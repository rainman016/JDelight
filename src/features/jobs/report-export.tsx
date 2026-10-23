import { useState } from "react";
import { Modal } from "@/components/modal";
import type { Job, ReportVersion, SourceVersion } from "@/domain/schema";
import { reportDate, reportText } from "@/domain/report-presentation";
export function ReportExport({
  job,
  versions,
  sources,
  selectedId,
  currentId,
  onClose,
  onPrint,
  onToast,
}: {
  job: Job;
  versions: ReportVersion[];
  sources: SourceVersion[];
  selectedId: string;
  currentId: string;
  onClose: () => void;
  onPrint: (report: ReportVersion) => void;
  onToast: (message: string) => void;
}) {
  const [versionId, setVersionId] = useState(selectedId),
    [error, setError] = useState("");
  const selected = versions.find((version) => version.id === versionId),
    source = sources.find((item) => item.id === selected?.sourceVersionId);
  const copy = async () => {
    if (!selected || !source) return;
    try {
      await navigator.clipboard.writeText(reportText(job, selected, source));
      onToast(`已复制第 ${selected.no} 版全文`);
      onClose();
    } catch {
      setError("浏览器没有允许复制，可以选择打印 / 存成 PDF。");
    }
  };
  return (
    <Modal title="导出这份报告" onClose={onClose} className="jd-export-sheet">
      <p className="jd-sheet-lead">
        导出的是一份可以拿去面试前复习、或发给学长看的文本。导出内容会标明版本和日期。
      </p>
      <label className="jd-export-version">
        导出哪个版本
        <select
          value={versionId}
          onChange={(event) => {
            setVersionId(event.target.value);
            setError("");
          }}
        >
          {[...versions].reverse().map((version) => (
            <option key={version.id} value={version.id}>
              第 {version.no} 版{version.id === currentId ? "（当前）" : ""} ·{" "}
              {version.supplements.length
                ? `含 ${version.supplements.length} 条补充`
                : "基础分析"}{" "}
              · {reportDate(version.createdAt)}
            </option>
          ))}
        </select>
      </label>
      <div className="jd-export-columns">
        <section>
          <h3>会包含</h3>
          <ul>
            <li>报告全部内容和每条判断的原文依据</li>
            <li>你加入的补充，以及来源</li>
            <li>“原文没写 / 不确定”的边界提示</li>
            <li>版本号和日期</li>
          </ul>
        </section>
        <section>
          <h3>不会包含</h3>
          <ul>
            <li>还没加入报告的草稿笔记</li>
            <li>内部诊断信息</li>
            <li>你的“我的标记”和备注</li>
          </ul>
        </section>
      </div>
      {versionId !== currentId && (
        <p className="jd-export-warning">
          你选的是旧版本，导出的内容不含之后加入的补充。
        </p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {(!selected || !source) && (
        <p role="alert">这个版本的原文没有读取成功，返回详情后再试。</p>
      )}
      <div className="btn-row jd-export-actions">
        <button
          type="button"
          className="btn"
          disabled={!source}
          onClick={() => void copy()}
        >
          复制全文
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!selected || !source}
          onClick={() => selected && onPrint(selected)}
        >
          打印 / 存成 PDF
        </button>
      </div>
      <p className="jd-sheet-foot">
        想备份或换设备？回到“我的岗位”首页，用“数据与备份”。
      </p>
    </Modal>
  );
}
