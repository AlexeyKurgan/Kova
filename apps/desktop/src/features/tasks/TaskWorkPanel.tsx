import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleStop,
  ClipboardCopy,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import BrandIcon from "../../components/BrandIcon";
import { providerBrand } from "../../lib/brands";
import {
  addWorkflowStep,
  approveAiRun,
  getAgentRouting,
  recommendProvider,
  cancelAiRun,
  getAiRun,
  deleteWorkflowStep,
  listAiSessions,
  previewAiHandoff,
  resumeAiSession,
  runTaskValidation,
  startAiRun,
  updateTask,
  updateWorkflowStep,
} from "../../lib/coreClient";
import { formatDate, plural } from "../../lib/format";
import { RUN_DOT, RUN_LABELS } from "../../lib/runLabels";
import type {
  AgentRecommendation,
  AgentRole,
  AgentSession,
  AiRun,
  ProviderInfo,
  Task,
  ValidationResult,
  WorkflowStep,
} from "../../lib/types";

type Props = {
  task: Task;
  providers: ProviderInfo[];
  defaultProvider: string;
  onCapsule: () => void;
  onOpenAgents: () => void;
  onFinished: () => void;
  onValidationRefresh: () => void;
  onNotify: (text: string, tone?: "error" | "warning") => void;
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
  return (
    run?.status === "queued" ||
    run?.status === "running" ||
    run?.status === "waiting_approval"
  );
}

