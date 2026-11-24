import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Clock3, X } from "lucide-react";
import { LEDGER_TYPE_LABELS } from "../../lib/labels";
import type { LedgerEvent, Task } from "../../lib/types";

type Props = {
  events: LedgerEvent[];
  tasks: Task[];
  onClose: () => void;
};

const FILTERS = [
  { key: "all", label: "Всё" },
  { key: "tasks", label: "Задачи" },
  { key: "assets", label: "Ассеты" },
  { key: "blender", label: "Blender" },
  { key: "ai", label: "AI" },
  { key: "review", label: "Review" },
  { key: "snapshots", label: "Снапшоты" },
  { key: "projects", label: "Проекты" },
];

function dayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function monthKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dayLabel(key: string) {
  if (key === "unknown") return "Без даты";
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
  if (same(date, today)) return "Сегодня";
  if (same(date, yesterday)) return "Вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function monthLabel(key: string) {
  if (key === "unknown") return "Без даты";
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
}

function category(type: string) {
  if (type.startsWith("task.")) return "tasks";
  if (type.startsWith("asset.")) return "assets";
  if (type.startsWith("blender.")) return "blender";
  if (type.startsWith("ai.")) return "ai";
  if (type.startsWith("review.")) return "review";
  if (type.startsWith("snapshot.")) return "snapshots";
  if (type.startsWith("project.")) return "projects";
  return "all";
}

export default function ActivityModal({ events, tasks, onClose }: Props) {
  const [filter, setFilter] = useState("all");
  const [openMonths, setOpenMonths] = useState<string[]>([]);
  const initialized = useRef(false);
  const taskTitles = useMemo(
    () => new Map(tasks.map((task) => [task.id, task.title])),
    [tasks],
  );

  const filtered = useMemo(
    () => events.filter((event) => filter === "all" || category(event.type) === filter),
    [events, filter],
  );

  const months = useMemo(() => {
    const map = new Map<string, LedgerEvent[]>();
    for (const event of filtered) {
      const key = monthKey(event.at);
      const rows = map.get(key) ?? [];
      rows.push(event);
      map.set(key, rows);
    }
    return [...map.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [filtered]);

  useEffect(() => {
    if (initialized.current || months.length === 0) return;
    initialized.current = true;
    setOpenMonths([months[0][0]]);
  }, [months]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const toggleMonth = (key: string) => {
    setOpenMonths((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal activity-modal">
        <div className="modal-header">
          <span className="modal-title">
            <Clock3 size={16} className="activity-title-icon" />
            Активность проекта
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>

        <div className="activity-filters">
          <select
            className="filter-select"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label="Фильтр активности"
          >
            {FILTERS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <span className="activity-filter-note">Фильтр событий</span>
        </div>

        <div className="modal-body activity-body">
          {months.length === 0 ? (
            <div className="empty-panel">
              <div className="empty-art">
                <Clock3 size={24} />
              </div>
              <h2 className="empty-title">Пока нет событий</h2>
              <p className="empty-text">Действия в проекте будут появляться здесь по дням.</p>
            </div>
          ) : (
            months.map(([month, rows]) => {
              const open = openMonths.includes(month);
              const days = new Map<string, LedgerEvent[]>();
              for (const event of rows) {
                const key = dayKey(event.at);
                days.set(key, [...(days.get(key) ?? []), event]);
              }
              return (
                <div className="activity-month" key={month}>
                  <button
                    type="button"
                    className="activity-month-head"
                    onClick={() => toggleMonth(month)}
                  >
                    {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    <span>{monthLabel(month)}</span>
                    <span className="activity-month-count">{rows.length}</span>
                  </button>
                  {open ? (
                    <div className="activity-days">
                      {[...days.entries()].map(([day, dayEvents]) => (
                        <div className="activity-day" key={day}>
                          <div className="activity-day-label">{dayLabel(day)}</div>
                          {dayEvents.map((event) => (
                            <div className="activity-event" key={event.id}>
                              <span className="activity-event-time">
                                {new Date(event.at).toLocaleTimeString("ru-RU", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              <span className="activity-event-label">
                                {LEDGER_TYPE_LABELS[event.type] ?? event.type}
                              </span>
                              <span className="activity-event-subject">
                                {taskTitles.get(event.subject) ??
                                  (typeof event.data.name === "string"
                                    ? event.data.name
                                    : event.subject)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div className="modal-footer">
          <span className="activity-footnote">
            Всего событий: {filtered.length} · хранятся локально в .hub/ledger
          </span>
          <span className="modal-footer-spacer" />
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
