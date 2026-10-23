import "fake-indexeddb/auto";
import { test, expect } from "vitest";
import { JDelightDatabase } from "./database";
import { createRepository } from "./repository";
import { reportFor, SAMPLE_JD } from "../providers/mock";
import { DATA_CASES } from "../../tests/shared/data-contract";
import { withIsolatedDatabase } from "../../tests/helpers/database-isolation";
for (const entry of DATA_CASES)
  test(entry.name, () => withIsolatedDatabase(entry.run));
test("历史报告读取只校验结构，保存前仍检查 V1–V7", () =>
  withIsolatedDatabase(async (scope) => {
    const db = scope.track(new JDelightDatabase(scope.name));
    const repo = createRepository(db);
    const job = await repo.createJob(SAMPLE_JD, {
      title: "虚构岗位",
      company: "",
      place: "",
    });
    const source = await repo.getSource(job);
    const content = reportFor(source);
    content.focus.items[0].citations[0].quote = "不符合当前引用规则的旧内容";
    await expect(
      repo.saveReport(job.id, source, content, null),
    ).rejects.toThrow();
    const id = crypto.randomUUID();
    await db.reportVersions.add({
      id,
      jobId: job.id,
      sourceVersionId: source.id,
      no: 1,
      parentId: null,
      content,
      supplements: [],
      change: { kind: "base", summary: "历史基础分析" },
      createdAt: new Date().toISOString(),
    });
    await db.jobs.update(job.id, {
      currentReportVersionId: id,
      status: "ready",
    });
    expect(
      (await repo.readJob(job.id))?.report?.content.focus.items[0].citations[0]
        .quote,
    ).toBe("不符合当前引用规则的旧内容");
  }));
