import { useEffect, useMemo, useState } from "react";
import {
  Box,
  CheckCircle2,
  Clock3,
  Download,
  Gamepad2,
  Package,
  Power,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  installPackage,
  listPackages,
  setPackageEnabled,
  uninstallPackage,
} from "../../lib/coreClient";
import type { Engine, KovaPackage } from "../../lib/types";
import { ENGINE_LABELS } from "../../lib/labels";

type View = "installed" | "available" | "all";

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

function packageIcon(item: KovaPackage) {
  if (item.type === "engine") return Gamepad2;
  if (item.type === "style") return Sparkles;
  if (item.type === "task_template") return Wrench;
  if (item.id === "kova-core") return ShieldCheck;
  return Package;
}

export default function PackagesScreen() {
  const [packages, setPackages] = useState<KovaPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<View>("installed");
  const [engine, setEngine] = useState("all");

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setPackages(await listPackages());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить пакеты");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20000);
    return () => window.clearInterval(timer);
  }, []);

  const engines = useMemo(
    () => [...new Set(packages.flatMap((item) => item.engines))].sort(),
    [packages],
  );

  const filtered = useMemo(() => {
    return packages.filter((item) => {
      if (view === "installed" && !item.installed) return false;
      if (view === "available" && item.installed) return false;
      if (engine !== "all" && !item.engines.includes(engine as Engine)) return false;
      return true;
    });
  }, [engine, packages, view]);

  const installedCount = packages.filter((item) => item.installed).length;
  const availableCount = packages.filter((item) => !item.installed).length;
  const updates = packages.filter((item) => item.update_available).length;

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

  return (
    <section className="packages-screen">
      <div className="assets-heading">
        <Package size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>Пакеты</h1>
          <p className="subtitle">
            Наборы инструментов, проверок и правил для движков. Устанавливай только то,
            что нужно проекту.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void refresh()}>
            <RefreshCw size={15} />
            Проверить обновления
          </button>
        </div>
      </div>

      <div className="pkg-summary">
        <div className="pkg-summary-card">
          <span>Установлено</span>
          <b>{installedCount}</b>
        </div>
        <div className="pkg-summary-card">
          <span>Доступно</span>
          <b>{availableCount}</b>
        </div>
        <div className="pkg-summary-card">
          <span>Обновления</span>
          <b>{updates}</b>
        </div>
      </div>

      <div className="resource-toolbar pkg-toolbar">
        <div className="pkg-tabs">
          {(
            [
              ["installed", "Установленные"],
              ["available", "Доступные"],
              ["all", "Все"],
            ] as Array<[View, string]>
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={`pkg-tab${view === value ? " is-active" : ""}`}
              onClick={() => setView(value)}
            >
              {label}
            </button>
          ))}
        </div>
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
      </div>

      {error ? <p className="modal-error resource-error">{error}</p> : null}
      {loading && packages.length === 0 ? (
        <p className="pkg-loading">Загружаю пакеты…</p>
      ) : null}

      {filtered.length === 0 && !loading ? (
        <div className="empty-panel">
          <div className="empty-art">
            <Package size={42} />
          </div>
          <h2 className="empty-title">Здесь пока пусто</h2>
          <p className="empty-text">
            {view === "installed"
              ? "Установи пакет из вкладки «Доступные»."
              : "Все доступные пакеты уже установлены."}
          </p>
        </div>
      ) : null}

      <div className="pkg-grid">
        {filtered.map((item) => {
          const Icon = packageIcon(item);
          const coming = item.status === "coming_soon";
          const installed = item.installed;
          return (
            <article className={`pkg-card is-${item.status}`} key={item.id}>
              <div className="pkg-card-head">
                <span className="pkg-icon">
                  <Icon size={20} />
                </span>
                <div className="pkg-title">
                  <b>{item.name}</b>
                  <small>
                    {TYPE_LABELS[item.type] ?? item.type} · {item.author || "Kova"} ·{" "}
                    {item.version}
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

              <div className="pkg-actions">
                {coming ? (
                  <button type="button" className="btn btn-secondary btn-small" disabled>
                    <Clock3 size={13} />
                    Скоро
                  </button>
                ) : !installed ? (
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
                      onClick={() =>
                        void run(item.id, () => setPackageEnabled(item.id, !item.enabled))
                      }
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
    </section>
  );
}
