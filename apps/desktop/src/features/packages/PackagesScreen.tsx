import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Box,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  Gamepad2,
  Globe2,
  Package,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
import {
  getPackageMarketplace,
  importPackage,
  installPackage,
  installRemotePackage,
  listLedger,
  listPackages,
  setPackageEnabled,
  uninstallPackage,
} from "../../lib/coreClient";
import { formatDate } from "../../lib/format";
import { pickFile } from "../../lib/dialogs";
import { ENGINE_LABELS } from "../../lib/labels";
import type {
  Engine,
  KovaPackage,
  LedgerEvent,
  PackageMarketplace,
  RemotePackage,
} from "../../lib/types";

type View = "installed" | "available" | "all" | "market";
type Sort = "status" | "name" | "tools" | "checks";
type Range = "day" | "week" | "month" | "year" | "all";

const TYPE_LABELS: Record<string, string> = {
  engine: "Движок",
  tool_adapter: "Инструмент",
  ai_provider: "AI-провайдер",
  check: "Проверки",
  task_template: "Шаблоны задач",
  importer_exporter: "Импорт/экспорт",
  ui_extension: "UI",
  mcp_bridge: "MCP",
  style: "Стиль",
  asset_pack: "Ассеты",
};

const PERMISSION_LABELS: Record<string, string> = {
  "project.read": "Чтение проекта",
  "project.write": "Запись в проект",
  "blender.run": "Запуск Blender",
  "engine.run": "Запуск движка",
  "cli.run": "Запуск CLI",
  network: "Сеть",
  clipboard: "Буфер обмена",
  notifications: "Уведомления",
  secrets: "Секреты",
  background: "Фон",
  ui: "UI",
};

const STATUS_LABELS: Record<KovaPackage["status"], string> = {
  installed: "Установлен",
  disabled: "Выключен",
  available: "Доступен",
  coming_soon: "Скоро",
};

const EVENT_LABELS: Record<string, string> = {
  "package.installed": "Установлен",
  "package.uninstalled": "Удалён",
  "package.enabled": "Включён",
  "package.disabled": "Выключен",
};

const INDEX_KEY = "kova.packageIndex";
const DEFAULT_INDEX_URL =
  "https://raw.githubusercontent.com/AlexeyKurgan/Kova/main/packages/index.json";

const RANGES: Array<[Range, string, number]> = [
  ["day", "24 часа", 86400_000],
  ["week", "7 дней", 7 * 86400_000],
  ["month", "30 дней", 30 * 86400_000],
  ["year", "Год", 365 * 86400_000],
  ["all", "Всё", 0],
];

const DONUT_COLORS = {
  installed: "#5cc8a1",
  available: "#6aa9ff",
  coming: "#d8a657",
};

function packageIcon(item: { type: string; id: string }) {
  if (item.type === "engine") return Gamepad2;
  if (item.type === "style") return Sparkles;
  if (item.type === "task_template") return Wrench;
  if (item.id === "kova-core") return ShieldCheck;
  return Package;
}

