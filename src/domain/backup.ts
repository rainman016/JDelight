import { z } from "zod";
import {
  jobSchema,
  sourceVersionSchema,
  reportVersionSchema,
  supplementSchema,
} from "./schema";
import { splitSource } from "./source";
import { reportBlockIds } from "./supplements";

const backupShape = z.strictObject({
  format: z.literal("jdelight-backup"),
  formatVersion: z.literal(1),
  schemaVersion: z.literal(2),
  exportedAt: z.iso.datetime(),
  jobs: z.array(jobSchema),
  sourceVersions: z.array(sourceVersionSchema),
  reportVersions: z.array(reportVersionSchema),
  supplements: z.array(supplementSchema),
});
export type Backup = z.infer<typeof backupShape>;
export const backupSchema = backupShape.superRefine((data, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  for (const rows of [
    data.jobs,
    data.sourceVersions,
    data.reportVersions,
    data.supplements,
  ])
    if (new Set(rows.map((item) => item.id)).size !== rows.length)
      fail("备份存在重复编号");
  const jobs = new Map(data.jobs.map((item) => [item.id, item]));
  const sources = new Map(data.sourceVersions.map((item) => [item.id, item]));
  const reports = new Map(data.reportVersions.map((item) => [item.id, item]));
  const notes = new Map(data.supplements.map((item) => [item.id, item]));
  for (const source of data.sourceVersions) {
    const lines = splitSource(source.text);
    if (
      !jobs.has(source.jobId) ||
      lines.length !== source.lines.length ||
      lines.some(
        (line, i) =>
          line.lineNo !== source.lines[i].lineNo ||
          line.text !== source.lines[i].text,
      )
    )
      fail("备份原文或岗位关联不完整");
  }
  const checkAnchor = (
    anchor: Backup["supplements"][number]["anchor"],
    jobId: string,
  ) => {
    const parent = reports.get(anchor.reportVersionId);
    if (
      !parent ||
      parent.jobId !== jobId ||
      parent.sourceVersionId !== anchor.sourceVersionId ||
      !reportBlockIds(parent.content).has(anchor.blockId)
    )
      fail("备份补充的选中文字关联不完整");
  };
  for (const report of data.reportVersions) {
    const stableIds = [
      ...report.content.header.shown.map((item) => item.id),
      report.content.focus.gist.id,
      ...report.content.focus.items.map((item) => item.id),
    ];
    const allowed = {
      positioning: ["paragraph"],
      thresholds: ["requirement", "paragraph"],
      implicit: ["paragraph"],
      capabilities: ["capability"],
      scenarios: ["scenario", "paragraph"],
      preparation: ["paragraph", "probe"],
      toConfirm: ["question"],
    };
    for (const section of report.content.sections) {
      if (
        (section.status === "not_in_source") !==
          (section.blocks.length === 0) ||
        section.blocks.some(
          (block) => !allowed[section.key].includes(block.type),
        )
      )
        fail("备份报告的章节状态或内容类型不完整");
      for (const block of section.blocks) {
        stableIds.push(block.blockId);
        if (block.type === "paragraph")
          stableIds.push(...block.claims.map((item) => item.id));
        else if (block.type === "requirement") stableIds.push(block.note.id);
        else if (block.type === "capability")
          stableIds.push(...block.meaning.map((item) => item.id));
        else if (block.type === "scenario")
          stableIds.push(block.product.id, block.difficulty.id);
        else if (block.type === "probe") {
          stableIds.push(block.claim.id);
          if (block.claim.kind !== "speculation")
            fail("备份报告的追问类型不完整");
        }
      }
    }
    if (
      new Set(stableIds).size !== stableIds.length ||
      report.content.focus.gist.kind !== "inference"
    )
      fail("备份报告的稳定编号或速览类型不完整");
    if (
      !jobs.has(report.jobId) ||
      sources.get(report.sourceVersionId)?.jobId !== report.jobId ||
      report.content.sourceVersionId !== report.sourceVersionId
    )
      fail("备份报告与原文关联不完整");
    if (
      report.content.sections.some(
        (section, index) =>
          section.key !==
          [
            "positioning",
            "thresholds",
            "implicit",
            "capabilities",
            "scenarios",
            "preparation",
            "toConfirm",
          ][index],
      )
    )
      fail("备份报告章节顺序不完整");
    if (
      report.no === 1
        ? report.parentId !== null ||
          report.change.kind !== "base" ||
          report.supplements.length > 0
        : !report.parentId ||
          reports.get(report.parentId)?.jobId !== report.jobId ||
          reports.get(report.parentId)?.no !== report.no - 1 ||
          report.change.kind === "base"
    )
      fail("备份报告版本链不完整");
    if (
      report.change.kind !== "base" &&
      (!report.change.supplementId ||
        notes.get(report.change.supplementId)?.jobId !== report.jobId)
    )
      fail("备份版本变化没有对应补充");
    if (
      new Set(report.supplements.map((item) => item.supplementId)).size !==
      report.supplements.length
    )
      fail("备份版本存在重复补充");
    for (const snapshot of report.supplements) {
      if (
        snapshot.anchor.sourceVersionId !== report.sourceVersionId ||
        (reports.get(snapshot.anchor.reportVersionId)?.no ?? Infinity) >=
          snapshot.addedInVersion
      )
        fail("备份补充的加入版本关系不完整");
      if (
        notes.get(snapshot.supplementId)?.jobId !== report.jobId ||
        snapshot.addedInVersion > report.no ||
        !reportBlockIds(report.content).has(snapshot.anchor.blockId)
      )
        fail("备份补充快照不完整");
      checkAnchor(snapshot.anchor, report.jobId);
    }
  }
  for (const job of data.jobs) {
    const versions = data.reportVersions
      .filter((item) => item.jobId === job.id)
      .sort((a, b) => a.no - b.no);
    const current = job.currentReportVersionId
      ? reports.get(job.currentReportVersionId)
      : undefined;
    if (
      sources.get(job.currentSourceVersionId)?.jobId !== job.id ||
      (job.currentReportVersionId &&
        (!current ||
          current.jobId !== job.id ||
          current.sourceVersionId !== job.currentSourceVersionId)) ||
      (job.status === "ready") !== !!current ||
      (versions.length && versions.at(-1)?.id !== current?.id) ||
      versions.some((version, i) => version.no !== i + 1)
    )
      fail("备份岗位的当前版本关联不完整");
  }
  for (const note of data.supplements) {
    if (note.status === "unanswered" && note.answer !== "")
      fail("备份未解答的问题含有不一致的解答状态");
    if (
      !jobs.has(note.jobId) ||
      !note.question.trim() ||
      (note.status !== "unanswered" && !note.answer.trim()) ||
      (note.status === "added" || note.status === "withdrawn") !==
        (note.addedInVersion !== null)
    )
      fail("备份疑问状态不完整");
    checkAnchor(note.anchor, note.jobId);
    const current = reports.get(
      jobs.get(note.jobId)?.currentReportVersionId ?? "",
    );
    const snapshot = current?.supplements.find(
      (item) => item.supplementId === note.id,
    );
    if (
      note.addedInVersion !== null &&
      (note.addedInVersion > (current?.no ?? 0) ||
        (reports.get(note.anchor.reportVersionId)?.no ?? Infinity) >=
          note.addedInVersion)
    )
      fail("备份疑问的加入版本关系不完整");
    if (
      note.status === "added"
        ? !snapshot ||
          snapshot.answer !== note.answer ||
          snapshot.question !== note.question ||
          snapshot.answerKind !== note.answerKind ||
          snapshot.addedInVersion !== note.addedInVersion ||
          JSON.stringify(snapshot.anchor) !== JSON.stringify(note.anchor)
        : !!snapshot
    )
      fail("备份当前补充与报告快照不一致");
  }
});
export function parseBackup(input: unknown): Backup {
  if (typeof input === "object" && input !== null) {
    const value = input as Record<string, unknown>;
    if (
      (typeof value.formatVersion === "number" && value.formatVersion > 1) ||
      (typeof value.schemaVersion === "number" && value.schemaVersion > 2)
    )
      throw new Error(
        "备份来自更新版本的 JDelight，更新后再导入；本机数据没有变化。",
      );
  }
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) {
    const relation = parsed.error.issues.find(
      (issue) => issue.code === "custom",
    );
    throw new Error(
      relation?.message ??
        "这不是完整的 JDelight 备份文件，或文件版本不支持；本机数据没有变化。",
    );
  }
  return parsed.data;
}
