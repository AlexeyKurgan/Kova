import { useEffect, useRef, useState } from "react";
import { Bell, Moon, PanelRight, Search, Settings, Sun } from "lucide-react";
import type { CoreStatus, Section } from "../lib/types";

type Props = {
  section: Section;
  core: CoreStatus;
  projectName: string;
  theme: "dark" | "light";
  inspectorOpen: boolean;
  reviewCount: number;
  toolIssues: number | null;
  onToggleTheme: () => void;
  onShowInspector: () => void;
  onOpenReview: () => void;
  onOpenSettings: () => void;
  onSearch: (query: string) => void;
};

const coreLabel: Record<CoreStatus, string> = {
  checking: "проверка",
  ok: "в порядке",
  offline: "не запущен",
};

export default function TopBar({
  section,
  core,
  projectName,
  theme,
  inspectorOpen,
  reviewCount,
  toolIssues,
  onToggleTheme,
  onShowInspector,
  onOpenReview,
  onOpenSettings,
  onSearch,
}: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="topbar">
      <div className="breadcrumb">
        <span className="breadcrumb-project">{projectName}</span>
        <span className="breadcrumb-sep">/</span>
        <span className="breadcrumb-current">{section}</span>
      </div>

      <label className="search-box">
        <Search size={14} strokeWidth={1.8} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSearch(query);
            }
          }}
          placeholder="Поиск по проекту"
          aria-label="Поиск по проекту"
        />
        <kbd>Ctrl+K</kbd>
      </label>

      <div className="topbar-status">
        <span className={`status is-${core}`}>
          <span className="dot" />
          Core: {coreLabel[core]}
        </span>
        <span
          className={`status ${
            toolIssues === null ? "is-muted" : toolIssues > 0 ? "is-warning" : "is-ok"
          }`}
        >
          <span className="dot" />
          {toolIssues === null
            ? "Инструменты проверяются"
            : toolIssues > 0
              ? `Инструменты: ${toolIssues}`
              : "Инструменты в порядке"}
        </span>
        <button
          type="button"
          className="icon-btn topbar-icon"
          onClick={onOpenReview}
          aria-label={`Review: ${reviewCount}`}
          title={reviewCount > 0 ? `Review: ${reviewCount}` : "Review"}
        >
          <Bell size={15} />
          {reviewCount > 0 ? <span className="topbar-badge">{reviewCount}</span> : null}
        </button>
        <button
          type="button"
          className="icon-btn topbar-theme-btn"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          type="button"
          className="icon-btn topbar-icon"
          onClick={onOpenSettings}
          aria-label="Настройки"
          title="Настройки"
        >
          <Settings size={15} />
        </button>
        {!inspectorOpen ? (
          <button
            type="button"
            className="icon-btn topbar-panel-btn"
            onClick={onShowInspector}
            aria-label="Показать состояние проекта"
          >
            <PanelRight size={15} />
          </button>
        ) : null}
      </div>
    </header>
  );
}
