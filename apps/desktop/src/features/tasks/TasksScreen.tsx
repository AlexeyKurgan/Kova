import { useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Box,
  ChevronRight,
  ClipboardList,
  Ellipsis,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { formatDate, plural } from "../../lib/format";
import { coreUrl } from "../../lib/coreClient";
import {
  ENGINE_LABELS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
} from "../../lib/labels";
import type { AssetPassport, Task, TaskType } from "../../lib/types";

type Props = {
  tasks: Task[];
  trashTasks: Task[];
  assets: AssetPassport[];
  projectCover: string | null;
  onCreateTask: () => void;
  onOpenTask: (taskId: string) => void;
  onArchive: (taskId: string) => void;
  onRestore: (taskId: string) => void;
  onDelete: (task: Task) => void;
  onRestoreTrash: (taskId: string) => void;
  onPurge: (task: Task) => void;
};

type StatusFilter = "all" | "active" | "done" | "archive" | "trash";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Все задачи" },
  { value: "active", label: "Активные" },
  { value: "done", label: "Готовые" },
  { value: "archive", label: "Архив" },
  { value: "trash", label: "Корзина" },
];

const TYPE_ORDER: TaskType[] = ["model", "animation", "texture", "effect", "level", "export", "code"];

function isActive(task: Task) {
  return task.status !== "done" && task.status !== "archived";
}

function taskTypeValue(type: TaskType) {
  return TASK_TYPE_LABELS[type] ?? type;
}

