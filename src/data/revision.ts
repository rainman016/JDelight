import type { JDelightDatabase } from "./database";
export async function dataRevision(db: JDelightDatabase) {
  return (await db.meta.get("dataRevision"))?.value ?? "initial";
}
/** 调用方的写事务必须包含 meta，和业务数据同时提交／回滚。 */
export async function markDataChanged(db: JDelightDatabase) {
  await db.meta.put({ key: "dataRevision", value: crypto.randomUUID() });
}
