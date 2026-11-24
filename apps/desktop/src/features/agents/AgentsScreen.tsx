import { useEffect, useState } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import BrandIcon from "../../components/BrandIcon";
import { providerBrand } from "../../lib/brands";
import type { ProviderInfo } from "../../lib/types";

type Props = {
  providers: ProviderInfo[];
  onRefresh: () => void;
  onSave: (
    providerId: string,
    input: {
      name?: string;
      description?: string;
      command?: string;
      args?: string[];
      enabled?: boolean;
      timeout?: number;
      set_default?: boolean;
    },
  ) => Promise<void>;
  onCreate: (input: {
    name: string;
    command: string;
    args?: string[];
    description?: string;
    timeout?: number;
    set_default?: boolean;
  }) => Promise<void>;
  onCheck: (providerId: string) => Promise<void>;
  onSetDefault: (providerId: string) => Promise<void>;
  onDelete: (providerId: string) => Promise<void>;
};

type Dialog =
  | { kind: "edit"; provider: ProviderInfo }
  | { kind: "create" }
  | null;

function parseArgs(text: string) {
  const matches = text.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((item) => item.replace(/^"|"$/g, ""));
}

function statusLabel(provider: ProviderInfo) {
  if (!provider.installed) return "CLI не найден";
  return provider.version || "Установлен";
}

