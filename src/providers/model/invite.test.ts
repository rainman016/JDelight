import { afterEach, expect, test, vi } from "vitest";
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
test("码规范化保存在 localStorage，请求通过头部携带", async () => {
  vi.resetModules();
  const { saveInvite, readInvite, inviteHeaders } = await import("./invite");
  expect(saveInvite("abcde-fghjk")).toBe(true);
  expect(readInvite()).toBe("ABCDEFGHJK");
  expect(localStorage.getItem("jdelight:invite")).toBe("ABCDEFGHJK");
  expect(inviteHeaders()).toEqual({ "X-JDelight-Invite": "ABCDEFGHJK" });
  expect(saveInvite("bad")).toBe(false);
});
test("localStorage 读写抛错不阻断流程，本页保留刚确认的码", async () => {
  vi.resetModules();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  const { saveInvite, readInvite, inviteHeaders } = await import("./invite");
  expect(readInvite()).toBeNull();
  expect(saveInvite("abcde-fghjk")).toBe(true);
  expect(inviteHeaders()).toEqual({ "X-JDelight-Invite": "ABCDEFGHJK" });
});
