import type { ReportContent } from "./report";
export function reportBlockIds(content: ReportContent) {
  return new Set([
    content.focus.gist.id,
    ...content.focus.items.map((item) => item.id),
    ...content.sections.flatMap((section) =>
      section.blocks.map((block) => block.blockId),
    ),
  ]);
}
export function questionText(text: string) {
  const value = text.trim();
  if (!value || value.length > 2000)
    throw new Error("问题需要 1–2,000 字，输入仍保留");
  return value;
}
export function answerText(text: string) {
  const value = text.trim();
  if (!value || value.length > 12000)
    throw new Error("解答需要 1–12,000 字，输入仍保留");
  return value;
}
