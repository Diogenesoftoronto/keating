import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export interface SettingsTabDef {
  id: string;
  label: string;
  component: React.ReactNode;
}

interface SettingsDialogProps {
  open: boolean;
  tabs: SettingsTabDef[];
  onClose: () => void;
}

export function SettingsDialog({ open, tabs, onClose }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === dialogRef.current) onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/50 backdrop-blur-sm px-4 pt-6 pb-6"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-lg border-2 border-border bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div className="hidden sm:flex w-44 md:w-52 lg:w-56 flex-col border-r border-border bg-muted/30 shrink-0">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-foreground">Settings</span>
          </div>
          <div className="flex flex-col p-2 gap-1 overflow-y-auto">
            {tabs.map((tab, i) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(i)}
                className={`text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  i === activeTab
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 border-b border-border">
            <select
              className="min-w-0 flex-1 text-sm font-medium bg-transparent border border-border rounded px-2 py-2"
              value={activeTab}
              onChange={(e) => setActiveTab(Number(e.target.value))}
              aria-label="Settings tab"
            >
              {tabs.map((tab, i) => (
                <option key={tab.id} value={i}>{tab.label}</option>
              ))}
            </select>
            <button
              onClick={onClose}
              className="dialog-icon-button inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 sm:p-5">
            {tabs[activeTab]?.component}
          </div>
        </div>
      </div>
    </div>
  );
}
