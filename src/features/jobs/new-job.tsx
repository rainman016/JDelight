"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { repository } from "@/data/repository";
import type { Job } from "@/domain/schema";
import { checksOf, metaFrom, sourceLines, type JobMeta } from "@/domain/source";
import { lightSegments } from "@/domain/signals";
import { ReportCheckError } from "@/domain/report";
import {
  analyze,
  invalidDemoReport,
  SAMPLE_JD,
  STAGES,
  type Progress,
} from "@/providers/mock";
import { SourcePaper } from "@/components/source-paper";
import {
  analysisStatus,
  analyzeWithModel,
  AnalysisClientError,
} from "@/providers/model/client";
import type { AnalysisStatus, AnalysisFailureKind } from "@/domain/analysis";
import { TrialAccess } from "./trial-access";
type Failure = { kind: AnalysisFailureKind | "save"; reasons: string[] };

export default function NewJob({
  retry,
  demoFail,
}: {
  retry?: string;
  demoFail: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"input" | "confirm" | "analyzing" | "fail">(
    retry ? "analyzing" : "input",
  );
  const [raw, setRaw] = useState("");
  const [meta, setMeta] = useState<JobMeta>({
    title: "",
    company: "",
    place: "",
  });
  const [error, setError] = useState("");
  const [fail, setFail] = useState<Failure | null>(null);
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [useReal, setUseReal] = useState(false);
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  useEffect(() => {
    let mounted = true;
    void analysisStatus().then((value) => {
      if (mounted) {
        setStatus(value);
        if (
          value?.mode === "trial" &&
          value.available &&
          !value.needCode &&
          !value.invalidCode &&
          value.codeRemaining > 0
        )
          setUseReal(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);
  const [progress, setProgress] = useState<Progress>({
    stage: 0,
    done: 0,
    total: 0,
  });
  useEffect(() => {
    if (step !== "analyzing" || !useReal || progress.stage !== 2) return;
    const started = performance.now();
    const timer = setInterval(
      () => setWaitingSeconds(Math.floor((performance.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [step, useReal, progress.stage]);
  const [saved, setSaved] = useState(false);
  const jobRef = useRef<Job | null>(null);
  const requestId = useRef<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const attempted = useRef(false);
  const runJob = useCallback(
    async (existing?: Job, modeOverride?: boolean) => {
      const mode = modeOverride ?? useReal;
      if (inFlight.current) return;
      inFlight.current = true;
      setUseReal(mode);
      setWaitingSeconds(0);
      setProgress({ stage: 0, done: 0, total: 0 });
      const ctrl = new AbortController();
      active.current = ctrl;
      let job: Job | null = existing ?? jobRef.current;
      let savingReport = false;
      setError("");
      setFail(null);
      try {
        const repo = repository();
        if (!job) {
          requestId.current ??= crypto.randomUUID();
          job = await repo.createJob(raw, meta, requestId.current);
        }
        jobRef.current = job;
        ctrl.signal.throwIfAborted();
        setSaved(true);
        if (job.currentReportVersionId) {
          router.replace(`/jobs/${job.id}`);
          return;
        }
        const source = await repo.getSource(job);
        ctrl.signal.throwIfAborted();
        setRaw(source.text);
        setMeta({ title: job.title, company: job.company, place: job.place });
        const started = await repo.startAnalysis(job.id);
        ctrl.signal.throwIfAborted();
        if (started.currentReportVersionId) {
          router.replace(`/jobs/${job.id}`);
          return;
        }
        setStep("analyzing");
        const content = mode
          ? await analyzeWithModel(source, setProgress, ctrl.signal)
          : await analyze(source, setProgress, ctrl.signal);
        ctrl.signal.throwIfAborted();
        const shouldFail = !mode && demoFail && !attempted.current;
        attempted.current = true;
        savingReport = true;
        await repo.saveReport(
          job.id,
          source,
          shouldFail ? invalidDemoReport(content) : content,
          job.currentReportVersionId,
        );
        // 事务一旦开始就等其原子完成；取消不能把已提交的 ready 状态改回 saved。
        if (!ctrl.signal.aborted) router.replace(`/jobs/${job.id}`);
      } catch (cause) {
        if (ctrl.signal.aborted) {
          if (job && !savingReport)
            await repository()
              .cancelAnalysis(job.id)
              .catch(() => {});
          return;
        }
        if (!job) {
          setError("没保存成功，可以再试一次。输入仍保留在这里。");
          setStep("confirm");
          return;
        }
        const clientError = cause instanceof AnalysisClientError ? cause : null;
        const check = cause instanceof ReportCheckError;
        const reasons = clientError
          ? [...clientError.reasons]
          : check
            ? [...new Set(cause.issues.map((i) => i.message))]
            : [
                cause instanceof Error &&
                /另一个页面|基础分析已经/.test(cause.message)
                  ? cause.message
                  : savingReport
                    ? "未保存，仍显示上一版本，可以重试"
                    : "分析没有完成，可以重新分析。原文仍在本机。",
              ];
        const failureKind = clientError?.kind ?? (check ? "check" : "save");
        if (mode) setStatus(await analysisStatus());
        const latest = await repository()
          .failAnalysis(job.id, {
            kind: failureKind === "config" ? "save" : failureKind,
            reasons,
          })
          .catch(() => {
            reasons.push(
              "失败状态没保存成功；已确认原文仍在本机，可以返回首页重试。",
            );
          });
        if (latest?.currentReportVersionId) {
          router.replace(`/jobs/${job.id}`);
          return;
        }
        setFail({ kind: failureKind, reasons });
        setStep("fail");
      } finally {
        inFlight.current = false;
      }
    },
    [demoFail, raw, meta, router, useReal],
  );
  useEffect(() => {
    let mounted = true;
    if (retry)
      void repository()
        .readJob(retry)
        .then((data) => {
          if (!mounted) return;
          if (!data) {
            setError("没找到这个岗位，可以返回我的岗位。");
            setStep("fail");
            return;
          }
          void runJob(data.job);
        })
        .catch(() => {
          if (mounted) {
            setError("原文没有读取成功，可以返回首页再试。");
            setStep("fail");
          }
        });
    return () => {
      mounted = false;
      active.current?.abort();
    };
    // retry 是一次性的路由入口；raw/meta 编辑不能重启已经运行的分析。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);
  const lines = useMemo(() => sourceLines(raw), [raw]);
  const notes = checksOf(lines);
  const next = () => {
    if (raw.trim().length >= 40 && raw.length <= 12000) {
      setMeta(metaFrom(raw));
      setError("");
      setStep("confirm");
    }
  };
  const index = step === "input" ? 0 : step === "confirm" ? 1 : 2;
  const stages: readonly string[] = useReal
    ? ["切分段落", "识别分区", "等待模型返回"]
    : STAGES;
  return (
    <div className="app">
      <header className="topbar">
        <Link className="back" href="/">
          ← 我的岗位
        </Link>
        <span className="wordmark">JDelight</span>
        <nav className="crumbs" aria-label="进度">
          {["输入", "校对", "解析", "详情"].map((label, i) => (
            <span
              className="crumb"
              key={label}
              aria-current={i === index ? "step" : undefined}
              data-state={i < index ? "done" : i === index ? "now" : "next"}
            >
              {label}
            </span>
          ))}
          {step === "analyzing" && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                active.current?.abort();
                if (useReal)
                  setError(
                    "已取消等待。已经发出的真实调用仍计次，原文已保留。",
                  );
                setStep("confirm");
              }}
            >
              取消
            </button>
          )}
        </nav>
      </header>
      <main className="main">
        {step === "input" && (
          <InputView raw={raw} onChange={setRaw} onNext={next} />
        )}
        {step === "confirm" && (
          <section className="stage confirm-stage" aria-labelledby="cf-h">
            <div className="cf-side">
              <h1 id="cf-h" className="cf-title">
                先校对一下原文
              </h1>
              <p className="cf-lead">
                分析只会依据你确认的这份原文。确认后原文不能再改；想改就回去修改后重新确认。
              </p>
              <div className="cf-fields">
                {(
                  [
                    ["title", "岗位名称"],
                    ["company", "公司"],
                    ["place", "地点"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="cf-field" key={key}>
                    <span>{label}</span>
                    <input
                      value={meta[key]}
                      disabled={saved}
                      maxLength={80}
                      placeholder="原文没写可以留空"
                      onChange={(e) =>
                        setMeta({ ...meta, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
              <ul className="cf-notes" aria-label="检查结果">
                {notes.map((n, i) => (
                  <li className="cf-note" data-level={n.level} key={i}>
                    {n.text}
                  </li>
                ))}
              </ul>
              {error && (
                <p role="alert" className="inline-error">
                  {error}
                </p>
              )}
              {status?.mode === "trial" && (
                <TrialAccess
                  status={status}
                  checked={useReal}
                  onChange={setUseReal}
                  onStatus={setStatus}
                />
              )}
              {status?.mode !== "trial" &&
                status?.available &&
                status.uiRemaining > 0 && (
                  <label className="real-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={useReal}
                      onChange={(e) => setUseReal(e.target.checked)}
                    />
                    <span>用真实 AI 分析（还剩 {status.uiRemaining} 次）</span>
                  </label>
                )}
              {useReal && status?.mode !== "trial" && (
                <p className="hint">
                  真实分析会计次和费用；取消后，已经发出的调用仍计次。
                </p>
              )}
              <div className="btn-row">
                {saved ? (
                  <Link href="/" className="btn">
                    返回我的岗位
                  </Link>
                ) : (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setStep("input")}
                  >
                    回去修改
                  </button>
                )}
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => void runJob()}
                >
                  {saved ? "继续分析" : "确认原文，开始分析"}
                </button>
              </div>
              <p className="hint">
                {saved
                  ? "原文已确认并保存在本机，可以继续分析，也可以稍后从首页重试。"
                  : "不会自动补全缺字，也不会替你改写原文。"}
              </p>
            </div>
            <SourcePaper
              lines={lines}
              flagged={notes.flatMap((n) => (n.lineNo ? [n.lineNo] : []))}
            />
          </section>
        )}
        {step === "analyzing" && (
          <section className="stage analyze-stage" aria-label="解析中">
            <div className="steps-wrap">
              <h1 className="big-stage">{stages[progress.stage]}</h1>
              <p className="big-count" role="status">
                {useReal && progress.stage === 2 ? (
                  <>
                    {waitingSeconds}
                    <small>秒 · 已等待</small>
                  </>
                ) : (
                  <>
                    {progress.done}
                    <small>/ {progress.total} 行</small>
                  </>
                )}
              </p>
              <ol className="steps">
                {stages.map((label, i) => (
                  <li
                    key={label}
                    data-state={
                      i < progress.stage
                        ? "done"
                        : i === progress.stage
                          ? "now"
                          : "next"
                    }
                  >
                    <span className="step-mark" aria-hidden="true" />
                    <span>{label}</span>
                    <span className="step-count">
                      {useReal && i === 2
                        ? progress.stage === 2
                          ? `${waitingSeconds} 秒`
                          : ""
                        : i <= progress.stage
                          ? `${i < progress.stage ? progress.total : progress.done} / ${progress.total} 行`
                          : ""}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="hint">
                {useReal
                  ? "前两个步骤在本机处理原文；等待时间按实际秒数显示。取消会中止请求，但已发出的调用仍计次。"
                  : "每一步对应真实处理的行数。解析使用本地规则，未调用 AI 模型。"}
              </p>
            </div>
            <SourcePaper lines={lines} label="正在解析 · 原文" />
          </section>
        )}
        {step === "fail" && (
          <FailureView
            fail={fail ?? { kind: "save", reasons: [error] }}
            saved={saved}
            status={status}
            useReal={useReal}
            onRetry={() => void runJob()}
            onMock={() => void runJob(undefined, false)}
          />
        )}
      </main>
    </div>
  );
}
function InputView({
  raw,
  onChange,
  onNext,
}: {
  raw: string;
  onChange: (value: string) => void;
  onNext: () => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null),
    ghost = useRef<HTMLDivElement>(null);
  const chars = raw.trim().length;
  const ready = chars >= 40 && raw.length <= 12000;
  const segs = lightSegments(raw);
  const found = new Set(
    sourceLines(raw)
      .filter((l) => l.heading)
      .map((l) => l.section),
  );
  const [pasteNote, setPasteNote] = useState("");
  useEffect(() => {
    textarea.current?.focus();
  }, []);
  return (
    <section className="stage input-stage">
      <div className="hero">
        <h1 className="poster">
          <span className="ln">贴一份 JD，</span>
          <span className="ln">
            看它<em>到底</em>
          </span>
          <span className="ln">要什么。</span>
        </h1>
        <p className="lead">
          粘贴任意一份岗位描述。下一步先校对原文，确认后才开始分析。结果保存在这台设备的这个浏览器里。
        </p>
        <ul className="meters" aria-label="实时识别">
          {[
            [segs.filter((s) => s.kind === "skill").length, "技能词"],
            [segs.filter((s) => s.kind === "risk").length, "待确认信号"],
            [`${found.size}/3`, "分区"],
          ].map(([n, label]) => (
            <li key={label}>
              <b>{n}</b>
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="editor-col">
        <p className="scribble" aria-hidden="true">
          贴在这儿 ↘
        </p>
        <div className="editor">
          <div className="win-bar">
            <span className="win-title">岗位描述.txt</span>
          </div>
          <label htmlFor="jd" className="sr-only">
            岗位描述
          </label>
          <div className="editor-body">
            <div className="lit-layer" ref={ghost} aria-hidden="true">
              {segs.map((s, i) =>
                s.kind ? (
                  <mark key={i} className={`lit ${s.kind}`}>
                    {s.text}
                  </mark>
                ) : (
                  <span key={i}>{s.text}</span>
                ),
              )}
              {"\n"}
            </div>
            <textarea
              ref={textarea}
              id="jd"
              value={raw}
              spellCheck={false}
              placeholder={"例如：\n岗位职责\n1. 负责……\n任职要求\n1. 熟悉……"}
              onChange={(e) => {
                setPasteNote("");
                onChange(e.target.value);
              }}
              onPaste={(e) => {
                if (e.clipboardData.getData("text").length + raw.length > 12000)
                  setPasteNote(
                    "原文可能超过 12,000 字；内容保留在输入框，缩短后再校对。",
                  );
              }}
              onScroll={(e) => {
                if (ghost.current)
                  ghost.current.scrollTop = e.currentTarget.scrollTop;
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (ready) onNext();
                }
              }}
            />
          </div>
          <div className="editor-foot">
            <span className="stat">
              {raw
                ? `${raw.split(/\r\n|\n|\r/).length} 行 · ${chars.toLocaleString()} 字`
                : "支持 40–12,000 字"}
            </span>
            <span className="spacer" />
            {raw ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  onChange("");
                  textarea.current?.focus();
                }}
              >
                清空
              </button>
            ) : (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  onChange(SAMPLE_JD);
                  textarea.current?.focus();
                }}
              >
                试试示例
              </button>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={!ready}
              aria-describedby="why"
              onClick={onNext}
            >
              下一步：校对 <kbd>Ctrl ↵</kbd>
            </button>
          </div>
        </div>
        <p id="why" className="hint" role="status">
          {pasteNote ||
            (raw.length > 12000
              ? "超过 12,000 字，输入已保留，缩短后再试。"
              : ready
                ? "准备好了，下一步校对原文。"
                : chars
                  ? `还差 ${40 - chars} 个字才能开始。`
                  : "先粘贴一份岗位描述，或用示例看看效果。")}
        </p>
      </div>
    </section>
  );
}

function FailureView({
  fail,
  saved,
  status,
  useReal,
  onRetry,
  onMock,
}: {
  fail: Failure;
  saved: boolean;
  status: AnalysisStatus | null;
  useReal: boolean;
  onRetry: () => void;
  onMock: () => void;
}) {
  const quota = fail.kind === "quota";
  return (
    <section className="stage fail-stage" aria-live="polite">
      <div className="fail-card">
        <span className="fail-tag">
          {quota
            ? "次数已用完"
            : fail.kind === "save"
              ? "没有完成"
              : "没通过检查"}
        </span>
        <h1 className="fail-title">
          {quota
            ? status?.mode === "trial"
              ? "这个邀请码暂时不能继续真实分析"
              : "本机的真实分析次数已用完"
            : fail.kind === "save"
              ? "这次分析没有保存成功"
              : "这次分析没通过检查，没有展示"}
        </h1>
        <p className="fail-lead">
          {quota
            ? status?.mode === "trial"
              ? "这个邀请码的份数或可用次数受限；现在仍可使用模拟分析。"
              : status
                ? `本机上限 ${status.maxCalls} 次、¥${status.maxCostCny}，已用 ${status.used} 次、约 ¥${status.costUsedCny.toFixed(4)}，不会自动恢复。`
                : "本机真实分析受次数与金额上限约束，不会自动恢复。"
            : "引用必须和原文一字不差，要求的程度不能被改写。"}
        </p>
        <ul className="fail-list">
          {fail.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <div className="btn-row">
          <Link className="btn" href="/">
            {quota ? "只保存原文" : "先保存原文，稍后再试"}
          </Link>
          {saved &&
            (quota ? (
              <button type="button" className="btn primary" onClick={onMock}>
                用示例分析看看效果
              </button>
            ) : (
              <button type="button" className="btn primary" onClick={onRetry}>
                重新分析
                {useReal && status
                  ? status.mode === "trial"
                    ? `（这个码还剩 ${status.codeRemaining} 份）`
                    : `（还剩 ${status.uiRemaining} 次）`
                  : ""}
              </button>
            ))}
        </div>
        {saved && (
          <p className="hint">
            你确认过的原文已经在本机，不会因为这次失败丢失。
          </p>
        )}
      </div>
    </section>
  );
}
