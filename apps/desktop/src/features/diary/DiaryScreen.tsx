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
import { DayPicker } from "react-day-picker";
import { ru } from "date-fns/locale";
import { format, parseISO } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "react-day-picker/style.css";
import { getDiary } from "../../lib/coreClient";
import { plural } from "../../lib/format";
import { LEDGER_TYPE_LABELS } from "../../lib/labels";
import type { DiaryDay, DiaryResponse } from "../../lib/types";

const RANGES = [7, 14, 30] as const;

const SERIES = [
  { key: "tasks", label: "Задачи", color: "#D8A657" },
  { key: "assets", label: "Ассеты", color: "#6AA9FF" },
  { key: "reviews", label: "Принято", color: "#5CC8A1" },
  { key: "snapshots", label: "Снапшоты", color: "#8B7BD8" },
] as const;

function dayCount(day: DiaryDay) {
  return (
    day.tasks_created +
    day.tasks_done +
    day.assets +
    day.reviews +
    day.snapshots
  );
}

function isToday(value: string) {
  return value === format(new Date(), "yyyy-MM-dd");
}

export default function DiaryScreen() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(14);
  const [data, setData] = useState<DiaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

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

  const chartData = useMemo(
    () =>
      [...(data?.days ?? [])].reverse().map((day) => ({
        date: day.date,
        label: format(parseISO(day.date), "d MMM", { locale: ru }),
        tasks: day.tasks_created + day.tasks_done,
        assets: day.assets,
        reviews: day.reviews,
        snapshots: day.snapshots,
        events: day.events,
      })),
    [data],
  );

  const activeDates = useMemo(
    () =>
      (data?.days ?? [])
        .filter((day) => day.events > 0)
        .map((day) => parseISO(day.date)),
    [data],
  );

  const visibleDays = useMemo(() => {
    let rows = data?.days ?? [];
    if (selectedDate) {
      const key = format(selectedDate, "yyyy-MM-dd");
      rows = rows.filter((day) => day.date === key);
    }
    return rows.filter((day) => day.events > 0 || isToday(day.date));
  }, [data, selectedDate]);

  const totals = (data?.totals ?? {}) as Record<string, number>;
  const summary = [
    { label: "Событий", value: totals.events ?? 0, icon: Sparkles },
    { label: "Задач создано", value: totals.tasks_created ?? 0, icon: FilePlus2 },
    { label: "Задач закрыто", value: totals.tasks_done ?? 0, icon: CheckCircle2 },
    { label: "Ассетов", value: totals.assets ?? 0, icon: Package },
    { label: "Принято", value: totals.reviews ?? 0, icon: ShieldCheck },
  ];

  return (
    <section className="assets-screen diary-screen diary-v2">
      <div className="diary-hero">
        <div className="diary-hero-copy">
          <span className="diary-kicker">
            <CalendarDays size={13} />
            история проекта
          </span>
          <h1>Дневник проекта</h1>
          <p>
            Что происходило в проекте по дням: задачи, ассеты, проверки и снапшоты.
            Сводка строится из журнала <code>.hub</code>.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary diary-refresh"
          disabled={loading}
          onClick={() => load(range)}
        >
          <RefreshCw size={15} />
          {loading ? "Обновление…" : "Обновить"}
        </button>
      </div>

      <div className="diary-controls">
        <div className="diary-range">
          {RANGES.map((value) => (
            <button
              type="button"
              key={value}
              className={range === value ? "is-active" : ""}
              onClick={() => {
                setRange(value);
                setSelectedDate(null);
              }}
            >
              {value} дней
            </button>
          ))}
        </div>
        <span className="diary-controls-note">
          {selectedDate
            ? `Выбран день: ${format(selectedDate, "d MMMM yyyy", { locale: ru })}`
            : `Сводка за последние ${range} дней`}
        </span>
        <button
          type="button"
          className="diary-today-btn"
          disabled={!selectedDate}
          onClick={() => setSelectedDate(null)}
        >
          Все дни
        </button>
      </div>

      {error ? <p className="modal-error resource-error">{error}</p> : null}

      <div className="diary-kpis">
        {summary.map((item) => {
          const Icon = item.icon;
          return (
            <article className="diary-kpi" key={item.label}>
              <span className="diary-kpi-icon">
                <Icon size={14} />
              </span>
              <div>
                <b>{item.value}</b>
                <span>{item.label}</span>
              </div>
            </article>
          );
        })}
      </div>

      <div className="diary-analytics">
        <article className="diary-chart-card">
          <div className="diary-card-head">
            <div>
              <span className="diary-card-kicker">Активность по дням</span>
              <b>{range} дней проекта</b>
            </div>
            <div className="diary-legend">
              {SERIES.map((item) => (
                <span key={item.key}>
                  <i style={{ background: item.color }} />
                  {item.label}
                </span>
              ))}
            </div>
          </div>
          <div className="diary-chart">
            {chartData.length === 0 ? (
              <p className="ad3-empty">Данных пока нет.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.055)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#8b929c", fontSize: 8.5 }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "#8b929c", fontSize: 8.5 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.035)" }}
                    contentStyle={{
                      background: "#14171c",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 8,
                      color: "#e7e9ec",
                      fontSize: 10,
                    }}
                    labelStyle={{ color: "#e7e9ec", marginBottom: 4 }}
                  />
                  {SERIES.map((item) => (
                    <Bar
                      key={item.key}
                      dataKey={item.key}
                      stackId="activity"
                      fill={item.color}
                      radius={[2, 2, 0, 0]}
                      maxBarSize={22}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>

        <article className="diary-calendar-card">
          <div className="diary-card-head">
            <div>
              <span className="diary-card-kicker">Календарь</span>
              <b>Дни с событиями</b>
            </div>
            <span className="diary-calendar-count">
              {activeDates.length} {plural(activeDates.length, ["день", "дня", "дней"])}
            </span>
          </div>
          <div className="diary-calendar">
            <DayPicker
              mode="single"
              selected={selectedDate ?? undefined}
              onSelect={(date) => setSelectedDate(date ?? null)}
              locale={ru}
              showOutsideDays
              fixedWeeks
              modifiers={{ hasEvents: activeDates }}
              modifiersClassNames={{ hasEvents: "diary-cal-day-has-events" }}
            />
          </div>
          <div className="diary-calendar-legend">
            <span>
              <i className="is-event" /> есть события
            </span>
            <span>
              <i className="is-empty" /> без событий
            </span>
          </div>
        </article>
      </div>

      <article className="diary-feed">
        <div className="diary-feed-head">
          <h2>
            <BookOpen size={14} />
            Лента проекта
          </h2>
          <span>
            {visibleDays.length} {plural(visibleDays.length, ["день", "дня", "дней"])}
          </span>
        </div>

        {loading && !data ? (
          <div className="diary-feed-empty">
            <CalendarDays size={28} />
            <b>Собираю дневник…</b>
          </div>
        ) : visibleDays.length === 0 ? (
          <div className="diary-feed-empty">
            <BookOpen size={28} />
            <b>
              {selectedDate ? "В этот день событий нет" : "Пока ничего не произошло"}
            </b>
            <span>
              {selectedDate
                ? "Выбери другой день в календаре."
                : "Создай задачу или импортируй ассет — записи появятся здесь."}
            </span>
            {selectedDate ? (
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setSelectedDate(null)}>
                Показать все дни
              </button>
            ) : null}
          </div>
        ) : (
          <div className="diary-list">
            {visibleDays.map((day) => {
              const count = dayCount(day);
              const date = parseISO(day.date);
              return (
                <article
                  className={`diary-entry${isToday(day.date) ? " is-today" : ""}`}
                  key={day.date}
                >
                  <div className="diary-entry-date">
                    <b>{format(date, "d")}</b>
                    <span>{format(date, "MMM", { locale: ru })}</span>
                    <small>{format(date, "EEE", { locale: ru })}</small>
                  </div>
                  <div className="diary-entry-main">
                    <header className="diary-entry-head">
                      <div>
                        <b>{isToday(day.date) ? "Сегодня" : format(date, "d MMMM yyyy", { locale: ru })}</b>
                        <span className="diary-entry-count">
                          {day.events} {plural(day.events, ["событие", "события", "событий"])}
                        </span>
                      </div>
                      {isToday(day.date) ? <span className="diary-today-badge">Сегодня</span> : null}
                    </header>
                    <div className="diary-entry-stats">
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
                        {day.highlights.slice(0, 10).map((type) => (
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
      </article>
    </section>
  );
}
