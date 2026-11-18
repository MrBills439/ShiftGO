import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { D } from '../constants/theme';

/**
 * Renders a privacy notice written in a tiny Markdown subset: "# " / "## "
 * headings, "- " bullets, paragraphs. Same rules as the web NoticeText.
 */
export function NoticeText({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      out.push(<Text key={`p${out.length}`} style={st.p}>{para.join(' ')}</Text>);
      para = [];
    }
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('# ')) { flush(); out.push(<Text key={`h${out.length}`} accessibilityRole="header" style={st.h1}>{line.slice(2)}</Text>); }
    else if (line.startsWith('## ')) { flush(); out.push(<Text key={`h${out.length}`} accessibilityRole="header" style={st.h2}>{line.slice(3)}</Text>); }
    else if (line.startsWith('- ')) {
      flush();
      out.push(
        <View key={`li${out.length}`} style={st.li}>
          <Text style={st.bullet}>{'•'}</Text>
          <Text style={[st.p, st.liText]}>{line.slice(2)}</Text>
        </View>,
      );
    } else if (line.trim() === '') flush();
    else para.push(line.trim());
  }
  flush();
  return <View style={st.wrap}>{out}</View>;
}

const st = StyleSheet.create({
  wrap: { gap: 10 },
  h1: { fontSize: 20, fontWeight: '700', color: D.text },
  h2: { fontSize: 15, fontWeight: '700', color: D.text, marginTop: 6 },
  p: { fontSize: 14, lineHeight: 21, color: D.text },
  li: { flexDirection: 'row', gap: 8, paddingLeft: 4 },
  bullet: { fontSize: 14, lineHeight: 21, color: D.muted },
  liText: { flex: 1 },
});
