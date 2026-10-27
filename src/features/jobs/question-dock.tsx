import { useEffect, useRef, useState } from "react";
import { repository } from "@/data/repository";
import { KIND_LABEL } from "@/domain/report-presentation";
import type { Supplement } from "@/domain/schema";
import { mockAnswer, type AnswerProvider } from "@/providers/mock/answer";
import { answerWithModel } from "@/providers/model/answer";
import { analysisStatus, AnalysisClientError } from "@/providers/model/client";
import type { AnalysisStatus } from "@/domain/analysis";
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
  provider,
  source = "",
}: {
  jobId: string;
  target: QuestionTarget;
  onClose: () => void;
  onAdd: (note: Supplement) => Promise<void>;
  provider?: AnswerProvider;
  source?: string;
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
  const activeRequest = useRef<AbortController | null>(null);
  const [cachedAnswer, setCachedAnswer] = useState<Awaited<
    ReturnType<AnswerProvider>
  > | null>(null);
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [checking, setChecking] = useState(!provider);
  const remote =
    !provider &&
    status?.mode === "trial" &&
    !status.needCode &&
    !status.invalidCode &&
    !status.unavailable;
  const exhausted = remote && status.questionsRemaining === 0;
  useEffect(() => {
    let mounted = true;
    if (!provider)
      void analysisStatus().then((next) => {
        if (mounted) {
          setStatus(next);
          setChecking(false);
        }
      });
    return () => {
      mounted = false;
      activeRequest.current?.abort();
    };
  }, [provider]);
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
    let received = cachedAnswer;
    activeRequest.current = new AbortController();
    try {
      saved ??= await repository().createQuestion(
        jobId,
        target.anchor.reportVersionId,
        target.anchor,
        question,
        requestId.current,
      );
      setNote(saved);
      if (!received) {
        const result = remote
          ? await answerWithModel(
              {
                jobId,
                question: saved.question,
                selected: saved.anchor.exact,
                source,
              },
              activeRequest.current.signal,
            )
          : await (provider ?? mockAnswer)(saved.question, saved.anchor.exact);
        received = result;
        setCachedAnswer(result);
        if (
          "questionsRemaining" in result &&
          typeof result.questionsRemaining === "number"
        ) {
          const remaining = result.questionsRemaining;
          setStatus((current) =>
            current?.mode === "trial"
              ? { ...current, questionsRemaining: remaining }
              : current,
          );
        }
      }
      activeRequest.current.signal.throwIfAborted();
      const result = received;
      setNote(
        await repository().answerQuestion(
          saved.id,
          result.answer,
          result.answerKind,
        ),
      );
      setCachedAnswer(null);
    } catch (cause) {
      setError(
        received
          ? "解答已返回，但本机没有保存成功；重试会再次保存，不会重新提问。"
          : remote && saved
            ? cause instanceof AnalysisClientError
              ? `没有拿到解答，这次不扣次数。${cause.reasons.join("；")}`
              : "没有拿到解答，这次不扣次数。问题已经保留。"
            : saved
              ? "这次没拿到解答（服务暂时没响应）。问题已经记下，不会丢。"
              : cause instanceof Error
                ? cause.message
                : "问题没保存成功，输入仍在，可以重试。",
      );
      if (remote && !activeRequest.current.signal.aborted)
        void analysisStatus().then((next) => {
          if (!activeRequest.current?.signal.aborted) setStatus(next);
        });
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
      {remote && (
        <p className="jd-question-quota" role="status">
          这个码还剩 {status.questionsRemaining} 次提问
        </p>
      )}
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
            {note.answerKind === "common" && note.answer.startsWith("示例解答")
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
          {answered
            ? "正在加入报告…"
            : remote
              ? "正在获取解答…（约 10 秒）"
              : "正在保存问题并获取示例解答…"}
        </p>
      )}
      {!answered && checking && <p role="status">正在检查提问额度…</p>}
      {!answered && exhausted && (
        <p role="status">
          {status.questionCallLimitReached
            ? "这个码的可用提问调用次数已用完，仍可查看已有解答。"
            : status.trialEnded
              ? "当前可用提问次数已用完，仍可查看已有解答。"
              : "这个码的 20 次提问已用完，仍可查看已有解答。"}
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
              disabled={busy || (exhausted && !cachedAnswer)}
              onClick={() => void answer()}
            >
              重试
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={busy || checking || exhausted || !question.trim()}
            onClick={() => void answer()}
          >
            {remote ? "提问" : "获取示例解答"}
          </button>
        )}
      </div>
      {answered && remote && <p className="jd-dock-reference">解答仅供参考</p>}
      <p className="jd-dock-foot">
        问题提交后保存在“我的疑问与补充”；加入报告会生成新版本。
      </p>
    </section>
  );
}
