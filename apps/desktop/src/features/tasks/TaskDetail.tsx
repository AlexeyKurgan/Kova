import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bot,
  BookOpen,
  Check,
  ClipboardCopy,
  ClipboardList,
  Inbox,
  Plus,
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
import type {
  AssetPassport,
  LedgerEvent,
  Task,
  TaskStatus,
} from "../../lib/types";

type Props = {
  task: Task;
  assets: AssetPassport[];
  events: LedgerEvent[];
  importing: boolean;
  onBack: () => void;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onCapsule: () => void;
  onResponse: () => void;
  onImportAsset: () => void;
  onOpenAsset: (assetId: string) => void;
  onEditSkills: () => void;
  onRunAi: () => void;
  aiRunning: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
};

export default function TaskDetail({
  task,
  assets,
  events,
  importing,
  onBack,
  onStatusChange,
  onCapsule,
  onResponse,
  onImportAsset,
  onOpenAsset,
  onEditSkills,
  onRunAi,
  aiRunning,
  onArchive,
  onRestore,
  onDelete,
}: Props) {
  const blenderRelevant =
    task.engine === "blender" ||
    ["model", "animation", "texture", "effect", "level", "export"].includes(task.type);
  const doneCount = task.criteria.filter((criterion) => criterion.done).length;
  const total = task.criteria.length;
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  const taskEvents = events.filter((event) => event.subject === task.id).slice(0, 6);

  return (
    <section className="assets-screen">
      <div className="task-detail-bar">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          <ArrowLeft size={15} />
          Задачи
        </button>
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
        <span className="task-detail-spacer" />
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

      <div className="assets-heading">
        <ClipboardList size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>{task.title}</h1>
          <p className="subtitle">
            {TASK_TYPE_LABELS[task.type]} · {ENGINE_LABELS[task.engine]} · создана{" "}
            {formatDate(task.created_at)}
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-primary" onClick={onCapsule}>
            <ClipboardCopy size={15} />
            Подготовить капсулу
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onRunAi}
            disabled={aiRunning}
          >
            <Bot size={15} />
            {aiRunning ? "AI работает…" : "Запустить AI"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onResponse}>
            <Inbox size={15} />
            Вставить ответ
          </button>
        </div>
      </div>

      <div className="task-summary">
        <div className="task-summary-item">
          <span>Критерии</span>
          <b>
            {doneCount}/{total}
          </b>
          <span className="task-summary-bar">
            <span style={{ width: `${percent}%` }} />
          </span>
        </div>
        <div className="task-summary-item">
          <span>Ассеты</span>
          <b>{assets.length}</b>
        </div>
        <div className="task-summary-item">
          <span>Скиллы</span>
          <b>{task.skills.length === 0 ? "авто" : task.skills.length}</b>
        </div>
        <div className="task-summary-item">
          <span>Обновлена</span>
          <b>{formatDate(task.updated_at)}</b>
        </div>
        <div className="task-summary-item is-id">
          <span>ID</span>
          <b>{task.id}</b>
        </div>
      </div>

      <div className="detail-grid">
        <article className="detail-card">
          <h2>Цель</h2>
          <p>{task.goal || "Не указана"}</p>

          <h2>Критерии готовности</h2>
          {task.criteria.length === 0 ? (
            <p className="detail-muted">Критерии не заданы</p>
          ) : (
            <ul className="criteria-list">
              {task.criteria.map((criterion) => (
                <li key={criterion.id} className={criterion.done ? "is-done" : ""}>
                  <span className="criteria-box">
                    {criterion.done ? <Check size={11} strokeWidth={3} /> : null}
                  </span>
                  {criterion.text}
                </li>
              ))}
            </ul>
          )}

          {task.constraints.length > 0 ? (
            <>
              <h2>Ограничения</h2>
              <ul className="criteria-list">
                {task.constraints.map((constraint) => (
                  <li key={constraint}>{constraint}</li>
                ))}
              </ul>
            </>
          ) : null}

          {blenderRelevant ? (
            <>
              <h2>Скиллы Blender</h2>
              {task.skills.length === 0 ? (
                <p className="detail-muted">Авто: Kova подберёт по типу задачи</p>
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
                <BookOpen size={14} />
                Выбрать скиллы
              </button>
            </>
          ) : null}
        </article>

        <article className="detail-card">
          <h2>Следующий шаг</h2>
          <p>{task.next_step || "Определи после ответа агента"}</p>

          <h2>Артефакты</h2>
          {task.artifacts.length === 0 ? (
            <p className="detail-muted">Пока нет ответов и файлов</p>
          ) : (
            <ul className="criteria-list">
              {task.artifacts.map((artifact) => (
                <li key={artifact.id}>
                  {artifact.kind === "response" ? "Ответ AI" : artifact.kind} ·{" "}
                  {artifact.path.split("/").pop()} · {formatDate(artifact.created_at)}
                </li>
              ))}
            </ul>
          )}

          <h2>Ассеты</h2>
          {assets.length === 0 ? (
            <p className="detail-muted">Нет привязанных ассетов</p>
          ) : (
            <ul className="criteria-list">
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
                    <span className="detail-muted">
                      {" "}
                      · {ASSET_TYPE_LABELS[asset.type] ?? asset.type}
                      {current ? ` · ${current.label}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={importing}
            onClick={onImportAsset}
          >
            <Plus size={15} />
            {importing ? "Импорт…" : "Импортировать ассет"}
          </button>

          <h2>Режим</h2>
          <p className="detail-muted">
            {task.mode === "clipboard" ? "Clipboard — бесплатно, через буфер обмена" : task.mode}
          </p>
        </article>

        <article className="detail-card task-activity-card">
          <h2>Активность задачи</h2>
          {taskEvents.length === 0 ? (
            <p className="detail-muted">Событий пока нет — начни с капсулы или ответа AI.</p>
          ) : (
            <ul className="task-activity-list">
              {taskEvents.map((event) => (
                <li key={event.id}>
                  <span>{LEDGER_TYPE_LABELS[event.type] ?? event.type}</span>
                  <span className="detail-muted">{formatDate(event.at)}</span>
                </li>
              ))}
            </ul>
          )}
          <h2>Создана</h2>
          <p className="detail-muted">{formatDate(task.created_at)}</p>
        </article>
      </div>
    </section>
  );
}
