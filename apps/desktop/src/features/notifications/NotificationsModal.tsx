import { useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Box,
  Check,
  ChevronRight,
  Clock3,
  FileClock,
  Package,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { formatDate } from "../../lib/format";
import { LEDGER_TYPE_LABELS, TASK_STATUS_LABELS } from "../../lib/labels";
import type { LedgerEvent, ReviewItem, Task } from "../../lib/types";

type Props = {
  events: LedgerEvent[];
  review: ReviewItem[];
  tasks: Task[];
  onClose: () => void;
  onOpenReview: () => void;
  onOpenTask: (taskId: string) => void;
};

type Range = "day" | "week" | "month" | "all";
type Category = "review" | "task" | "asset" | "package" | "ai" | "system";

const CATEGORIES: Array<[Category, string]> = [
  ["review", "Review"],
  ["task", "Задачи"],
  ["asset", "Ассеты"],
  ["package", "Пакеты"],
  ["ai", "AI"],
  ["system", "Система"],
];

const MUTED_KEY = "kova-muted-notifications";

function categoryOf(type: string, review: boolean): Category {
  if (review || type.startsWith("review.")) return "review";
  if (type.startsWith("task.")) return "task";
  if (type.startsWith("asset.")) return "asset";
  if (type.startsWith("package.")) return "package";
  if (type.startsWith("ai.") || type.startsWith("agent.")) return "ai";
  return "system";
}

function loadMuted(): Category[] {
  try {
    const raw = window.localStorage.getItem(MUTED_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw) as string[];
    return CATEGORIES.map(([category]) => category).filter((category) =>
      value.includes(category),
    );
  } catch {
    return [];
  }
}

const RANGES: Array<[Range, string, number]> = [
  ["day", "24 часа", 86400_000],
  ["week", "7 дней", 7 * 86400_000],
  ["month", "30 дней", 30 * 86400_000],
  ["all", "Всё", 0],
];

function actorLabel(actor: string): string {
  if (actor === "human") return "Вы";
  if (actor === "agent" || actor === "ai") return "Агент";
  if (actor === "system") return "Kova";
  return actor || "Kova";
}

function eventTitle(event: LedgerEvent): string {
  const data = event.data as Record<string, unknown>;
  return String(
    data.title ||
      data.name ||
      LEDGER_TYPE_LABELS[event.type] ||
      event.type.replaceAll(".", " · "),
  );
}

function eventText(event: LedgerEvent): string {
  const data = event.data as Record<string, unknown>;
  const actor = actorLabel(event.actor);
  if (event.type === "task.status") {
    const from = TASK_STATUS_LABELS[String(data.from) as keyof typeof TASK_STATUS_LABELS];
    const to = TASK_STATUS_LABELS[String(data.to) as keyof typeof TASK_STATUS_LABELS];
    if (from && to) return `${actor} · ${from} → ${to}`;
  }
  const detail = String(data.path || data.name || "");
  if (detail && detail !== eventTitle(event)) return `${actor} · ${detail}`;
  return `${actor} · ${LEDGER_TYPE_LABELS[event.type] ?? event.type}`;
}

function eventIcon(type: string) {
  if (type.startsWith("review.")) return Star;
  if (type.startsWith("asset.")) return Box;
  if (type.startsWith("package.")) return Package;
  if (type.startsWith("ai.") || type.startsWith("agent.")) return Sparkles;
  if (type.startsWith("task.")) return Activity;
  return FileClock;
}

export default function NotificationsModal({
  events,
  review,
  tasks,
  onClose,
  onOpenReview,
  onOpenTask,
}: Props) {
  const [range, setRange] = useState<Range>("week");
  const [muted, setMuted] = useState<Category[]>(loadMuted);

  const notifications = useMemo(() => {
    const limit = RANGES.find(([value]) => value === range)?.[2] ?? 0;
    const now = Date.now();
    const rows: Array<{
      id: string;
      at: string;
      title: string;
      text: string;
      type: string;
      taskId: string;
      review: boolean;
      category: Category;
    }> = [];
    for (const item of review) {
      const task = tasks.find((candidate) => candidate.id === item.task_id);
      rows.push({
        id: `review-${item.id}`,
        at: item.created_at,
        title: task?.title || "Результат AI",
        text: item.summary || "Ждёт проверки",
        type: "review.pending",
        taskId: item.task_id,
        review: true,
        category: "review",
      });
    }
    for (const event of events) {
      const at = event.at || "";
      rows.push({
        id: `event-${event.id}`,
        at,
        title: eventTitle(event),
        text: eventText(event),
        type: event.type,
        taskId: event.subject.startsWith("task_") ? event.subject : "",
        review: event.type.startsWith("review."),
        category: categoryOf(event.type, event.type.startsWith("review.")),
      });
    }
    return rows
      .filter((row) => {
        if (muted.includes(row.category)) return false;
        if (limit === 0) return true;
        const stamp = Date.parse(row.at);
        return !Number.isNaN(stamp) && now - stamp <= limit;
      })
      .sort((left, right) => (Date.parse(right.at) || 0) - (Date.parse(left.at) || 0))
      .slice(0, 80);
  }, [events, muted, range, review, tasks]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof notifications>();
    for (const row of notifications) {
      const date = new Date(row.at);
      const key = Number.isNaN(date.getTime())
        ? "Без даты"
        : date.toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
            year: "numeric",
          });
      const rows = map.get(key) ?? [];
      rows.push(row);
      map.set(key, rows);
    }
    return [...map.entries()];
  }, [notifications]);

  const today = new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const yesterdayDate = new Date(Date.now() - 86400_000);
  const yesterday = yesterdayDate.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const label = (key: string) =>
    key === today ? "Сегодня" : key === yesterday ? "Вчера" : key;

  const toggleCategory = (category: Category) => {
    setMuted((current) => {
      const next = current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category];
      window.localStorage.setItem(MUTED_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal notifications-modal">
        <div className="modal-header">
          <span className="modal-title">
            <Bell size={15} />
            Уведомления
            <small>{notifications.length} за период</small>
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>

        <div className="notifications-ranges">
          {RANGES.map(([value, title]) => (
            <button
              type="button"
              key={value}
              className={range === value ? "is-active" : ""}
              onClick={() => setRange(value)}
            >
              {title}
            </button>
          ))}
        </div>

        <div className="notifications-filters">
          {CATEGORIES.map(([category, label]) => {
            const active = !muted.includes(category);
            return (
              <button
                type="button"
                key={category}
                className={active ? "is-active" : ""}
                onClick={() => toggleCategory(category)}
                title={active ? "Скрыть тип" : "Показывать тип"}
              >
                <span className="notification-filter-dot" />
                {label}
              </button>
            );
          })}
        </div>

        <div className="notifications-body">
          {groups.length === 0 ? (
            <div className="empty-panel">
              <div className="empty-art">
                <Bell size={34} />
              </div>
              <h2 className="empty-title">Пока тихо</h2>
              <p className="empty-text">За этот период событий нет.</p>
            </div>
          ) : (
            groups.map(([date, rows]) => (
              <section className="notification-group" key={date}>
                <div className="notification-group-head">
                  <span>{label(date)}</span>
                  <b>{rows.length}</b>
                </div>
                {rows.map((row) => {
                  const Icon = row.review ? Star : eventIcon(row.type);
                  return (
                    <button
                      type="button"
                      className={`notification-row${row.review ? " is-review" : ""}`}
                      key={row.id}
                      onClick={() => {
                        if (row.review) {
                          onOpenReview();
                        } else if (row.taskId) {
                          onOpenTask(row.taskId);
                        }
                      }}
                      disabled={!row.review && !row.taskId}
                    >
                      <span className="notification-icon">
                        <Icon size={15} />
                      </span>
                      <span className="notification-copy">
                        <b>{row.title}</b>
                        <small>{row.text}</small>
                      </span>
                      <span className="notification-time">
                        <Clock3 size={10} />
                        {formatDate(row.at)}
                      </span>
                      {row.review || row.taskId ? (
                        <ChevronRight size={13} className="notification-chevron" />
                      ) : null}
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onOpenReview}>
            <Check size={14} />
            Открыть Review
          </button>
          <span className="modal-footer-spacer" />
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
