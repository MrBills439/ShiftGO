#!/usr/bin/env python3
"""
Accessibility regression check for the Expo app (run in CI).

Fails (exit 1) when any of these come back:
  - a Pressable / Touchable without accessibilityRole
  - an icon-only Pressable (no <Text> inside) without accessibilityLabel
  - a TextInput without accessibilityLabel (a placeholder is not a label)
  - an <Image> with neither accessibilityLabel nor accessible={false}
  - text scaling switched off (allowFontScaling={false})
  - a tap target under 44pt (width/height) with no hitSlop

Heuristic and regex-based (no RN parser), deliberately strict; if a case is a
genuine exception, make it explicit in the code (e.g. accessible={false}).
Usage: python3 scripts/a11y_check.py   (from mobile/)
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
ATTRS = r'((?:[^>"\'{}]|"[^"]*"|\'[^\']*\'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*)'
PRESSABLE = re.compile(r'<(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback)\b' + ATTRS + '>', re.S)
TEXT_INPUT = re.compile(r'<TextInput\b' + ATTRS + r'/?>', re.S)
IMAGE = re.compile(r'<Image\b' + ATTRS + r'/?>', re.S)
STYLE_DEF = re.compile(r'\n\s*(\w+):\s*\{([^{}]*)\}')


def line_of(src, offset):
    return src.count('\n', 0, offset) + 1


def main():
    problems = []
    files = sorted(list(ROOT.glob('app/**/*.tsx')) + list(ROOT.glob('components/**/*.tsx')))
    for f in files:
        src = f.read_text()
        rel = f.relative_to(ROOT)
        styles = {m.group(1): m.group(2) for m in STYLE_DEF.finditer(src)}
        for m in PRESSABLE.finditer(src):
            attrs = m.group(2)
            at = f'{rel}:{line_of(src, m.start())}'
            if 'accessibilityRole' not in attrs and 'role=' not in attrs:
                problems.append(f'{at}  {m.group(1)} has no accessibilityRole')
            close = src.find(f'</{m.group(1)}>', m.end())
            body = src[m.end():close] if close > 0 else ''
            if '<Text' not in body and 'accessibilityLabel' not in attrs:
                problems.append(f'{at}  icon-only {m.group(1)} has no accessibilityLabel')
            if 'hitSlop' not in attrs:
                for name in re.findall(r'\b(?:s|st|r|f|fi|styles|ir)\.(\w+)', attrs):
                    d = styles.get(name, '')
                    small = [int(v) for v in re.findall(r'(?<![a-zA-Z])(?:width|height):\s*(\d+)', d) if int(v) < 44]
                    min_h = re.search(r'minHeight:\s*(\d+)', d)
                    if small and not (min_h and int(min_h.group(1)) >= 44):
                        problems.append(f'{at}  tap target {name} is {min(small)}pt (<44) with no hitSlop')
        for m in TEXT_INPUT.finditer(src):
            if 'accessibilityLabel' not in m.group(1):
                problems.append(f'{rel}:{line_of(src, m.start())}  TextInput has no accessibilityLabel')
        for m in IMAGE.finditer(src):
            a = m.group(1)
            if 'accessibilityLabel' not in a and 'accessible={false}' not in a:
                problems.append(f'{rel}:{line_of(src, m.start())}  Image needs accessibilityLabel or accessible={{false}}')
        for m in re.finditer(r'allowFontScaling=\{false\}', src):
            problems.append(f'{rel}:{line_of(src, m.start())}  text scaling switched off')
    for p in problems:
        print(p)
    print(f'{len(problems)} accessibility problem(s) in {len(files)} files')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
