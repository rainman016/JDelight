import "fake-indexeddb/auto";
import Dexie from "dexie";
import { expect, test } from "vitest";
import { withIsolatedDatabase } from "../../../tests/helpers/database-isolation";
import {
  atomicScenario,
  cascadeScenario,
  isolationScenario,
  SpikeDatabase,
  upgradeScenario,
} from "./database";

test("fake-indexeddb：版本新增中途失败整体回滚，正常重试可提交", async () => {
  const result = await atomicScenario();
  expect(result.aborted).toEqual({
    insertedInside: true,
    error: "模拟保存失败",
    newVersion: null,
    job: { id: "job-a", title: "虚构数据岗位", currentVersionId: "v1" },
    oldVersion: { id: "v1", jobId: "job-a", text: "旧报告内容" },
  });
  expect(result.committed).toEqual({
    currentVersionId: "v2",
    versions: 2,
    oldVersion: result.aborted.oldVersion,
  });
});

test("fake-indexeddb：级联删除岗位与全部版本，保留其他岗位", async () => {
  const result = await cascadeScenario();
  expect(result.job).toBeNull();
  expect(result.versions).toEqual([]);
  expect(result.otherJob?.id).toBe("job-b");
  expect(result.otherVersion?.text).toBe("其他岗位报告");
});

test("fake-indexeddb：v1 升 v2 填充字段并完整保留数据", async () => {
  expect(await upgradeScenario()).toEqual({
    version: 2,
    jobs: [
      {
        id: "job-a",
        title: "虚构数据岗位",
        currentVersionId: "v1",
        status: "preparing",
      },
    ],
    versions: [{ id: "v1", jobId: "job-a", text: "旧报告内容" }],
  });
});

test("fake-indexeddb：并发用例独立数据库且结束后删除", async () => {
  const result = await isolationScenario();
  expect(result.results[0].name).not.toBe(result.results[1].name);
  expect(result.results.map(({ title }) => title)).toEqual(["甲", "乙"]);
  expect(result.deleted).toEqual([true, true]);
});

test("隔离辅助函数：测试抛错也关闭连接并删除数据库", async () => {
  let name = "";
  await expect(
    withIsolatedDatabase(async (scope) => {
      name = scope.name;
      const db = scope.track(new SpikeDatabase(name));
      await db.open();
      throw new Error("测试失败");
    }),
  ).rejects.toThrow("测试失败");
  expect(await Dexie.exists(name)).toBe(false);
});