export default function TasksScreen({
  tasks,
  trashTasks,
  assets,
  projectCover,
  onCreateTask,
  onOpenTask,
  onArchive,
  onRestore,
  onDelete,
  onRestoreTrash,
  onPurge,
}: Props) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState<"all" | TaskType>("all");
  const [sort, setSort] = useState("recent");
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      all: tasks.length,
      active: tasks.filter(isActive).length,
      done: tasks.filter((task) => task.status === "done").length,
      archive: tasks.filter((task) => task.status === "archived").length,
      trash: trashTasks.length,
    }),
    [tasks, trashTasks],
  );

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    const base = status === "trash" ? trashTasks : tasks;
    const rows = base.filter((task) => {
      if (status === "active" && !isActive(task)) return false;
      if (status === "done" && task.status !== "done") return false;
      if (status === "archive" && task.status !== "archived") return false;
      if (type !== "all" && task.type !== type) return false;
      if (!search) return true;
      return `${task.title} ${task.goal} ${task.tags.join(" ")} ${taskTypeValue(task.type)}`
        .toLowerCase()
        .includes(search);
    });
    return [...rows].sort((left, right) => {
      if (sort === "name") return left.title.localeCompare(right.title, "ru");
      if (sort === "progress") {
        const leftTotal = left.criteria.length || 1;
        const rightTotal = right.criteria.length || 1;
        const leftDone = left.criteria.filter((item) => item.done).length / leftTotal;
        const rightDone = right.criteria.filter((item) => item.done).length / rightTotal;
        return rightDone - leftDone;
      }
      return (right.updated_at || "").localeCompare(left.updated_at || "");
    });
  }, [query, sort, status, tasks, trashTasks, type]);

  const assetsFor = (task: Task) => assets.filter((asset) => asset.task_ids.includes(task.id)).length;
  const isTrash = status === "trash";

  return (
    <section className="assets-screen tasks-screen">
      <div className="assets-heading">
        <ClipboardList size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>Задачи</h1>
          <p className="subtitle">
            Цель, критерии готовности и связанные ассеты — рабочий контекст вместо чата.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-primary" onClick={onCreateTask}>
            <Plus size={15} />
            Новая задача
          </button>
        </div>
      </div>

      <div className="resource-toolbar">
        <label className="resource-search">
          <Search size={14} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск задач…"
            aria-label="Поиск задач"
          />
        </label>
        <select
          className="filter-select"
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          aria-label="Статус задач"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({counts[option.value]})
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={type}
          onChange={(event) => setType(event.target.value as "all" | TaskType)}
          aria-label="Тип задачи"
        >
          <option value="all">Все типы</option>
          {TYPE_ORDER.map((item) => (
            <option key={item} value={item}>
              {taskTypeValue(item)}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          aria-label="Сортировка"
        >
          <option value="recent">Последние</option>
          <option value="name">По названию</option>
          <option value="progress">По прогрессу</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-art">
            <Sparkles size={22} className="empty-sparkle" />
          </div>
          <h2 className="empty-title">
            {isTrash
              ? "Корзина пуста"
              : tasks.length === 0
                ? "Пока нет задач"
                : "Здесь пусто"}
          </h2>
          <p className="empty-text">
            {isTrash
              ? "Удалённые задачи появятся здесь — их можно восстановить."
              : tasks.length === 0
                ? "Нажми «Новая задача» в правом верхнем углу."
                : "Смени фильтры или сбрось поиск."}
          </p>
        </div>
      ) : (
        <div className="task-list">
          {visible.map((task) => {
            const done = task.criteria.filter((criterion) => criterion.done).length;
            const total = task.criteria.length;
            const percent = total === 0 ? 0 : Math.round((done / total) * 100);
            const linkedAssets = assetsFor(task);
            const linkedPreview = task.asset_ids
              .map((assetId) => assets.find((asset) => asset.id === assetId))
              .find((asset): asset is AssetPassport => Boolean(asset?.preview));
            const thumbnail = linkedPreview
              ? `${coreUrl(`/assets/${linkedPreview.id}/preview`)}?v=${encodeURIComponent(
                  linkedPreview.updated_at,
                )}`
              : undefined;
            return (
              <article className={`task-card2${isTrash ? " is-trash" : ""}`} key={task.id}>
                <div className="task-thumb2">
                  {linkedPreview ? (
                    <img src={thumbnail} alt="" />
                  ) : task.asset_ids.length > 0 ? (
                    <Box size={28} strokeWidth={1.4} />
                  ) : projectCover ? (
                    <img src={projectCover} alt="" />
                  ) : (
                    <ClipboardList size={28} strokeWidth={1.4} />
                  )}
                </div>
                <div className="task-body2">
                  <div className="task-head2">
                    <span className={`task-status is-${isTrash ? "deleted" : task.status}`}>
                      {isTrash ? "В корзине" : TASK_STATUS_LABELS[task.status]}
                    </span>
                    <span className="task-id2">#{task.id.slice(-4)}</span>
                    <span className="task-type-chip">{taskTypeValue(task.type)}</span>
                    <span className="task-updated2">{formatDate(task.updated_at)}</span>
                  </div>
                  <h2>{task.title}</h2>
                  <p className="task-goal2">{task.goal || "Цель пока не задана"}</p>
                  <div className="task-meta2">
                    <span>{ENGINE_LABELS[task.engine]}</span>
                    {linkedAssets > 0 ? (
                      <span>
                        <Box size={12} />
                        {linkedAssets} {plural(linkedAssets, ["ассет", "ассета", "ассетов"])}
                      </span>
                    ) : null}
                    {task.skills.length > 0 ? (
                      <span>
                        <Sparkles size={12} />
                        {task.skills.length} скиллов
                      </span>
                    ) : null}
                  </div>
                  <div className="task-progress2">
                    <span className="task-progress-bar">
                      <span style={{ width: `${percent}%` }} />
                    </span>
                    <span>{done}/{total}</span>
                  </div>
                </div>

                <div className="task-actions2">
                  {!isTrash ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => { setMenuFor(null); onOpenTask(task.id); }}
                    >
                      Открыть задачу
                      <ChevronRight size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => onRestoreTrash(task.id)}
                    >
                      <ArchiveRestore size={14} />
                      Восстановить
                    </button>
                  )}
                  <div className="task-menu-wrap">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setMenuFor(menuFor === task.id ? null : task.id)}
                      aria-label="Действия с задачей"
                      title="Действия"
                    >
                      <Ellipsis size={16} />
                    </button>
                    {menuFor === task.id ? (
                      <div className="project-menu">
                        {isTrash ? (
                          <button type="button" className="is-danger" onClick={() => { setMenuFor(null); onPurge(task); }}>
                            <Trash2 size={13} />
                            Удалить навсегда
                          </button>
                        ) : (
                          <>
                            <button type="button" onClick={() => { setMenuFor(null); onOpenTask(task.id); }}>
                              <ChevronRight size={13} />
                              Открыть
                            </button>
                            {task.status === "archived" ? (
                              <button type="button" onClick={() => { setMenuFor(null); onRestore(task.id); }}>
                                <ArchiveRestore size={13} />
                                Вернуть из архива
                              </button>
                            ) : (
                              <button type="button" onClick={() => { setMenuFor(null); onArchive(task.id); }}>
                                <Archive size={13} />
                                В архив
                              </button>
                            )}
                            <button
                              type="button"
                              className="is-danger"
                              onClick={() => { setMenuFor(null); onDelete(task); }}
                            >
                              <Trash2 size={13} />
                              В корзину
                            </button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