export default function AgentsScreen({
  providers,
  onRefresh,
  onSave,
  onCreate,
  onCheck,
  onSetDefault,
  onDelete,
}: Props) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [description, setDescription] = useState("");
  const [timeout, setTimeoutValue] = useState(1800);
  const [enabled, setEnabled] = useState(true);
  const [setDefault, setSetDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setDialog(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, busy]);

  const openEdit = (provider: ProviderInfo) => {
    setName(provider.name);
    setCommand(provider.command);
    setArgs(provider.args.join(" "));
    setDescription(provider.description);
    setTimeoutValue(provider.timeout);
    setEnabled(provider.enabled);
    setSetDefault(provider.default);
    setError(null);
    setDialog({ kind: "edit", provider });
  };

  const openCreate = () => {
    setName("");
    setCommand("");
    setArgs("{prompt}");
    setDescription("");
    setTimeoutValue(1800);
    setEnabled(true);
    setSetDefault(false);
    setError(null);
    setDialog({ kind: "create" });
  };

  const submit = async () => {
    if (!dialog || busy || !name.trim() || !command.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = parseArgs(args);
      if (dialog.kind === "edit") {
        await onSave(dialog.provider.id, {
          name: name.trim(),
          description: description.trim(),
          command: command.trim(),
          args: parsed,
          enabled,
          timeout,
          set_default: setDefault,
        });
      } else {
        await onCreate({
          name: name.trim(),
          description: description.trim(),
          command: command.trim(),
          args: parsed,
          timeout,
          set_default: setDefault,
        });
      }
      setDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить провайдера");
    } finally {
      setBusy(false);
    }
  };

  const installedCount = providers.filter((provider) => provider.installed && provider.enabled).length;

  return (
    <section className="assets-screen agents-screen">
      <div className="assets-heading">
        <Bot size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>Агенты и AI</h1>
          <p className="subtitle">
            Kova запускает установленные CLI-агенты в папке проекта. Ключи и логин остаются в
            самих инструментах — Kova их не хранит.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={15} />
            Свой CLI
          </button>
          <button type="button" className="btn btn-secondary" onClick={onRefresh}>
            <RefreshCw size={14} />
            Обновить
          </button>
        </div>
      </div>

      <div className="agents-summary">
        <span className="agents-summary-dot" />
        {installedCount > 0
          ? `Готовы к запуску: ${installedCount}`
          : "Пока не найден ни один CLI-агент"}
        <span className="agents-summary-note">
          Установка и логин — через сам CLI, например <code>claude</code>, <code>codex</code>,{" "}
          <code>gemini</code>.
        </span>
      </div>

      {error && !dialog ? <p className="modal-error">{error}</p> : null}

      <div className="agents-grid">
        {providers.map((provider) => {
          const brand = providerBrand(provider.id);
          return (
            <article
              className={`agent-card${provider.default ? " is-default" : ""}${
                !provider.installed ? " is-missing" : ""
              }`}
              key={provider.id}
            >
              <div className="agent-card-head">
                <span className={`agent-glyph is-${provider.id}`}>
                  {brand ? (
                    <BrandIcon name={brand} size={22} />
                  ) : (
                    <Bot size={20} strokeWidth={1.7} />
                  )}
                </span>
                <div className="agent-title">
                  <h2>{provider.name}</h2>
                  <span className="agent-meta">
                    {provider.builtin ? "Встроенный пресет" : "Свой CLI"} ·{" "}
                    {provider.installed ? "найден" : "не найден"}
                  </span>
                </div>
                {provider.default ? <span className="agent-default">Основной</span> : null}
              </div>

              <p className="agent-desc">{provider.description || "CLI-агент в папке проекта."}</p>

              <div className="agent-status">
                <span className={`dot ${provider.installed ? "is-on" : "is-off"}`} />
                <span>{statusLabel(provider)}</span>
                {provider.installed && provider.path ? (
                  <code title={provider.path}>{provider.path}</code>
                ) : null}
              </div>

              <div className="agent-command">
                <code>
                  {provider.command} {provider.args.join(" ")}
                </code>
              </div>

              <div className="agent-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => {
                    void onCheck(provider.id).catch((err) => {
                      setError(err instanceof Error ? err.message : "Проверка не удалась");
                    });
                  }}
                >
                  <Play size={13} />
                  Проверить
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => openEdit(provider)}
                >
                  Настроить
                </button>
                <span className="modal-footer-spacer" />
                {!provider.default && provider.installed ? (
                  <button
                    type="button"
                    className="agent-default-btn"
                    onClick={() => {
                      void onSetDefault(provider.id).catch((err) => {
                        setError(err instanceof Error ? err.message : "Не удалось выбрать");
                      });
                    }}
                  >
                    <Check size={13} />
                    Сделать основным
                  </button>
                ) : null}
                {!provider.builtin ? (
                  <button
                    type="button"
                    className="icon-btn is-danger"
                    title="Удалить провайдера"
                    aria-label="Удалить провайдера"
                    onClick={() => {
                      if (window.confirm(`Удалить провайдера «${provider.name}»?`)) {
                        void onDelete(provider.id).catch((err) => {
                          setError(err instanceof Error ? err.message : "Не удалось удалить");
                        });
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
                {!provider.installed ? (
                  <span className="agent-hint">укажи полный путь в настройках</span>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <div className="agents-note">
        <ChevronRight size={14} />
        Kova не подставляет ключи и не обходит логин. Если CLI не установлен — установи его
        в системе и нажми «Обновить». Для моделей с API-ключом добавь свой CLI-обёртку или
        используй OpenCode/Codex с настроенным провайдером.
      </div>

      {dialog ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setDialog(null);
          }}
        >
          <div className="modal agent-dialog">
            <div className="modal-header">
              <span className="modal-title">
                {dialog.kind === "edit" ? "Настроить агента" : "Свой CLI-агент"}
              </span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => !busy && setDialog(null)}
                aria-label="Закрыть"
              >
                <X size={14} />
              </button>
            </div>

            <div className="modal-body">
              <div className="field">
                <label htmlFor="agent-name">Название</label>
                <input
                  id="agent-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Например: DeepSeek CLI"
                />
              </div>
              <div className="field">
                <label htmlFor="agent-command">Команда</label>
                <input
                  id="agent-command"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="codex или полный путь к .exe/.cmd"
                />
              </div>
              <div className="field">
                <label htmlFor="agent-args">Аргументы</label>
                <input
                  id="agent-args"
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  placeholder={'exec --sandbox workspace-write "{prompt}"'}
                />
                <span className="field-hint">
                  {"{prompt}"} заменяется на текст задачи. Если плейсхолдера нет, промпт
                  добавится в конец.
                </span>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="agent-timeout">Лимит, сек</label>
                  <input
                    id="agent-timeout"
                    type="number"
                    min={60}
                    max={7200}
                    value={timeout}
                    onChange={(event) => setTimeoutValue(Number(event.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="agent-desc">Описание</label>
                  <input
                    id="agent-desc"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Для чего этот CLI"
                  />
                </div>
              </div>
              <label className="agent-check">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                Включён
              </label>
              <label className="agent-check">
                <input
                  type="checkbox"
                  checked={setDefault}
                  onChange={(event) => setSetDefault(event.target.checked)}
                />
                Сделать основным
              </label>
              {error ? <p className="modal-error">{error}</p> : null}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                Отмена
              </button>
              <span className="modal-footer-spacer" />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !name.trim() || !command.trim()}
                onClick={() => void submit()}
              >
                {busy ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
