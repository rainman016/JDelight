export const DAY_MS = 86_400_000;
export const NOTICE_KEYS = {
  wechat: "jdelight-wechat-dismissed",
  backup: "jdelight-backup-dismissed",
  iphone: "jdelight-iphone-until",
} as const;
export interface NoticePreferences {
  wechatClosed: boolean;
  backupClosed: boolean;
  iphoneUntil: number;
}
type Stores = { local: Storage; session: Storage };
export function readNoticePreferences(
  stores?: Stores,
): NoticePreferences | null {
  try {
    const local = stores?.local ?? window.localStorage,
      session = stores?.session ?? window.sessionStorage;
    for (const storage of [local, session]) {
      storage.setItem("jdelight-notice-probe", "1");
      storage.removeItem("jdelight-notice-probe");
    }
    const until = Number(local.getItem(NOTICE_KEYS.iphone));
    return {
      wechatClosed: session.getItem(NOTICE_KEYS.wechat) === "1",
      backupClosed: session.getItem(NOTICE_KEYS.backup) === "1",
      iphoneUntil: Number.isFinite(until) && until > 0 ? until : 0,
    };
  } catch {
    return null;
  }
}
export function dismissNotice(
  kind: keyof typeof NOTICE_KEYS,
  now = Date.now(),
  stores?: Stores,
) {
  try {
    if (kind === "iphone")
      (stores?.local ?? window.localStorage).setItem(
        NOTICE_KEYS.iphone,
        String(now + 30 * DAY_MS),
      );
    else
      (stores?.session ?? window.sessionStorage).setItem(
        NOTICE_KEYS[kind],
        "1",
      );
    return true;
  } catch {
    return false;
  }
}
export function isWechat(ua: string) {
  return /MicroMessenger/i.test(ua);
}
export function isIosSafari(ua: string) {
  return (
    /iPhone|iPad|iPod/i.test(ua) &&
    /Safari/i.test(ua) &&
    !/CriOS|FxiOS|EdgiOS|MicroMessenger/i.test(ua)
  );
}
export function homeNotice(input: {
  preferences: NoticePreferences | null;
  ua: string;
  standalone: boolean;
  now: number;
  newReports: number;
  firstReportAt: string | null;
  lastExportAt: string | null;
}) {
  if (!input.preferences) return null;
  const start = input.lastExportAt ?? input.firstReportAt;
  const elapsed = start ? input.now - Date.parse(start) : 0;
  if (
    !input.preferences.backupClosed &&
    (input.newReports >= 3 || (!!input.firstReportAt && elapsed >= 7 * DAY_MS))
  )
    return {
      kind: "backup" as const,
      reason: input.newReports >= 3 ? ("count" as const) : ("age" as const),
    };
  if (
    isIosSafari(input.ua) &&
    !input.standalone &&
    input.now >= input.preferences.iphoneUntil
  )
    return { kind: "iphone" as const };
  return null;
}
export function feedbackUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function createPersistenceRequest() {
  let requested = false;
  return async (provided?: Pick<StorageManager, "persist" | "persisted">) => {
    if (requested) return;
    requested = true;
    try {
      const storage = provided ?? navigator.storage;
      if (
        typeof storage?.persist === "function" &&
        !(await storage.persisted?.())
      )
        await storage.persist();
    } catch {
      /* 结果不显示，不重复申请 */
    }
  };
}
