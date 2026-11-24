import { useEffect, useState } from "react";
import {
  Bot,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import BrandIcon from "../../components/BrandIcon";
import { providerBrand } from "../../lib/brands";
import { listRecentAiRuns } from "../../lib/coreClient";
import { formatDate } from "../../lib/format";
import type { AiRun, AiRunStatus, ProviderInfo } from "../../lib/types";

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
  onOpenTask: (taskId: string) => void;
};

type Dialog =
  | { kind: "edit"; provider: ProviderInfo }
  | { kind: "create" }
  | null;

const RUN_LABELS: Record<AiRunStatus, string> = {
  queued: "В очереди",
  running: "Работает",
  succeeded: "Готово",
  failed: "Ошибка",
  cancelled: "Отменено",
  interrupted: "Прервано",
};

const RUN_DOT: Record<AiRunStatus, string> = {
  queued: "is-queued",
  running: "is-running",
  succeeded: "is-succeeded",
  failed: "is-failed",
  cancelled: "is-cancelled",
  interrupted: "is-interrupted",
};

function parseArgs(text: string) {
  const matches = text.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((item) => item.replace(/^"|"$/g, ""));
}

function providerState(provider: ProviderInfo) {
  if (!provider.installed) return { label: "не найден", dot: "is-off" };
  if (!provider.enabled) return { label: "выключен", dot: "is-warn" };
  return { label: "готов", dot: "is-on" };
}

function commandLine(provider: ProviderInfo) {
  return [provider.command, ...provider.args].filter(Boolean).join(" ");
}

