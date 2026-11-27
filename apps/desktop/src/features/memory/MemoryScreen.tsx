import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownUp,
  Box,
  Brain,
  ChevronRight,
  Clock3,
  FileClock,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { searchMemory } from "../../lib/coreClient";
import { t, tp } from "../../lib/i18n";
import type { MemoryResponse, MemoryResult } from "../../lib/types";

type Props = {
  seed?: { text: string; key: number } | null;
  onOpenTask: (taskId: string) => void;
  onOpenAsset: (assetId: string) => void;
};

type Granularity = "hour" | "day" | "month" | "year";
type KindFilter = "all" | "task" | "asset" | "chat" | "event" | "decision";
type RangeFilter = "all" | "day" | "week" | "month" | "year";

const GROUPS = [
  { key: "tasks", kind: "task", label: "Задачи", icon: Sparkles },
  { key: "assets", kind: "asset", label: "Ассеты", icon: Box },
  { key: "chats", kind: "chat", label: "Чаты", icon: MessageSquare },
  { key: "decisions", kind: "decision", label: "Решения", icon: Brain },
  { key: "events", kind: "event", label: "События", icon: FileClock },
] as const;

const GRANULARITIES: Array<[Granularity, string]> = [
  ["hour", "Часы"],
  ["day", "Дни"],
  ["month", "Месяцы"],
  ["year", "Годы"],
];

const KIND_FILTERS: Array<[KindFilter, string]> = [
  ["all", "Все"],
  ["task", "Задачи"],
  ["asset", "Ассеты"],
  ["chat", "Чаты"],
  ["decision", "Решения"],
  ["event", "События"],
];

const RANGES: Array<[RangeFilter, string, number]> = [
  ["all", "Всё время", 0],
  ["day", "24 часа", 24 * 3600_000],
  ["week", "7 дней", 7 * 24 * 3600_000],
  ["month", "30 дней", 30 * 24 * 3600_000],
  ["year", "Год", 365 * 24 * 3600_000],
];

const DONUT_COLORS = ["#d8a657", "#6aa9ff", "#5cc8a1", "#b58cff", "#74808d"];

function canOpen(row: MemoryResult) {
  return (
    row.kind === "task" ||
    row.kind === "asset" ||
    row.link.startsWith("task_") ||
    row.link.startsWith("asst_")
  );
}

