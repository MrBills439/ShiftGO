'use client';
/**
 * Renders a privacy notice written in a tiny Markdown subset: "# " / "## "
 * headings, "- " bullet lists and paragraphs. Builds React elements only (no
 * HTML injection), so HR-entered text can never run script in staff browsers.
 */
import type { ReactNode } from 'react';

export function NoticeText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (list.length) {
      const items = list;
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-fg">
          {items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>,
      );
      list = [];
    }
  };
  const flushPara = () => {
    if (para.length) {
      blocks.push(<p key={`p-${blocks.length}`} className="text-sm leading-relaxed text-fg">{para.join(' ')}</p>);
      para = [];
    }
  };

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('# ')) {
      flushList(); flushPara();
      blocks.push(<h2 key={`h-${blocks.length}`} className="text-lg font-semibold text-fg">{line.slice(2)}</h2>);
    } else if (line.startsWith('## ')) {
      flushList(); flushPara();
      blocks.push(<h3 key={`h-${blocks.length}`} className="pt-2 text-sm font-semibold text-fg">{line.slice(3)}</h3>);
    } else if (line.startsWith('- ')) {
      flushPara();
      list.push(line.slice(2));
    } else if (line.trim() === '') {
      flushList(); flushPara();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushList(); flushPara();
  return <div className="space-y-3">{blocks}</div>;
}
