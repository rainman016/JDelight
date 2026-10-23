import { createRepository } from "../../src/data/repository";
import type { JDelightDatabase } from "../../src/data/database";
import { reportFor, SAMPLE_JD } from "../../src/providers/mock";
import {
  reportVersionSchema,
  type SupplementSnapshot,
} from "../../src/domain/schema";

/** 仅测试调用：直接构造未来阶段 B 会产生的不可变快照，产品没有注入入口。 */
export async function detailFixture(db: JDelightDatabase) {
  const repo = createRepository(db);
  const job = await repo.createJob(SAMPLE_JD, {
    title: "初级 AI Agent 产品经理",
    company: "星桥科技",
    place: "上海",
  });
  const source = await repo.getSource(job);
  const first = await repo.saveReport(job.id, source, reportFor(source), null);
  const block = first.content.sections[0].blocks[0];
  const note: SupplementSnapshot = {
    supplementId: "test-supplement",
    question: "怎么理解这句话？",
    answer: "旧版本里的解释。",
    answerKind: "common",
    anchor: {
      blockId: block.blockId,
      start: 0,
      end: 2,
      exact: "一般",
      prefix: "",
      suffix: "",
      reportVersionId: first.id,
      sourceVersionId: source.id,
      offsetUnit: "utf16",
    },
    addedInVersion: 2,
  };
  const second = reportVersionSchema.parse({
    ...first,
    id: crypto.randomUUID(),
    no: 2,
    parentId: first.id,
    supplements: [note],
    change: {
      kind: "add",
      supplementId: note.supplementId,
      summary: "加入：怎么理解这句话？",
    },
  });
  const third = reportVersionSchema.parse({
    ...second,
    id: crypto.randomUUID(),
    no: 3,
    parentId: second.id,
    supplements: [{ ...note, answer: "当前版本里的新解释。" }],
    change: {
      kind: "edit",
      supplementId: note.supplementId,
      summary: "修改补充：怎么理解这句话？",
    },
  });
  await db.transaction("rw", db.jobs, db.reportVersions, async () => {
    await db.reportVersions.bulkAdd([second, third]);
    await db.jobs.update(job.id, { currentReportVersionId: third.id });
  });
  return { job, source, first, second, third };
}
