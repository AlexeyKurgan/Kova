import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  FilePlus2,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { getDiary } from "../../lib/coreClient";
import { plural } from "../../lib/format";
import { LEDGER_TYPE_LABELS } from "../../lib/labels";
import type { DiaryDay, DiaryResponse } from "../../lib/types";

const RANGES = [7, 14, 30] as const;

function dayLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function weekdayLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { weekday: "long" });
}

function isToday(value: string) {
  return value === new Date().toISOString().slice(0, 10);
}

function dayCount(day: DiaryDay) {
  return (
    day.tasks_created +
    day.tasks_done +
    day.assets +
    day.reviews +
    day.snapshots
  );
}

export default function DiaryScreen() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(14);
  const [data, setData] = useState<DiaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = (next: number) => {
    setLoading(true);
    setError("");
    getDiary(next)
      .then((value) => setData(value))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Не удалось загрузить дневник"),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(range);
  }, [range]);

  const visibleDays = useMemo(
    () => (data?.days ?? []).filter((day) => day.events > 0 || isToday(day.date)),
    [data],
  );

  const totals = (data?.totals ?? {}) as Record<string, number>;
  const summary = [
    { label: "Событий", value: totals.events ?? 0, icon: Sparkles },
    { label: "Задач создано", value: totals.tasks_created ?? 0, icon: FilePlus2 },
    { label: "Задач закрыто", value: totals.tasks_done ?? 0, icon: CheckCircle2 },
    { label: "Ассетов", value: totals.assets ?? 0, icon: Package },
    { label: "Принято", value: totals.reviews ?? 0, icon: ShieldCheck },
  ];

  return (
    <section className="diary-screen">
      <div className="assets-heading">
        <BookOpen size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>Дневник проекта</h1>
          <p className="subtitle">
            Что происходило в проекте по дням: задачи, ассеты, проверки и снапшоты.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading}
            onClick={() => load(range)}
          >
            <RefreshCw size={15} />
            {loading ? "Обновление…" : "Обновить"}
          </button>
        </div>
      </div>

      <div className="diary-toolbar">
        {RANGES.map((value) => (
          <button
            type="button"
            key={value}
            className={range === value ? "is-active" : ""}
            onClick={() => setRange(value)}
          >
            {value} дней
          </button>
        ))}
        <span className="diary-toolbar-spacer" />
        <small>Сводка строится из журнала .hub</small>
      </div>

      {error ? <p className="modal-error resource-error">{error}</p> : null}

      <div className="diary-summary">
        {summary.map((item) => {
          const Icon = item.icon;
          return (
            <article className="diary-stat" key={item.label}>
              <Icon size={15} />
              <b>{item.value}</b>
              <span>{item.label}</span>
            </article>
          );
        })}
      </div>

      {loading && !data ? (
        <div className="empty-panel">
          <div className="empty-art">
            <CalendarDays size={42} />
          </div>
          <h2 className="empty-title">Собираю дневник…</h2>
        </div>
      ) : visibleDays.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-art">
            <BookOpen size={62} strokeWidth={1.05} />
            <Sparkles size={20} className="empty-sparkle" />
          </div>
          <h2 className="empty-title">Пока ничего не произошло</h2>
          <p className="empty-text">
            Создай задачу или импортируй ассет — записи появятся здесь.
          </p>
        </div>
      ) : (
        <div className="diary-list">
          {visibleDays.map((day) => {
            const count = dayCount(day);
            return (
              <article className={`diary-day${isToday(day.date) ? " is-today" : ""}`} key={day.date}>
                <div className="diary-day-rail">
                  <span className="diary-day-dot" />
                  <span className="diary-day-line" />
                </div>
                <div className="diary-day-body">
                  <header className="diary-day-head">
                    <div>
                      <b>{isToday(day.date) ? "Сегодня" : dayLabel(day.date)}</b>
                      <small>{weekdayLabel(day.date)}</small>
                    </div>
                    <span className="diary-day-events">
                      {day.events} {plural(day.events, ["событие", "события", "событий"])}
                    </span>
                  </header>
                  <div className="diary-day-stats">
                    {day.tasks_created > 0 ? (
                      <span>
                        +{day.tasks_created}{" "}
                        {plural(day.tasks_created, ["задача", "задачи", "задач"])}
                      </span>
                    ) : null}
                    {day.tasks_done > 0 ? <span className="is-ok">✓ {day.tasks_done} закрыто</span> : null}
                    {day.assets > 0 ? (
                      <span>
                        +{day.assets} {plural(day.assets, ["ассет", "ассета", "ассетов"])}
                      </span>
                    ) : null}
                    {day.reviews > 0 ? <span className="is-ok">✓ {day.reviews} принято</span> : null}
                    {day.snapshots > 0 ? (
                      <span>
                        {day.snapshots}{" "}
                        {plural(day.snapshots, ["снапшот", "снапшота", "снапшотов"])}
                      </span>
                    ) : null}
                    {count === 0 ? <span className="is-muted">без изменений</span> : null}
                  </div>
                  {day.highlights.length > 0 ? (
                    <div className="diary-highlights">
                      {day.highlights.slice(0, 8).map((type) => (
                        <span key={type}>
                          <i />
                          {LEDGER_TYPE_LABELS[type] ?? type}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
