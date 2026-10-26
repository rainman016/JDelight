import { useId, useState } from "react";
import type { TrialAnalysisStatus } from "@/domain/analysis";
import { normalizeInvite } from "@/domain/invite";
import { analysisStatus } from "@/providers/model/client";
import { readInvite, saveInvite } from "@/providers/model/invite";
export function TrialAccess({
  status,
  checked,
  onChange,
  onStatus,
}: {
  status: TrialAnalysisStatus;
  checked: boolean;
  onChange: (value: boolean) => void;
  onStatus: (value: TrialAnalysisStatus) => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(() => readInvite() ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const id = useId();
  const change = () => {
    setEditing(true);
    onChange(false);
    setError("");
  };
  if (status.unavailable)
    return (
      <div className="trial-access">
        <p role="status">真实分析暂不可用，现在仍可使用模拟分析。</p>
        <button
          type="button"
          className="jd-link"
          onClick={async () => {
            const next = await analysisStatus();
            if (next?.mode === "trial") onStatus(next);
          }}
        >
          重试检查
        </button>
      </div>
    );
  if (status.trialEnded)
    return (
      <p className="trial-access" role="status">
        试用额度已用完，感谢参与！现在仍可使用模拟分析。
      </p>
    );
  const entry = editing || status.needCode || status.invalidCode;
  return (
    <div className="trial-access">
      {entry ? (
        <>
          <button className="jd-link" type="button" onClick={change}>
            有邀请码？用真实 AI 分析
          </button>
          {(editing || status.invalidCode) && (
            <form
              className="trial-code-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                onChange(false);
                const code = normalizeInvite(draft);
                if (!code) {
                  setError("邀请码不对，请检查后重试。");
                  return;
                }
                setBusy(true);
                setError("");
                try {
                  const next = await analysisStatus(code);
                  if (next?.mode !== "trial" || next.unavailable) {
                    setError("暂时无法检查邀请码，请稍后重试。");
                    return;
                  }
                  if (next.invalidCode || next.needCode) {
                    setError("邀请码不对，请检查后重试。");
                    return;
                  }
                  saveInvite(code);
                  setEditing(false);
                  onStatus(next);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label htmlFor={id}>邀请码</label>
              <div className="trial-code-row">
                <input
                  id={id}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setError("");
                  }}
                  maxLength={16}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="XXXXX-XXXXX"
                  aria-invalid={!!error || status.invalidCode}
                  aria-describedby={
                    error || status.invalidCode ? `${id}-error` : undefined
                  }
                />
                <button type="submit" className="btn" disabled={busy}>
                  {busy ? "检查中…" : "确认"}
                </button>
              </div>
              {(error || status.invalidCode) && (
                <p id={`${id}-error`} className="inline-error" role="alert">
                  {error || "邀请码不对，请检查后重试。"}
                </p>
              )}
            </form>
          )}
        </>
      ) : status.codeRemaining === 0 ? (
        <div className="trial-code-state">
          <p role="status">
            {status.callLimitReached
              ? "这个邀请码的可用调用次数已用完，请联系发码人。"
              : "这个邀请码的 15 份已用完，请联系发码人。"}
          </p>
          <button className="jd-link" type="button" onClick={change}>
            更换邀请码
          </button>
        </div>
      ) : (
        <>
          <div className="trial-code-state">
            <label className="real-switch">
              <input
                type="checkbox"
                role="switch"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
              />
              <span>
                用真实 AI 分析（这个码还剩 {status.codeRemaining} 份）
              </span>
            </label>
            <button className="jd-link" type="button" onClick={change}>
              更换邀请码
            </button>
          </div>
          <p className="hint">真实分析会消耗份数；没有生成报告时退还份数。</p>
        </>
      )}
    </div>
  );
}
