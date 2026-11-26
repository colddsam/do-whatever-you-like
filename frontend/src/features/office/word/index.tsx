"use client";

import dynamic from "next/dynamic";

/** Entry for /tools/word-editor: client-only (contentEditable document, IndexedDB autosave). */
const Editor = dynamic(() => import("./editor").then((m) => m.WordEditorEntry), {
  ssr: false,
  loading: () => <div aria-hidden className="h-[calc(100dvh-140px)] min-h-[560px] animate-pulse rounded-lg border border-line bg-surface lg:h-[min(86dvh,1100px)]" />,
});

/** The playground passes `toolId`; there's one word processor, so it isn't read. */
export function WordEditorTool(_props: { toolId: string }) {
  void _props;
  return <Editor />;
}