export default function AgentsScreen({
  providers,
  onRefresh,
  onSave,
  onCreate,
  onCheck,
  onSetDefault,
  onDelete,
  onOpenTask,
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
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<AiRun[]>([]);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!dialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setDialog(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, busy]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      listRecentAiRuns(8)
        .then((rows) => {
          if (!alive) return;
          setRuns(rows);
          setRunsError(null);
        })
        .catch(() => {
          if (!alive) return;
          setRunsError("История запусков недоступна");
        });
    };
    void load();
    const timer = window.setInterval(load, 10000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refreshKey]);

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

  const check = async (provider: ProviderInfo) => {
    setCheckingId(provider.id);
    setError(null);
    try {
      await onCheck(provider.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Проверка не удалась");
    } finally {
      setCheckingId(null);
    }
  };

  const makeDefault = async (provider: ProviderInfo) => {
    setError(null);
    try {
      await onSetDefault(provider.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выбрать основного");
    }
  };

  const remove = async (provider: ProviderInfo) => {
    if (!window.confirm(`Удалить провайдера «${provider.name}»?`)) return;
    setError(null);
    try {
      await onDelete(provider.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить провайдера");
    }
  };

  const refreshAll = () => {
    onRefresh();
    setRefreshKey((value) => value + 1);
  };

  const ready = providers.filter((provider) => provider.installed && provider.enabled);
  const defaultProvider = providers.find((provider) => provider.default) ?? null;
  const groups = [
    {
      key: "ready",
      label: "Доступны",
      items: providers.filter((provider) => provider.installed && provider.enabled),
    },
    {
      key: "disabled",
      label: "Выключены",
      items: providers.filter((provider) => provider.installed && !provider.enabled),
    },
    {
      key: "missing",
      label: "Не найдены",
      items: providers.filter((provider) => !provider.installed),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <section className="assets-screen agents-screen">
      <div className="assets-heading">
        <Bot size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>Агенты и AI</h1>
          <p className="subtitle">
            CLI-агенты работают в папке проекта. Kova запускает процесс, делает снапшот и
            показывает результат.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={15} />
            Свой CLI
          </button>
          <button
            type="button"
            className="icon-btn action-btn"
            title="Обновить провайдеров и запуски"
            aria-label="Обновить провайдеров и запуски"
            onClick={refreshAll}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      <div className="agents-statusbar">
        <span className={`agents-dot ${ready.length > 0 ? "is-on" : "is-off"}`} />
        <span>
          {ready.length > 0
            ? `Готовы к запуску: ${ready.length} из ${providers.length}`
            : "Ни один CLI не найден"}
        </span>
        {defaultProvider ? (
          <>
            <span className="agents-sep">·</span>
            <span>основной — {defaultProvider.name}</span>
          </>
        ) : null}
      </div>

      {error ? <p className="agents-error">{error}</p> : null}

      <div className="agents-layout">
        <section className="agent-panel">
          <div className="agent-panel-head">
            <h2>Провайдеры</h2>
            <span>{providers.length}</span>
          </div>

          {providers.length === 0 ? (
            <div className="agent-empty">
              <b>Провайдеров пока нет</b>
              <span>Добавь свой CLI или верни встроенные пресеты.</span>
            </div>
          ) : (
            <div className="agent-list">
              {groups.map((group) => (
                <div className="agent-group" key={group.key}>
                  <div className="agent-group-head">
                    <span>{group.label}</span>
                    <span>{group.items.length}</span>
                  </div>
                  {group.items.map((provider) => {
                    const brand = providerBrand(provider.id);
                    const state = providerState(provider);
                    const checking = checkingId === provider.id;
                    return (
                      <article
                        className={`agent-row${!provider.installed ? " is-missing" : ""}${
                          provider.default ? " is-default" : ""
                        }`}
                        key={provider.id}
                      >
                        <span className="agent-icon">
                          {brand ? (
                            <BrandIcon name={brand} size={21} />
                          ) : (
                            <Bot size={19} strokeWidth={1.6} />
                          )}
                        </span>

                        <div className="agent-main">
                          <div className="agent-name-line">
                            <span className={`agent-dot ${state.dot}`} />
                            <b title={provider.description || undefined}>{provider.name}</b>
                            {provider.default ? (
                              <span className="agent-tag is-default">основной</span>
                            ) : null}
                            {!provider.enabled ? (
                              <span className="agent-tag">выключен</span>
                            ) : null}
                            {!provider.installed ? (
                              <span className="agent-tag is-off">не найден</span>
                            ) : null}
                          </div>
                          <div className="agent-meta-line">
                            <span>{provider.builtin ? "пресет" : "свой CLI"}</span>
                            <span className="agents-sep">·</span>
                            <span>
                              {provider.version ||
                                (provider.installed ? "CLI готов" : "команда не найдена")}
                            </span>
                            {provider.path ? (
                              <code title={provider.path}>{provider.path}</code>
                            ) : null}
                          </div>
                          <code className="agent-cmd" title={commandLine(provider)}>
                            {commandLine(provider)}
                          </code>
                        </div>

                        <div className="agent-actions2">
                          <button
                            type="button"
                            className="agent-link"
                            disabled={checking}
                            title="Проверить, что CLI доступен"
                            onClick={() => void check(provider)}
                          >
                            {provider.installed ? (
                              <RefreshCw size={11} />
                            ) : (
                              <Search size={11} />
                            )}
                            {checking
                              ? "Проверка…"
                              : provider.installed
                                ? "Проверить"
                                : "Найти"}
                          </button>
                          <button
                            type="button"
                            className="agent-link"
                            title="Настроить провайдера"
                            onClick={() => openEdit(provider)}
                          >
                            <Pencil size={11} />
                            Настроить
                          </button>
                          {!provider.default && provider.installed ? (
                            <button
                              type="button"
                              className="agent-link"
                              title="Сделать основным"
                              aria-label="Сделать основным"
                              onClick={() => void makeDefault(provider)}
                            >
                              <Star size={12} />
                            </button>
                          ) : null}
                          {!provider.builtin ? (
                            <button
                              type="button"
                              className="agent-link is-danger"
                              title="Удалить провайдера"
                              aria-label="Удалить провайдера"
                              onClick={() => void remove(provider)}
                            >
                              <Trash2 size={12} />
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="agents-side">
          <section className="agent-panel">
            <div className="agent-panel-head">
              <h2>Последние запуски</h2>
            </div>
            {runsError ? (
              <div className="agent-empty">
                <span>{runsError}</span>
              </div>
            ) : runs.length === 0 ? (
              <div className="agent-empty">
                <b>Запусков пока нет</b>
                <span>Запусти задачу из карточки — здесь появится история.</span>
              </div>
            ) : (
              <div className="run-list">
                {runs.map((run) => (
                  <button
                    type="button"
                    className="run-row"
                    key={run.id}
                    title={`Открыть задачу «${run.task_title}»`}
                    onClick={() => onOpenTask(run.task_id)}
                  >
                    <span className={`run-dot ${RUN_DOT[run.status]}`} />
                    <span className="run-copy">
                      <b>{run.task_title}</b>
                      <small>
                        {run.provider_name} · {formatDate(run.started_at || run.created_at)}
                      </small>
                    </span>
                    <span className={`run-label ${RUN_DOT[run.status]}`}>
                      {RUN_LABELS[run.status]}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="agent-panel agent-facts">
            <div className="agent-panel-head">
              <h2>Границы</h2>
            </div>
            <ul>
              <li>Kova запускает CLI в папке проекта и делает снапшот перед стартом.</li>
              <li>Запись и команды ограничивает сам CLI, а не Kova.</li>
              <li>Логин и ключи остаются внутри CLI; Kova их не хранит.</li>
            </ul>
          </section>
        </aside>
      </div>

      <p className="agents-footnote">
        Установка и вход выполняются в самом CLI. Если команда не находится — укажи полный путь
        в настройках провайдера.
      </p>

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
                {dialog.kind === "edit" ? "Настроить провайдера" : "Свой CLI-агент"}
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