export default function PackagesScreen() {
  const [packages, setPackages] = useState<KovaPackage[]>([]);
  const [ledger, setLedger] = useState<LedgerEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState<View>("installed");
  const [engine, setEngine] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("status");
  const [range, setRange] = useState<Range>("all");
  const [eventsOpen, setEventsOpen] = useState(false);
  const [market, setMarket] = useState<PackageMarketplace | null>(null);
  const [marketUrl, setMarketUrl] = useState(
    () => window.localStorage.getItem(INDEX_KEY) ?? "",
  );
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState("");
  const [remoteBusy, setRemoteBusy] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, events] = await Promise.all([
        listPackages(),
        listLedger(300).catch(() => []),
      ]);
      setPackages(rows);
      setLedger(events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить пакеты");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 25000);
    return () => window.clearInterval(timer);
  }, []);

  const loadMarket = async (value: string) => {
    setMarketLoading(true);
    setMarketError("");
    try {
      const data = await getPackageMarketplace(value.trim());
      setMarket(data);
      if (!value.trim()) setMarketUrl(data.index_url);
    } catch (err) {
      setMarket(null);
      setMarketError(
        err instanceof Error ? err.message : "Не удалось загрузить индекс пакетов",
      );
    } finally {
      setMarketLoading(false);
    }
  };

  const openMarket = () => {
    setView("market");
    if (!market && !marketLoading) void loadMarket(marketUrl);
  };

  const applyIndex = () => {
    const value = marketUrl.trim();
    if (value) window.localStorage.setItem(INDEX_KEY, value);
    else window.localStorage.removeItem(INDEX_KEY);
    void loadMarket(value);
  };

  const installRemote = async (item: RemotePackage) => {
    if (remoteBusy) return;
    setRemoteBusy(item.id);
    setMarketError("");
    try {
      await installRemotePackage({
        packageId: item.id,
        url: item.download_url,
        sha256: item.sha256,
        version: item.version,
      });
      await refresh();
      await loadMarket(market?.index_url ?? marketUrl);
    } catch (err) {
      setMarketError(
        err instanceof Error ? err.message : "Не удалось установить пакет",
      );
    } finally {
      setRemoteBusy(null);
    }
  };

  const engines = useMemo(
    () => [...new Set(packages.flatMap((item) => item.engines))].sort(),
    [packages],
  );

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    const rows = packages.filter((item) => {
      if (view === "installed" && !item.installed) return false;
      if (view === "available" && item.installed) return false;
      if (engine !== "all" && !item.engines.includes(engine as Engine)) return false;
      if (!search) return true;
      return `${item.name} ${item.id} ${item.description} ${item.engines.join(" ")}`
        .toLowerCase()
        .includes(search);
    });
    return [...rows].sort((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name, "ru");
      if (sort === "tools") return right.tools.length - left.tools.length;
      if (sort === "checks") return right.checks.length - left.checks.length;
      const rank = (item: KovaPackage) =>
        item.status === "installed" ? 0 : item.status === "disabled" ? 1 : item.status === "available" ? 2 : 3;
      return rank(left) - rank(right) || left.name.localeCompare(right.name, "ru");
    });
  }, [engine, packages, query, sort, view]);

  const marketRows = useMemo(() => {
    if (!market) return [];
    const search = query.trim().toLowerCase();
    return market.packages.filter((item) => {
      if (engine !== "all" && !item.engines.includes(engine as Engine)) return false;
      if (!search) return true;
      return `${item.name} ${item.id} ${item.description} ${item.author} ${item.engines.join(" ")}`
        .toLowerCase()
        .includes(search);
    });
  }, [engine, market, query]);

  const installed = packages.filter((item) => item.installed);
  const available = packages.filter((item) => !item.installed && item.available);
  const coming = packages.filter((item) => !item.available);
  const updates = packages.filter((item) => item.update_available).length;
  const total = Math.max(1, packages.length);

  const donut = `conic-gradient(
    ${DONUT_COLORS.installed} 0 ${(installed.length / total) * 100}%,
    ${DONUT_COLORS.available} ${(installed.length / total) * 100}% ${((installed.length + available.length) / total) * 100}%,
    ${DONUT_COLORS.coming} ${((installed.length + available.length) / total) * 100}% 100%
  )`;

  const coverage = engines
    .map((value) => ({
      engine: value,
      count: installed.filter((item) => item.id !== "kova-core" && item.engines.includes(value)).length,
    }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);
  const coverageMax = Math.max(1, ...coverage.map((item) => item.count));

  const packageEvents = useMemo(() => {
    const limit = RANGES.find(([value]) => value === range)?.[2] ?? 0;
    const now = Date.now();
    return ledger
      .filter((event) => event.type.startsWith("package."))
      .filter((event) => {
        if (limit === 0) return true;
        const stamp = Date.parse(event.at);
        return !Number.isNaN(stamp) && now - stamp <= limit;
      })
      .slice(0, 40);
  }, [ledger, range]);

  const importFromFile = async () => {
    if (importing) return;
    setError("");
    const path = await pickFile("Пакет Kova (.zip)", ["zip"]);
    if (!path) return;
    setImporting(true);
    try {
      await importPackage(path);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось импортировать пакет");
    } finally {
      setImporting(false);
    }
  };

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Действие не выполнено");
    } finally {
      setBusy(null);
    }
  };

  const sections: Array<[string, KovaPackage[]]> =
    view === "all"
      ? [
          ["Установленные", installed.filter((item) => filtered.includes(item))],
          ["Доступные", available.filter((item) => filtered.includes(item))],
          ["Скоро", coming.filter((item) => filtered.includes(item))],
        ]
      : [[view === "installed" ? "Установленные" : "Доступные", filtered]];

  return (
    <section className="packages-screen pkg-v2">
      <div className="pkg-hero">
        <div className="pkg-hero-copy">
          <span className="pkg-kicker">
            <Package size={13} />
            Пакеты проекта
          </span>
          <h1>Инструменты под твой пайплайн</h1>
          <p>
            Blender, Roblox и ядро уже включены. Остальные движки и расширения
            подключай по мере роста проекта — без лишних экранов.
          </p>
          <div className="pkg-hero-pills">
            <span>{installed.length} установлено</span>
            <span>{available.length} доступно</span>
            <span>{coming.length} скоро</span>
            <span>{updates} обновлений</span>
          </div>
        </div>
        <div className="pkg-hero-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={importing}
            onClick={() => void importFromFile()}
          >
            <Upload size={15} />
            {importing ? "Импорт…" : "Импорт пакета"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void refresh()}>
            <RefreshCw size={15} />
            Проверить обновления
          </button>
        </div>
      </div>

      <div className="pkg-analytics">
        <article className="pkg-analytics-card pkg-donut-card">
          <div className="pkg-card-kicker">Состав пакетов</div>
          <div className="pkg-donut-row">
            <div className="pkg-donut" style={{ background: donut }}>
              <div>
                <b>{packages.length}</b>
                <small>пакетов</small>
              </div>
            </div>
            <div className="pkg-donut-legend">
              <span><i style={{ background: DONUT_COLORS.installed }} />Установлено <b>{installed.length}</b></span>
              <span><i style={{ background: DONUT_COLORS.available }} />Доступно <b>{available.length}</b></span>
              <span><i style={{ background: DONUT_COLORS.coming }} />Скоро <b>{coming.length}</b></span>
            </div>
          </div>
        </article>

        <article className="pkg-analytics-card">
          <div className="pkg-card-kicker">
            <Gamepad2 size={12} />
            Покрытие движков
          </div>
          <div className="pkg-coverage">
            {coverage.length === 0 ? (
              <p className="pkg-empty-inline">Пока нет установленных engine-пакетов.</p>
            ) : (
              coverage.map((item) => (
                <div className="pkg-coverage-row" key={item.engine}>
                  <span>{ENGINE_LABELS[item.engine] ?? item.engine}</span>
                  <div>
                    <i style={{ width: `${(item.count / coverageMax) * 100}%` }} />
                  </div>
                  <b>{item.count}</b>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="pkg-analytics-card">
          <div className="pkg-card-kicker">
            <Activity size={12} />
            Активность пакетов
          </div>
          <div className="pkg-activity-summary">
            <b>{packageEvents.length}</b>
            <span>событий за период</span>
          </div>
          <div className="pkg-range-chips">
            {RANGES.map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={range === value ? "is-active" : ""}
                onClick={() => setRange(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="agent-link pkg-events-link" onClick={() => setEventsOpen((value) => !value)}>
            {eventsOpen ? "Скрыть журнал" : "Открыть журнал"}
          </button>
        </article>
      </div>

      <div className="pkg-toolbar pkg-toolbar-v2">
        <div className="pkg-tabs">
          {(
            [
              ["installed", "Установленные"],
              ["available", "Доступные"],
              ["all", "Все"],
              ["market", "Маркетплейс"],
            ] as Array<[View, string]>
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={`pkg-tab${view === value ? " is-active" : ""}`}
              onClick={() => (value === "market" ? openMarket() : setView(value))}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="pkg-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти пакет…"
          />
        </label>
        <select
          className="filter-select"
          value={engine}
          onChange={(event) => setEngine(event.target.value)}
          aria-label="Движок пакета"
        >
          <option value="all">Все движки</option>
          {engines.map((value) => (
            <option key={value} value={value}>
              {ENGINE_LABELS[value as Engine] ?? value}
            </option>
          ))}
        </select>
        {view !== "market" ? (
          <select
            className="filter-select"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            aria-label="Сортировка пакетов"
          >
            <option value="status">По статусу</option>
            <option value="name">По имени</option>
            <option value="tools">По инструментам</option>
            <option value="checks">По проверкам</option>
          </select>
        ) : null}
      </div>

      {error ? <p className="modal-error resource-error">{error}</p> : null}
      {loading && packages.length === 0 ? <p className="pkg-loading">Загружаю пакеты…</p> : null}

      {eventsOpen ? (
        <div className="pkg-events">
          <div className="pkg-events-head">
            <span>Журнал пакетов</span>
            <b>{packageEvents.length}</b>
          </div>
          {packageEvents.length === 0 ? (
            <p className="pkg-empty-inline">Пока нет действий с пакетами за этот период.</p>
          ) : (
            <div className="pkg-events-list">
              {packageEvents.map((event) => (
                <div className="pkg-event-row" key={event.id}>
                  <span className="pkg-event-dot" />
                  <div>
                    <b>{String((event.data as { name?: string }).name || event.subject)}</b>
                    <small>{EVENT_LABELS[event.type] ?? event.type}</small>
                  </div>
                  <span>{formatDate(event.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {view === "market" ? (
        <section className="pkg-section pkg-market">
          <div className="pkg-section-head">
            <div>
              <h2>
                <Store size={13} /> Маркетплейс
              </h2>
              <small>
                {market
                  ? `${market.name} · ${marketRows.length} из ${market.packages.length} пакетов`
                  : "Индекс сообщества по HTTPS"}
              </small>
            </div>
            <span>{market?.packages.length ?? 0}</span>
          </div>

          <div className="pkg-market-bar">
            <label>
              <Globe2 size={13} />
              <input
                value={marketUrl}
                placeholder={DEFAULT_INDEX_URL}
                onChange={(event) => setMarketUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyIndex();
                }}
                aria-label="Адрес индекса пакетов"
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={marketLoading}
              onClick={applyIndex}
            >
              <RefreshCw size={13} />
              {marketLoading ? "Загрузка…" : "Обновить индекс"}
            </button>
          </div>

          <p className="pkg-market-note">
            Пакеты скачиваются только по HTTPS и проверяются по SHA256. Код
            пакетов не исполняется: манифест проходит ту же проверку, что и
            локальный импорт.
          </p>

          {marketError ? (
            <p className="modal-error resource-error">{marketError}</p>
          ) : null}
          {marketLoading && !market ? (
            <p className="pkg-loading">Загружаю индекс…</p>
          ) : null}
          {market && marketRows.length === 0 ? (
            <p className="pkg-empty-inline">В индексе пока нет подходящих пакетов.</p>
          ) : null}

          {marketRows.length > 0 ? (
            <div className="pkg-grid">
              {marketRows.map((item) => {
                const Icon = packageIcon(item);
                return (
                  <article className={`pkg-card is-${item.status}`} key={item.id}>
                    <div className="pkg-card-head">
                      <span className="pkg-icon">
                        <Icon size={20} />
                      </span>
                      <div className="pkg-title">
                        <b>{item.name}</b>
                        <small>
                          {TYPE_LABELS[item.type] ?? item.type} · {item.author} ·{" "}
                          {item.version}
                        </small>
                      </div>
                      <span className="pkg-trust">
                        <Globe2 size={10} />
                        {item.builtin ? "встроенный" : "внешний"}
                      </span>
                    </div>

                    <p className="pkg-description">{item.description}</p>

                    <div className="pkg-engines">
                      {item.engines.slice(0, 6).map((value) => (
                        <span key={value}>{ENGINE_LABELS[value] ?? value}</span>
                      ))}
                    </div>

                    <div className="pkg-permissions">
                      {item.permissions.slice(0, 5).map((value) => (
                        <span key={value}>{PERMISSION_LABELS[value] ?? value}</span>
                      ))}
                    </div>

                    <div className="pkg-metrics">
                      <span>
                        <Wrench size={11} /> {item.tools.length} инструментов
                      </span>
                      <span>
                        <ShieldCheck size={11} /> {item.checks.length} проверок
                      </span>
                      <span>
                        <Box size={11} /> {item.templates.length} шаблонов
                      </span>
                    </div>

                    <div className="pkg-market-meta">
                      <span>SHA256 проверен</span>
                      {item.size ? (
                        <span>{(item.size / 1024).toFixed(1)} КБ</span>
                      ) : null}
                      {item.homepage ? (
                        <a href={item.homepage} target="_blank" rel="noreferrer">
                          <ExternalLink size={11} /> страница
                        </a>
                      ) : null}
                    </div>

                    <div className="pkg-actions">
                      {item.builtin ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          disabled
                        >
                          <CheckCircle2 size={13} />
                          Уже в Kova
                        </button>
                      ) : item.installed && !item.update_available ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          disabled
                        >
                          <CheckCircle2 size={13} />
                          Установлен {item.installed_version}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          disabled={remoteBusy !== null}
                          onClick={() => void installRemote(item)}
                        >
                          <Download size={13} />
                          {remoteBusy === item.id
                            ? "Установка…"
                            : item.update_available
                              ? `Обновить до ${item.version}`
                              : "Установить"}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {view !== "market" ? sections.map(([title, rows]) => (
        <section className="pkg-section" key={String(title)}>
          <div className="pkg-section-head">
            <div>
              <h2>{title}</h2>
              <small>
                {rows.length} {rows.length === 1 ? "пакет" : "пакетов"}
              </small>
            </div>
            <span>{rows.length}</span>
          </div>
          {rows.length === 0 ? (
            <p className="pkg-empty-inline">Здесь пока пусто.</p>
          ) : (
            <div className="pkg-grid">
              {rows.map((item) => {
                const Icon = packageIcon(item);
                const coming = item.status === "coming_soon";
                const installedItem = item.installed;
                return (
                  <article className={`pkg-card is-${item.status}`} key={item.id}>
                    <div className="pkg-card-head">
                      <span className="pkg-icon">
                        <Icon size={20} />
                      </span>
                      <div className="pkg-title">
                        <b>{item.name}</b>
                        <small>
                          {TYPE_LABELS[item.type] ?? item.type} · {item.author || "Kova"} · {item.version}
                        </small>
                      </div>
                      <span className={`pkg-status is-${item.status}`}>
                        {item.status === "installed" ? <CheckCircle2 size={11} /> : null}
                        {item.status === "coming_soon" ? <Clock3 size={11} /> : null}
                        {STATUS_LABELS[item.status]}
                      </span>
                    </div>

                    <p className="pkg-description">{item.description}</p>

                    <div className="pkg-engines">
                      {item.engines.slice(0, 6).map((value) => (
                        <span key={value}>{ENGINE_LABELS[value] ?? value}</span>
                      ))}
                    </div>

                    <div className="pkg-permissions">
                      {item.permissions.slice(0, 5).map((value) => (
                        <span key={value}>{PERMISSION_LABELS[value] ?? value}</span>
                      ))}
                    </div>

                    <div className="pkg-metrics">
                      <span><Wrench size={11} /> {item.tools.length} инструментов</span>
                      <span><ShieldCheck size={11} /> {item.checks.length} проверок</span>
                      <span><Box size={11} /> {item.templates.length} шаблонов</span>
                    </div>

                    {item.engine_info ? (
                      <div
                        className={`pkg-engine-state${
                          item.engine_info.installed && item.engine_info.project_detected
                            ? " is-ready"
                            : item.engine_info.installed
                              ? " is-partial"
                              : ""
                        }`}
                        title={item.engine_info.message}
                      >
                        <i />
                        <b>
                          {item.engine_info.installed
                            ? item.engine_info.version || "Движок найден"
                            : "Движок не найден"}
                        </b>
                        <small>
                          {item.engine_info.project_detected
                            ? "проект найден"
                            : "проект не найден"}
                        </small>
                      </div>
                    ) : null}

                    <div className="pkg-actions">
                      {coming ? (
                        <button type="button" className="btn btn-secondary btn-small" disabled>
                          <Clock3 size={13} />
                          Скоро
                        </button>
                      ) : !installedItem ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          disabled={busy === item.id}
                          onClick={() => void run(item.id, () => installPackage(item.id))}
                        >
                          <Download size={13} />
                          {busy === item.id ? "Установка…" : "Установить"}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            disabled={busy === item.id}
                            onClick={() => void run(item.id, () => setPackageEnabled(item.id, !item.enabled))}
                          >
                            <Power size={13} />
                            {item.enabled ? "Выключить" : "Включить"}
                          </button>
                          {item.id !== "kova-core" ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-small"
                              disabled={busy === item.id}
                              onClick={() => void run(item.id, () => uninstallPackage(item.id))}
                            >
                              <Trash2 size={13} />
                              Удалить
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )) : null}
    </section>
  );
}
