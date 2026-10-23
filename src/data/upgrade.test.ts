import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { runUpgradeContract } from "../../tests/shared/upgrade-contract";
test("真实 v1 数据升级为 v2：五表保留、只回填快照、关闭重开、不可变保护", async () => {
  await expect(runUpgradeContract()).resolves.toEqual({
    passed: true,
    schemaVersion: 2,
  });
});
