export type SourceSection = "meta" | "duty" | "must" | "bonus" | "other";
export interface SourceLine {
  lineNo: number;
  text: string;
  section: SourceSection;
  heading: boolean;
  itemNo: number | null;
}
export interface JobMeta {
  title: string;
  company: string;
  place: string;
}
export const SECTION_LABEL = {
  meta: "原文",
  duty: "职责",
  must: "要求",
  bonus: "加分项",
  other: "原文",
};
const HEADINGS: [RegExp, SourceSection][] = [
  [
    /^(岗位职责|工作职责|工作内容|你将负责|职位描述|岗位描述|职责描述|你要做的)$/,
    "duty",
  ],
  [
    /^(任职要求|任职资格|岗位要求|职位要求|我们希望你|职责要求|任职条件|基本要求|你需要具备|核心能力)$/,
    "must",
  ],
  [/^(加分项|加分条件|优先条件|优先考虑|加分|nicetohave)$/i, "bonus"],
];
function normalizeHeading(text: string): string {
  const unwrap = (value: string) =>
    value.replace(/^[\s【\[(（]+|[\s】\])）:：]+$/g, "");
  return unwrap(
    unwrap(text).replace(
      /^(?:[0-9一二三四五六七八九十百]+[\s、.．)）\]:：-]+)\s*/,
      "",
    ),
  )
    .replace(/\s*[-–—]\s*[A-Za-z].*$/, "")
    .replace(/[\s:：]/g, "");
}
export function classifySourceLine(
  line: SourceLine,
  current: SourceSection,
  counts: Record<SourceSection, number>,
): SourceSection {
  const text = line.text.trim();
  const normalized = normalizeHeading(text);
  const heading = HEADINGS.find(([re]) => re.test(normalized));
  line.heading = !!heading;
  line.section = heading?.[1] ?? (text ? current : "other");
  if (heading) return heading[1];
  if (text && current !== "meta" && current !== "other")
    line.itemNo = ++counts[current];
  return current;
}
export function splitSource(text: string): SourceLine[] {
  return text.split(/\r\n|\n|\r/).map((text, i) => ({
    lineNo: i + 1,
    text,
    section: "other",
    heading: false,
    itemNo: null,
  }));
}
export function sourceLines(text: string): SourceLine[] {
  const lines = splitSource(text);
  const counts = { meta: 0, duty: 0, must: 0, bonus: 0, other: 0 };
  let section: SourceSection = "meta";
  for (const line of lines) section = classifySourceLine(line, section, counts);
  return lines;
}
export function citationLabel(line: SourceLine): string {
  if (/^岗位名称[:：]/.test(line.text.trim())) return "岗位名称";
  if (/^薪资待遇[:：]/.test(line.text.trim())) return "薪资待遇";
  if (line.itemNo !== null)
    return `${SECTION_LABEL[line.section]}第 ${line.itemNo} 条`;
  return `原文第 ${line.lineNo} 行`;
}
export function metaFrom(text: string): JobMeta {
  const pick = (re: RegExp) => text.match(re)?.[1]?.trim() ?? "";
  const [company = "", inlinePlace = ""] =
    pick(/^公司[:：][ \t]*(.+)$/m).split(/\s*[·・]\s*/);
  return {
    title: pick(/^岗位名称[:：][ \t]*(.+)$/m),
    company,
    place: pick(/^(?:地点|工作地点)[:：][ \t]*(.+)$/m) || inlinePlace,
  };
}
export function hasSourceEllipsis(text: string): boolean {
  return /…|\.{3}/.test(text);
}
export function checksOf(lines: SourceLine[], meta?: JobMeta) {
  const found = new Set(lines.filter((l) => l.heading).map((l) => l.section));
  const notes: { level: "warn" | "ok"; text: string; lineNo?: number }[] = [];
  if (!found.has("duty"))
    notes.push({
      level: "warn",
      text: "没找到“岗位职责”分区。如果原文本来就没有，可以直接确认。",
    });
  if (!found.has("must"))
    notes.push({
      level: "warn",
      text: "没找到“任职要求”分区。分析会把要求当作“原文未写明”。",
    });
  for (const line of lines) {
    const text = line.text.trim();
    const identityField = /^(?:岗位名称|公司)[:：]/.test(text);
    const middleEllipsis = [...text.matchAll(/…+|\.{3,}/g)].some(
      (match) =>
        text.slice(0, match.index).trim() &&
        text.slice(match.index + match[0].length).trim(),
    );
    if ((identityField && hasSourceEllipsis(text)) || middleEllipsis)
      notes.push({
        level: "warn",
        text: `第 ${line.lineNo} 行有省略号，原文可能不完整；分析不会补全。`,
        lineNo: line.lineNo,
      });
  }
  if (meta) {
    const original = metaFrom(lines.map((line) => line.text).join("\n"));
    for (const [key, label] of [
      ["title", "岗位名称"],
      ["company", "公司"],
    ] as const)
      if (hasSourceEllipsis(meta[key]) && meta[key] !== original[key])
        notes.push({
          level: "warn",
          text: `${label}有省略号，原文可能不完整；分析不会补全。`,
        });
  }
  const last = [...lines].reverse().find((l) => l.text.trim());
  if (last && /(?:…|\.\.\.|，|,|、|和|及)$/.test(last.text.trim()))
    notes.push({
      level: "warn",
      text: `第 ${last.lineNo} 行像是没写完，可能复制时被截断。`,
      lineNo: last.lineNo,
    });
  if (!notes.length)
    notes.push({ level: "ok", text: "分区齐全，没发现被截断的迹象。" });
  return notes;
}
