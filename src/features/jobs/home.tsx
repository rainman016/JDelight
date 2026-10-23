"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { liveQuery } from "dexie";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { repository } from "@/data/repository";
import {
  MARKS,
  type Job,
  type Mark,
  type ReportVersion,
} from "@/domain/schema";
import { MarkMenu } from "@/components/mark-menu";
import { LocalNote } from "@/components/local-note";
import { DataModal, type BackupStatus } from "@/features/backup/data-modal";
import "@/styles/home.css";
const Intro = dynamic(() => import("@/components/intro/Intro"), { ssr: false });
type Row = { job: Job; report?: ReportVersion };
function initialIntro() {
  try {
    return sessionStorage.getItem("jdelight-intro") !== "seen";
  } catch {
    return true;
  }
}
export default function Home() {
  const [intro, setIntro] = useState(initialIntro);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState<Mark | "all">("all");
  const [piled, setPiled] = useState(true);
  const [dataOpen, setDataOpen] = useState(false),
    [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const reduced = useReducedMotion();
  const newHref =
    new URLSearchParams(window.location.search).get("demo") === "fail"
      ? "/new?demo=fail"
      : "/new";
  useEffect(() => {
    const sub = liveQuery(() => repository().listJobs()).subscribe({
      next: setRows,
      error: () =>
        setError("本机数据没有读取成功，可以刷新再试。已存的数据没有被删除。"),
    });
    const backup = liveQuery(() => repository().backupStatus()).subscribe({
      next: setBackupStatus,
      error: () => setError("备份状态没有读取成功，可以刷新后再试。"),
    });
    return () => {
      sub.unsubscribe();
      backup.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(timer);
  }, [toast]);
  if (intro)
    return (
      <Intro
        onEnter={() => {
          try {
            sessionStorage.setItem("jdelight-intro", "seen");
          } catch {
            /* 本次访问仍可进入 */
          }
          setIntro(false);
        }}
      />
    );
  const shown = (rows ?? []).filter(
    (r) => filter === "all" || r.job.mark === filter,
  );
  const order = Object.keys(MARKS) as Mark[];
  if (!piled)
    shown.sort((a, b) => order.indexOf(a.job.mark) - order.indexOf(b.job.mark));
  const isPiled = piled && shown.length > 1;
  return (
    <div className="home">
      <header className="topbar">
        <span className="wordmark">JDelight</span>
        <span className="spacer" />
        <LocalNote />
        <button type="button" className="btn" onClick={() => setDataOpen(true)}>
          数据与备份
        </button>
        <Link className="btn primary" href={newHref}>
          贴一份新的 JD
        </Link>
      </header>
      <main className="home-main">
        {backupStatus?.dirty && (
          <p className="jd-backup-reminder">
            <span>
              {backupStatus.lastExportAt
                ? "上次备份后有新的改动，建议再导出一次。"
                : "还没有备份过。清理浏览器会让这些岗位消失。"}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => setDataOpen(true)}
            >
              现在导出一份
            </button>
          </p>
        )}
        <section className="home-head">
          <h1 className="home-title">我的岗位</h1>
          <p className="home-sub">
            {rows?.length
              ? `${rows.length} 个岗位 · ${rows.filter((r) => r.report).length} 份报告。面试前，从这里回到你读过的每一个岗位。`
              : "面试前，从这里回到你读过的每一个岗位。"}
          </p>
          <div className="filters" role="group" aria-label="按标记筛选">
            {(["all", ...order] as const).map((f) => (
              <button
                key={f}
                type="button"
                className="filter"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "全部" : MARKS[f]}
                <span className="n">
                  {rows?.filter((r) => f === "all" || r.job.mark === f)
                    .length ?? 0}
                </span>
              </button>
            ))}
          </div>
        </section>
        {error && (
          <p className="cf-note" data-level="warn" role="alert">
            {error}
          </p>
        )}
        {rows === null && !error ? (
          <p role="status">正在读取本机岗位…</p>
        ) : rows?.length === 0 ? (
          <section className="empty-home">
            <p className="hand-big">还没有岗位</p>
            <p className="hand-small">
              收到面试邀请了吗？把那份 JD 贴进来，先读懂它。
            </p>
            <Link href={newHref} className="btn">
              贴一份 JD
            </Link>
          </section>
        ) : shown.length === 0 ? (
          <section className="empty-home">
            <p className="hand-big">这里空空的</p>
            <p className="hand-small">
              没有标记为“{filter === "all" ? "全部" : MARKS[filter]}”的岗位。
            </p>
            <button className="btn" onClick={() => setFilter("all")}>
              看全部
            </button>
          </section>
        ) : (
          <>
            {(rows?.length ?? 0) > 1 && (
              <div className="pile-bar">
                <button
                  type="button"
                  className="btn"
                  aria-pressed={!piled}
                  onClick={() => setPiled((v) => !v)}
                >
                  {piled ? "整理开" : "叠起来"}
                </button>
                <span className="hand-small">
                  {piled
                    ? "点任意一张，整理开"
                    : "已按标记分好：准备中 → 已面试 → 已放弃"}
                </span>
              </div>
            )}
            <LayoutGroup>
              <ul className={`cards ${isPiled ? "piled" : "spread"}`}>
                {shown.map((row, i) => (
                  <motion.li
                    key={row.job.id}
                    layout={!reduced}
                    transition={
                      reduced
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 260, damping: 26 }
                    }
                    className="card-wrap"
                    style={{ zIndex: isPiled ? shown.length - i : 1 }}
                  >
                    <JobCard
                      row={row}
                      tilt={
                        reduced
                          ? 0
                          : [-3.2, 2.4, -1.4, 3.1, -2.2][i % 5] /
                            (isPiled ? 1 : 3)
                      }
                      piled={isPiled}
                      onSpread={() => setPiled(false)}
                      onToast={setToast}
                    />
                  </motion.li>
                ))}
              </ul>
            </LayoutGroup>
          </>
        )}
        <p className="local-footer">
          数据只保存在这台设备的这个浏览器里。清理浏览器数据会让岗位消失。
        </p>
      </main>
      {dataOpen && (
        <DataModal
          status={backupStatus}
          onClose={() => setDataOpen(false)}
          onToast={setToast}
        />
      )}
      <div className="toast" role="status" data-on={!!toast}>
        {toast}
      </div>
    </div>
  );
}
function JobCard({
  row: { job, report },
  tilt,
  piled,
  onSpread,
  onToast,
}: {
  row: Row;
  tilt: number;
  piled: boolean;
  onSpread: () => void;
  onToast: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState("");
  const [armed, setArmed] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const noteLock = useRef(false);
  const discardNote = useRef(false);
  async function saveNote(value: string) {
    if (noteLock.current || discardNote.current) return;
    noteLock.current = true;
    setNoteSaving(true);
    try {
      await repository().setNote(job.id, value);
      setEditing(false);
      setError("");
      onToast(value.trim() ? "备注已保存" : "备注已清空");
    } catch {
      setError("备注没保存成功，可以再试一次");
    } finally {
      noteLock.current = false;
      setNoteSaving(false);
    }
  }
  const ready = !!report;
  return (
    <article
      className="job"
      data-analyzed={ready}
      data-mark={MARKS[job.mark]}
      style={{ ["--tilt" as string]: `${tilt}deg` }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setArmed(false);
      }}
    >
      <MarkMenu
        mark={job.mark}
        onChange={async (mark) => {
          try {
            await repository().setMark(job.id, mark);
            onToast(`已标记为“${MARKS[mark]}”`);
          } catch {
            setError("标记没保存成功，可以再试一次");
          }
        }}
      />
      {piled ? (
        <button
          type="button"
          className="job-open"
          aria-label={`整理开：${job.title || "未命名岗位"}`}
          onClick={onSpread}
        >
          <CardContent job={job} report={report} />
        </button>
      ) : (
        <Link
          className="job-open"
          href={ready ? `/jobs/${job.id}` : `/new?retry=${job.id}`}
        >
          <CardContent job={job} report={report} />
        </Link>
      )}
      {editing && !piled ? (
        <textarea
          className="note-edit"
          aria-label="备注"
          autoFocus
          value={draft}
          disabled={noteSaving}
          onChange={(e) =>
            setDraft(Array.from(e.target.value).slice(0, 60).join(""))
          }
          onBlur={(e) => {
            if (editing) void saveNote(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void saveNote(draft);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              discardNote.current = true;
              setEditing(false);
            }
          }}
        />
      ) : job.note ? (
        <button
          type="button"
          className="note-mini"
          disabled={piled}
          aria-label={`修改备注：${job.note}`}
          onClick={() => {
            discardNote.current = false;
            setDraft(job.note);
            setEditing(true);
          }}
        >
          {job.note}
        </button>
      ) : null}
      {!ready && !piled && (
        <Link className="btn primary retry-btn" href={`/new?retry=${job.id}`}>
          重新分析
        </Link>
      )}
      <footer className="job-foot">
        <span className={`ver${ready ? "" : " pending"}`}>
          {report
            ? `报告第 ${report.no} 版 · ${report.content.origin === "model" ? "真实分析" : "示例分析"}${report.supplements.length ? ` · ${report.supplements.length} 条补充` : ""}`
            : "待分析"}
        </span>
        <time className="seen" dateTime={job.lastViewedAt}>
          {new Date(job.lastViewedAt).toLocaleDateString("zh-CN", {
            month: "numeric",
            day: "numeric",
          })}{" "}
          查看
        </time>
        {!job.note && !editing && !piled && (
          <button
            type="button"
            className="note-add"
            onClick={() => {
              discardNote.current = false;
              setDraft("");
              setEditing(true);
            }}
          >
            + 备注
          </button>
        )}
        {!piled && (
          <button
            type="button"
            disabled={busy}
            className={`del${armed ? " sure" : ""}`}
            onBlur={() => setArmed(false)}
            onClick={async () => {
              if (!armed) {
                setArmed(true);
                return;
              }
              setBusy(true);
              try {
                await repository().deleteJob(job.id);
                onToast("已删除这个岗位的全部数据");
              } catch {
                setError("删除失败，数据没有变化");
              } finally {
                setBusy(false);
                setArmed(false);
              }
            }}
          >
            {armed ? "再点一次，确认删除" : "删除"}
          </button>
        )}
      </footer>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
function CardContent({ job, report }: Row) {
  return (
    <>
      <h2 className="job-title">{job.title || "未命名岗位"}</h2>
      <p className="job-where">
        {job.company || "未显示"} · {job.place || "未显示"}
      </p>
      <p className="job-gist">
        {report?.content.focus.gist.text ?? "原文已保存，分析还没完成。"}
      </p>
      {report && (
        <span className="conds">
          {report.content.header.shown.slice(0, 4).map((c) => (
            <span key={c.id} className="cond" data-known="true">
              {c.text}
            </span>
          ))}
          {report.content.header.missing.slice(0, 2).map((c) => (
            <span key={c} className="cond" data-known="false">
              {c}：未显示
            </span>
          ))}
        </span>
      )}
    </>
  );
}
