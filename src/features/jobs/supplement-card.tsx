import { useState } from "react";
import type { SupplementSnapshot } from "@/domain/schema";
import { KIND_LABEL } from "@/domain/report-presentation";
import { useReportActions } from "./report-actions";
export function SupplementCard({ item }: { item: SupplementSnapshot }) {
  const actions = useReportActions();
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(item.answer),
    [armed, setArmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const commit = async (kind: "edit" | "withdraw") => {
    if (!actions || busy) return;
    setBusy(true);
    setError("");
    try {
      await actions.changeNote(
        item.supplementId,
        kind === "edit" ? { kind, answer: draft } : { kind },
      );
      setEditing(false);
      setArmed(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "没保存成功，输入仍保留，可以再试",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <li data-supplement-id={item.supplementId}>
      <span className="jd-supplement-meta">
        第 {item.addedInVersion} 版加入 · {KIND_LABEL[item.answerKind]}
      </span>
      <p className="jd-note-selection">你选中的：{item.anchor.exact}</p>
      <strong>{item.question}</strong>
      {editing ? (
        <>
          <label className="sr-only" htmlFor={`edit-${item.supplementId}`}>
            修改补充
          </label>
          <textarea
            id={`edit-${item.supplementId}`}
            autoFocus
            className="jd-note-edit"
            maxLength={12000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </>
      ) : (
        <p>{item.answer}</p>
      )}
      {actions && (
        <div className="jd-note-actions">
          {editing ? (
            <>
              <button
                type="button"
                className="jd-link"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setError("");
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="jd-link"
                disabled={busy || !draft.trim()}
                onClick={() => void commit("edit")}
              >
                保存为新版本
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="jd-link"
                disabled={busy}
                onClick={() => {
                  setDraft(item.answer);
                  setEditing(true);
                  setError("");
                }}
              >
                修改
              </button>
              <button
                type="button"
                className={`jd-link${armed ? " danger" : ""}`}
                disabled={busy}
                onBlur={() => setArmed(false)}
                onClick={() => {
                  if (!armed) setArmed(true);
                  else void commit("withdraw");
                }}
              >
                {armed ? "再点一次，撤下" : "撤下"}
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
