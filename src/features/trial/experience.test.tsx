import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { AppExperience, HomeNotices, FeedbackButton } from "./experience";
import {
  DAY_MS,
  NOTICE_KEYS,
  createPersistenceRequest,
  dismissNotice,
  feedbackUrl,
  homeNotice,
  isIosSafari,
  isWechat,
  readNoticePreferences,
} from "./experience-state";
const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const now = Date.parse("2026-10-26T12:00:00Z");
const preferences = {
  wechatClosed: false,
  backupClosed: false,
  iphoneUntil: 0,
};
const base = {
  preferences,
  ua: "desktop",
  standalone: false,
  now,
  newReports: 0,
  firstReportAt: new Date(now - DAY_MS).toISOString(),
  lastExportAt: null,
};
const status = {
  jobs: 3,
  versions: 3,
  notes: 0,
  dirty: true,
  newReports: 3,
  firstReportAt: base.firstReportAt,
  lastExportAt: null,
};
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

test("微信识别及 iOS Safari 排除其他浏览器与微信", () => {
  expect(isWechat(iphone + " MicroMessenger/8.0")).toBe(true);
  expect(isIosSafari(iphone)).toBe(true);
  for (const browser of ["CriOS", "FxiOS", "EdgiOS", "MicroMessenger"])
    expect(isIosSafari(iphone + ` ${browser}/1`)).toBe(false);
  expect(isIosSafari("desktop Safari")).toBe(false);
});
test("报告达到 3 份或满 7 天才催备份，优先于 iPhone；没有报告不催", () => {
  expect(homeNotice({ ...base, newReports: 2 })).toBeNull();
  expect(homeNotice({ ...base, newReports: 3, ua: iphone })).toEqual({
    kind: "backup",
    reason: "count",
  });
  expect(
    homeNotice({
      ...base,
      firstReportAt: new Date(now - 7 * DAY_MS).toISOString(),
    }),
  ).toEqual({ kind: "backup", reason: "age" });
  expect(
    homeNotice({
      ...base,
      firstReportAt: new Date(now - 20 * DAY_MS).toISOString(),
      lastExportAt: new Date(now - DAY_MS).toISOString(),
    }),
  ).toBeNull();
  expect(
    homeNotice({
      ...base,
      firstReportAt: null,
      lastExportAt: new Date(now - 20 * DAY_MS).toISOString(),
    }),
  ).toBeNull();
});
test("微信与备份仅会话内关闭；iPhone 关闭满 30 天恢复，主屏幕不提示", () => {
  expect(dismissNotice("wechat", now)).toBe(true);
  expect(dismissNotice("backup", now)).toBe(true);
  expect(readNoticePreferences()).toMatchObject({
    wechatClosed: true,
    backupClosed: true,
  });
  expect(
    homeNotice({
      ...base,
      newReports: 3,
      preferences: readNoticePreferences(),
    }),
  ).toBeNull();
  expect(dismissNotice("iphone", now)).toBe(true);
  const saved = readNoticePreferences();
  expect(
    homeNotice({
      ...base,
      ua: iphone,
      now: now + 29 * DAY_MS,
      firstReportAt: null,
      preferences: saved,
    }),
  ).toBeNull();
  expect(
    homeNotice({
      ...base,
      ua: iphone,
      now: now + 30 * DAY_MS,
      firstReportAt: null,
      preferences: saved,
    }),
  ).toEqual({ kind: "iphone" });
  expect(homeNotice({ ...base, ua: iphone, standalone: true })).toBeNull();
  sessionStorage.clear();
  expect(readNoticePreferences()).toMatchObject({
    wechatClosed: false,
    backupClosed: false,
    iphoneUntil: now + 30 * DAY_MS,
  });
});
test.each(["getItem", "setItem"] as const)(
  "存储 %s 失败静默，提示全部隐藏",
  (method) => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readNoticePreferences()).toBeNull();
    render(
      <>
        <AppExperience />
        <HomeNotices status={status} onExport={async () => {}} />
      </>,
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  },
);
test("微信与备份最多两条，关闭跨组件生效；失败导出不清空提醒", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    iphone + " MicroMessenger/8.0",
  );
  const onExport = vi.fn(async () => {
    throw new Error("fake download failure");
  });
  render(
    <>
      <AppExperience />
      <HomeNotices status={status} onExport={onExport} />
    </>,
  );
  expect(screen.getAllByRole("complementary")).toHaveLength(2);
  expect(
    screen.queryByRole("complementary", { name: "iPhone 提示" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "导出备份" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "备份没有导出成功",
  );
  expect(screen.getByRole("complementary", { name: "备份提醒" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭微信提示" }));
  expect(screen.queryByRole("complementary", { name: "微信提示" })).toBeNull();
  expect(sessionStorage.getItem(NOTICE_KEYS.wechat)).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: "关闭备份提醒" }));
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});
test("iPhone 关闭写入 30 天期限，写入失败也隐藏提示而不报错", () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(iphone);
  vi.spyOn(Date, "now").mockReturnValue(now);
  render(<HomeNotices status={null} onExport={async () => {}} />);
  expect(
    screen.getByRole("complementary", { name: "iPhone 提示" }),
  ).toBeVisible();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("write blocked");
  });
  fireEvent.click(screen.getByRole("button", { name: "关闭iPhone 提示" }));
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  expect(dismissNotice("iphone", now)).toBe(false);
});
test.each([
  undefined,
  "",
  "http://feedback.test",
  "javascript:alert(1)",
  "not a url",
  "https://user:pass@feedback.test",
])("反馈 URL 非法或缺失时不显示：%s", (url) => {
  expect(feedbackUrl(url)).toBeNull();
  render(<FeedbackButton url={url ?? ""} />);
  expect(screen.queryByRole("link", { name: "提意见" })).toBeNull();
});
test("合法反馈按钮在新窗口打开，有防跨窗访问属性；浮层打开时可隐藏", () => {
  const { rerender } = render(
    <FeedbackButton url="https://feedback.test/form" />,
  );
  const link = screen.getByRole("link", { name: "提意见" });
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  rerender(<FeedbackButton url="https://feedback.test/form" hidden />);
  expect(screen.queryByRole("link")).toBeNull();
});
test("持久存储申请只执行一次，已持久或失败都静默结束", async () => {
  const storage = {
    persisted: vi.fn(async () => false),
    persist: vi.fn(async () => true),
  };
  const request = createPersistenceRequest();
  await Promise.all([request(storage), request(storage)]);
  await request(storage);
  expect(storage.persist).toHaveBeenCalledTimes(1);
  const already = {
    persisted: vi.fn(async () => true),
    persist: vi.fn(async () => true),
  };
  await createPersistenceRequest()(already);
  expect(already.persist).not.toHaveBeenCalled();
  const broken = {
    persisted: vi.fn(async () => {
      throw new Error("blocked");
    }),
    persist: vi.fn(async () => true),
  };
  await expect(createPersistenceRequest()(broken)).resolves.toBeUndefined();
  expect(broken.persist).not.toHaveBeenCalled();
});