function usageLine(run: AiRun) {
  const usage = run.usage;
  if (!usage) return "Расход: Unknown — провайдер не вернул usage.";
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = usage[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return null;
  };
  const input = pick("input_tokens", "prompt_tokens");
  const output = pick("output_tokens", "completion_tokens");
  const total = pick("total_tokens", "total") ?? (input ?? 0) + (output ?? 0);
  const parts = [`Токены: ${total.toLocaleString("ru-RU")}`];
  if (input !== null) parts.push(`вход ${input.toLocaleString("ru-RU")}`);
  if (output !== null) parts.push(`выход ${output.toLocaleString("ru-RU")}`);
  return parts.join(" · ");
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
  onValidationRefresh,
  onNotify,
}: Props) {
  const available = useMemo(
    () => providers.filter((provider) => provider.installed && provider.enabled),
    [providers],
  );
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [message, setMessage] = useState("");
  const [snapshot, setSnapshot] = useState(true);
  const [activeRun, setActiveRun] = useState<AiRun | null>(null);
  const [handoffFrom, setHandoffFrom] = useState<AgentSession | null>(null);
  const [handoffMode, setHandoffMode] = useState<"continue" | "transfer" | null>(null);
  const [resumeFrom, setResumeFrom] = useState<AgentSession | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationBusy, setValidationBusy] = useState(false);
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const autoRan = useRef<Set<string>>(new Set());
  const [handoffPreview, setHandoffPreview] = useState<{ text: string; to: string } | null>(null);
  const [handoffPreviewOpen, setHandoffPreviewOpen] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [addingStep, setAddingStep] = useState(false);
  const [stepTitle, setStepTitle] = useState("");
  const [stepPrompt, setStepPrompt] = useState("");
  const [stepBusy, setStepBusy] = useState(false);
  const [roles, setRoles] = useState<AgentRole[]>([]);
  const [roleId, setRoleId] = useState("");
  const [recommendation, setRecommendation] = useState<AgentRecommendation | null>(null);
  const [toolPolicy, setToolPolicy] = useState<"read-only" | "workspace" | "auto">("workspace");
  const [approvalBusy, setApprovalBusy] = useState(false);

  const provider = providers.find((item) => item.id === providerId) ?? null;
  const needsModel = Boolean(
    provider?.args.some((item) => item.includes("{model}")),
  );
  const modelOptions = provider?.models ?? EMPTY_MODELS;

  useEffect(() => {
    setSessions([]);
    setActiveRun(null);
    setHandoffFrom(null);
    setHandoffMode(null);
    setResumeFrom(null);
    setHandoffPreview(null);
    setHandoffPreviewOpen(false);
    setValidationResults([]);
    autoRan.current.clear();
    setExpandedRun(null);
    setMessage("");
    setError(null);
    setRoleId(task.role_id || "");
    setRecommendation(null);
  }, [task.id]);

  useEffect(() => {
    let alive = true;
    getAgentRouting()
      .then((data) => {
        if (alive) setRoles(data.roles);
      })
      .catch(() => {
        if (alive) setRoles([]);
      });
    recommendProvider(task.id)
      .then((data) => {
        if (alive) setRecommendation(data);
      })
      .catch(() => {
        if (alive) setRecommendation(null);
      });
    return () => {
      alive = false;
    };
  }, [task.id, refreshKey]);

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
    setModel(provider?.default_model || modelOptions[0] || "");
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
            if (next.status === "failed") {
              onNotify("Агент завершился с ошибкой");
            } else if (next.status === "interrupted") {
              onNotify("Запуск агента прерван", "warning");
            }
          }
        })
        .catch(() => undefined);
    }, 1400);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [activeRun?.id, activeRun?.status, onFinished, onNotify]);

  const loadHandoffPreview = async (session: AgentSession, target: string) => {
    if (!target) return;
    setPreviewBusy(true);
    try {
      const preview = await previewAiHandoff({
        task_id: task.id,
        from_session_id: session.id,
        to_provider: target,
      });
      setHandoffPreview({ text: preview.text, to: preview.to_provider_name });
    } catch {
      setHandoffPreview(null);
    } finally {
      setPreviewBusy(false);
    }
  };

  const startHandoff = (session: AgentSession, mode: "continue" | "transfer") => {
    const sourceProvider = providers.find((item) => item.id === session.provider_id);
    const canResume =
      mode === "continue" &&
      Boolean(session.cli_session_id) &&
      available.some((item) => item.id === session.provider_id) &&
      (sourceProvider?.resume_args?.length ?? 0) > 0;
    if (canResume) {
      setResumeFrom(session);
      setHandoffFrom(null);
      setHandoffMode(null);
      setHandoffPreview(null);
      setHandoffPreviewOpen(false);
      setProviderId(session.provider_id);
      return;
    }
    setResumeFrom(null);
    setHandoffFrom(session);
    setHandoffMode(mode);
    setHandoffPreviewOpen(false);
    let target = providerId || available[0]?.id || session.provider_id;
    if (mode === "continue" && available.some((item) => item.id === session.provider_id)) {
      setProviderId(session.provider_id);
      target = session.provider_id;
    }
    void loadHandoffPreview(session, target);
  };

  const clearHandoff = () => {
    setHandoffFrom(null);
    setHandoffMode(null);
    setResumeFrom(null);
    setHandoffPreview(null);
    setHandoffPreviewOpen(false);
  };

  useEffect(() => {
    if (!handoffFrom) return;
    const target = providerId || handoffFrom.provider_id;
    if (target) void loadHandoffPreview(handoffFrom, target);
  }, [handoffFrom?.id, providerId]);

  const addStep = async () => {
    if (!stepTitle.trim() || stepBusy) return;
    setStepBusy(true);
    setError(null);
    try {
      await addWorkflowStep(task.id, {
        title: stepTitle.trim(),
        prompt: stepPrompt.trim(),
      });
      setStepTitle("");
      setStepPrompt("");
      setAddingStep(false);
      onFinished();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить шаг");
    } finally {
      setStepBusy(false);
    }
  };

  const runStep = async (step: WorkflowStep) => {
    if (!providerId || stepBusy || busy || isRunning(activeRun)) return;
    if (needsModel && !model) {
      setError("Выбери модель для этого провайдера");
      return;
    }
    setStepBusy(true);
    setError(null);
    setValidationResults([]);
    try {
      const run = await startAiRun({
        task_id: task.id,
        provider: providerId,
        snapshot,
        message: step.prompt || step.title,
        model: needsModel ? model : undefined,
        read_only: readOnly,
        workflow_step_id: step.id,
      });
      setActiveRun(run);
      setRefreshKey((value) => value + 1);
      setExpandedRun(run.id);
      onFinished();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запустить шаг");
    } finally {
      setStepBusy(false);
    }
  };

  const setStepStatus = async (step: WorkflowStep, status: string) => {
    if (stepBusy) return;
    setStepBusy(true);
    try {
      await updateWorkflowStep(task.id, step.id, { status });
      onFinished();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить шаг");
    } finally {
      setStepBusy(false);
    }
  };

  const removeStep = async (step: WorkflowStep) => {
    if (stepBusy) return;
    setStepBusy(true);
    try {
      await deleteWorkflowStep(task.id, step.id);
      onFinished();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить шаг");
    } finally {
      setStepBusy(false);
    }
  };

  const start = async () => {
    if (!providerId || busy || isRunning(activeRun)) return;
    if (needsModel && !model) {
      setError("Выбери модель для этого провайдера");
      return;
    }
    setBusy(true);
    setError(null);
    setValidationResults([]);
    try {
      const run = resumeFrom
        ? await resumeAiSession(resumeFrom.id, {
            message: message.trim(),
            model: needsModel ? model : undefined,
            snapshot,
            read_only: readOnly,
          })
        : await startAiRun({
            task_id: task.id,
            provider: providerId,
            snapshot,
            message: message.trim(),
            model: needsModel ? model : undefined,
            handoff_from_session: handoffFrom?.id,
            read_only: readOnly,
          });
      setActiveRun(run);
      setMessage("");
      clearHandoff();
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

  const decideApproval = async (decision: "allow" | "deny" | "allow_all") => {
    if (!activeRun || approvalBusy) return;
    setApprovalBusy(true);
    setError(null);
    try {
      const next = await approveAiRun(activeRun.id, decision);
      setActiveRun(next);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось подтвердить действие");
    } finally {
      setApprovalBusy(false);
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
  const latestRun =
    activeRun ??
    sessions[0]?.runs[sessions[0].runs.length - 1] ??
    null;
  const canValidate =
    Boolean(latestRun) &&
    !isRunning(latestRun) &&
    task.validation.length > 0;
  const validationPassed = validationResults.filter((row) => row.status === "passed").length;
  const validationFailed = validationResults.filter(
    (row) => row.status === "failed" || row.status === "error" || row.status === "timeout",
  ).length;

  const runChecks = async () => {
    if (validationBusy) return;
    if (latestRun) autoRan.current.add(latestRun.id);
    setValidationBusy(true);
    setError(null);
    try {
      const rows = await runTaskValidation(task.id, undefined, latestRun?.id);
      setValidationResults(rows);
      onValidationRefresh();
      onFinished();
      const failed = rows.filter((row) => row.status !== "passed").length;
      if (failed > 0) {
        onNotify(`Проверки: ${failed} с ошибками`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить проверки");
    } finally {
      setValidationBusy(false);
    }
  };

  useEffect(() => {
    if (task.validation_mode !== "always" || !canValidate || !latestRun) return;
    if (autoRan.current.has(latestRun.id)) return;
    void runChecks();
  }, [canValidate, latestRun?.id, task.validation_mode]);

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
                    {session.handoff_id ? <span className="agent-tag">из сессии</span> : null}
                    {session.cli_session_id ? (
                      <span className="agent-tag" title={session.cli_session_id}>
                        cli
                      </span>
                    ) : null}
                    <span className="work-session-meta">
                      {formatDate(session.created_at)}
                    </span>
                    {session.runs.length > 0 &&
                    !session.runs.some((run) =>
                      run.status === "queued" || run.status === "running",
                    ) ? (
                      <>
                        <button
                          type="button"
                          className="agent-link"
                          title="Продолжить: реальный resume CLI, если он доступен, иначе новая сессия с контекстом"
                          onClick={() => startHandoff(session, "continue")}
                        >
                          Продолжить
                        </button>
                        <button
                          type="button"
                          className="agent-link"
                          title="Передать работу другому агенту"
                          onClick={() => startHandoff(session, "transfer")}
                        >
                          Передать
                        </button>
                      </>
                    ) : null}
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
                            <div className="work-note">
                              {run.read_only ? "Только чтение · " : ""}
                              {run.tool_policy
                                ? `инструменты: ${
                                    run.tool_policy === "auto"
                                      ? "запись + команды"
                                      : run.tool_policy === "workspace"
                                        ? "чтение + запись"
                                        : "только чтение"
                                  } · `
                                : ""}
                              {run.isolation === "worktree"
                                ? "worktree · "
                                : run.isolation === "sandbox"
                                  ? "sandbox-копия · "
                                  : ""}
                              {run.network?.length
                                ? `сеть: ${run.network
                                    .map((item) =>
                                      item.allowed
                                        ? item.host
                                        : `${item.host} (блок)`,
                                    )
                                    .join(", ")} · `
                                : ""}
                              {usageLine(run)}
                            </div>
                            {run.actions.length > 0 ? (
                              <details className="work-actions">
                                <summary>
                                  Действия CLI ({run.actions.length})
                                </summary>
                                <ul>
                                  {run.actions.map((action, index) => (
                                    <li key={`${action.kind}:${index}`}>
                                      <span>{action.kind === "command" ? "cmd" : "file"}</span>
                                      <code>{action.value}</code>
                                      {action.exit_code !== undefined &&
                                      action.exit_code !== null ? (
                                        <small>exit {action.exit_code}</small>
                                      ) : null}
                                      {action.change ? <small>{action.change}</small> : null}
                                    </li>
                                  ))}
                                </ul>
                                <small className="work-actions-note">
                                  Показано из структурированного вывода CLI. Kova не
                                  перехватывает и не блокирует команды.
                                </small>
                              </details>
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
            <b>
              {resumeFrom
                ? "Продолжение CLI-сессии"
                : handoffMode === "continue"
                  ? "Продолжение работы"
                  : handoffMode === "transfer"
                    ? "Передача работы"
                    : "Новый шаг"}
            </b>
            {activeRun ? (
              <span className={`work-run-state ${RUN_DOT[activeRun.status]}`}>
                {RUN_LABELS[activeRun.status]}
              </span>
            ) : null}
          </div>

          {activeRun?.status === "waiting_approval" && activeRun.approval ? (
            <div className="work-approval">
              <div className="work-approval-head">
                <b>Нужно подтверждение</b>
                <span>{activeRun.approval.tool}</span>
              </div>
              <div className="work-approval-target">
                {activeRun.approval.args.path || activeRun.approval.args.command}
                {activeRun.approval.args.bytes
                  ? ` · ${activeRun.approval.args.bytes} байт`
                  : ""}
              </div>
              {activeRun.approval.args.preview ? (
                <pre>{activeRun.approval.args.preview}</pre>
              ) : null}
              <div className="work-approval-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={approvalBusy}
                  onClick={() => void decideApproval("allow")}
                >
                  Разрешить
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={approvalBusy}
                  onClick={() => void decideApproval("allow_all")}
                >
                  Разрешить всё в запуске
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={approvalBusy}
                  onClick={() => void decideApproval("deny")}
                >
                  Отклонить
                </button>
              </div>
              <small>
                Политика: {activeRun.tool_policy || "workspace"}. Отклонение остановит запуск.
              </small>
            </div>
          ) : null}

          {running && activeRun ? (
            <div className="work-live">
              <div className="work-live-head">
                <span>
                  {activeRun.status === "queued"
                    ? activeRun.queue_position > 1
                      ? `В очереди · ${activeRun.queue_position}`
                      : "Ожидает слот"
                    : activeRun.status === "waiting_approval"
                      ? "Ожидает подтверждения"
                      : "Вывод в реальном времени"}
                </span>
                <span className="work-live-dot" />
              </div>
              <pre>
                {activeRun.status === "queued"
                  ? `Лимит параллельных запусков: ${activeRun.max_parallel_runs || 1}. Запуск начнётся автоматически.`
                  : activeRun.status === "waiting_approval"
                    ? "Агент остановлен на опасном действии. Проверь карточку выше."
                    : cleanOutput(activeRun.output) || "Агент работает…"}
              </pre>
            </div>
          ) : null}

          {canValidate ? (
            <div className="work-validation-bar">
              <span>
                Результат готов. Проверить задачу?
                {validationResults.length > 0 ? (
                  <small>
                    {validationPassed} пройдено · {validationFailed}{" "}
                    {plural(validationFailed, ["ошибка", "ошибки", "ошибок"])}
                  </small>
                ) : null}
              </span>
              <button
                type="button"
                className="agent-link"
                disabled={validationBusy}
                onClick={() => void runChecks()}
              >
                <Sparkles size={11} />
                {validationBusy ? "Проверка…" : `Проверить (${task.validation.length})`}
              </button>
            </div>
          ) : null}

          <div className="work-flow">
            <div className="work-flow-head">
              <span>Шаги</span>
              <b>
                {task.workflow.filter((step) => step.status === "done").length}/
                {task.workflow.length}
              </b>
              <button
                type="button"
                className="agent-link"
                onClick={() => setAddingStep((value) => !value)}
              >
                {addingStep ? "Скрыть" : "+ Шаг"}
              </button>
            </div>
            {addingStep ? (
              <div className="work-flow-add">
                <input
                  value={stepTitle}
                  placeholder="Название шага"
                  onChange={(event) => setStepTitle(event.target.value)}
                />
                <input
                  value={stepPrompt}
                  placeholder="Что сделать (уйдёт агенту)"
                  onChange={(event) => setStepPrompt(event.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={stepBusy || !stepTitle.trim()}
                  onClick={() => void addStep()}
                >
                  Добавить
                </button>
              </div>
            ) : null}
            {task.workflow.length === 0 ? null : (
              <ol className="work-flow-list">
                {task.workflow.map((step) => (
                  <li key={step.id} className={`is-${step.status}`}>
                    <span className="work-flow-dot" />
                    <span className="work-flow-copy">
                      <b>{step.title}</b>
                      {step.prompt ? <small>{step.prompt}</small> : null}
                    </span>
                    {step.status === "pending" || step.status === "failed" ? (
                      <button
                        type="button"
                        className="agent-link"
                        disabled={stepBusy || running}
                        onClick={() => void runStep(step)}
                      >
                        Запустить
                      </button>
                    ) : null}
                    {step.status !== "done" && step.status !== "skipped" ? (
                      <button
                        type="button"
                        className="agent-link"
                        disabled={stepBusy}
                        onClick={() => void setStepStatus(step, "done")}
                      >
                        Готово
                      </button>
                    ) : null}
                    {step.status !== "done" && step.status !== "skipped" ? (
                      <button
                        type="button"
                        className="agent-link"
                        disabled={stepBusy}
                        onClick={() => void setStepStatus(step, "skipped")}
                      >
                        Пропустить
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="agent-link"
                      disabled={stepBusy}
                      title="Удалить шаг"
                      onClick={() => void removeStep(step)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {resumeFrom ? (
            <div className="work-handoff">
              <span>
                Продолжение CLI-сессии · <b>{resumeFrom.provider_name}</b> ·{" "}
                {formatDate(resumeFrom.created_at)}
              </span>
              <span className="agent-tag">resume</span>
              <button type="button" className="agent-link" onClick={clearHandoff}>
                Отменить
              </button>
            </div>
          ) : null}
          {resumeFrom ? (
            <div className="work-note">
              Контекст остаётся в самом CLI. Kova отправит только новое сообщение.
            </div>
          ) : null}

          {handoffFrom ? (
            <>
            <div className="work-handoff">
              <span>
                {handoffMode === "continue" ? "Продолжение работы" : "Передача из сессии"}{" "}
                · <b>{handoffFrom.provider_name}</b> · {formatDate(handoffFrom.created_at)}
              </span>
              <button
                type="button"
                className="agent-link"
                disabled={previewBusy}
                onClick={() => setHandoffPreviewOpen((value) => !value)}
              >
                {previewBusy
                  ? "Загрузка…"
                  : handoffPreviewOpen
                    ? "Скрыть"
                    : "Что уйдёт"}
              </button>
              <button type="button" className="agent-link" onClick={clearHandoff}>
                Отменить
              </button>
            </div>
            {handoffMode === "continue" ? (
              <div className="work-note">
                Resume для этой сессии недоступен — передаётся пакет контекста в новую сессию.
              </div>
            ) : null}
            {handoffPreviewOpen ? (
              <pre className="work-handoff-preview">
                {handoffPreview?.text || "Предпросмотр недоступен."}
              </pre>
            ) : null}
            </>
          ) : null}

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
                  disabled={running || busy || Boolean(resumeFrom)}
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

              {roles.length > 0 ? (
                <label className="work-field">
                  <span>Роль</span>
                  <select
                    value={roleId}
                    disabled={running || busy}
                    onChange={(event) => {
                      const next = event.target.value;
                      setRoleId(next);
                      void updateTask(task.id, { role_id: next }).then(onFinished);
                    }}
                  >
                    <option value="">Без роли</option>
                    {roles.map((role) => (
                      <option value={role.id} key={role.id}>
                        {role.name}
                        {role.provider_id ? ` · ${role.provider_id}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {recommendation?.provider_id && recommendation.provider_id !== providerId ? (
                <div className="work-note">
                  Рекомендация: <b>{recommendation.provider_name}</b> ·{" "}
                  {recommendation.reason}{" "}
                  <button
                    type="button"
                    className="agent-link"
                    onClick={() => setProviderId(recommendation.provider_id)}
                  >
                    Выбрать
                  </button>
                </div>
              ) : null}

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
                    <input
                      value={model}
                      disabled={running || busy}
                      placeholder="Например: gpt-5-codex"
                      onChange={(event) => setModel(event.target.value)}
                    />
                  )}
                </label>
              ) : null}

              {provider?.kind === "api" ? (
                <label className="work-field">
                  <span>Инструменты</span>
                  <select
                    value={toolPolicy}
                    disabled={running || busy}
                    onChange={(event) =>
                      setToolPolicy(event.target.value as "read-only" | "workspace" | "auto")
                    }
                  >
                    <option value="read-only">Только чтение</option>
                    <option value="workspace">Чтение и запись файлов</option>
                    <option value="auto">Чтение, запись и команды</option>
                  </select>
                </label>
              ) : null}

              {provider?.kind !== "api" ? (
              <label className="agent-check work-readonly">
                <input
                  type="checkbox"
                  checked={readOnly}
                  disabled={
                    running || busy || (provider?.read_only_args?.length ?? 0) === 0
                  }
                  onChange={(event) => setReadOnly(event.target.checked)}
                />
                Только чтение
                <small>
                  {(provider?.read_only_args?.length ?? 0) === 0
                    ? "аргументы не заданы в настройках провайдера"
                    : "без правок файлов"}
                </small>
              </label>
              ) : null}

              {!needsModel ? (
                <div className="work-note">
                  {modelOptions.length > 0
                    ? "Модели заданы, но в аргументах нет {model}. Добавь плейсхолдер в настройках провайдера."
                    : provider?.capabilities?.checked
                      ? provider.capabilities.supports_model
                        ? "CLI поддерживает --model. Добавь {model} в аргументы, чтобы выбирать модель здесь."
                        : "Модель задаётся в конфиге CLI."
                      : "Модель: CLI default. Нажми «Проверить» в «Агентах», чтобы узнать флаги."}
                </div>
              ) : null}

              <label className="work-field">
                <span>Запрос</span>
                <textarea
                  rows={2}
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
                    {busy
                      ? "Запуск…"
                      : resumeFrom
                        ? "Продолжить и запустить"
                        : handoffMode === "continue"
                          ? "Продолжить и запустить"
                          : handoffMode === "transfer"
                          ? "Передать и запустить"
                          : activeRun
                            ? "Запустить ещё"
                            : "Запустить"}
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
