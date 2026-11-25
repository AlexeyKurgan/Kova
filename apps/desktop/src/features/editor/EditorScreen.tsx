import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Code2,
  Download,
  FolderOpen,
  Play,
  Search,
  Square,
} from "lucide-react";
import {
  EDITOR_EXTENSIONS,
  EXTENSION_CATEGORIES,
  EXTENSION_PACKS,
} from "../../lib/editorExtensions";
import type { EditorExtension, EditorPack } from "../../lib/editorExtensions";
import { EXTENSION_ICONS } from "../../lib/editorIcons";

type Props = {
  projectPath: string | null;
};

type EditorStatus = {
  installed: boolean;
  running: boolean;
  installing: boolean;
  url: string | null;
  version: string;
  extensions: string[];
};

type Tab = "extensions" | "packs";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

function editorStatusText(
  status: EditorStatus | null,
): { label: string; tone: string } {
  if (status?.running) return { label: "Редактор запущен", tone: "is-on" };
  if (status?.installed) return { label: "Редактор установлен", tone: "is-ready" };
  return { label: "Редактор не установлен", tone: "is-off" };
}

export default function EditorScreen({ projectPath }: Props) {
  const [status, setStatus] = useState<EditorStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [tab, setTab] = useState<Tab>("extensions");
  const desktop = inTauri();

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      setStatus(await invoke<EditorStatus>("editor_status"));
    } catch {
      setStatus(null);
    }
  }, [desktop]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh, desktop]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  const isInstalled = (id: string) =>
    (status?.extensions ?? []).some((folder) =>
      folder.toLowerCase().startsWith(id.toLowerCase()),
    );

  const changeExtensions = async (
    key: string,
    action: "install" | "uninstall",
    ids: string[],
  ) => {
    if (!desktop) {
      setError("Доступно в десктоп-приложении");
      return;
    }
    setBusyKey(key);
    setError(null);
    try {
      await invoke(
        action === "install"
          ? "editor_install_extensions"
          : "editor_uninstall_extensions",
        { ids },
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusyKey(null);
  };

  const packInstalled = (pack: EditorPack) =>
    pack.extensions.every((extension) => isInstalled(extension.id));

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return EDITOR_EXTENSIONS.filter((extension) => {
      if (category !== "all" && extension.category !== category) return false;
      if (!text) return true;
      return (
        extension.name.toLowerCase().includes(text) ||
        extension.description.toLowerCase().includes(text) ||
        extension.publisher.toLowerCase().includes(text) ||
        extension.id.toLowerCase().includes(text)
      );
    });
  }, [query, category]);

  const state = editorStatusText(status);

  return (
    <section className="assets-screen editor-screen">
      <div className="assets-heading">
        <Code2 size={38} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <div className="editor-title-line">
            <h1>Редактор</h1>
            <span
              className={`editor-status-dot ${state.tone}`}
              title={state.label}
              aria-label={state.label}
            />
          </div>
          <p className="subtitle">
            Kova Editor с задачами и чатом — проект открывается сразу.
          </p>
        </div>
        <div className="header-actions">
          {desktop && !status?.installed ? (
            <button
              type="button"
              className="icon-btn action-btn is-install"
              disabled={busy || status?.installing}
              title={status?.installing ? "Скачивание…" : "Скачать редактор"}
              aria-label="Скачать редактор"
              onClick={() =>
                void run(async () => {
                  await invoke("editor_install");
                })
              }
            >
              <Download size={15} />
            </button>
          ) : null}
          {desktop && status?.installed ? (
            <button
              type="button"
              className="icon-btn action-btn is-play"
              disabled={busy || !projectPath}
              title={status?.running ? "Открыть окно редактора" : "Запустить редактор"}
              aria-label={status?.running ? "Открыть окно редактора" : "Запустить редактор"}
              onClick={() =>
                void run(async () => {
                  await invoke("editor_open", { projectPath: projectPath ?? "" });
                })
              }
            >
              <Play size={17} fill="currentColor" strokeWidth={0} />
            </button>
          ) : null}
          {desktop && status?.running ? (
            <button
              type="button"
              className="icon-btn action-btn is-danger"
              disabled={busy}
              title="Остановить редактор"
              aria-label="Остановить редактор"
              onClick={() =>
                void run(async () => {
                  await invoke("editor_close");
                })
              }
            >
              <Square size={15} fill="currentColor" strokeWidth={0} />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn action-btn"
            disabled={!desktop || busy || !projectPath}
            title="Открыть папку проекта"
            aria-label="Открыть папку проекта"
            onClick={() =>
              void run(async () => {
                await invoke("open_project_folder", { path: projectPath ?? "" });
              })
            }
          >
            <FolderOpen size={16} />
          </button>
        </div>
      </div>

      {error ? <p className="modal-error">{error}</p> : null}

      <div className="ext-controls">
        <div className="editor-tabs">
          <button
            type="button"
            className={tab === "extensions" ? "editor-tab is-active" : "editor-tab"}
            onClick={() => setTab("extensions")}
          >
            Расширения
            <span>{EDITOR_EXTENSIONS.length}</span>
          </button>
          <button
            type="button"
            className={tab === "packs" ? "editor-tab is-active" : "editor-tab"}
            onClick={() => setTab("packs")}
          >
            Наборы
            <span>{EXTENSION_PACKS.length}</span>
          </button>
        </div>

        {tab === "extensions" ? (
          <div className="ext-toolbar">
            <label className="ext-search">
              <Search size={14} strokeWidth={1.8} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по названию, описанию, издателю"
                aria-label="Поиск расширений"
              />
            </label>
            <select
              className="ext-select"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              aria-label="Категория"
            >
              <option value="all">Все категории</option>
              {EXTENSION_CATEGORIES.filter((item) => item.id !== "all").map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {tab === "extensions" ? (
        <>
          <div className="ext-grid">
            {filtered.map((extension) => (
              <ExtensionCard
                key={extension.id}
                extension={extension}
                installed={isInstalled(extension.id)}
                busy={busyKey === extension.id}
                disabled={!desktop || !status?.installed || busyKey !== null}
                onInstall={() =>
                  void changeExtensions(extension.id, "install", [extension.id])
                }
                onRemove={() =>
                  void changeExtensions(extension.id, "uninstall", [extension.id])
                }
              />
            ))}
            {filtered.length === 0 ? (
              <p className="ext-empty">Ничего не найдено</p>
            ) : null}
          </div>
        </>
      ) : (
        <div className="pack-grid">
          {EXTENSION_PACKS.map((pack) => {
            const installed = packInstalled(pack);
            const ids = pack.extensions.map((extension) => extension.id);
            return (
              <article className="pack-card" key={pack.id}>
                <div className="pack-card-head">
                  <span className="pack-label">{pack.label}</span>
                  <span className="pack-count">{pack.extensions.length}</span>
                </div>
                <ul className="pack-ext-list">
                  {pack.extensions.map((extension) => (
                    <li key={extension.id}>{extension.name}</li>
                  ))}
                </ul>
                {installed ? (
                  <button
                    type="button"
                    className="ext-action is-remove"
                    disabled={!desktop || busyKey !== null}
                    onClick={() => void changeExtensions(`pack-${pack.id}`, "uninstall", ids)}
                  >
                    Удалить набор
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ext-action"
                    disabled={!desktop || !status?.installed || busyKey !== null}
                    onClick={() => void changeExtensions(`pack-${pack.id}`, "install", ids)}
                  >
                    {busyKey === `pack-${pack.id}` ? "Установка…" : "Установить набор"}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

type CardProps = {
  extension: EditorExtension;
  installed: boolean;
  busy: boolean;
  disabled: boolean;
  onInstall: () => void;
  onRemove: () => void;
};

function ExtensionCard({
  extension,
  installed,
  busy,
  disabled,
  onInstall,
  onRemove,
}: CardProps) {
  const icon = EXTENSION_ICONS[extension.id];
  return (
    <article className="ext-card">
      <div className="ext-card-head">
        {icon ? (
          <img className="ext-logo" src={icon} alt="" loading="lazy" />
        ) : (
          <span
            className="ext-logo is-fallback"
            style={{
              color: extension.color,
              borderColor: `${extension.color}55`,
              background: `${extension.color}18`,
            }}
          >
            {extension.badge}
          </span>
        )}
        <div className="ext-card-title">
          <span className="ext-name" title={extension.name}>
            {extension.name}
          </span>
          <span className="ext-publisher">{extension.publisher}</span>
        </div>
      </div>
      <p className="ext-desc">{extension.description}</p>
      <div className="ext-card-foot">
        {installed ? (
          <button
            type="button"
            className="ext-action is-remove"
            disabled={disabled || busy}
            onClick={onRemove}
          >
            {busy ? "Удаление…" : "Удалить"}
          </button>
        ) : (
          <button
            type="button"
            className="ext-action"
            disabled={disabled || busy}
            onClick={onInstall}
          >
            {busy ? "Установка…" : "Установить"}
          </button>
        )}
      </div>
    </article>
  );
}
