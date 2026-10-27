import "fake-indexeddb/auto";
import { afterEach, expect, test, vi } from "vitest";
import { withIsolatedDatabase } from "../../tests/helpers/database-isolation";
import { JDelightDatabase } from "./database";
import { createRepository } from "./repository";
import { SAMPLE_JD, reportFor } from "../providers/mock";
afterEach(() => vi.useRealTimers());
test("新增 3 份基础报告计数；补充版本不重复计数，成功导出后清零", async () => {
  await withIsolatedDatabase(async (scope) => {
    const repo = createRepository(
      scope.track(new JDelightDatabase(scope.name)),
    );
    for (let i = 0; i < 3; i++) {
      const job = await repo.createJob(SAMPLE_JD, {
        title: `虚构岗位 ${i}`,
        company: "星桥科技",
        place: "上海",
      });
      const source = await repo.getSource(job);
      const report = await repo.saveReport(
        job.id,
        source,
        reportFor(source),
        null,
      );
      if (i === 0) {
        const note = await repo.createQuestion(
          job.id,
          report.id,
          {
            blockId: report.content.sections[0].blocks[0].blockId,
            start: 0,
            end: 2,
            exact: "一般",
            prefix: "",
            suffix: "",
            reportVersionId: report.id,
            sourceVersionId: source.id,
            offsetUnit: "utf16",
          },
          "怎么理解？",
        );
        await repo.answerQuestion(
          note.id,
          "示例解答：这是一般理解。",
          "common",
        );
        await repo.changeSupplement(job.id, note.id, report.id, {
          kind: "add",
        });
      }
    }
    expect(await repo.backupStatus()).toMatchObject({
      versions: 4,
      newReports: 3,
    });
    const snapshot = await repo.exportData();
    await repo.markExported(
      snapshot.data.exportedAt,
      snapshot.revision,
      snapshot.data.reportVersions
        .filter((report) => report.change.kind === "base")
        .map((report) => report.id),
    );
    expect(await repo.backupStatus()).toMatchObject({
      newReports: 0,
      dirty: false,
      lastExportAt: snapshot.data.exportedAt,
    });
  });
});
test("同一毫秒内、导出快照后新增的报告仍未备份，不会被清零", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  await withIsolatedDatabase(async (scope) => {
    const repo = createRepository(
      scope.track(new JDelightDatabase(scope.name)),
    );
    const create = async () => {
      const job = await repo.createJob(SAMPLE_JD, {
        title: "虚构岗位",
        company: "星桥科技",
        place: "上海",
      });
      const source = await repo.getSource(job);
      return repo.saveReport(job.id, source, reportFor(source), null);
    };
    const first = await create();
    const snapshot = await repo.exportData();
    const later = await create();
    expect(first.createdAt).toBe(later.createdAt);
    await repo.markExported(snapshot.data.exportedAt, snapshot.revision, [
      first.id,
    ]);
    expect(await repo.backupStatus()).toMatchObject({
      newReports: 1,
      dirty: true,
    });
  });
});
