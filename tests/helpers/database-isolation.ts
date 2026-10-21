import Dexie from "dexie";

export interface DatabaseTestScope {
  readonly name: string;
  track<T extends Dexie>(database: T): T;
}

/**
 * 每次调用使用独立数据库名，并在成功或异常时关闭全部连接、删除测试库。
 * fake-indexeddb 环境应在导入 Dexie / 此辅助函数之前安装 IndexedDB polyfill。
 * 浏览器测试还应使用 Playwright 默认的独立 context，隔离页面存储与选区。
 */
export async function withIsolatedDatabase<T>(
  run: (scope: DatabaseTestScope) => Promise<T>,
): Promise<T> {
  const name = `jdelight-test-${crypto.randomUUID()}`;
  const connections = new Set<Dexie>();
  try {
    return await run({
      name,
      track(database) {
        if (database.name !== name) throw new Error("测试数据库名称不匹配");
        connections.add(database);
        return database;
      },
    });
  } finally {
    for (const database of connections) database.close();
    await Dexie.delete(name);
  }
}
