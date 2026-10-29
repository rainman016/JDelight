"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { liveQuery } from "dexie";
import { repository } from "@/data/repository";
import type { ReportVersion } from "@/domain/schema";
import { hasIncompleteJobMeta, reportDate } from "@/domain/report-presentation";
import { MarkMenu } from "@/components/mark-menu";
import { LocalNote } from "@/components/local-note";
import { Modal } from "@/components/modal";
import { CitationProvider } from "./report-citations";
import { Brief, ReportBody } from "./report-content";
import { ReportExport } from "./report-export";
import { ReportVersions } from "./report-versions";
import { useCitation } from "./use-citation";
import { useQuestions } from "./use-questions";
import { ReportActions } from "./report-actions";
import { QuestionDock } from "./question-dock";
import { FeedbackButton } from "@/features/trial/experience";
import { QuestionList } from "./question-list";

type Data = Awaited<ReturnType<ReturnType<typeof repository>["readJob"]>>;
type Tab = "report" | "brief";
export default function JobDetail({ id }: { id: string }) {
  const [data, setData] = useState<Data | undefined>(undefined);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("report");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [printReport, setPrintReport] = useState<ReportVersion | null>(null);
  const sourcePanel = useRef<HTMLElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const {
    active,
    thread,
    mobileOpen,
    setMobileOpen,
    clear: clearCitation,
    pick: pickCitation,
    scrollRef,
    registerLine,
  } = useCitation();
  useEffect(() => {
    const sub = liveQuery(() => repository().readJob(id)).subscribe({
      next: setData,
      error: () =>
        setError("报告没有读取成功，原文仍在本机，可以返回首页再试。"),
    });
    void repository()
      .recordView(id)
      .catch(() => {});
    return () => sub.unsubscribe();
  }, [id]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 2200);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    const esc = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]"))
        clearCitation();
    };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [clearCitation]);
  useEffect(() => {
    if (!printReport) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) window.print();
    });
    return () => {
      cancelled = true;
    };
  }, [printReport]);
  useEffect(() => {
    const restore = () => setPrintReport(null);
    addEventListener("afterprint", restore);
    return () => removeEventListener("afterprint", restore);
  }, []);
  const report =
    data?.versions.find((version) => version.id === selectedId) ?? data?.report;
  const source =
    data?.sources.find((item) => item.id === report?.sourceVersionId) ??
    data?.source;
  const printable = printReport ?? report;
  const printSource = data?.sources.find(
    (item) => item.id === printable?.sourceVersionId,
  );
  const readonly = !!report && report.id !== data?.job.currentReportVersionId;
  const questions = useQuestions({
    jobId: id,
    report,
    readonly,
    onNotice: setNotice,
    onVersion: () => setSelectedId(null),
  });
  const switchTab = (next: Tab) => {
    setTab(next);
    clearCitation();
    questions.close();
  };
  return (
    <div className="job-detail">
      <FeedbackButton
        hidden={!!questions.target || mobileOpen || exporting || !!notice}
      />
      <div className="detail-screen">
        <header className="topbar">
          <Link href="/" className="back">
            ← 我的岗位
          </Link>
          <span className="spacer" />
          <LocalNote />
          {report && (
            <button
              type="button"
              className="btn"
              onClick={() => setExporting(true)}
            >
              导出报告
            </button>
          )}
        </header>
        <main className="detail-main">
          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : data === undefined ? (
            <p role="status">正在读取岗位…</p>
          ) : !data ? (
            <>
              <h1 className="d-title">没找到这个岗位</h1>
              <Link className="btn" href="/">
                返回我的岗位
              </Link>
            </>
          ) : (
            <>
              <section className="d-head">
                <div>
                  <h1 className="d-title">{data.job.title || "未命名岗位"}</h1>
                  <p className="d-where">
                    {data.job.company || "未显示"} ·{" "}
                    {data.job.place || "未显示"}
                  </p>
                  {hasIncompleteJobMeta(data.job) && (
                    <p className="jd-source-incomplete">原文不完整</p>
                  )}
                  {report && (
                    <ReportVersions
                      versions={data.versions}
                      currentId={data.job.currentReportVersionId!}
                      selected={report}
                      onSelect={(versionId) => {
                        setSelectedId(versionId);
                        clearCitation();
                        questions.close();
                      }}
                    />
                  )}
                </div>
                <div className="detail-mark">
                  <span className="jd-mark-label">我的标记</span>
                  <MarkMenu
                    mark={data.job.mark}
                    onChange={async (mark) => {
                      try {
                        await repository().setMark(id, mark);
                        setNotice("标记已保存");
                      } catch {
                        setNotice("标记没保存成功，可以再试一次");
                      }
                    }}
                  />
                </div>
              </section>
              {report && source ? (
                <>
                  {readonly && (
                    <p className="jd-readonly" role="status">
                      你在看第 {report.no} 版（{reportDate(report.createdAt)}
                      ）。旧版本只读，不能提问或修改。
                      <button
                        type="button"
                        className="jd-link"
                        onClick={() => {
                          setSelectedId(null);
                          clearCitation();
                          questions.close();
                        }}
                      >
                        回到当前第 {data.report?.no} 版
                      </button>
                    </p>
                  )}
                  <div
                    className="jd-tabs"
                    role="tablist"
                    aria-label="报告视图"
                    ref={tabs}
                    onKeyDown={(event) => {
                      if (
                        !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                          event.key,
                        )
                      )
                        return;
                      event.preventDefault();
                      const next =
                        event.key === "Home"
                          ? "report"
                          : event.key === "End"
                            ? "brief"
                            : tab === "report"
                              ? "brief"
                              : "report";
                      switchTab(next);
                      tabs.current
                        ?.querySelector<HTMLButtonElement>(`#tab-${next}`)
                        ?.focus();
                    }}
                  >
                    {(["report", "brief"] as const).map((name) => (
                      <button
                        type="button"
                        key={name}
                        id={`tab-${name}`}
                        role="tab"
                        aria-selected={tab === name}
                        aria-controls="report-panel"
                        tabIndex={tab === name ? 0 : -1}
                        onClick={() => switchTab(name)}
                      >
                        {name === "report" ? "完整报告" : "面试前速览"}
                      </button>
                    ))}
                  </div>
                  <CitationProvider
                    source={source}
                    activeId={active?.id}
                    onPick={(next) => pickCitation(next, tab === "brief")}
                  >
                    <ReportActions
                      actions={
                        readonly
                          ? null
                          : {
                              askBlock: questions.askBlock,
                              changeNote: questions.changeNote,
                            }
                      }
                    >
                      <div
                        id="report-panel"
                        role="tabpanel"
                        aria-labelledby={`tab-${tab}`}
                        tabIndex={0}
                        onMouseUp={(event) =>
                          questions.capture(event.currentTarget)
                        }
                        onKeyUp={(event) =>
                          questions.capture(event.currentTarget)
                        }
                        onTouchEnd={(event) =>
                          questions.capture(event.currentTarget)
                        }
                      >
                        <div
                          className={
                            tab === "report" ? "jd-grid" : "jd-brief-grid"
                          }
                        >
                          {tab === "report" && (
                            <aside
                              className="jd-source"
                              aria-label="JD 原文"
                              ref={sourcePanel}
                              tabIndex={-1}
                            >
                              <span className="jd-source-label">
                                原文 · {source.lines.length} 行
                              </span>
                              <div
                                className="jd-source-scroll"
                                ref={scrollRef}
                                tabIndex={0}
                                aria-label="滚动阅读 JD 原文"
                              >
                                {source.lines.map((line) => (
                                  <p
                                    key={line.lineNo}
                                    ref={(element) =>
                                      registerLine(line.lineNo, element)
                                    }
                                    data-line={line.lineNo}
                                    data-highlighted={
                                      active?.citation.lineNo === line.lineNo
                                    }
                                    data-heading={line.heading}
                                    className="jd-source-line"
                                  >
                                    <span
                                      className="jd-line-no"
                                      aria-label={`第 ${line.lineNo} 行`}
                                    >
                                      {line.lineNo}
                                    </span>
                                    <span>{line.text || "\u00a0"}</span>
                                  </p>
                                ))}
                              </div>
                              <p className="jd-source-tip">
                                点报告里的出处，原文里的依据会亮起来
                              </p>
                            </aside>
                          )}
                          {tab === "report" ? (
                            <div className="jd-report-column">
                              <ReportBody report={report} />
                              {!readonly && (
                                <QuestionList
                                  notes={data.supplements}
                                  onOpen={questions.openNote}
                                />
                              )}
                            </div>
                          ) : (
                            <Brief
                              report={report}
                              questions={
                                readonly ? report.supplements : data.supplements
                              }
                            />
                          )}
                        </div>
                      </div>
                    </ReportActions>
                  </CitationProvider>
                </>
              ) : (
                <section className="empty-home">
                  <h2>原文已保存，等待分析</h2>
                  <Link className="btn primary" href={`/new?retry=${id}`}>
                    重新分析
                  </Link>
                </section>
              )}
            </>
          )}
        </main>
      </div>
      {questions.selection && !readonly && (
        <button
          type="button"
          className="jd-ask-floating"
          style={{ left: questions.selection.x, top: questions.selection.y }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={questions.openSelection}
        >
          问一问
        </button>
      )}
      {questions.target && !readonly && (
        <QuestionDock
          key={questions.target.initial?.id ?? questions.target.anchor.exact}
          jobId={id}
          target={questions.target}
          source={source?.text ?? ""}
          onClose={questions.close}
          onAdd={questions.addNote}
        />
      )}
      {thread && (
        <svg className="jd-thread" aria-hidden="true">
          <path d={thread.d} />
          <circle cx={thread.x} cy={thread.y} r="4" />
        </svg>
      )}
      {mobileOpen && active && (
        <Modal
          title={`原文 · ${active.label}`}
          className="jd-source-sheet"
          onClose={clearCitation}
        >
          <p className="jd-sheet-lead">第 {active.citation.lineNo} 行</p>
          <blockquote>
            <mark>{active.citation.quote}</mark>
          </blockquote>
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setMobileOpen(false);
                setTab("report");
                requestAnimationFrame(() => {
                  sourcePanel.current?.scrollIntoView({ block: "start" });
                  sourcePanel.current?.focus({ preventScroll: true });
                });
              }}
            >
              在原文里看
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={clearCitation}
            >
              知道了
            </button>
          </div>
        </Modal>
      )}
      {exporting && data && report && (
        <ReportExport
          job={data.job}
          versions={data.versions}
          sources={data.sources}
          selectedId={report.id}
          currentId={data.job.currentReportVersionId!}
          onClose={() => setExporting(false)}
          onToast={setNotice}
          onPrint={(version) => {
            setExporting(false);
            clearCitation();
            setPrintReport({ ...version });
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {printable && data && printSource && (
        <article className="report-print" aria-label="待打印报告">
          <header>
            <p>JDelight · 岗位报告</p>
            <h1>{data.job.title || "未命名岗位"}</h1>
            <p>
              {data.job.company || "未显示"} · {data.job.place || "未显示"}
            </p>
            {hasIncompleteJobMeta(data.job) && (
              <p className="jd-source-incomplete">原文不完整</p>
            )}
            <p>
              报告第 {printable.no} 版 · {reportDate(printable.createdAt)} ·{" "}
              {printable.content.origin === "model" ? "真实分析" : "示例分析"}
            </p>
          </header>
          <CitationProvider source={printSource}>
            <ReportBody report={printable} />
          </CitationProvider>
          <section className="jd-print-source">
            <h2>确认过的 JD 原文</h2>
            {printSource.lines.map((line) => (
              <p key={line.lineNo}>
                <span>{line.lineNo}</span>
                {line.text || "\u00a0"}
              </p>
            ))}
          </section>
        </article>
      )}
    </div>
  );
}
