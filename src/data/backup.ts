import { parseBackup, type Backup } from "@/domain/backup";
import type { JDelightDatabase } from "./database";
import { dataRevision, markDataChanged } from "./revision";

export function createBackupRepository(db: JDelightDatabase) {
  const exportData = () =>
    db.transaction(
      "r",
      db.jobs,
      db.sourceVersions,
      db.reportVersions,
      db.supplements,
      db.meta,
      async () => ({
        data: parseBackup({
          format: "jdelight-backup",
          formatVersion: 1,
          schemaVersion: 2,
          exportedAt: new Date().toISOString(),
          jobs: await db.jobs.toArray(),
          sourceVersions: await db.sourceVersions.toArray(),
          reportVersions: await db.reportVersions.toArray(),
          supplements: await db.supplements.toArray(),
        }),
        revision: await dataRevision(db),
      }),
    );
  return {
    exportData,
    backupStatus: () =>
      db.transaction(
        "r",
        db.jobs,
        db.reportVersions,
        db.supplements,
        db.meta,
        async () => {
          const lastExportAt =
            (await db.meta.get("lastExportAt"))?.value ?? null;
          const revision = await dataRevision(db),
            exported = (await db.meta.get("exportedRevision"))?.value;
          const jobs = await db.jobs.count();
          return {
            jobs,
            versions: await db.reportVersions.count(),
            notes: await db.supplements.count(),
            lastExportAt,
            dirty: lastExportAt ? revision !== exported : jobs > 0,
          };
        },
      ),
    markExported: (exportedAt: string, revision: string) =>
      db.transaction("rw", db.meta, async () => {
        // 记导出快照的修订号，下载期间又有写入时仍提示未备份。
        await db.meta.bulkPut([
          { key: "lastExportAt", value: exportedAt },
          { key: "exportedRevision", value: revision },
        ]);
      }),
    previewImport: async (input: unknown) => {
      const data = parseBackup(input);
      return db.transaction("r", db.jobs, db.meta, async () => {
        const ids = new Set(await db.jobs.toCollection().primaryKeys());
        return {
          data,
          duplicates: data.jobs.filter((job) => ids.has(job.id)).length,
          localJobs: ids.size,
          revision: await dataRevision(db),
        };
      });
    },
    importData: async (
      input: Backup,
      mode: "merge" | "replace",
      expectedRevision: string,
    ) => {
      const data = parseBackup(input);
      if (mode !== "merge" && mode !== "replace")
        throw new Error("导入方式不支持，本机数据没有变化");
      const local = await db.transaction(
        "r",
        db.jobs,
        db.sourceVersions,
        db.reportVersions,
        db.supplements,
        db.meta,
        async () => ({
          jobs: new Set(await db.jobs.toCollection().primaryKeys()),
          sources: new Set(
            await db.sourceVersions.toCollection().primaryKeys(),
          ),
          reports: new Set(
            await db.reportVersions.toCollection().primaryKeys(),
          ),
          notes: new Set(await db.supplements.toCollection().primaryKeys()),
          revision: await dataRevision(db),
        }),
      );
      if (local.revision !== expectedRevision)
        throw new Error("本机数据在预览后有变化，重新选择文件查看后再导入");
      const incoming = structuredClone(data);
      if (mode === "merge") {
        for (const job of incoming.jobs) {
          const originalId = job.id;
          const sources = incoming.sourceVersions.filter(
            (item) => item.jobId === originalId,
          );
          const reports = incoming.reportVersions.filter(
            (item) => item.jobId === originalId,
          );
          const notes = incoming.supplements.filter(
            (item) => item.jobId === originalId,
          );
          const duplicate = local.jobs.has(originalId);
          if (
            !duplicate &&
            !sources.some((item) => local.sources.has(item.id)) &&
            !reports.some((item) => local.reports.has(item.id)) &&
            !notes.some((item) => local.notes.has(item.id))
          )
            continue;
          const jobId = duplicate ? crypto.randomUUID() : originalId;
          const ids = new Map(
            [...sources, ...reports, ...notes].map((item) => [
              item.id,
              crypto.randomUUID(),
            ]),
          );
          const remap = (id: string) => {
            const mapped = ids.get(id);
            if (!mapped) throw new Error("备份引用无法对应，本机数据没有变化");
            return mapped;
          };
          const anchor = (value: Backup["supplements"][number]["anchor"]) => ({
            ...value,
            reportVersionId: remap(value.reportVersionId),
            sourceVersionId: remap(value.sourceVersionId),
          });
          job.id = jobId;
          if (duplicate)
            job.title = `${job.title || "未命名岗位"}（导入的副本）`;
          job.currentSourceVersionId = remap(job.currentSourceVersionId);
          if (job.currentReportVersionId)
            job.currentReportVersionId = remap(job.currentReportVersionId);
          for (const source of sources) {
            source.id = remap(source.id);
            source.jobId = jobId;
          }
          for (const report of reports) {
            report.id = remap(report.id);
            report.jobId = jobId;
            report.sourceVersionId = remap(report.sourceVersionId);
            report.content.sourceVersionId = remap(
              report.content.sourceVersionId,
            );
            if (report.parentId) report.parentId = remap(report.parentId);
            if (report.change.supplementId)
              report.change.supplementId = remap(report.change.supplementId);
            report.supplements = report.supplements.map((item) => ({
              ...item,
              supplementId: remap(item.supplementId),
              anchor: anchor(item.anchor),
            }));
          }
          for (const note of notes) {
            note.id = remap(note.id);
            note.jobId = jobId;
            note.anchor = anchor(note.anchor);
          }
        }
      }
      parseBackup(incoming);
      return db.transaction(
        "rw",
        db.jobs,
        db.sourceVersions,
        db.reportVersions,
        db.supplements,
        db.meta,
        async () => {
          if ((await dataRevision(db)) !== expectedRevision)
            throw new Error(
              "本机数据在预览后有变化，没有覆盖，重新选择文件后再试",
            );
          if (mode === "replace") {
            await db.supplements.clear();
            await db.reportVersions.clear();
            await db.sourceVersions.clear();
            await db.jobs.clear();
          }
          await db.jobs.bulkAdd(incoming.jobs);
          await db.sourceVersions.bulkAdd(incoming.sourceVersions);
          await db.reportVersions.bulkAdd(incoming.reportVersions);
          await db.supplements.bulkAdd(incoming.supplements);
          await markDataChanged(db);
          return {
            jobs: incoming.jobs.length,
            versions: incoming.reportVersions.length,
            notes: incoming.supplements.length,
          };
        },
      );
    },
  };
}
