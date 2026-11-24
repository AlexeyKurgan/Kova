import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleStop,
  ClipboardCopy,
  Play,
  RefreshCw,
} from "lucide-react";
import BrandIcon from "../../components/BrandIcon";
import { providerBrand } from "../../lib/brands";
import {
  cancelAiRun,
  getAiRun,
  listAiSessions,
  startAiRun,
} from "../../lib/coreClient";
import { formatDate } from "../../lib/format";
import { RUN_DOT, RUN_LABELS } from "../../lib/runLabels";
import type { AgentSession, AiRun, ProviderInfo, Task } from "../../lib/types";

type Props = {
  task: Task;
  providers: ProviderInfo[];
  defaultProvider: string;
  onCapsule: () => void;
  onOpenAgents: () => void;
  onFinished: () => void;
};

const EMPTY_MODELS: string[] = [];

const SESSION_LABELS: Record<AgentSession["status"], string> = {
  active: "Активна",
  completed: "Завершена",
  failed: "Ошибка",
  cancelled: "Отменена",
  interrupted: "Прервана",
};

function cleanOutput(text: string) {
  return text
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .trim();
}

function isRunning(run: AiRun | null) {
  return run?.status === "queued" || run?.status === "running";
}

function runLabel(run: AiRun) {
  return run.model ? `${RUN_LABELS[run.status]} · ${run.model}` : RUN_LABELS[run.status];
}

