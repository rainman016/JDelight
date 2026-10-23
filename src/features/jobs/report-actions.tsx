import { createContext, useContext, type ReactNode } from "react";
import type { SupplementChange } from "@/data/supplements";
interface Actions {
  askBlock: (blockId: string, title: string, button: HTMLButtonElement) => void;
  changeNote: (id: string, change: SupplementChange) => Promise<void>;
}
const Context = createContext<Actions | null>(null);
export function ReportActions({
  actions,
  children,
}: {
  actions: Actions | null;
  children: ReactNode;
}) {
  return <Context.Provider value={actions}>{children}</Context.Provider>;
}
export const useReportActions = () => useContext(Context);
export function AskSection({
  blockId,
  title,
}: {
  blockId?: string;
  title: string;
}) {
  const actions = useReportActions();
  return actions && blockId ? (
    <button
      type="button"
      className="jd-ask-section"
      onClick={(event) => actions.askBlock(blockId, title, event.currentTarget)}
    >
      问这一节<span className="sr-only">：{title}</span>
    </button>
  ) : null;
}