export default function MemoryScreen({ seed, onOpenTask, onOpenAsset }: Props) {
  const [query, setQuery] = useState("");
  const [granularity, setGranularity] = useState<Granularity>("hour");
  const [kind, setKind] = useState<KindFilter>("all");
  const [range, setRange] = useState<RangeFilter>("all");
  const [sort, setSort] = useState<"new" | "old">("new");
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
        searchMemory(query, granularity)
          .then((value) => {
            if (alive) setData(value);
          })
          .catch((err) => {
            if (alive) setError(err instanceof Error ? err.message : t("Поиск не сработал"));
          })
          .finally(() => {
            if (alive) setLoading(false);
          });
      },
      query.trim() ? 240 : 0,
    );
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, granularity, version]);

  const cutoff = useMemo(() => {
    const found = RANGES.find(([value]) => value === range);
    return found ? found[2] : 0;
  }, [range]);

  const filteredGroups = useMemo(() => {
    const result: Record<string, MemoryResult[]> = {};
    for (const group of GROUPS) {
      const rows = (data?.groups[group.key] ?? []).filter((row) => {
        if (kind !== "all" && row.kind !== kind) return false;
        if (cutoff > 0) {
          const stamp = Date.parse(row.updated_at);
          if (Number.isNaN(stamp) || Date.now() - stamp > cutoff) return false;
        }
        return true;
      });
      result[group.key] = [...rows].sort((left, right) => {
        const leftStamp = Date.parse(left.updated_at) || 0;
        const rightStamp = Date.parse(right.updated_at) || 0;
        return sort === "new" ? rightStamp - leftStamp : leftStamp - rightStamp;
      });
    }
    return result;
  }, [cutoff, data, kind, sort]);

  const visibleTotal = GROUPS.reduce(
    (total, group) => total + (filteredGroups[group.key]?.length ?? 0),
    0,
  );

  const open = (row: MemoryResult) => {
    if (row.kind === "task" || row.link.startsWith("task_")) {
      onOpenTask(row.link || row.id);
    } else if (row.kind === "asset" || row.link.startsWith("asst_")) {
      onOpenAsset(row.link || row.id);
    }
  };

  const timeline = data?.timeline;
  const max = Math.max(1, timeline?.max ?? 1);
  const labelStep = Math.max(1, Math.ceil((timeline?.buckets.length ?? 1) / 8));
  const kindTotal = data
    ? [data.counts.tasks, data.counts.assets, data.counts.chats, data.counts.decisions, data.counts.events]
    : [0, 0, 0, 0, 0];
  const kindSum = Math.max(1, kindTotal.reduce((sum, value) => sum + value, 0));
  let donutStart = 0;
  const donutStops = kindTotal.map((value, index) => {
    const start = donutStart;
    donutStart += (value / kindSum) * 100;
    return `${DONUT_COLORS[index]} ${start}% ${donutStart}%`;
  });

  return (
    <section className="memory-screen memory-v2">
      <div className="memory-hero">
        <div className="memory-hero-copy">
          <span className="memory-kicker">
            <Brain size={13} />
            {t("Память проекта")}
          </span>
          <h1>{t("Всё, что Kova знает о проекте")}</h1>
          <p>
            {t("Задачи, ассеты, решения, чаты и журнал. Ищи по смыслу, смотри активность и возвращайся к контексту без перечитывания чатов.")}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary memory-refresh"
          onClick={() => setVersion((value) => value + 1)}
        >
          <RefreshCw size={15} />
          {t("Обновить")}
        </button>
      </div>

      <div className="memory-command">
        <Search size={20} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Найти задачу, ассет, решение, событие…")}
          autoFocus
        />
        {loading ? <span className="memory-spinner">{t("Ищу…")}</span> : <kbd>Enter</kbd>}
      </div>

      <div className="memory-dashboard">
        <article className="memory-chart-card">
          <div className="memory-card-head">
            <div>
              <span className="memory-card-kicker">
                <Activity size={12} />
                {t("Активность памяти")}
              </span>
              <b>{t("{count} записей за период", { count: timeline?.total ?? 0 })}</b>
            </div>
            <div className="memory-segmented">
              {GRANULARITIES.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={granularity === value ? "is-active" : ""}
                  onClick={() => setGranularity(value)}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </div>

          <div className="memory-chart">
            {(timeline?.buckets ?? []).map((bucket, index) => {
              const totalHeight = bucket.total > 0 ? Math.max(5, (bucket.total / max) * 100) : 0;
              const segments = [
                ["task", bucket.task],
                ["asset", bucket.asset],
                ["chat", bucket.chat],
                ["decision", bucket.decision],
                ["event", bucket.event],
              ] as const;
              return (
                <div className="memory-bar-col" key={`${bucket.label}-${index}`}>
                  <div className="memory-bar-wrap">
                    {bucket.total > 0 ? (
                      <div className="memory-bar-stack" style={{ height: `${totalHeight}%` }}>
                        {segments.map(([name, value]) =>
                          value > 0 ? (
                            <span
                              key={name}
                              className={`memory-bar-seg is-${name}`}
                              style={{ height: `${(value / bucket.total) * 100}%` }}
                              title={`${bucket.label}: ${value}`}
                            />
                          ) : null,
                        )}
                      </div>
                    ) : (
                      <span className="memory-bar-zero" />
                    )}
                  </div>
                  <small>
                    {index % labelStep === 0 || index === (timeline?.buckets.length ?? 0) - 1
                      ? bucket.label
                      : ""}
                  </small>
                </div>
              );
            })}
          </div>

          <div className="memory-legend">
            <span><i className="is-task" /> {t("Задачи")}</span>
            <span><i className="is-asset" /> {t("Ассеты")}</span>
            <span><i className="is-chat" /> {t("Чаты")}</span>
            <span><i className="is-decision" /> {t("Решения")}</span>
            <span><i className="is-event" /> {t("События")}</span>
          </div>
        </article>

        <article className="memory-donut-card">
          <div className="memory-card-kicker">
            <Clock3 size={12} />
            {t("Состав памяти")}
          </div>
          <div className="memory-donut-row">
            <div
              className="memory-donut"
              style={{ background: `conic-gradient(${donutStops.join(", ")})` }}
            >
              <div>
                <b>{kindSum}</b>
                <small>{t("записей")}</small>
              </div>
            </div>
            <div className="memory-donut-legend">
              {GROUPS.map((group, index) => (
                <span key={group.key}>
                  <i style={{ background: DONUT_COLORS[index] }} />
                  {t(group.label)}
                  <b>{kindTotal[index]}</b>
                </span>
              ))}
            </div>
          </div>
        </article>
      </div>

      <div className="memory-toolbar">
        <div className="memory-filter-chips">
          {KIND_FILTERS.map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={kind === value ? "is-active" : ""}
              onClick={() => setKind(value)}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <div className="memory-toolbar-right">
          <label className="memory-select">
            <Clock3 size={13} />
            <select value={range} onChange={(event) => setRange(event.target.value as RangeFilter)}>
              {RANGES.map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="memory-sort"
            onClick={() => setSort((value) => (value === "new" ? "old" : "new"))}
            title={sort === "new" ? t("Сначала новые") : t("Сначала старые")}
          >
            <ArrowDownUp size={13} />
            {sort === "new" ? t("Новые") : t("Старые")}
          </button>
        </div>
      </div>

      {error ? <p className="modal-error resource-error">{error}</p> : null}

      {!loading && data && data.total === 0 ? (
        <div className="empty-panel">
          <div className="empty-art">
            <Brain size={42} />
          </div>
          <h2 className="empty-title">
            {query.trim() ? t("В памяти проекта этого нет") : t("Память пока пуста")}
          </h2>
          <p className="empty-text">
            {query.trim()
              ? t("Попробуй другое слово или открой задачи и ассеты напрямую.")
              : t("Создай задачу или импортируй ассет — записи появятся здесь.")}
          </p>
        </div>
      ) : null}

      {data && data.total > 0 && visibleTotal === 0 ? (
        <div className="empty-panel">
          <div className="empty-art">
            <Search size={34} />
          </div>
          <h2 className="empty-title">{t("Ничего не попало в фильтр")}</h2>
          <p className="empty-text">{t("Сбрось тип или диапазон времени.")}</p>
        </div>
      ) : null}

      <div className="memory-sections">
        {GROUPS.map((group, index) => {
          const rows = filteredGroups[group.key] ?? [];
          if (rows.length === 0) return null;
          const Icon = group.icon;
          return (
            <section className="memory-section-card" key={group.key}>
              <div className="memory-section-head">
                <span className={`memory-section-icon is-${group.kind}`}>
                  <Icon size={15} />
                </span>
                <div>
                  <h2>{t(group.label)}</h2>
                  <small>
                    {rows.length}{" "}
                    {tp(rows.length, ["запись", "записи", "записей"], "record", "records")}{" "}
                    {t("в выборке")}
                  </small>
                </div>
                <b>{data?.groups[group.key]?.length ?? rows.length}</b>
              </div>
              <div className="memory-list">
                {rows.map((row) => {
                  const clickable = canOpen(row);
                  return (
                    <button
                      type="button"
                      className={`memory-row${clickable ? " is-link" : ""}`}
                      key={`${row.kind}-${row.id}`}
                      onClick={() => clickable && open(row)}
                      disabled={!clickable}
                    >
                      <span className="memory-row-dot" style={{ background: DONUT_COLORS[index] }} />
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
