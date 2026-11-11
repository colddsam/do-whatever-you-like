/** Jobs that work today: every one of these is a live tool. */
const tasks = [
  "Merge PDFs",
  "PDF to Word",
  "Sign PDFs",
  "Remove backgrounds",
  "HEIC to JPG",
  "Resize images",
  "Download reels",
  "Save YouTube videos",
  "Transcribe audio",
  "Extract MP3s",
  "Blur faces",
  "Make QR codes",
];

export function Marquee() {
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden} className="flex shrink-0 items-center">
      {tasks.map((t) => (
        <li key={t} className="flex items-center gap-8 pr-8 text-lg font-medium tracking-[-0.01em] text-ink-2 md:text-xl">
          {t}
          <span aria-hidden className="size-1.5 rounded-full bg-ink-3/60" />
        </li>
      ))}
    </ul>
  );

  return (
    <section aria-label="Things you can do" className="border-y border-line bg-paper-2/50">
      <div className="group relative flex overflow-hidden py-6 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        <div className="flex animate-marquee group-hover:[animation-play-state:paused]">
          {row(false)}
          {row(true)}
        </div>
      </div>
    </section>
  );
}
