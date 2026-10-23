import { useEffect, useRef, useState } from "react";
import { repository } from "@/data/repository";
import { KIND_LABEL } from "@/domain/report-presentation";
import type { Supplement } from "@/domain/schema";
import { mockAnswer, type AnswerProvider } from "@/providers/mock/answer";
export interface QuestionTarget {
  anchor: Supplement["anchor"];
  title?: string;
  initial?: Supplement;
}
export function QuestionDock({
  jobId,
  target,
  onClose,
  onAdd,
  provider = mockAnswer,
}: {
  jobId: string;
  target: QuestionTarget;
  onClose: () => void;
  onAdd: (note: Supplement) => Promise<void>;
  provider?: AnswerProvider;
}) {
  const [question, setQuestion] = useState(
    target.initial?.question ??
      (target.title ? `怎么理解“${target.title}”这一节？` : ""),
  );
  const [note, setNote] = useState<Supplement | null>(target.initial ?? null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    input = useRef<HTMLTextAreaElement>(null),
    requestId = useRef(crypto.randomUUID());
  const dockRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    (
      input.current ??
      dockRef.current?.querySelector<HTMLButtonElement>("button")
    )?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
      else
        document.getElementById("report-panel")?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const esc = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);
  const answer = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    let saved = note;
    try {
      saved ??= await repository().createQuestion(
        jobId,
        target.anchor.reportVersionId,
        target.anchor,
        question,
        requestId.current,
      );
      setNote(saved);
      const result = await provider(saved.question, saved.anchor.exact);
      setNote(
        await repository().answerQuestion(
          saved.id,
          result.answer,
          result.answerKind,
        ),
      );
    } catch (cause) {
      setError(
        saved
          ? "这次没拿到解答（服务暂时没响应）。问题已经记下，不会丢。"
          : cause instanceof Error
            ? cause.message
            : "问题没保存成功，输入仍在，可以重试。",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const add = async () => {
    if (!note || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await onAdd(note);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "加入没有成功，上一版本和解答仍在，可以重试。",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const answered = !!note?.answer;
  return (
    <section
      ref={dockRef}
      className="jd-question-dock"
      role="dialog"
      aria-label="问一问"
    >
      <button
        type="button"
        className="jd-dock-close"
        aria-label="关闭问答卡"
        onClick={onClose}
      >
        ×
      </button>
      <h2>问一问</h2>
      <p className="jd-dock-selected" tabIndex={0} aria-label="你选中的文字">
        <span>你选中的</span>
        {target.anchor.exact}
      </p>
      {note ? (
        <p className="jd-dock-question">
          <strong>{note.question}</strong>
        </p>
      ) : (
        <label className="jd-question-label">
          想问什么
          <textarea
            ref={input}
            maxLength={2000}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="比如，这句话是什么意思？"
          />
        </label>
      )}
      {answered && (
        <>
          <p className="jd-answer-kind">
            {note.answerKind === "common"
              ? "示例解答 · 通常"
              : KIND_LABEL[note.answerKind]}
          </p>
          <p className="jd-dock-answer">{note.answer}</p>
        </>
      )}
      {error && (
        <p className="jd-dock-error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p role="status">
          {answered ? "正在加入报告…" : "正在保存问题并获取示例解答…"}
        </p>
      )}
      <div className="btn-row">
        {answered ? (
          <>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={onClose}
            >
              先不加
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void add()}
            >
              加入报告
            </button>
          </>
        ) : error && note ? (
          <>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={onClose}
            >
              先记下，稍后再问
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void answer()}
            >
              重试
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={busy || !question.trim()}
            onClick={() => void answer()}
          >
            获取示例解答
          </button>
        )}
      </div>
      <p className="jd-dock-foot">
        问题提交后保存在“我的疑问与补充”；加入报告会生成新版本。
      </p>
    </section>
  );
}
