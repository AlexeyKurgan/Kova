import { useEffect, useState } from "react";
import {
  Box,
  Brain,
  ChevronRight,
  FileClock,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { searchMemory } from "../../lib/coreClient";
import type { MemoryResponse, MemoryResult } from "../../lib/types";

type Props = {
  seed?: { text: string; key: number } | null;
  onOpenTask: (taskId: string) => void;
  onOpenAsset: (assetId: string) => void;
};

const GROUP_LABELS: Array<[keyof MemoryResponse["groups"], string]> = [
  ["tasks", "Задачи"],
  ["assets", "Ассеты"],
  ["chats", "Чаты"],
  ["decisions", "Решения"],
  ["events", "События"],
];

const KIND_ICONS: Record<MemoryResult["kind"], typeof Box> = {
  task: Sparkles,
  asset: Box,
  chat: MessageSquare,
  event: FileClock,
  decision: Brain,
};

export default function MemoryScreen({ seed, onOpenTask, onOpenAsset }: Props) {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<MemoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (seed?.text) setQuery(seed.text);
  }, [seed?.key]);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        setError(null);
        searchMemory(query)
          .then((value) => {
            if (alive) setData(value);
          })
          .catch((err) => {
            if (alive) setError(err instanceof Error ? err.message : "Поиск не сработал");
          })
          .finally(() => {
            if (alive) setLoading(false);
          });
      },
      query.trim() ? 260 : 0,
    );
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, version]);

  const open = (row: MemoryResult) => {
    if (row.kind === "task" || row.link.startsWith("task_")) {
      onOpenTask(row.link || row.id);
    } else if (row.kind === "asset" || row.link.startsWith("asst_")) {
      onOpenAsset(row.link || row.id);
    }
  };

  const canOpen = (row: MemoryResult) =>
    row.kind === "task" ||
    row.kind === "asset" ||
    row.link.startsWith("task_") ||
    row.link.startsWith("asst_");

  return (
    <section className="memory-screen">
      <div className="assets-heading">
        <Brain size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>Память проекта</h1>
          <p className="subtitle">
            Задачи, ассеты, решения и журнал в одном поиске. Kova не выдумывает: если
            ничего нет, так и скажет.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setVersion((value) => value + 1)}
          >
            <RefreshCw size={15} />
            Обновить
          </button>
        </div>
      </div>

      <div className="memory-search">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти задачу, ассет, решение, событие…"
          autoFocus
        />
        {loading ? <span className="memory-spinner">Ищу…</span> : null}
      </div>

      <div className="memory-stats">
        <span>
          <b>{data?.counts.tasks ?? 0}</b> задач
        </span>
        <span>
          <b>{data?.counts.assets ?? 0}</b> ассетов
        </span>
        <span>
          <b>{data?.counts.chats ?? 0}</b> чатов
        </span>
        <span>
          <b>{data?.counts.decisions ?? 0}</b> решений
        </span>
        <span>
          <b>{data?.counts.events ?? 0}</b> событий
        </span>
      </div>

      {error ? <p className="modal-error resource-error">{error}</p> : null}

      {!loading && data && data.total === 0 ? (
        <div className="empty-panel">
          <div className="empty-art">
            <Brain size={42} />
          </div>
          <h2 className="empty-title">
            {query.trim() ? "В памяти проекта этого нет" : "Память пока пуста"}
          </h2>
          <p className="empty-text">
            {query.trim()
              ? "Попробуй другое слово или открой задачи и ассеты напрямую."
              : "Создай задачу или импортируй ассет — записи появятся здесь."}
          </p>
        </div>
      ) : null}

      <div className="memory-groups">
        {GROUP_LABELS.map(([key, label]) => {
          const rows = data?.groups[key] ?? [];
          if (rows.length === 0) return null;
          return (
            <section className="memory-group" key={key}>
              <div className="memory-group-head">
                <h2>{label}</h2>
                <span>{rows.length}</span>
              </div>
              <div className="memory-list">
                {rows.map((row) => {
                  const Icon = KIND_ICONS[row.kind] ?? Brain;
                  const clickable = canOpen(row);
                  return (
                    <button
                      type="button"
                      className={`memory-row${clickable ? " is-link" : ""}`}
                      key={`${row.kind}-${row.id}`}
                      onClick={() => clickable && open(row)}
                      disabled={!clickable}
                    >
                      <span className="memory-icon">
                        <Icon size={15} />
                      </span>
                      <span className="memory-copy">
                        <b>{row.title}</b>
                        <small>{row.snippet}</small>
                      </span>
                      <span className="memory-meta">{row.meta}</span>
                      {clickable ? <ChevronRight size={14} className="memory-chevron" /> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
