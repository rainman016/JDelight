import {
  anchorSchema,
  supplementSchema,
  reportVersionSchema,
  type Supplement,
  type SupplementSnapshot,
} from "@/domain/schema";
import { answerText, questionText, reportBlockIds } from "@/domain/supplements";
import { kindSchema } from "@/domain/report";
import type { JDelightDatabase } from "./database";
import { markDataChanged } from "./revision";

export type SupplementChange =
  { kind: "add" | "withdraw" } | { kind: "edit"; answer: string };
export function createSupplementRepository(db: JDelightDatabase) {
  return {
    createQuestion: async (
      jobId: string,
      parentId: string,
      input: unknown,
      question: string,
      requestId = crypto.randomUUID(),
    ) => {
      const anchor = anchorSchema.parse(input);
      const text = questionText(question);
      return db.transaction(
        "rw",
        db.jobs,
        db.reportVersions,
        db.supplements,
        db.meta,
        async () => {
          const job = await db.jobs.get(jobId),
            parent = await db.reportVersions.get(parentId);
          if (
            !job ||
            job.currentReportVersionId !== parentId ||
            !parent ||
            parent.jobId !== jobId
          )
            throw new Error("报告已更新，输入仍在；回到当前版本后再提问");
          if (
            anchor.reportVersionId !== parentId ||
            anchor.sourceVersionId !== parent.sourceVersionId ||
            !reportBlockIds(parent.content).has(anchor.blockId)
          )
            throw new Error("选中文字与报告版本不一致，重新选择后再问");
          const existing = await db.supplements.get(requestId);
          if (existing) {
            if (
              existing.jobId !== jobId ||
              existing.question !== text ||
              JSON.stringify(existing.anchor) !== JSON.stringify(anchor)
            )
              throw new Error("问题请求已变化，没有覆盖原问题");
            return existing;
          }
          const now = new Date().toISOString();
          const note = supplementSchema.parse({
            id: requestId,
            jobId,
            question: text,
            answer: "",
            answerKind: "common",
            anchor,
            status: "unanswered",
            addedInVersion: null,
            createdAt: now,
            updatedAt: now,
          });
          await db.supplements.add(note);
          await db.jobs.update(jobId, { updatedAt: now });
          await markDataChanged(db);
          return note;
        },
      );
    },
    answerQuestion: async (
      id: string,
      answer: string,
      kind: Supplement["answerKind"] = "common",
    ) => {
      const text = answerText(answer),
        answerKind = kindSchema.parse(kind);
      return db.transaction(
        "rw",
        db.jobs,
        db.supplements,
        db.meta,
        async () => {
          const note = await db.supplements.get(id);
          if (!note || !(await db.jobs.get(note.jobId)))
            throw new Error("问题已不在本机数据中，没有重新创建");
          if (note.status === "added" || note.status === "withdrawn")
            return note;
          const now = new Date().toISOString();
          const next = supplementSchema.parse({
            ...note,
            answer: text,
            answerKind,
            status: "answered",
            updatedAt: now,
          });
          await db.supplements.put(next);
          await db.jobs.update(note.jobId, { updatedAt: now });
          await markDataChanged(db);
          return next;
        },
      );
    },
    changeSupplement: async (
      jobId: string,
      supplementId: string,
      expectedParentId: string,
      change: SupplementChange,
    ) => {
      // 新快照在事务外计算；事务内重新核对父版本与补充，防止覆盖另一页面。
      const [parent, note, initialJob] = await Promise.all([
        db.reportVersions.get(expectedParentId),
        db.supplements.get(supplementId),
        db.jobs.get(jobId),
      ]);
      if (initialJob?.currentReportVersionId !== expectedParentId)
        throw new Error("另一个页面已经更新报告，未覆盖现有版本");
      if (!parent || parent.jobId !== jobId || !note || note.jobId !== jobId)
        throw new Error("报告或补充没有读取成功，原有版本仍在");
      if (
        change.kind === "add"
          ? note.status !== "answered"
          : note.status !== "added"
      )
        throw new Error("补充状态已变化，刷新后再试");
      if (
        !reportBlockIds(parent.content).has(note.anchor.blockId) ||
        note.anchor.sourceVersionId !== parent.sourceVersionId
      )
        throw new Error("补充的原文版本不一致，没有新增报告");
      const now = new Date().toISOString(),
        number = parent.no + 1;
      const updated = supplementSchema.parse({
        ...note,
        answer:
          change.kind === "edit" ? answerText(change.answer) : note.answer,
        status: change.kind === "withdraw" ? "withdrawn" : "added",
        addedInVersion: change.kind === "add" ? number : note.addedInVersion,
        updatedAt: now,
      });
      const snapshot: SupplementSnapshot = {
        supplementId: note.id,
        question: updated.question,
        answer: updated.answer,
        answerKind: updated.answerKind,
        anchor: structuredClone(updated.anchor),
        addedInVersion: updated.addedInVersion!,
      };
      const snapshots =
        change.kind === "add"
          ? [...parent.supplements, snapshot]
          : change.kind === "edit"
            ? parent.supplements.map((item) =>
                item.supplementId === note.id ? snapshot : item,
              )
            : parent.supplements.filter(
                (item) => item.supplementId !== note.id,
              );
      if (
        change.kind !== "add" &&
        !parent.supplements.some((item) => item.supplementId === note.id)
      )
        throw new Error("补充不在当前版本，未生成新版本");
      const prefix = {
        add: "加入：",
        edit: "修改补充：",
        withdraw: "撤下补充：",
      }[change.kind];
      const next = reportVersionSchema.parse({
        ...parent,
        id: crypto.randomUUID(),
        no: number,
        parentId: parent.id,
        supplements: snapshots,
        change: {
          kind: change.kind,
          supplementId: note.id,
          summary: prefix + note.question.slice(0, 40),
        },
        createdAt: now,
      });
      return db.transaction(
        "rw",
        db.jobs,
        db.sourceVersions,
        db.reportVersions,
        db.supplements,
        db.meta,
        async () => {
          const job = await db.jobs.get(jobId),
            stored = await db.supplements.get(note.id);
          if (
            !job ||
            job.currentReportVersionId !== parent.id ||
            job.currentSourceVersionId !== parent.sourceVersionId
          )
            throw new Error("另一个页面已经更新报告，未覆盖现有版本");
          if (
            !stored ||
            JSON.stringify(stored) !== JSON.stringify(note) ||
            !(await db.sourceVersions.get(parent.sourceVersionId))
          )
            throw new Error("补充或原文已变化，没有覆盖");
          if (!(await db.reportVersions.get(parent.id)))
            throw new Error("父版本已不在本机，没有重建");
          await db.reportVersions.add(next);
          await db.supplements.put(updated);
          await db.jobs.update(jobId, {
            currentReportVersionId: next.id,
            updatedAt: now,
          });
          await markDataChanged(db);
          return next;
        },
      );
    },
  };
}
