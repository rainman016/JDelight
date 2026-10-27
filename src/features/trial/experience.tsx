"use client";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { BackupStatus } from "@/features/backup/data-modal";
import {
  createPersistenceRequest,
  dismissNotice,
  feedbackUrl,
  homeNotice,
  isWechat,
  readNoticePreferences,
  type NoticePreferences,
} from "./experience-state";
const requestPersistence = createPersistenceRequest();
const changeEvent = "jdelight-notice-change";
function useNoticePreferences() {
  const [unavailable, setUnavailable] = useState(false);
  const subscribe = useCallback((notify: () => void) => {
    const changed = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === "unavailable")
        setUnavailable(true);
      notify();
    };
    addEventListener(changeEvent, changed);
    return () => removeEventListener(changeEvent, changed);
  }, []);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(readNoticePreferences()),
    () => "null",
  );
  const preferences: NoticePreferences | null = unavailable
    ? null
    : JSON.parse(snapshot);
  return {
    preferences,
    close: (kind: "wechat" | "backup" | "iphone") => {
      const saved = dismissNotice(kind);
      if (!saved) setUnavailable(true);
      dispatchEvent(
        new CustomEvent(changeEvent, {
          detail: saved ? "saved" : "unavailable",
        }),
      );
    },
  };
}
function NoticeStrip({
  label,
  children,
  onClose,
  action,
}: {
  label: string;
  children: ReactNode;
  onClose: () => void;
  action?: ReactNode;
}) {
  return (
    <aside className="jd-trial-notice" aria-label={label}>
      <p>{children}</p>
      {action}
      <button
        type="button"
        className="jd-notice-close"
        aria-label={`关闭${label}`}
        onClick={onClose}
      >
        ×
      </button>
    </aside>
  );
}
export function AppExperience() {
  const { preferences, close } = useNoticePreferences();
  const wechat =
    typeof navigator !== "undefined" && isWechat(navigator.userAgent);
  useEffect(() => {
    void requestPersistence();
  }, []);
  if (!preferences || preferences.wechatClosed || !wechat) return null;
  return (
    <div className="jd-device-notice">
      <NoticeStrip label="微信提示" onClose={() => close("wechat")}>
        在微信里打开，数据可能被清理。建议点右上角「···」→「在浏览器打开」。
      </NoticeStrip>
    </div>
  );
}
export function HomeNotices({
  status,
  onExport,
}: {
  status: BackupStatus | null;
  onExport: () => Promise<void>;
}) {
  const { preferences, close } = useNoticePreferences();
  const device = {
    ua: typeof navigator === "undefined" ? "" : navigator.userAgent,
    standalone:
      typeof window !== "undefined" &&
      (!!(navigator as Navigator & { standalone?: boolean }).standalone ||
        !!window.matchMedia?.("(display-mode: standalone)").matches),
  };
  const [now, setNow] = useState(Date.now),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const notice = homeNotice({
    preferences,
    ...device,
    now,
    newReports: status?.newReports ?? 0,
    firstReportAt: status?.firstReportAt ?? null,
    lastExportAt: status?.lastExportAt ?? null,
  });
  if (!notice) return null;
  if (notice.kind === "iphone")
    return (
      <NoticeStrip label="iPhone 提示" onClose={() => close("iphone")}>
        iPhone 用户：点底部「分享」→「添加到主屏幕」，数据保存更稳定。
      </NoticeStrip>
    );
  return (
    <>
      <NoticeStrip
        label="备份提醒"
        onClose={() => close("backup")}
        action={
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                await onExport();
              } catch {
                setError("备份没有导出成功，数据仍在本机，请重试。");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在导出…" : "导出备份"}
          </button>
        }
      >
        {notice.reason === "count"
          ? `你已新增 ${status?.newReports ?? 0} 份报告，建议导出备份，以免浏览器清理数据。`
          : "距上次备份已超过 7 天，建议导出备份，以免浏览器清理数据。"}
      </NoticeStrip>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </>
  );
}
export function FeedbackButton({
  hidden = false,
  url = process.env.NEXT_PUBLIC_JDELIGHT_FEEDBACK_URL,
}: {
  hidden?: boolean;
  url?: string;
}) {
  const href = feedbackUrl(url);
  return hidden || !href ? null : (
    <a
      className="btn jd-feedback"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      提意见
    </a>
  );
}
