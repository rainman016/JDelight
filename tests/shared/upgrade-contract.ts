import Dexie from "dexie";
import { JDelightDatabase } from "../../src/data/database";
import { createRepository } from "../../src/data/repository";
import { reportFor, SAMPLE_JD } from "../../src/providers/mock";
import { sourceLines } from "../../src/domain/source";
import { withIsolatedDatabase } from "../helpers/database-isolation";

export async function runUpgradeContract() {
  return withIsolatedDatabase(async (scope) => {
    const legacy = scope.track(new Dexie(scope.name));
    // 冻结 WO-002 的 v1 定义和无 supplements 字段的记录，避免用新库伪造升级。
    legacy.version(1).stores({
      jobs: "id, updatedAt, mark",
      sourceVersions: "id, jobId",
      reportVersions: "id, jobId, &[jobId+no]",
      supplements: "id, jobId",
      meta: "key",
    });
    const date = "2026-10-21T12:00:00.000Z";
    const source = {
      id: "legacy-source",
      jobId: "legacy-job",
      no: 1,
      text: SAMPLE_JD,
      lines: sourceLines(SAMPLE_JD),
      confirmedAt: date,
    };
    const report = {
      id: "legacy-report",
      jobId: source.jobId,
      sourceVersionId: source.id,
      no: 1,
      parentId: null,
      content: reportFor(source),
      change: { kind: "base" as const, summary: "基础分析" },
      createdAt: date,
    };
    const job = {
      id: source.jobId,
      title: "虚构岗位",
      company: "星桥科技",
      place: "上海",
      mark: "preparing" as const,
      note: "保留原有备注",
      status: "ready" as const,
      currentSourceVersionId: source.id,
      currentReportVersionId: report.id,
      lastError: null,
      createdAt: date,
      updatedAt: date,
      lastViewedAt: date,
    };
    const supplement = {
      id: "legacy-note",
      jobId: job.id,
      question: "已有问题",
      answer: "",
      answerKind: "common",
      status: "unanswered",
      addedInVersion: null,
      anchor: {
        blockId: "pos1",
        start: 0,
        end: 2,
        exact: "一般",
        prefix: "",
        suffix: "",
        reportVersionId: report.id,
        sourceVersionId: source.id,
        offsetUnit: "utf16",
      },
      createdAt: date,
      updatedAt: date,
    };
    await legacy.transaction("rw", legacy.tables, async () => {
      await legacy.table("jobs").add(job);
      await legacy.table("sourceVersions").add(source);
      await legacy.table("reportVersions").add(report);
      await legacy.table("supplements").add(supplement);
      await legacy.table("meta").add({ key: "schemaCreatedAt", value: date });
    });
    legacy.close();
    const upgraded = scope.track(new JDelightDatabase(scope.name));
    const saved = await createRepository(upgraded).readJob(job.id);
    const check = (value: unknown, message: string) => {
      if (!value) throw new Error(message);
    };
    check(upgraded.verno === 2, "数据库应升级为结构版本 2");
    check(
      JSON.stringify(saved?.job) === JSON.stringify(job),
      "升级不应改变岗位",
    );
    check(
      JSON.stringify(saved?.source) === JSON.stringify(source),
      "升级不应改变原文",
    );
    const { supplements: snapshots, ...retained } = saved!.report!;
    check(
      JSON.stringify(retained) === JSON.stringify(report) &&
        snapshots.length === 0,
      "报告只应增加空补充快照",
    );
    check(
      JSON.stringify(await upgraded.supplements.get(supplement.id)) ===
        JSON.stringify(supplement),
      "升级不应改变已有补充表",
    );
    check(
      (await upgraded.meta.get("schemaCreatedAt"))?.value === date,
      "原始建库时间应保留",
    );
    let rejected = false;
    try {
      await upgraded.reportVersions.update(report.id, { supplements: [] });
    } catch {
      rejected = true;
    }
    check(rejected, "升级后仍应拒绝改写报告");
    upgraded.close();
    const reopened = scope.track(new JDelightDatabase(scope.name));
    check(
      (await createRepository(reopened).readJob(job.id))?.report?.supplements
        .length === 0,
      "关闭重开后升级应持久化",
    );
    return { passed: true, schemaVersion: reopened.verno };
  });
}
