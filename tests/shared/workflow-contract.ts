import { JDelightDatabase } from "../../src/data/database";
import { createRepository } from "../../src/data/repository";
import { reportFor, SAMPLE_JD } from "../../src/providers/mock";
import { parseBackup, type Backup } from "../../src/domain/backup";
import type { DatabaseTestScope } from "../helpers/database-isolation";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(work: () => Promise<unknown>, message?: string) {
  try {
    await work();
  } catch (error) {
    if (message)
      assert(
        String(error).includes(message),
        `应拒绝：${message}；实际：${String(error)}`,
      );
    return;
  }
  throw new Error("操作应当拒绝且不改数据");
}
async function setup(scope: DatabaseTestScope, added = false) {
  const db = scope.track(new JDelightDatabase(scope.name)),
    repo = createRepository(db);
  const job = await repo.createJob(SAMPLE_JD, {
    title: "虚构岗位",
    company: "星桥科技",
    place: "上海",
  });
  const source = await repo.getSource(job),
    first = await repo.saveReport(job.id, source, reportFor(source), null);
  const blockId = first.content.sections[0].blocks[0].blockId;
  const anchor = {
    blockId,
    start: 0,
    end: 2,
    exact: "一般",
    prefix: "",
    suffix: "",
    reportVersionId: first.id,
    sourceVersionId: source.id,
    offsetUnit: "utf16",
  };
  const note = await repo.createQuestion(
    job.id,
    first.id,
    anchor,
    "这个词是什么意思？",
  );
  await repo.answerQuestion(note.id, "示例解答：这是通用解释。", "common");
  const current = added
    ? await repo.changeSupplement(job.id, note.id, first.id, { kind: "add" })
    : first;
  return { db, repo, job, source, first, note, current, anchor };
}
async function snapshot(db: JDelightDatabase) {
  return JSON.stringify(
    await Promise.all([
      db.jobs.toArray(),
      db.sourceVersions.toArray(),
      db.reportVersions.toArray(),
      db.supplements.toArray(),
      db.meta.toArray(),
    ]),
  );
}
function sameTables(a: Backup, b: Backup) {
  for (const key of [
    "jobs",
    "sourceVersions",
    "reportVersions",
    "supplements",
  ] as const)
    assert(
      JSON.stringify(a[key]) === JSON.stringify(b[key]),
      `${key} 应逐表一致`,
    );
}
export const WORKFLOW_CASES: {
  name: string;
  run: (scope: DatabaseTestScope) => Promise<void>;
}[] = [
  {
    name: "提问先保存未解答，同请求不重复，迟到解答不覆盖已加入状态",
    async run(scope) {
      const { db, repo, job, current, anchor } = await setup(scope);
      const requestId = crypto.randomUUID();
      const a = await repo.createQuestion(
        job.id,
        current.id,
        anchor,
        "会失败的解答",
        requestId,
      );
      const b = await repo.createQuestion(
        job.id,
        current.id,
        anchor,
        "会失败的解答",
        requestId,
      );
      assert(
        a.id === b.id &&
          (await db.supplements.get(a.id))?.status === "unanswered",
        "失败前问题已保存，重试不重复",
      );
      await repo.answerQuestion(a.id, "拿到了解答");
      const next = await repo.changeSupplement(job.id, a.id, current.id, {
        kind: "add",
      });
      await repo.answerQuestion(a.id, "迟到的旧解答");
      assert(
        (await db.supplements.get(a.id))?.answer === "拿到了解答" &&
          next.supplements[0].answer === "拿到了解答",
        "迟到结果不改已加入的快照",
      );
    },
  },
  {
    name: "加入、修改、撤下各生成版本，旧版正文与补充永不改变，关闭重开持久化",
    async run(scope) {
      const { db, repo, job, first, note, current } = await setup(scope, true);
      const before = JSON.stringify(current);
      const edit = await repo.changeSupplement(job.id, note.id, current.id, {
        kind: "edit",
        answer: "新的通用解释",
      });
      const withdrawn = await repo.changeSupplement(job.id, note.id, edit.id, {
        kind: "withdraw",
      });
      assert(
        edit.no === 3 &&
          withdrawn.no === 4 &&
          withdrawn.supplements.length === 0,
        "三次操作分别生成第2/3/4版",
      );
      assert(
        JSON.stringify(await db.reportVersions.get(current.id)) === before &&
          (await db.reportVersions.get(first.id))?.supplements.length === 0,
        "旧版快照完全不变",
      );
      assert(
        JSON.stringify(first.content) === JSON.stringify(withdrawn.content),
        "不改变基础判断",
      );
      db.close();
      const reopened = scope.track(new JDelightDatabase(scope.name));
      const saved = await createRepository(reopened).readJob(job.id);
      assert(
        saved?.report?.id === withdrawn.id &&
          saved.supplements[0].status === "withdrawn" &&
          saved.versions.length === 4,
        "关闭重开后四版与补充状态仍在",
      );
    },
  },
  {
    name: "新增版本在指针写入时失败：报告、补充、岗位和备份修订号全部回滚",
    async run(scope) {
      const { db, repo, job, first, note } = await setup(scope);
      const before = await snapshot(db);
      const fail = (changes: object) => {
        if ("currentReportVersionId" in changes)
          throw new Error("注入版本指针失败");
      };
      db.jobs.hook("updating", fail);
      try {
        await rejects(
          () =>
            repo.changeSupplement(job.id, note.id, first.id, { kind: "add" }),
          "注入",
        );
      } finally {
        db.jobs.hook("updating").unsubscribe(fail);
      }
      assert((await snapshot(db)) === before, "失败后所有数据与修订号完全不变");
    },
  },
  {
    name: "另一连接更新后拒绝旧父版本，不覆盖，也不多写版本",
    async run(scope) {
      const { db, repo, job, first, note } = await setup(scope);
      const other = createRepository(
        scope.track(new JDelightDatabase(scope.name)),
      );
      const second = await other.changeSupplement(job.id, note.id, first.id, {
        kind: "add",
      });
      await rejects(
        () =>
          repo.changeSupplement(job.id, note.id, first.id, {
            kind: "edit",
            answer: "旧页面",
          }),
        "另一个页面",
      );
      assert(
        (await repo.readJob(job.id))?.report?.id === second.id &&
          (await db.reportVersions.count()) === 2,
        "保持另一页面的版本",
      );
    },
  },
  {
    name: "未备份提醒：首次、成功导出无改动、查看不变、改备注和删除后变脏",
    async run(scope) {
      const { repo, job } = await setup(scope);
      assert((await repo.backupStatus()).dirty, "初始提醒");
      const exported = await repo.exportData();
      await repo.markExported(exported.data.exportedAt, exported.revision);
      assert(!(await repo.backupStatus()).dirty, "导出后无改动");
      await repo.recordView(job.id);
      assert(!(await repo.backupStatus()).dirty, "只是查看不应催备份");
      await repo.setNote(job.id, "新的备注");
      assert((await repo.backupStatus()).dirty, "修改后提醒");
      const again = await repo.exportData();
      await repo.markExported(again.data.exportedAt, again.revision);
      await repo.deleteJob(job.id);
      const status = await repo.backupStatus();
      assert(
        status.jobs === 0 && status.dirty && !!status.lastExportAt,
        "最后一岗位删除后仍提醒新改动",
      );
    },
  },
  {
    name: "下载期间有新改动，记下旧快照的导出时间后仍提示备份",
    async run(scope) {
      const { repo, job } = await setup(scope);
      const exported = await repo.exportData();
      await repo.setNote(job.id, "下载期间的新改动");
      await repo.markExported(exported.data.exportedAt, exported.revision);
      assert(
        (await repo.backupStatus()).dirty,
        "不能把未导出的新改动标成已备份",
      );
    },
  },
  {
    name: "导出再替换导入，原文、岗位、全部版本与补充逐表一致",
    async run(scope) {
      const { repo } = await setup(scope, true);
      const exported = await repo.exportData();
      const preview = await repo.previewImport(exported.data);
      await repo.importData(exported.data, "replace", preview.revision);
      sameTables(exported.data, (await repo.exportData()).data);
      assert(!("meta" in exported.data), "备份不含本机 meta 或服务端配置");
    },
  },
  {
    name: "同 ID 合并保留两份，原文、父版本、变化与补充锚点全部重映射",
    async run(scope) {
      const { repo } = await setup(scope, true);
      const before = (await repo.exportData()).data;
      const preview = await repo.previewImport(before);
      assert(preview.duplicates === 1, "预览识别重复岗位");
      await repo.importData(before, "merge", preview.revision);
      const after = (await repo.exportData()).data;
      parseBackup(after);
      assert(
        after.jobs.length === 2 &&
          after.reportVersions.length === 4 &&
          after.supplements.length === 2,
        "两份均保留",
      );
      const copy = after.jobs.find((item) => item.id !== before.jobs[0].id)!;
      const current = after.reportVersions.find(
        (item) => item.id === copy.currentReportVersionId,
      )!;
      assert(
        copy.title.endsWith("（导入的副本）") &&
          current.parentId !== before.reportVersions[1]?.parentId &&
          current.supplements[0].anchor.reportVersionId !==
            before.supplements[0].anchor.reportVersionId,
        "整份副本引用已换新 ID",
      );
      for (const job of before.jobs)
        assert(
          after.jobs.some(
            (item) => JSON.stringify(item) === JSON.stringify(job),
          ),
          "本机原岗位不变",
        );
    },
  },
  {
    name: "岗位 ID 不同但子记录编号碰撞，也不能覆盖任何本机记录",
    async run(scope) {
      const { repo } = await setup(scope, true);
      const input = structuredClone((await repo.exportData()).data);
      input.jobs[0].id = "另一虚构岗位";
      for (const rows of [
        input.sourceVersions,
        input.reportVersions,
        input.supplements,
      ])
        for (const item of rows) item.jobId = input.jobs[0].id;
      const preview = await repo.previewImport(input);
      await repo.importData(input, "merge", preview.revision);
      assert(
        (await repo.exportData()).data.jobs.length === 2,
        "不同岗位和子记录都保留",
      );
    },
  },
  {
    name: "替换在清空之后注入失败，四表与 meta 全部恢复",
    async run(scope) {
      const { db, repo } = await setup(scope, true);
      const exported = await repo.exportData(),
        preview = await repo.previewImport(exported.data);
      const before = await snapshot(db),
        fail = () => {
          throw new Error("注入导入报告失败");
        };
      db.reportVersions.hook("creating", fail);
      try {
        await rejects(
          () => repo.importData(exported.data, "replace", preview.revision),
          "注入",
        );
      } finally {
        db.reportVersions.hook("creating").unsubscribe(fail);
      }
      assert((await snapshot(db)) === before, "清空后的失败不能丢任何记录");
    },
  },
  {
    name: "错误、过新、断裂引用文件一律拒绝且本机数据不变",
    async run(scope) {
      const { db, repo } = await setup(scope, true),
        exported = (await repo.exportData()).data,
        before = await snapshot(db);
      const broken = structuredClone(exported);
      broken.supplements[0].anchor.reportVersionId = "不存在的报告";
      const duplicateBlock = structuredClone(exported);
      duplicateBlock.reportVersions[0].content.focus.items[0].id =
        duplicateBlock.reportVersions[0].content.focus.gist.id;
      const inconsistentSection = structuredClone(exported);
      inconsistentSection.reportVersions[0].content.sections[0].status =
        "not_in_source";
      const futureAddition = structuredClone(exported);
      futureAddition.supplements[0].addedInVersion = 999;
      for (const value of [
        {},
        { ...exported, formatVersion: 2 },
        { ...exported, schemaVersion: 3 },
        { ...exported, serverConfig: "不应接受" },
        broken,
        duplicateBlock,
        inconsistentSection,
        futureAddition,
      ])
        await rejects(() => repo.previewImport(value));
      assert((await snapshot(db)) === before, "预览拒绝不会修改数据");
    },
  },
  {
    name: "预览后有新写入时拒绝覆盖，保留用户的新备注",
    async run(scope) {
      const { db, repo, job } = await setup(scope);
      const preview = await repo.previewImport((await repo.exportData()).data);
      await repo.setNote(job.id, "预览后的新备注");
      const before = await snapshot(db);
      await rejects(
        () => repo.importData(preview.data, "replace", preview.revision),
        "预览后",
      );
      assert((await snapshot(db)) === before, "不能覆盖预览后的本机变化");
    },
  },
];
