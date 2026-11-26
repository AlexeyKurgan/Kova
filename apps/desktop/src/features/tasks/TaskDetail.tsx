import { useEffect, useState } from "react";
import {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  ClipboardList,
  Clock,
  Inbox,
  Play,
  Plus,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { formatDate } from "../../lib/format";
import {
  ASSET_TYPE_LABELS,
  ENGINE_LABELS,
  LEDGER_TYPE_LABELS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
} from "../../lib/labels";
import { listAiRuns } from "../../lib/coreClient";
import { RUN_DOT, RUN_LABELS } from "../../lib/runLabels";
import TaskValidationPanel from "./TaskValidationPanel";
import TaskWorkPanel from "./TaskWorkPanel";
import type {
  AiRun,
  AssetPassport,
  LedgerEvent,
  ProviderInfo,
  Task,
  TaskStatus,
} from "../../lib/types";

type Props = {
  task: Task;
  assets: AssetPassport[];
  providers: ProviderInfo[];
  defaultProvider: string;
  events: LedgerEvent[];
  importing: boolean;
  onBack: () => void;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onCapsule: () => void;
  onResponse: () => void;
  onImportAsset: () => void;
  onOpenAsset: (assetId: string) => void;
  onEditSkills: () => void;
  onOpenAgents: () => void;
  onTaskChanged: () => void;
  onNotify: (text: string, tone?: "error" | "warning") => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
};

type Tab = "overview" | "work" | "checks" | "artifacts" | "activity";

export default function TaskDetail({
  task,
  assets,
  providers,
  defaultProvider,
  events,
  importing,
  onBack,
  onStatusChange,
  onCapsule,
  onResponse,
  onImportAsset,
  onOpenAsset,
  onEditSkills,
  onOpenAgents,
  onTaskChanged,
  onNotify,
  onArchive,
  onRestore,
  onDelete,
}: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [validationRefresh, setValidationRefresh] = useState(0);
  const [runs, setRuns] = useState<AiRun[]>([]);
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    let alive = true;
    listAiRuns(task.id)
      .then((rows) => {
        if (alive) setRuns(rows);
      })
      .catch(() => {
        if (alive) setRuns([]);
      });
    return () => {
      alive = false;
    };
  }, [task.id, task.updated_at, validationRefresh]);

  const doneCount = task.criteria.filter((criterion) => criterion.done).length;
  const total = task.criteria.length;
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  const taskEvents = events.filter((event) => event.subject === task.id);
  const recentEvents = taskEvents.slice(0, 6);
  const latestRun = runs[0] ?? null;
  const runTone = latestRun ? RUN_DOT[latestRun.status] : "is-idle";
  const runLabel = latestRun ? RUN_LABELS[latestRun.status] : "Нет запусков";

  const runTitle =
    latestRun?.status === "succeeded"
      ? "Задача выполнена успешно"
      : latestRun?.status === "failed"
        ? "Запуск завершился ошибкой"
        : latestRun?.status === "cancelled"
          ? "Запуск отменён"
          : latestRun?.status === "interrupted"
            ? "Запуск прерван"
            : latestRun
              ? "Агент работает"
              : "Запусков ещё не было";
  const runText =
    latestRun?.status === "succeeded"
      ? "Агент завершил работу. Результат сохранён в задаче."
      : latestRun?.status === "failed"
        ? latestRun.error || "Проверь вывод запуска."
        : latestRun?.status === "cancelled"
          ? "Запуск был отменён."
          : latestRun?.status === "interrupted"
            ? latestRun.interrupted_reason || "Запуск не был завершён."
            : latestRun
              ? "Следи за прогрессом на вкладке «Работа»."
              : "Открой вкладку «Работа», чтобы запустить агента.";

  const eventTone = (type: string) => {
    if (type.includes("check") || type.includes("validation")) return "ok";
    if (type.includes("agent") || type.includes("ai")) return "agent";
    return "neutral";
  };
  const eventIcon = (type: string) => {
    const tone = eventTone(type);
    if (tone === "ok") return <CheckCircle2 size={13} />;
    if (tone === "agent") return <Play size={12} />;
    return <span className="td2-event-dot" />;
  };

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "overview", label: "Бриф" },
    { id: "work", label: "Работа" },
    { id: "checks", label: "Проверки", count: task.validation.length },
    { id: "artifacts", label: "Результат", count: task.artifacts.length + assets.length },
    { id: "activity", label: "История" },
  ];

  return (
    <section className="task-page td2-page">
      <div className="td2-topbar">
        <button type="button" className="btn btn-secondary btn-small" onClick={onBack}>
          <ArrowLeft size={14} />
          Назад
        </button>
        <span className="td2-spacer" />
        <span className="td2-id">ID: {task.id}</span>
        {task.status === "archived" ? (
          <button type="button" className="btn btn-secondary btn-small" onClick={onRestore}>
            <ArchiveRestore size={14} />
            Вернуть
          </button>
        ) : (
          <button type="button" className="btn btn-secondary btn-small" onClick={onArchive}>
            <Archive size={14} />
            В архив
          </button>
        )}
        <button
          type="button"
          className="icon-btn is-danger"
          title="Удалить задачу"
          aria-label="Удалить задачу"
          onClick={onDelete}
        >
          <Trash2 size={15} />
        </button>
      </div>

      <header className="td2-head">
        <span className="td2-head-icon">
          <ClipboardList size={30} strokeWidth={1.35} />
        </span>
        <div className="td2-head-copy">
          <div className="td2-title-row">
            <h1>{task.title}</h1>
            <select
              className={`task-status is-${task.status} task-status-pill`}
              value={task.status}
              onChange={(event) =>
                onStatusChange(task.id, event.target.value as TaskStatus)
              }
              aria-label="Статус задачи"
            >
              {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((status) => (
                <option key={status} value={status}>
                  {TASK_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <p>
            {TASK_TYPE_LABELS[task.type]} · {ENGINE_LABELS[task.engine]} · создана{" "}
            {formatDate(task.created_at)}
          </p>
        </div>
        <div className="td2-head-actions">
          <button type="button" className="btn btn-primary btn-small" onClick={onCapsule}>
            <ClipboardCopy size={14} />
            Капсула
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={onResponse}>
            <Inbox size={14} />
            Вставить ответ
          </button>
        </div>
      </header>

      <div className="td2-tabs">
        {tabs.map((item) => (
          <button
            type="button"
            key={item.id}
            className={tab === item.id ? "is-active" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {typeof item.count === "number" ? <b>{item.count}</b> : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="td2-stack">
          <div className="td2-stats">
            <article className="td2-stat">
              <Target size={16} />
              <div>
                <span>Цель</span>
                <b>{task.goal || "Не указана"}</b>
              </div>
            </article>
            <article className="td2-stat">
              <CheckCircle2 size={16} />
              <div>
                <span>Критерии</span>
                <b>{total === 0 ? "Критерии не заданы" : `${doneCount}/${total}`}</b>
                {total > 0 ? (
                  <i className="td2-stat-bar">
                    <i style={{ width: `${percent}%` }} />
                  </i>
                ) : null}
              </div>
            </article>
            <article className="td2-stat">
              <Play size={16} />
              <div>
                <span>Режим</span>
                <b>{task.mode === "clipboard" ? "Clipboard" : task.mode}</b>
              </div>
            </article>
            <article className="td2-stat">
              <Calendar size={16} />
              <div>
                <span>Обновлена</span>
                <b>{formatDate(task.updated_at)}</b>
              </div>
            </article>
          </div>

          <article className="td2-panel">
            <div className="td2-panel-head">
              <h2>
                <Sparkles size={14} />
                Результат запуска
              </h2>
              <span className={`td2-run-pill ${runTone}`}>
                <i />
                {runLabel}
              </span>
              {latestRun ? (
                <small>{formatDate(latestRun.finished_at || latestRun.started_at || latestRun.created_at)}</small>
              ) : null}
              <button
                type="button"
                className={`td2-chevron${showResult ? " is-open" : ""}`}
                onClick={() => setShowResult((value) => !value)}
                aria-label="Показать результат"
              >
                <ChevronDown size={14} />
              </button>
            </div>
            <div className="td2-result">
              <span className={`td2-result-icon ${runTone}`}>
                {latestRun?.status === "succeeded" ? (
                  <Check size={20} strokeWidth={3} />
                ) : (
                  <Play size={16} />
                )}
              </span>
              <div>
                <b>{runTitle}</b>
                <p>{runText}</p>
              </div>
            </div>
            {latestRun ? (
              <>
                <button
                  type="button"
                  className={`td2-details-toggle${showResult ? " is-open" : ""}`}
                  onClick={() => setShowResult((value) => !value)}
                >
                  <ChevronDown size={13} />
                  {showResult ? "Скрыть детали" : "Показать детали"}
                </button>
                {showResult ? (
                  <pre className="td2-result-output">
                    {latestRun.output || latestRun.error || "Вывод пуст"}
                  </pre>
                ) : null}
              </>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-small td2-to-work"
                onClick={() => setTab("work")}
              >
                Перейти к работе
              </button>
            )}
          </article>

          <article className="td2-panel td2-why">
            <div className="td2-panel-head">
              <h2>
                <Sparkles size={14} />
                Почему так вышло?
              </h2>
              <button type="button" className="agent-link" onClick={() => setTab("work")}>
                К запуску →
              </button>
            </div>
            <div className="td2-why-grid">
              <div>
                <span>Исполнитель</span>
                <b>{latestRun?.provider_name || (task.mode === "clipboard" ? "Clipboard" : task.mode)}</b>
                <small>{latestRun?.model || "модель не указана"}</small>
              </div>
              <div>
                <span>Изменения</span>
                <b>{latestRun ? latestRun.changes.length : 0}</b>
                <small>
                  {latestRun?.review_id
                    ? "результат ждёт приёмки в Review"
                    : latestRun
                      ? "файлы и вывод сохранены в запуске"
                      : "запусков ещё не было"}
                </small>
              </div>
              <div>
                <span>Проверки</span>
                <b>{task.validation.length}</b>
                <small>
                  {task.validation.length > 0
                    ? task.validation.map((item) => item.label).join(" · ")
                    : "команды не настроены"}
                </small>
              </div>
              <div>
                <span>Страховка</span>
                <b>{latestRun?.snapshot_id ? "Снапшот" : latestRun ? "Без снапшота" : "—"}</b>
                <small>
                  {latestRun?.snapshot_id
                    ? latestRun.snapshot_id
                    : "Kova создаёт снапшот перед применением worktree"}
                </small>
              </div>
            </div>
            <p className="td2-why-note">
              Объяснение собрано из журнала: кто выполнял задачу, что изменилось,
              какие проверки настроены и где сохранён результат. Это не догадка модели.
            </p>
            <div className="td2-why-actions">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setTab("checks")}>
                Проверки
              </button>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setTab("artifacts")}>
                Результат
              </button>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setTab("activity")}>
                История
              </button>
            </div>
          </article>

          <article className="td2-panel td2-context">
            <div className="td2-panel-head">
              <h2>
                <ClipboardList size={14} />
                Контекст задачи
              </h2>
            </div>
            <div className="td2-context-grid">
              <div>
                <span>Цель</span>
                <p>{task.goal || "Не указана"}</p>
                {task.constraints.length > 0 ? (
                  <>
                    <span>Ограничения</span>
                    <ul className="td2-list">
                      {task.constraints.map((constraint) => (
                        <li key={constraint}>{constraint}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
              <div>
                <span>Критерии готовности</span>
                {task.criteria.length === 0 ? (
                  <p className="detail-muted">Критерии не заданы</p>
                ) : (
                  <ul className="criteria-list td-criteria">
                    {task.criteria.map((criterion) => (
                      <li key={criterion.id} className={criterion.done ? "is-done" : ""}>
                        <span className="criteria-box">
                          {criterion.done ? <Check size={10} strokeWidth={3} /> : null}
                        </span>
                        {criterion.text}
                      </li>
                    ))}
                  </ul>
                )}
                <span>Скиллы</span>
                {task.skills.length === 0 ? (
                  <p className="detail-muted">Не выбраны — Kova подберёт по задаче</p>
                ) : (
                  <div className="blender-chips task-skills">
                    {task.skills.map((name) => (
                      <span className="blender-chip" key={name}>
                        {name.replace("blender-", "")}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={onEditSkills}
                >
                  <BookOpen size={13} />
                  Выбрать скиллы
                </button>
              </div>
            </div>
          </article>

          <article className="td2-panel">
            <div className="td2-panel-head">
              <h2>
                <Clock size={14} />
                Последняя активность
              </h2>
              <button type="button" className="agent-link" onClick={() => setTab("activity")}>
                Все события →
              </button>
            </div>
            {recentEvents.length === 0 ? (
              <p className="td2-empty">Событий пока нет.</p>
            ) : (
              <ul className="td2-events">
                {recentEvents.map((event) => (
                  <li key={event.id}>
                    <small>{formatDate(event.at)}</small>
                    <span className={`td2-event-icon is-${eventTone(event.type)}`}>
                      {eventIcon(event.type)}
                    </span>
                    <span>{LEDGER_TYPE_LABELS[event.type] ?? event.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      ) : null}

      {tab === "work" ? (
        <TaskWorkPanel
          task={task}
          providers={providers}
          defaultProvider={defaultProvider}
          onCapsule={onCapsule}
          onOpenAgents={onOpenAgents}
          onFinished={onTaskChanged}
          onValidationRefresh={() => setValidationRefresh((value) => value + 1)}
          onNotify={onNotify}
        />
      ) : null}

      {tab === "checks" ? (
        <TaskValidationPanel
          task={task}
          onTaskChanged={onTaskChanged}
          refreshKey={validationRefresh}
          onNotify={onNotify}
        />
      ) : null}

      {tab === "artifacts" ? (
        <div className="td2-stack">
          <article className="td2-panel">
            <div className="td2-panel-head">
              <h2>Артефакты</h2>
            </div>
            {task.artifacts.length === 0 ? (
              <p className="td2-empty">Пока нет ответов и файлов.</p>
            ) : (
              <ul className="td2-list td2-artifacts">
                {task.artifacts.map((artifact) => (
                  <li key={artifact.id}>
                    <span>{artifact.kind === "response" ? "Ответ AI" : artifact.kind}</span>
                    <small>
                      {artifact.path.split("/").pop()} · {formatDate(artifact.created_at)}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </article>
          <article className="td2-panel">
            <div className="td2-panel-head">
              <h2>Ассеты</h2>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={importing}
                onClick={onImportAsset}
              >
                <Plus size={13} />
                {importing ? "Импорт…" : "Импортировать"}
              </button>
            </div>
            {assets.length === 0 ? (
              <p className="td2-empty">Нет привязанных ассетов.</p>
            ) : (
              <ul className="td2-list td2-artifacts">
                {assets.map((asset) => {
                  const current =
                    asset.versions.find((item) => item.id === asset.current_version_id) ??
                    asset.versions[asset.versions.length - 1];
                  return (
                    <li key={asset.id}>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onOpenAsset(asset.id)}
                      >
                        {asset.name}
                      </button>
                      <small>
                        {ASSET_TYPE_LABELS[asset.type] ?? asset.type}
                        {current ? ` · ${current.label}` : ""}
                      </small>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        </div>
      ) : null}

      {tab === "activity" ? (
        <article className="td2-panel">
          <div className="td2-panel-head">
            <h2>
              <Activity size={14} />
              Активность задачи
            </h2>
            <small>{taskEvents.length}</small>
          </div>
          {taskEvents.length === 0 ? (
            <p className="td2-empty">Событий пока нет.</p>
          ) : (
            <ul className="td2-events is-full">
              {taskEvents.map((event) => (
                <li key={event.id}>
                  <small>{formatDate(event.at)}</small>
                  <span className={`td2-event-icon is-${eventTone(event.type)}`}>
                    {eventIcon(event.type)}
                  </span>
                  <span>{LEDGER_TYPE_LABELS[event.type] ?? event.type}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
      ) : null}
    </section>
  );
}
