"use client";

import { useSyncExternalStore, type ComponentType } from "react";
import { getUtility, ENGINE_INFO, type Engine } from "@/lib/utilities/catalog";
import { Workbench } from "../workbench";
import {
  CardEngine,
  CodesEngine,
  EscapeEngine,
  FancyEngine,
  IeeeEngine,
  LinesEngine,
  LoremEngine,
  MorseEngine,
  NumWordsEngine,
  RepeatEngine,
  RomanEngine,
  SummarizeEngine,
  type EngineProps,
} from "./text-engines";
import {
  EditorEngine,
  FormatEngine,
  HtmlViewerEngine,
  MinifyEngine,
  ValidateEngine,
} from "./code-engines";
import {
  JsonPathEngine,
  UriTemplateEngine,
  XmlViewerEngine,
  XPathEngine,
  XsdEngine,
  XsltEngine,
} from "./xml-engines";
import { HashEngine, RandomEngine } from "./data-engines";
import { MarkdownEngine } from "./markdown-engine";
import { CalculatorEngine } from "./calculator-engine";
import { FindReplaceEngine, SplitEngine } from "./string-engines";
import {
  DeviceEngine,
  NetworkEngine,
  TextImageEngine,
  WebGenEngine,
} from "./web-engines";
import {
  DateEngine,
  TimerEngine,
  UnitEngine,
  WorldClockEngine,
} from "./everyday-engines";
import {
  EncryptEngine,
  ExifEngine,
  PasswordEngine,
  QrScanEngine,
} from "./privacy-engines";
import { ContrastEngine, CssGenEngine } from "./design-engines";
import { CronEngine } from "./cron-engine";
import { MorseAudioEngine } from "./morse-audio-engine";
import {
  ChmodEngine,
  CodeTypesEngine,
  DataConvertEngine,
} from "./dev-data-engines";
import { DataViewerEngine } from "./data-viewer-engine";
import {
  LayoutPlaygroundEngine,
  PaletteScaleEngine,
  SvgOptimizerEngine,
} from "./design-extra-engines";
import {
  CaseConvertEngine,
  ListCompareEngine,
  TextCleanerEngine,
  WordCountEngine,
} from "./text-extra-engines";
import {
  BillSplitEngine,
  FinanceCalcEngine,
  GstPercentEngine,
  InvoiceSignEngine,
} from "./finance-engines";

const ENGINES: Record<Engine, ComponentType<EngineProps>> = {
  codes: CodesEngine,
  fancy: FancyEngine,
  numwords: NumWordsEngine,
  roman: RomanEngine,
  repeat: RepeatEngine,
  lines: LinesEngine,
  morse: MorseEngine,
  "morse-audio": MorseAudioEngine,
  lorem: LoremEngine,
  summarize: SummarizeEngine,
  "text-image": TextImageEngine,
  format: FormatEngine,
  minify: MinifyEngine,
  validate: ValidateEngine,
  card: CardEngine,
  editor: EditorEngine,
  "html-viewer": HtmlViewerEngine,
  markdown: MarkdownEngine,
  calculator: CalculatorEngine,
  "find-replace": FindReplaceEngine,
  split: SplitEngine,
  xpath: XPathEngine,
  xslt: XsltEngine,
  xsd: XsdEngine,
  "xml-viewer": XmlViewerEngine,
  jsonpath: JsonPathEngine,
  uritemplate: UriTemplateEngine,
  escape: EscapeEngine,
  ieee: IeeeEngine,
  hash: HashEngine,
  random: RandomEngine,
  network: NetworkEngine,
  device: DeviceEngine,
  webgen: WebGenEngine,
  units: UnitEngine,
  worldclock: WorldClockEngine,
  timer: TimerEngine,
  date: DateEngine,
  password: PasswordEngine,
  encrypt: EncryptEngine,
  qrscan: QrScanEngine,
  exif: ExifEngine,
  cron: CronEngine,
  contrast: ContrastEngine,
  cssgen: CssGenEngine,
  "data-convert": DataConvertEngine,
  "code-types": CodeTypesEngine,
  chmod: ChmodEngine,
  "data-viewer": DataViewerEngine,
  "svg-opt": SvgOptimizerEngine,
  "layout-play": LayoutPlaygroundEngine,
  "palette-scale": PaletteScaleEngine,
  "word-count": WordCountEngine,
  "case-convert": CaseConvertEngine,
  "list-compare": ListCompareEngine,
  "text-cleaner": TextCleanerEngine,
  "finance-calc": FinanceCalcEngine,
  "gst-percent": GstPercentEngine,
  "bill-split": BillSplitEngine,
  "invoice-sign": InvoiceSignEngine,
};

/**
 * Every Developer, Text and Everyday utility page: one engine per job, with the page's preset
 * (an algorithm, a language, a direction) as its starting state.
 */
const noop = () => () => {};

export function UtilityTool({ toolId }: { toolId: string }) {
  // Engines use browser APIs (DOMParser, crypto, canvas) and random output, so they render in the
  // browser only; the server sends a same-sized placeholder, which avoids hydration mismatches.
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const def = getUtility(toolId)!;
  const info = ENGINE_INFO[def.engine];
  const Engine = ENGINES[def.engine];
  const footer = info.server
    ? def.engine === "xsd" || def.engine === "xslt"
      ? "Your XML is sent to our server to be processed, then discarded. Nothing is stored."
      : "Lookups run from our server against public addresses only. Nothing you enter is stored."
    : def.preset?.kind === "myip"
      ? "Your address is read from this one request and never stored."
      : def.engine === "units"
        ? "Runs in your browser. Currency rates are fetched from frankfurter.dev (European Central Bank data); nothing you type is sent."
        : def.engine === "morse-audio"
          ? "Your recordings and microphone are decoded on this device. Nothing is uploaded."
          : def.engine === "exif" ||
              def.engine === "qrscan" ||
              def.engine === "data-viewer" ||
              def.preset?.kind === "mic"
            ? "Your files, photos, camera and microphone stay on this device. Nothing is uploaded."
            : "Everything here runs in your browser. Nothing you type is sent anywhere.";
  return (
    <Workbench steps={info.steps} current={1} footer={footer}>
      <div className="@container grid gap-3 p-3 sm:p-4 md:gap-4 md:p-5">
        {mounted ? (
          <Engine key={toolId} preset={def.preset ?? {}} />
        ) : (
          <div aria-hidden className="grid gap-3">
            <div className="h-28 animate-pulse rounded-md border border-dashed border-line" />
            <div className="h-56 animate-pulse rounded-md border border-line bg-paper" />
          </div>
        )}
      </div>
    </Workbench>
  );
}
