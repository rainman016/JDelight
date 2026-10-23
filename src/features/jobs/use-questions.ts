import { useCallback, useEffect, useState } from "react";
import { createAnchor, getAnchorText, resolveAnchor } from "@/lib/anchor";
import type { ReportVersion, Supplement } from "@/domain/schema";
import type { SupplementChange } from "@/data/supplements";
import { repository } from "@/data/repository";
import type { QuestionTarget } from "./question-dock";
export function useQuestions({
  jobId,
  report,
  readonly,
  onNotice,
  onVersion,
}: {
  jobId: string;
  report?: ReportVersion;
  readonly: boolean;
  onNotice: (text: string) => void;
  onVersion: () => void;
}) {
  const [selection, setSelection] = useState<{
    anchor: Supplement["anchor"];
    x: number;
    y: number;
  } | null>(null);
  const [target, setTarget] = useState<QuestionTarget | null>(null);
  const close = useCallback(() => {
    setTarget(null);
    setSelection(null);
  }, []);
  useEffect(() => {
    const esc = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]"))
        close();
    };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [close]);
  const anchorFrom = (block: HTMLElement, range: Range) => ({
    ...createAnchor(block, range),
    reportVersionId: report!.id,
    sourceVersionId: report!.sourceVersionId,
    offsetUnit: "utf16" as const,
  });
  const capture = (root: HTMLElement) => {
    if (readonly || !report || target) return;
    const selected = getSelection();
    if (
      !selected ||
      selected.isCollapsed ||
      !selected.toString().trim() ||
      !selected.rangeCount
    ) {
      setSelection(null);
      return;
    }
    const range = selected.getRangeAt(0),
      node = range.startContainer;
    const block = (
      node instanceof Element ? node : node.parentElement
    )?.closest<HTMLElement>("[data-block-id]");
    if (!block || !root.contains(block)) {
      setSelection(null);
      return;
    }
    try {
      const anchor = anchorFrom(block, range),
        rect = range.getBoundingClientRect();
      setSelection({
        anchor,
        x: Math.min(innerWidth - 110, Math.max(12, rect.left)),
        y: Math.max(58, rect.top - 48),
      });
    } catch {
      setSelection(null);
      onNotice("一次选择同一段文字，或用“问这一节”提问。");
    }
  };
  const askBlock = (
    blockId: string,
    title: string,
    button: HTMLButtonElement,
  ) => {
    if (readonly || !report) return;
    const block = button
      .closest(".jd-report")
      ?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
    if (!block) return;
    const range = document.createRange();
    range.selectNodeContents(block);
    try {
      setTarget({ anchor: anchorFrom(block, range), title });
      setSelection(null);
    } catch {
      onNotice("这一节的文字没有定位成功，可以重新选中文字。");
    }
  };
  const changeNote = async (id: string, change: SupplementChange) => {
    if (!report || readonly)
      throw new Error("旧版本只读，回到当前版本后再操作");
    const next = await repository().changeSupplement(
      jobId,
      id,
      report.id,
      change,
    );
    onVersion();
    onNotice(
      `${change.kind === "add" ? "已加入报告" : change.kind === "edit" ? "已修改" : "已撤下"}，生成第 ${next.no} 版；第 ${next.no - 1} 版仍可查看`,
    );
  };
  const openNote = (note: Supplement) => {
    const block = document.querySelector<HTMLElement>(
      `.detail-screen [data-block-id="${CSS.escape(note.anchor.blockId)}"]`,
    );
    if (
      !block ||
      resolveAnchor(getAnchorText(block), note.anchor).status === "lost"
    ) {
      onNotice("所选文字暂时找不到，问题仍在；重新选择文字后再问。");
      return;
    }
    setTarget({ anchor: note.anchor, initial: note });
    setSelection(null);
  };
  const addNote = async (note: Supplement) => {
    const block = document.querySelector<HTMLElement>(
      `.detail-screen [data-block-id="${CSS.escape(note.anchor.blockId)}"]`,
    );
    if (
      !block ||
      resolveAnchor(getAnchorText(block), note.anchor).status === "lost"
    )
      throw new Error("所选文字暂时找不到，问题与解答仍保留，重新选择后再问。");
    await changeNote(note.id, { kind: "add" });
  };
  return {
    selection,
    target,
    close,
    capture,
    askBlock,
    changeNote,
    openNote,
    addNote,
    openSelection: () => {
      if (selection) {
        setTarget({ anchor: selection.anchor });
        setSelection(null);
      }
    },
  };
}
