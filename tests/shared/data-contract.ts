import Dexie from "dexie";
import { JDelightDatabase } from "../../src/data/database";
import { createRepository } from "../../src/data/repository";
import { reportFor, SAMPLE_JD } from "../../src/providers/mock";
import { withIsolatedDatabase } from "../helpers/database-isolation";
import type { DatabaseTestScope } from "../helpers/database-isolation";

function assert(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(reason);
}
async function rejects(work: () => Promise<unknown>, text?: string) {
  let error: unknown;
  try {
    await work();
  } catch (cause) {
    error = cause;
  }
  assert(error instanceof Error, "操作应当拒绝");
  if (text)
    assert(
      error.message.includes(text),
      `错误应包含：${text}；实际：${error.message}`,
    );
}
const meta = { title: "虚构岗位", company: "星桥科技", place: "上海" };
async function setup(scope: DatabaseTestScope) {
  const db = scope.track(new JDelightDatabase(scope.name));
  const repo = createRepository(db);
  const job = await repo.createJob(SAMPLE_JD, meta);
  const source = await repo.getSource(job);
  return { db, repo, job, source };
}
export const DATA_CASES: {
  name: string;
  run: (scope: DatabaseTestScope) => Promise<void>;
}[] = [
  {
    name: "新建后关闭重开，岗位、原文、报告与 schemaCreatedAt 均保留",
    async run(scope) {
      const { db, repo, job, source } = await setup(scope);
      const report = await repo.saveReport(
        job.id,
        source,
        reportFor(source),
        null,
      );
      db.close();
      const reopened = scope.track(new JDelightDatabase(scope.name));
      const saved = await createRepository(reopened).readJob(job.id);
      assert(saved?.job.currentReportVersionId === report.id, "报告指针持久化");
      assert(
        saved.source.text === SAMPLE_JD &&
          saved.report?.content.sections.length === 7,
        "原文报告持久化",
      );
      assert(
        await reopened.meta.get("schemaCreatedAt"),
        "数据库首次创建时间已记录",
      );
    },
  },
  {
    name: "两岗位的标记、备注和删除互不影响",
    async run(scope) {
      const { db, repo, job } = await setup(scope);
      const other = await repo.createJob(SAMPLE_JD, {
        ...meta,
        title: "另一虚构岗位",
      });
      await repo.setMark(job.id, "interviewed");
      await repo.setNote(job.id, "周五面试");
      const untouched = await repo.readJob(other.id);
      assert(
        untouched?.job.mark === "preparing" && untouched.job.note === "",
        "第二岗位未变化",
      );
      await repo.deleteJob(job.id);
      assert(await db.jobs.get(other.id), "第二岗位仍在");
      assert(
        (await db.sourceVersions.where("jobId").equals(other.id).count()) === 1,
        "第二岗位原文仍在",
      );
    },
  },
  {
    name: "新增报告后、更新指针前抛错，整个事务回滚",
    async run(scope) {
      const { db, repo, job, source } = await setup(scope);
      await repo.startAnalysis(job.id);
      const before = await db.jobs.get(job.id);
      const fail = (changes: object) => {
        if ("currentReportVersionId" in changes)
          throw new Error("注入指针写入失败");
      };
      db.jobs.hook("updating", fail);
      await rejects(
        () => repo.saveReport(job.id, source, reportFor(source), null),
        "注入",
      );
      db.jobs.hook("updating").unsubscribe(fail);
      const after = await db.jobs.get(job.id);
      assert((await db.reportVersions.count()) === 0, "新版本应回滚");
      assert(
        JSON.stringify(before) === JSON.stringify(after),
        "指针、状态与时间应全部不变",
      );
    },
  },
  {
    name: "另一连接先写报告，旧父版本拒绝且不覆盖",
    async run(scope) {
      const { db, repo, job, source } = await setup(scope);
      const other = scope.track(new JDelightDatabase(scope.name));
      const first = await createRepository(other).saveReport(
        job.id,
        source,
        reportFor(source),
        null,
      );
      await rejects(
        () => repo.saveReport(job.id, source, reportFor(source), null),
        "另一个页面",
      );
      assert(
        (await db.jobs.get(job.id))?.currentReportVersionId === first.id,
        "保持先写的指针",
      );
      assert((await db.reportVersions.count()) === 1, "不得多写版本");
      await repo.failAnalysis(job.id, {
        kind: "check",
        reasons: ["迟到的失败"],
      });
      await repo.cancelAnalysis(job.id);
      const latest = await repo.startAnalysis(job.id);
      assert(
        latest.status === "ready" &&
          latest.lastError === null &&
          latest.currentReportVersionId === first.id,
        "迟到的失败、取消和开始都不得降级另一页面的成功结果",
      );
    },
  },
  {
    name: "四表级联删除；任一删除失败则全部保留",
    async run(scope) {
      const { db, repo, job, source } = await setup(scope);
      await repo.saveReport(job.id, source, reportFor(source), null);
      const now = new Date().toISOString();
      await db.supplements.add({
        id: "fake-supplement",
        jobId: job.id,
        question: "虚构问题",
        answer: "",
        answerKind: "common",
        status: "unanswered",
        addedInVersion: null,
        anchor: {
          blockId: "pos1",
          start: 0,
          end: 1,
          exact: "一",
          prefix: "",
          suffix: "",
          reportVersionId: "fixture",
          sourceVersionId: source.id,
          offsetUnit: "utf16",
        },
        createdAt: now,
        updatedAt: now,
      });
      const fail = () => {
        throw new Error("注入岗位删除失败");
      };
      db.jobs.hook("deleting", fail);
      await rejects(() => repo.deleteJob(job.id), "注入");
      db.jobs.hook("deleting").unsubscribe(fail);
      for (const table of [
        db.jobs,
        db.sourceVersions,
        db.reportVersions,
        db.supplements,
      ])
        assert((await table.count()) === 1, "失败时四表均保留");
      await repo.deleteJob(job.id);
      for (const table of [
        db.jobs,
        db.sourceVersions,
        db.reportVersions,
        db.supplements,
      ])
        assert((await table.count()) === 0, "删除后四表均为空");
    },
  },
  {
    name: "原文和报告更新及 put 覆写均被拒绝；重复创建不新增",
    async run(scope) {
      const { db, repo, job, source } = await setup(scope);
      const again = await repo.createJob(SAMPLE_JD, meta, job.id);
      assert(
        again.id === job.id && (await db.jobs.count()) === 1,
        "请求 ID 去重",
      );
      const report = await repo.saveReport(
        job.id,
        source,
        reportFor(source),
        null,
      );
      await rejects(
        () => db.sourceVersions.update(source.id, { text: "改写" }),
        "不可修改",
      );
      await rejects(
        () => db.sourceVersions.put({ ...source, text: "改写" }),
        "不可修改",
      );
      await rejects(
        () => db.reportVersions.update(report.id, { no: 2 }),
        "不可修改",
      );
      await rejects(
        () => db.reportVersions.put({ ...report, no: 2 }),
        "不可修改",
      );
      assert(
        (await db.sourceVersions.get(source.id))?.text === SAMPLE_JD,
        "不可变原文未变化",
      );
      await rejects(() => repo.setNote(job.id, "字".repeat(61)), "备注");
      assert((await db.jobs.get(job.id))?.note === "", "超长备注被拒绝");
    },
  },
  {
    name: "沿用 withIsolatedDatabase，异常也关闭连接并删除独立测试库",
    async run(scope) {
      let nestedName = "";
      await rejects(
        () =>
          withIsolatedDatabase(async (nested) => {
            nestedName = nested.name;
            assert(nested.name !== scope.name, "测试库相互独立");
            const { db } = await setup(nested);
            assert(db.isOpen(), "连接打开");
            throw new Error("注入测试异常");
          }),
        "注入测试异常",
      );
      assert(!(await Dexie.exists(nestedName)), "异常测试库被删除");
      const { db } = await setup(scope);
      assert((await db.jobs.count()) === 1, "当前测试库不受影响");
    },
  },
];
