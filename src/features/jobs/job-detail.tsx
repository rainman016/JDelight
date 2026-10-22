"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { liveQuery } from "dexie";
import { repository } from "@/data/repository";
import { citationLabel } from "@/domain/source";
import { MarkMenu } from "@/components/mark-menu";
import { LocalNote } from "@/components/local-note";
type Data = Awaited<ReturnType<ReturnType<typeof repository>["readJob"]>>;
export default function JobDetail({ id }: { id: string }) {
  const [data, setData] = useState<Data | undefined>(undefined);
  const [error, setError] = useState("");
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
  const report = data?.report;
  return (
    <>
      <header className="topbar">
        <Link href="/" className="back">
          ← 我的岗位
        </Link>
        <span className="spacer" />
        <LocalNote />
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
                  {data.job.company || "未显示"} · {data.job.place || "未显示"}
                </p>
              </div>
              <div className="detail-mark">
                <MarkMenu
                  mark={data.job.mark}
                  onChange={async (mark) => {
                    try {
                      await repository().setMark(id, mark);
                    } catch {
                      setError("标记没保存成功，可以再试一次");
                    }
                  }}
                />
              </div>
            </section>
            {report ? (
              <>
                <p className="report-version">
                  报告第 {report.no} 版 ·{" "}
                  {report.content.origin === "model" ? "真实分析" : "示例分析"}
                </p>
                <section className="brief-sheet">
                  <span className="tab-label">面试重点速览</span>
                  <p className="gist-text">{report.content.focus.gist.text}</p>
                  <ol className="focus">
                    {report.content.focus.items.map((item) => (
                      <li key={item.id}>
                        <p>{item.text}</p>
                        <p className="focus-basis">{item.basis}</p>
                        <div className="focus-m">
                          <span className={`kind kind-${item.kind}`}>
                            {item.kind === "inference" ? "推断" : "推测"}
                          </span>
                          {item.citations.map((citation, i) => (
                            <span className="cite" key={i}>
                              {citationLabel(
                                data.source.lines.find(
                                  (l) => l.lineNo === citation.lineNo,
                                )!,
                              )}
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
                <p className="hint">完整报告阅读在下一版本提供。</p>
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
    </>
  );
}
