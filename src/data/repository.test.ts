import "fake-indexeddb/auto";
import { test, expect } from "vitest";
import { JDelightDatabase } from "./database";
import { createRepository } from "./repository";
import { reportFor, SAMPLE_JD } from "../providers/mock";
import { DATA_CASES } from "../../tests/shared/data-contract";
import { withIsolatedDatabase } from "../../tests/helpers/database-isolation";
for (const entry of DATA_CASES)
  test(entry.name, () => withIsolatedDatabase(entry.run));
test.each(["V2", "V8", "V9", "V10"] as const)(
  "历史报告读取只校验结构，保存前仍检查 V1–V10（%s）",
  (code) =>
    withIsolatedDatabase(async (scope) => {
      const db = scope.track(new JDelightDatabase(scope.name));
      const repo = createRepository(db);
      const text =
        code === "V9"
          ? SAMPLE_JD.replace("初级 AI Agent 产品经理", "初级 AI … 产品经理")
          : SAMPLE_JD;
      const job = await repo.createJob(text, {
        title: "虚构岗位",
        company: "",
        place: "",
      });
      const source = await repo.getSource(job);
      const content = reportFor(source);
      if (code === "V2")
        content.focus.items[0].citations[0].quote =
          "不符合当前引用规则的旧内容";
      else if (code === "V8") {
        const line = source.lines.find((item) =>
          item.text.includes("本科及以上"),
        )!;
        content.focus.gist = {
          ...content.focus.gist,
          kind: "source",
          text: "本科及以上学历，在校生可申请。",
          citations: [{ lineNo: line.lineNo, quote: line.text }],
        };
      } else if (code === "V9")
        content.header.shown[0] = {
          ...content.header.shown[0],
          text: "初级 AI Agent 产品经理",
          citations: [{ lineNo: 1, quote: source.lines[0].text }],
        };
      else content.focus.gist.text = "课程项目可替代经验要求。";
      await expect(
        repo.saveReport(job.id, source, content, null),
      ).rejects.toMatchObject({
        name: "ReportCheckError",
        issues: expect.arrayContaining([expect.objectContaining({ code })]),
      });
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
      const historical = await repo.readJob(job.id);
      expect(historical?.report?.content).toEqual(content);
      expect(historical?.versions[0].content).toEqual(content);
    }),
);
