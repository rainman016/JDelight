import {
  jobSchema,
  markSchema,
  sourceVersionSchema,
  reportVersionSchema,
  type Job,
  type Mark,
  type SourceVersion,
} from "@/domain/schema";
import { sourceLines, type JobMeta } from "@/domain/source";
import { validateReport } from "@/domain/report";
import { getDatabase, type JDelightDatabase } from "./database";

export function createRepository(db: JDelightDatabase) {
  const createJob = async (
    text: string,
    meta: JobMeta,
    requestId = crypto.randomUUID(),
  ) => {
    if (text.trim().length < 40 || text.length > 12000)
      throw new Error("岗位描述需为 40–12,000 字，原文仍保留在校对页");
    const now = new Date().toISOString();
    const source = sourceVersionSchema.parse({
      id: crypto.randomUUID(),
      jobId: requestId,
      no: 1,
      text,
      lines: sourceLines(text),
      confirmedAt: now,
    });
    const job = jobSchema.parse({
      id: requestId,
      ...meta,
      mark: "preparing",
      note: "",
      status: "saved",
      currentSourceVersionId: source.id,
      currentReportVersionId: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      lastViewedAt: now,
    });
    return db.transaction("rw", db.jobs, db.sourceVersions, async () => {
      const existing = await db.jobs.get(requestId);
      if (existing) {
        const saved = await db.sourceVersions.get(
          existing.currentSourceVersionId,
        );
        if (
          saved?.text !== text ||
          existing.title !== meta.title ||
          existing.company !== meta.company ||
          existing.place !== meta.place
        )
          throw new Error("已确认的原文不可改写，可以另贴一份 JD");
        return existing;
      }
      await db.jobs.add(job);
      await db.sourceVersions.add(source);
      return job;
    });
  };
  const patchJob = (
    id: string,
    patch: Partial<
      Pick<Job, "mark" | "note" | "lastViewedAt" | "status" | "lastError">
    >,
  ) =>
    db.transaction("rw", db.jobs, async () => {
      const job = await db.jobs.get(id);
      if (!job) throw new Error("没找到这个岗位");
      const next = jobSchema.parse({
        ...job,
        ...patch,
        updatedAt: new Date().toISOString(),
      });
      await db.jobs.put(next);
      return next;
    });
  const patchAnalysis = (
    id: string,
    status: "saved" | "analyzing" | "failed",
    lastError: Job["lastError"] = null,
  ) =>
    db.transaction("rw", db.jobs, async () => {
      const current = await db.jobs.get(id);
      if (!current) throw new Error("没找到这个岗位");
      // 另一个页面可能已经提交成功；迟到的开始、取消或失败都不能降级 ready。
      if (current.currentReportVersionId !== null) return current;
      return patchJob(id, { status, lastError });
    });
  const readJob = (id: string) =>
    db.transaction(
      "r",
      db.jobs,
      db.sourceVersions,
      db.reportVersions,
      async () => {
        const job = await db.jobs.get(id);
        if (!job) return null;
        const source = await db.sourceVersions.get(job.currentSourceVersionId);
        if (!source) throw new Error("岗位原文没有读取成功，可以返回首页再试");
        const report = job.currentReportVersionId
          ? await db.reportVersions.get(job.currentReportVersionId)
          : undefined;
        if (job.currentReportVersionId && !report)
          throw new Error("报告没有读取成功，原文仍在本机");
        const storedReport = report
          ? reportVersionSchema.parse(report)
          : undefined;
        const versions = (
          await db.reportVersions.where("jobId").equals(id).sortBy("no")
        ).map((version) => reportVersionSchema.parse(version));
        const sources = (
          await db.sourceVersions.where("jobId").equals(id).toArray()
        ).map((version) => sourceVersionSchema.parse(version));
        return { job, source, report: storedReport, versions, sources };
      },
    );
  return {
    createJob,
    readJob,
    listJobs: () =>
      db.transaction("r", db.jobs, db.reportVersions, async () => {
        const jobs = await db.jobs.orderBy("updatedAt").reverse().toArray();
        return Promise.all(
          jobs.map(async (job) => ({
            job,
            report: job.currentReportVersionId
              ? await db.reportVersions.get(job.currentReportVersionId)
              : undefined,
          })),
        );
      }),
    getSource: async (job: Job): Promise<SourceVersion> => {
      const source = await db.sourceVersions.get(job.currentSourceVersionId);
      if (!source) throw new Error("原文没有读取成功");
      return source;
    },
    startAnalysis: (id: string) => patchAnalysis(id, "analyzing"),
    cancelAnalysis: (id: string) => patchAnalysis(id, "saved"),
    failAnalysis: (id: string, lastError: NonNullable<Job["lastError"]>) =>
      patchAnalysis(id, "failed", lastError),
    setMark: (id: string, mark: Mark) =>
      patchJob(id, { mark: markSchema.parse(mark) }),
    setNote: (id: string, note: string) => patchJob(id, { note: note.trim() }),
    recordView: (id: string) =>
      patchJob(id, { lastViewedAt: new Date().toISOString() }),
    saveReport: async (
      jobId: string,
      source: SourceVersion,
      input: unknown,
      expectedParentId: string | null,
    ) => {
      const content = validateReport(input, source);
      return db.transaction(
        "rw",
        db.jobs,
        db.sourceVersions,
        db.reportVersions,
        async () => {
          const job = await db.jobs.get(jobId);
          if (!job) throw new Error("没找到这个岗位");
          if (job.currentReportVersionId !== expectedParentId)
            throw new Error("另一个页面已经更新了报告，未覆盖现有版本");
          if (
            source.jobId !== jobId ||
            job.currentSourceVersionId !== source.id
          )
            throw new Error("原文版本已变化，未保存报告");
          const stored = await db.sourceVersions.get(source.id);
          if (
            !stored ||
            stored.text !== source.text ||
            JSON.stringify(stored.lines) !== JSON.stringify(source.lines)
          )
            throw new Error("原文与本机版本不一致，未保存报告");
          // 基础分析仅创建一次；补充产生的新版本由独立事务处理。
          if (expectedParentId !== null)
            throw new Error("基础分析已经存在，不重复创建");
          const report = reportVersionSchema.parse({
            id: crypto.randomUUID(),
            jobId,
            sourceVersionId: source.id,
            no: 1,
            parentId: null,
            content,
            supplements: [],
            change: { kind: "base", summary: "基础分析" },
            createdAt: new Date().toISOString(),
          });
          await db.reportVersions.add(report);
          await db.jobs.update(jobId, {
            currentReportVersionId: report.id,
            status: "ready",
            lastError: null,
            updatedAt: report.createdAt,
          });
          return report;
        },
      );
    },
    deleteJob: (id: string) =>
      db.transaction(
        "rw",
        db.jobs,
        db.sourceVersions,
        db.reportVersions,
        db.supplements,
        async () => {
          await db.sourceVersions.where("jobId").equals(id).delete();
          await db.reportVersions.where("jobId").equals(id).delete();
          await db.supplements.where("jobId").equals(id).delete();
          await db.jobs.delete(id);
        },
      ),
  };
}
export const repository = () => createRepository(getDatabase());
