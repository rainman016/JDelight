import { useRef, useState } from "react";
import { Modal } from "@/components/modal";
import { repository } from "@/data/repository";
import { downloadBackup } from "./download";
export type BackupStatus = Awaited<
  ReturnType<ReturnType<typeof repository>["backupStatus"]>
>;
type Preview = Awaited<
  ReturnType<ReturnType<typeof repository>["previewImport"]>
>;
type Step = "main" | "preview" | "replace" | "done" | "error";
const backupTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export function DataModal({
  status,
  onClose,
  onToast,
}: {
  status: BackupStatus | null;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [step, setStep] = useState<Step>("main"),
    [mode, setMode] = useState<"merge" | "replace">("merge"),
    [preview, setPreview] = useState<Preview | null>(null),
    [filename, setFilename] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setFilename(file.name);
    try {
      if (!file.name.toLowerCase().endsWith(".json"))
        throw new Error(
          "这不是 JDelight 的备份文件（应为 .json）。本机数据没有变化。",
        );
      if (file.size > 50 * 1024 * 1024)
        throw new Error("备份文件超过 50 MB，暂时无法读取；本机数据没有变化。");
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error(
          "文件不是有效的 JSON，可能在传输中被截断。重新导出一份再试，本机数据没有变化。",
        );
      }
      setPreview(await repository().previewImport(parsed));
      setMode("merge");
      setStep("preview");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "文件没有读取成功，本机数据没有变化。",
      );
      setStep("error");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const exportFile = async (stay = false) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await downloadBackup();
      if (stay) onToast("已先导出现有数据");
      else {
        setDone(
          `已导出 ${result.jobs} 个岗位、${result.versions} 个报告版本、${result.notes} 条补充。文件名：${result.filename}，可在浏览器下载记录中找到。`,
        );
        setStep("done");
      }
    } catch {
      setError("导出没有完成或导出时间没记住，数据仍在本机，可以重新导出。");
    } finally {
      setBusy(false);
    }
  };
  const importFile = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await repository().importData(
        preview.data,
        mode,
        preview.revision,
      );
      setDone(
        `已${mode === "merge" ? "合并导入" : "用文件替换"} ${result.jobs} 个岗位、${result.versions} 个报告版本、${result.notes} 条补充。数据已保存在这个浏览器里。`,
      );
      setStep("done");
      onToast("导入完成");
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.includes("预览后")
          ? cause.message
          : "导入没有完成，本机数据没有变化。返回后重新选择文件再试。",
      );
      setStep("error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="数据与备份" onClose={onClose} className="jd-backup-sheet">
      <input
        ref={input}
        type="file"
        aria-label="选择备份文件"
        accept=".json,application/json"
        hidden
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      {step === "main" && (
        <>
          <p className="jd-sheet-lead">
            你的岗位和报告只保存在这台设备的这个浏览器里。清理浏览器数据、换设备或换浏览器，都会让它们消失。定期导出一份，换设备时再导入。
          </p>
          {!status ? (
            <p role="status">正在读取本机数据…</p>
          ) : (
            <div className="jd-backup-options">
              <section>
                <h3>导出全部数据</h3>
                <p>
                  {status.jobs} 个岗位 · {status.versions} 个报告版本 ·{" "}
                  {status.notes} 条补充，存成一个文件。
                </p>
                <p className="jd-backup-small">
                  {status.lastExportAt
                    ? `上次导出：${backupTime(status.lastExportAt)}`
                    : "还没有导出过。"}
                </p>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void exportFile()}
                >
                  导出成文件
                </button>
              </section>
              <section>
                <h3>从文件导入</h3>
                <p>
                  选之前导出的 JDelight
                  备份文件。选完先给你看里面有什么，确认后才会写入。
                </p>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  选择备份文件
                </button>
              </section>
            </div>
          )}
          <p className="jd-sheet-foot">
            备份文件包含原文、报告和补充，没有加密。收好文件，不要发到公开的地方。
          </p>
        </>
      )}
      {step === "preview" && preview && (
        <>
          <p className="jd-sheet-lead">
            文件：{filename}
            <br />
            里面有 {preview.data.jobs.length} 个岗位、
            {preview.data.reportVersions.length} 个报告版本、
            {preview.data.supplements.length} 条补充。
            <br />
            导出时间：{backupTime(preview.data.exportedAt)}。其中{" "}
            {preview.duplicates} 个岗位在这台设备上已经有了。
          </p>
          <fieldset className="jd-import-choices">
            <legend className="sr-only">导入方式</legend>
            <label data-on={mode === "merge"}>
              <input
                type="radio"
                name="import-mode"
                checked={mode === "merge"}
                onChange={() => setMode("merge")}
              />
              <span>
                <strong>合并（推荐）</strong>
                <small>
                  保留两边的岗位。同 ID
                  的岗位作为“导入的副本”加入，原文、各版报告与补充一起保留。
                </small>
              </span>
            </label>
            <label data-on={mode === "replace"}>
              <input
                type="radio"
                name="import-mode"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
              />
              <span>
                <strong>用文件替换这台设备上的全部数据</strong>
                <small>本机现有的 {preview.localJobs} 个岗位会被清掉。</small>
              </span>
            </label>
          </fieldset>
          <div className="btn-row jd-export-actions">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setStep("main")}
            >
              返回
            </button>
            <button
              type="button"
              className={`btn ${mode === "merge" ? "primary" : "danger"}`}
              disabled={busy}
              onClick={() =>
                mode === "replace" ? setStep("replace") : void importFile()
              }
            >
              {mode === "replace" ? "下一步" : "确认导入"}
            </button>
          </div>
        </>
      )}
      {step === "replace" && preview && (
        <>
          <p className="jd-sheet-lead jd-export-warning">
            这会清掉这台设备上现有的 {preview.localJobs} 个岗位，换成文件里的{" "}
            {preview.data.jobs.length} 个。<strong>清掉后不能撤销。</strong>
          </p>
          <p>稳妥做法：先把现有数据导出一份存着。</p>
          <div className="btn-row jd-export-actions">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void exportFile(true)}
            >
              先导出现有数据
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setStep("preview")}
            >
              返回
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() => void importFile()}
            >
              确认替换
            </button>
          </div>
        </>
      )}
      {step === "error" && (
        <>
          <p className="jd-sheet-lead">导入不了</p>
          <p className="jd-backup-small">文件：{filename}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setStep("main");
              setError("");
            }}
          >
            返回
          </button>
        </>
      )}
      {step === "done" && (
        <>
          <p className="jd-sheet-lead" role="status">
            {done}
          </p>
          <button type="button" className="btn primary" onClick={onClose}>
            好的
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {busy && <p role="status">正在处理本地文件…</p>}
    </Modal>
  );
}
