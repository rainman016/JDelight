import type { Block, Claim, Citation } from "./report";
import type { Job, ReportVersion, SourceVersion } from "./schema";
import { citationLabel } from "./source";

export const KIND_LABEL = {
  source: "原文",
  inference: "推断",
  speculation: "推测",
  common: "通常",
} as const;
export const SECTION_TITLES = {
  positioning: "岗位定位",
  thresholds: "任职门槛",
  implicit: "隐含要求",
  capabilities: "能力解析",
  scenarios: "场景推测",
  preparation: "准备建议",
  toConfirm: "待确认事项",
} as const;
export const STRENGTH_LABEL = {
  required: "必备",
  preferred: "优先，不是必须",
  listed: "原文列出",
  not_stated: "原文未说明",
} as const;

export function reportDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

/** 只使用所选版本的完整快照，不读取当前补充表、标记或备注。 */
export function reportText(
  job: Job,
  report: ReportVersion,
  source: SourceVersion,
) {
  const refs = (citations: Citation[]) =>
    citations
      .map((citation) => {
        const line = source.lines.find(
          (item) => item.lineNo === citation.lineNo,
        );
        return `〔${line ? citationLabel(line) : `原文第 ${citation.lineNo} 行`}：${citation.quote}〕`;
      })
      .join(" ");
  const claim = (item: Claim) =>
    `${item.kind === "source" ? "" : `【${KIND_LABEL[item.kind]}】`}${item.text} ${refs(item.citations)}`.trim();
  const blockText = (block: Block): string => {
    switch (block.type) {
      case "paragraph":
        return block.claims.map(claim).join("\n");
      case "requirement":
        return `“${block.phrase}” · ${STRENGTH_LABEL[block.strength]}${block.degree ? ` · 程度词：${block.degree}` : ""}\n${refs(block.citations)}\n${claim(block.note)}`;
      case "capability":
        return `${block.name} · 重要程度：${block.importance === "high" ? "高" : "中"}\n${block.meaning.map(claim).join("\n")}`;
      case "scenario":
        return `${block.scene}\n可能的产品：${claim(block.product)}\n可能的难点：${claim(block.difficulty)}`;
      case "probe":
        return claim(block.claim);
      case "question":
        return `${block.question}\n为什么要问：${block.why}\n${refs(block.citations)}`;
    }
  };
  const supplements = (blockId: string) =>
    report.supplements
      .filter((item) => item.anchor.blockId === blockId)
      .map(
        (item) =>
          `我的补充 · 第 ${item.addedInVersion} 版加入 · ${KIND_LABEL[item.answerKind]}\n你选中的：${item.anchor.exact}\n${item.question}\n${item.answer}`,
      );
  const knownBlocks = new Set([
    report.content.focus.gist.id,
    ...report.content.focus.items.map((item) => item.id),
    ...report.content.sections.flatMap((section) =>
      section.blocks.map((block) => block.blockId),
    ),
  ]);
  return [
    "JDelight · 岗位报告",
    job.title || "未命名岗位",
    `${job.company || "未显示"} · ${job.place || "未显示"}`,
    `报告第 ${report.no} 版 · ${reportDate(report.createdAt)} · ${report.content.origin === "model" ? "真实分析" : "示例分析"}`,
    "只依据你确认的原文；推断、推测和通常做法都不是招聘方说过的话。",
    "原文写明的条件",
    ...report.content.header.shown.map(
      (item) => `${item.text} ${refs(item.citations)}`,
    ),
    `原文没写：${report.content.header.missing.join("、") || "无另列项"}`,
    "1 岗位速览 · 面试重点速览",
    claim(report.content.focus.gist),
    ...supplements(report.content.focus.gist.id),
    ...report.content.focus.items.flatMap((item, i) => [
      `${i + 1}. 【${KIND_LABEL[item.kind]}】${item.text}\n依据：${item.basis}\n${refs(item.citations)}`,
      ...supplements(item.id),
    ]),
    ...report.content.sections.flatMap((section, i) => [
      `${i + 2} ${SECTION_TITLES[section.key]}`,
      ...(section.status === "not_in_source"
        ? ["原文未体现"]
        : section.blocks.flatMap((block) => [
            blockText(block),
            ...supplements(block.blockId),
          ])),
    ]),
    ...report.supplements
      .filter((item) => !knownBlocks.has(item.anchor.blockId))
      .map(
        (item) =>
          `我的补充 · 第 ${item.addedInVersion} 版加入 · ${KIND_LABEL[item.answerKind]}\n你选中的：${item.anchor.exact}\n${item.question}\n${item.answer}`,
      ),
    "确认过的 JD 原文",
    ...source.lines.map((line) => `${line.lineNo}  ${line.text}`),
  ].join("\n\n");
}
