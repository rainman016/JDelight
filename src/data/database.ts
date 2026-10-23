import Dexie, { type Table } from "dexie";
import type {
  Job,
  SourceVersion,
  ReportVersion,
  Supplement,
} from "@/domain/schema";

export class JDelightDatabase extends Dexie {
  jobs!: Table<Job, string>;
  sourceVersions!: Table<SourceVersion, string>;
  reportVersions!: Table<ReportVersion, string>;
  supplements!: Table<Supplement, string>;
  meta!: Table<{ key: string; value: string }, string>;
  constructor(name = "jdelight") {
    super(name);
    this.version(1).stores({
      jobs: "id, updatedAt, mark",
      sourceVersions: "id, jobId",
      reportVersions: "id, jobId, &[jobId+no]",
      supplements: "id, jobId",
      meta: "key",
    });
    this.version(2)
      .stores({})
      .upgrade(async (tx) => {
        // 只在 IndexedDB 的原子升级事务中回填；不清库、不修改原报告内容。
        // 使用此升级事务的原生游标，运行期的不可变 hooks 始终保持开启。
        await new Dexie.Promise<void>((resolve, reject) => {
          const request = tx.idbtrans
            .objectStore("reportVersions")
            .openCursor();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              resolve();
              return;
            }
            const write = cursor.update({ ...cursor.value, supplements: [] });
            write.onerror = () => reject(write.error);
            write.onsuccess = () => cursor.continue();
          };
        });
      });
    // 不可变版本：连直接调用 Table.update/put 都拒绝，删除由跨表事务负责。
    this.sourceVersions.hook("updating", () => {
      throw new Error("已确认的原文版本不可修改");
    });
    this.reportVersions.hook("updating", () => {
      throw new Error("已保存的报告版本不可修改");
    });
    this.on("populate", (tx) => {
      tx.table("meta").add({
        key: "schemaCreatedAt",
        value: new Date().toISOString(),
      });
    });
  }
}
let browserDatabase: JDelightDatabase | undefined;
export function getDatabase() {
  browserDatabase ??= new JDelightDatabase();
  return browserDatabase;
}
