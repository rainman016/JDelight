import Dexie, { type Table } from "dexie";
import { withIsolatedDatabase } from "../../../tests/helpers/database-isolation";

interface SpikeJob {
  id: string;
  title: string;
  currentVersionId: string;
  status?: string;
}
interface SpikeVersion {
  id: string;
  jobId: string;
  text: string;
}

// WO-001b 临时验证结构，最终提交删除；不是 WO-002 的数据契约。
export class SpikeDatabase extends Dexie {
  declare jobs: Table<SpikeJob, string>;
  declare reportVersions: Table<SpikeVersion, string>;

  constructor(name: string, version: 1 | 2 = 2) {
    super(name);
    this.version(1).stores({
      jobs: "id,currentVersionId",
      reportVersions: "id,jobId",
    });
    if (version === 2) {
      this.version(2)
        .stores({
          jobs: "id,currentVersionId,status",
          reportVersions: "id,jobId",
        })
        .upgrade((transaction) =>
          transaction
            .table<SpikeJob>("jobs")
            .toCollection()
            .modify((job) => {
              job.status ??= "preparing";
            }),
        );
    }
  }
}

const oldJob: SpikeJob = {
  id: "job-a",
  title: "虚构数据岗位",
  currentVersionId: "v1",
};
const oldVersion: SpikeVersion = {
  id: "v1",
  jobId: "job-a",
  text: "旧报告内容",
};
const newVersion: SpikeVersion = {
  id: "v2",
  jobId: "job-a",
  text: "新报告内容",
};

async function seed(database: SpikeDatabase) {
  await database.jobs.add({ ...oldJob });
  await database.reportVersions.add({ ...oldVersion });
}

export async function atomicScenario() {
  return withIsolatedDatabase(async (scope) => {
    const db = scope.track(new SpikeDatabase(scope.name));
    await seed(db);
    let insertedInside = false;
    let error = "";
    const save = (failAfterInsert: boolean) =>
      db.transaction("rw", db.jobs, db.reportVersions, async () => {
        await db.reportVersions.add({ ...newVersion });
        insertedInside = !!(await db.reportVersions.get("v2"));
        if (failAfterInsert) throw new Error("模拟保存失败");
        await db.jobs.update("job-a", { currentVersionId: "v2" });
      });
    try {
      await save(true);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    const aborted = {
      insertedInside,
      error,
      newVersion: (await db.reportVersions.get("v2")) ?? null,
      job: await db.jobs.get("job-a"),
      oldVersion: await db.reportVersions.get("v1"),
    };
    // 正向对照：同样的两步不抛错时必须能真正提交。
    await save(false);
    return {
      aborted,
      committed: {
        currentVersionId: (await db.jobs.get("job-a"))?.currentVersionId,
        versions: await db.reportVersions.count(),
        oldVersion: await db.reportVersions.get("v1"),
      },
    };
  });
}

export async function cascadeScenario() {
  return withIsolatedDatabase(async (scope) => {
    const db = scope.track(new SpikeDatabase(scope.name));
    await seed(db);
    await db.reportVersions.add({ ...newVersion });
    await db.jobs.add({
      id: "job-b",
      title: "另一个虚构岗位",
      currentVersionId: "other-v1",
    });
    await db.reportVersions.add({
      id: "other-v1",
      jobId: "job-b",
      text: "其他岗位报告",
    });
    await db.transaction("rw", db.jobs, db.reportVersions, async () => {
      await db.reportVersions.where("jobId").equals("job-a").delete();
      await db.jobs.delete("job-a");
    });
    return {
      job: (await db.jobs.get("job-a")) ?? null,
      versions: await db.reportVersions
        .where("jobId")
        .equals("job-a")
        .toArray(),
      otherJob: await db.jobs.get("job-b"),
      otherVersion: await db.reportVersions.get("other-v1"),
    };
  });
}

export async function upgradeScenario() {
  return withIsolatedDatabase(async (scope) => {
    const v1 = scope.track(new SpikeDatabase(scope.name, 1));
    await seed(v1);
    v1.close();
    const v2 = scope.track(new SpikeDatabase(scope.name, 2));
    await v2.open();
    return {
      version: v2.verno,
      jobs: await v2.jobs.toArray(),
      versions: await v2.reportVersions.toArray(),
    };
  });
}

export async function isolationScenario() {
  const results = await Promise.all(
    ["甲", "乙"].map((title) =>
      withIsolatedDatabase(async (scope) => {
        const db = scope.track(new SpikeDatabase(scope.name));
        await db.jobs.add({ id: "same-id", title, currentVersionId: "none" });
        return {
          name: scope.name,
          title: (await db.jobs.get("same-id"))?.title,
        };
      }),
    ),
  );
  return {
    results,
    deleted: await Promise.all(
      results.map(async ({ name }) => !(await Dexie.exists(name))),
    ),
  };
}