export default function TaskWorkPanel({
  task,
  providers,
  defaultProvider,
  onCapsule,
  onOpenAgents,
  onFinished,
}: Props) {
  const available = useMemo(
    () => providers.filter((provider) => provider.installed && provider.enabled),
    [providers],
  );
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [message, setMessage] = useState("");
  const [snapshot, setSnapshot] = useState(true);
  const [activeRun, setActiveRun] = useState<AiRun | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const provider = providers.find((item) => item.id === providerId) ?? null;
  const needsModel = Boolean(
    provider?.args.some((item) => item.includes("{model}")),
  );
  const modelOptions = provider?.models ?? EMPTY_MODELS;

  useEffect(() => {
    if (available.length === 0) {
      setProviderId("");
      return;
    }
    if (!available.some((item) => item.id === providerId)) {
      setProviderId(
        available.find((item) => item.id === defaultProvider)?.id ?? available[0].id,
      );
    }
  }, [available, defaultProvider, providerId]);

  useEffect(() => {
    setModel(modelOptions[0] ?? "");
  }, [providerId, modelOptions]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      listAiSessions(task.id)
        .then((rows) => {
          if (!alive) return;
          setSessions(rows);
          setSessionsError(null);
          const running = rows
            .flatMap((row) => row.runs)
            .find((run) => run.status === "queued" || run.status === "running");
          if (running) setActiveRun((current) => current ?? running);
        })
        .catch(() => {
          if (alive) setSessionsError("История сессий недоступна");
        });
    };
    void load();
    const timer = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refreshKey, task.id]);

  useEffect(() => {
    if (!activeRun || !isRunning(activeRun)) return;
    let alive = true;
    const timer = window.setInterval(() => {
      getAiRun(activeRun.id)
        .then((next) => {
          if (!alive) return;
          setActiveRun(next);
          if (!isRunning(next)) {
            setRefreshKey((value) => value + 1);
            onFinished();
          }
        })
        .catch(() => undefined);
    }, 1400);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [activeRun?.id, activeRun?.status, onFinished]);

  const start = async () => {
    if (!providerId || busy || isRunning(activeRun)) return;
    if (needsModel && !model) {
      setError("Выбери модель для этого провайдера");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const run = await startAiRun({
        task_id: task.id,
        provider: providerId,
        snapshot,
        message: message.trim(),
        model: needsModel ? model : undefined,
      });
      setActiveRun(run);
      setMessage("");
      setRefreshKey((value) => value + 1);
      setExpandedRun(run.id);
      if (!isRunning(run)) {
        onFinished();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запустить агента");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!activeRun) return;
    setBusy(true);
    try {
      const next = await cancelAiRun(activeRun.id);
      setActiveRun(next);
      if (!isRunning(next)) {
        setRefreshKey((value) => value + 1);
        onFinished();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отменить запуск");
    } finally {
      setBusy(false);
    }
  };

  const running = isRunning(activeRun);

  return (
    <section className="task-work">
      <div className="task-work-head">
        <div className="task-work-title">
          <h2>Работа с агентом</h2>
          <span>Kova добавит цель, критерии и ограничения задачи.</span>
        </div>
        <div className="task-work-actions">
          <button type="button" className="agent-link" onClick={onCapsule}>
            <ClipboardCopy size={12} />
            Капсула
          </button>
          <button type="button" className="agent-link" onClick={onOpenAgents}>
            <Bot size={12} />
            Агенты
          </button>
        </div>
      </div>

      <div className="task-work-grid">
        <div className="work-timeline">
          {sessionsError ? (
            <div className="work-empty">{sessionsError}</div>
          ) : sessions.length === 0 ? (
            <div className="work-empty">
              <b>Пока не было запусков</b>
              <span>Опиши шаг в поле запроса и отправь его агенту. Задача и критерии уйдут вместе с запросом.</span>
            </div>
          ) : (
            sessions.map((session) => {
              const brand = providerBrand(session.provider_id);
              return (
                <div className="work-session" key={session.id}>
                  <div className="work-session-head">
                    <span className="work-provider-icon">
                      {brand ? <BrandIcon name={brand} size={15} /> : <Bot size={14} />}
                    </span>
                    <b>{session.provider_name}</b>
                    <span className={`work-session-state is-${session.status}`}>
                      {SESSION_LABELS[session.status]}
                    </span>
                    <span className="work-session-meta">
                      {formatDate(session.created_at)}
                    </span>
                  </div>
                  {session.runs.map((run) => {
                    const open = expandedRun === run.id;
                    const output = cleanOutput(run.output);
                    return (
                      <div className="work-run-wrap" key={run.id}>
                        <button
                          type="button"
                          className="work-run"
                          onClick={() => setExpandedRun(open ? null : run.id)}
                        >
                          <span className={`run-dot ${RUN_DOT[run.status]}`} />
                          <span className="work-run-copy">
                            <span className="work-run-name">{runLabel(run)}</span>
                            <span className="work-run-meta">
                              {formatDate(run.started_at || run.created_at)}
                              {run.snapshot_id ? " · снапшот" : ""}
                            </span>
                          </span>
                          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                        {open ? (
                          <div className="work-run-body">
                            {run.error && run.status !== "running" ? (
                              <div className="work-error">{run.error}</div>
                            ) : null}
                            {run.interrupted_reason ? (
                              <div className="work-note is-warn">{run.interrupted_reason}</div>
                            ) : null}
                            {output ? (
                              <pre className="work-run-output">{output}</pre>
                            ) : isRunning(run) ? (
                              <div className="work-note">Агент работает. Вывод появится после завершения.</div>
                            ) : (
                              <div className="work-note">Вывод пустой.</div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="work-composer">
          <div className="work-composer-head">
            <b>Новый шаг</b>
            {activeRun ? (
              <span className={`work-run-state ${RUN_DOT[activeRun.status]}`}>
                {RUN_LABELS[activeRun.status]}
              </span>
            ) : null}
          </div>

          {available.length === 0 ? (
            <div className="work-empty">
              <b>Нет доступных CLI</b>
              <span>Добавь провайдера или установи CLI в системе.</span>
              <button type="button" className="btn btn-secondary btn-small" onClick={onOpenAgents}>
                Открыть «Агенты»
              </button>
            </div>
          ) : (
            <>
              <label className="work-field">
                <span>Провайдер</span>
                <select
                  value={providerId}
                  disabled={running || busy}
                  onChange={(event) => setProviderId(event.target.value)}
                >
                  {available.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.default ? " · основной" : ""}
                    </option>
                  ))}
                </select>
              </label>

              {needsModel ? (
                <label className="work-field">
                  <span>Модель</span>
                  {modelOptions.length > 0 ? (
                    <select
                      value={model}
                      disabled={running || busy}
                      onChange={(event) => setModel(event.target.value)}
                    >
                      {modelOptions.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="work-note is-warn">
                      В аргументах провайдера есть {"{model}"}, но модели не заданы. Добавь их
                      в настройках провайдера.
                    </div>
                  )}
                </label>
              ) : null}

              {!needsModel ? (
                <div className="work-note">
                  {modelOptions.length > 0
                    ? "Модели заданы, но в аргументах нет {model}. Добавь плейсхолдер в настройках провайдера."
                    : "Модель: CLI default. Чтобы выбирать её в Kova, добавь {model} в аргументы провайдера."}
                </div>
              ) : null}

              <label className="work-field">
                <span>Запрос</span>
                <textarea
                  rows={3}
                  value={message}
                  disabled={running || busy}
                  placeholder="Что сделать? Например: добавь хитбоксы и проверь, что кулдауны не сломались."
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                      event.preventDefault();
                      void start();
                    }
                  }}
                />
              </label>

              <div className="work-composer-foot">
                <label className="agent-check">
                  <input
                    type="checkbox"
                    checked={snapshot}
                    disabled={running || busy}
                    onChange={(event) => setSnapshot(event.target.checked)}
                  />
                  Снапшот
                </label>
                <span className="work-shortcut">Ctrl+Enter</span>
              </div>

              {error ? <div className="work-error">{error}</div> : null}

              <div className="work-run-actions">
                {running ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => void cancel()}
                  >
                    <CircleStop size={14} />
                    Остановить
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !providerId || (needsModel && !model)}
                    onClick={() => void start()}
                  >
                    <Play size={14} />
                    {busy ? "Запуск…" : activeRun ? "Запустить ещё" : "Запустить"}
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn action-btn"
                  title="Обновить историю"
                  aria-label="Обновить историю"
                  onClick={() => setRefreshKey((value) => value + 1)}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
