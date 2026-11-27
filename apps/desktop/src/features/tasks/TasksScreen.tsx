import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Box,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Code,
  Ellipsis,
  LayoutGrid,
  List,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import BrandIcon from "../../components/BrandIcon";
import { engineBrand } from "../../lib/brands";
import { TASK_TEMPLATES } from "../../lib/taskTemplates";
import { formatDate } from "../../lib/format";
import { listPackageTaskTemplates, mediaUrl } from "../../lib/coreClient";
import { t, tp } from "../../lib/i18n";
import {
  ENGINE_LABELS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
} from "../../lib/labels";
import type {
  AssetPassport,
  PackageTaskTemplate,
  Task,
  TaskType,
} from "../../lib/types";

type Props = {
  tasks: Task[];
  trashTasks: Task[];
  assets: AssetPassport[];
  projectCover: string | null;
  projectName: string;
  onCreateTask: () => void;
  onUseTemplate: (templateId: string) => void;
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
  projectName,
  onCreateTask,
  onUseTemplate,
  onOpenTask,
  onArchive,
  onRestore,
  onDelete,
  onRestoreTrash,
  onPurge,
}: Props) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [packageTemplates, setPackageTemplates] = useState<PackageTaskTemplate[]>([]);
  const [type, setType] = useState<"all" | TaskType>("all");
  const [sort, setSort] = useState("recent");
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "grid">("table");
  const [page, setPage] = useState(0);
  const templates = useMemo(
    () => [...packageTemplates, ...TASK_TEMPLATES],
    [packageTemplates],
  );

  useEffect(() => {
    let alive = true;
    listPackageTaskTemplates()
      .then((rows) => {
        if (alive) setPackageTemplates(rows);
      })
      .catch(() => {
        // Package templates are optional.
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!menuFor) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".task-menu-wrap")) return;
      setMenuFor(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuFor]);

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

  const isTrash = status === "trash";
  const PAGE_SIZE = 8;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const paged = visible.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const thumbnailFor = (task: Task) => {
    const linkedPreview = task.asset_ids
      .map((assetId) => assets.find((asset) => asset.id === assetId))
      .find((asset): asset is AssetPassport => Boolean(asset?.preview));
    if (linkedPreview) {
      return mediaUrl(`/assets/${linkedPreview.id}/preview`, {
        v: linkedPreview.updated_at,
      });
    }
    return projectCover || undefined;
  };

  const renderMenu = (task: Task) => (
    <div className="project-menu">
      {isTrash ? (
        <button
          type="button"
          className="is-danger"
          onClick={() => {
            setMenuFor(null);
            onPurge(task);
          }}
        >
          <Trash2 size={13} />
          {t("Удалить навсегда")}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setMenuFor(null);
              onOpenTask(task.id);
            }}
          >
            <ChevronRight size={13} />
            {t("Открыть")}
          </button>
          {task.status === "archived" ? (
            <button
              type="button"
              onClick={() => {
                setMenuFor(null);
                onRestore(task.id);
              }}
            >
              <ArchiveRestore size={13} />
              {t("Вернуть из архива")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMenuFor(null);
                onArchive(task.id);
              }}
            >
              <Archive size={13} />
              {t("В архив")}
            </button>
          )}
          <button
            type="button"
            className="is-danger"
            onClick={() => {
              setMenuFor(null);
              onDelete(task);
            }}
          >
            <Trash2 size={13} />
            {t("В корзину")}
          </button>
        </>
      )}
    </div>
  );

  return (
    <section className="tasks-page">
      <header className="tk-head">
        <span className="tk-head-icon">
          <ClipboardList size={34} strokeWidth={1.3} />
        </span>
        <div className="tk-head-copy">
          <h1>{t("Задачи")}</h1>
          <p>{t("Цель, критерии готовности и связанные ассеты.")}</p>
        </div>
        <div className="tk-head-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setLibraryOpen(true)}
          >
            <BookOpen size={15} />
            {t("Шаблоны")}
          </button>
          <button type="button" className="btn btn-primary" onClick={onCreateTask}>
            <Plus size={15} />
            {t("Новая задача")}
          </button>
        </div>
      </header>

      <div className="tk-toolbar">
        <label className="resource-search tk-search">
          <Search size={14} />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder={t("Поиск задач…")}
            aria-label={t("Поиск задач")}
          />
        </label>
        <select
          className="filter-select"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as StatusFilter);
            setPage(0);
          }}
          aria-label={t("Статус задач")}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)} ({counts[option.value]})
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={type}
          onChange={(event) => {
            setType(event.target.value as "all" | TaskType);
            setPage(0);
          }}
          aria-label={t("Тип задачи")}
        >
          <option value="all">{t("Все типы")}</option>
          {TYPE_ORDER.map((item) => (
            <option key={item} value={item}>
              {taskTypeValue(item)}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value);
            setPage(0);
          }}
          aria-label={t("Сортировка")}
        >
          <option value="recent">{t("Последние")}</option>
          <option value="name">{t("По названию")}</option>
          <option value="progress">{t("По прогрессу")}</option>
        </select>
        <div className="tk-view-switch">
          <button
            type="button"
            className={view === "table" ? "is-active" : ""}
            title={t("Списком")}
            onClick={() => setView("table")}
          >
            <List size={15} />
          </button>
          <button
            type="button"
            className={view === "grid" ? "is-active" : ""}
            title={t("Плиткой")}
            onClick={() => setView("grid")}
          >
            <LayoutGrid size={15} />
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-art">
            <Sparkles size={22} className="empty-sparkle" />
          </div>
          <h2 className="empty-title">
            {isTrash
              ? t("Корзина пуста")
              : tasks.length === 0
                ? t("Пока нет задач")
                : t("Здесь пусто")}
          </h2>
          <p className="empty-text">
            {isTrash
              ? t("Удалённые задачи появятся здесь — их можно восстановить.")
              : tasks.length === 0
                ? t("Нажми «Новая задача» в правом верхнем углу.")
                : t("Смени фильтры или сбрось поиск.")}
          </p>
        </div>
      ) : view === "table" ? (
        <div className="tk-table">
          <div className="tk-row is-head">
            <span>{t("Задача")}</span>
            <span>{t("Статус")}</span>
            <span>{t("Проект")}</span>
            <span>{t("Тип")}</span>
            <span>{t("Обновлена")}</span>
            <span>{t("Критерии")}</span>
            <span />
          </div>
          {paged.map((task) => {
            const done = task.criteria.filter((criterion) => criterion.done).length;
            const total = task.criteria.length;
            const percent = total === 0 ? 0 : Math.round((done / total) * 100);
            const thumb = thumbnailFor(task);
            return (
              <div
                className="tk-row"
                key={task.id}
                onClick={() => {
                  if (!isTrash) onOpenTask(task.id);
                }}
              >
                <div className="tk-task">
                  <span className="tk-thumb">
                    {thumb ? (
                      <img src={thumb} alt="" />
                    ) : task.asset_ids.length > 0 ? (
                      <Box size={17} />
                    ) : (
                      <ClipboardList size={17} />
                    )}
                  </span>
                  <span className="tk-task-copy">
                    <b>{task.title}</b>
                    <small>{task.goal || t("Цель пока не задана")}</small>
                  </span>
                </div>
                <span className={`tk-status is-${isTrash ? "deleted" : task.status}`}>
                  <i />
                  {isTrash ? t("В корзине") : TASK_STATUS_LABELS[task.status]}
                </span>
                <span className="tk-cell">
                  {engineBrand(task.engine) ? (
                    <BrandIcon name={engineBrand(task.engine)!} size={13} />
                  ) : (
                    <Box size={13} />
                  )}
                  <span>{projectName || ENGINE_LABELS[task.engine]}</span>
                </span>
                <span className="tk-cell">
                  {task.type === "model" ? (
                    <Box size={13} />
                  ) : task.type === "code" ? (
                    <Code size={13} />
                  ) : (
                    <ClipboardList size={13} />
                  )}
                  <span>{taskTypeValue(task.type)}</span>
                </span>
                <span className="tk-muted">{formatDate(task.updated_at)}</span>
                <span className="tk-criteria">
                  <span className="tk-progress">
                    <i style={{ width: `${percent}%` }} />
                  </span>
                  <small>
                    {done}/{total}
                  </small>
                </span>
                <span className="tk-actions">
                  {!isTrash ? (
                    <button
                      type="button"
                      className="tk-icon-btn"
                      title={t("Открыть задачу")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenTask(task.id);
                      }}
                    >
                      <Play size={13} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="tk-icon-btn"
                      title={t("Восстановить")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRestoreTrash(task.id);
                      }}
                    >
                      <ArchiveRestore size={13} />
                    </button>
                  )}
                  <div className="task-menu-wrap">
                    <button
                      type="button"
                      className="tk-icon-btn"
                      aria-label={t("Действия с задачей")}
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenuFor(menuFor === task.id ? null : task.id);
                      }}
                    >
                      <Ellipsis size={15} />
                    </button>
                    {menuFor === task.id ? renderMenu(task) : null}
                  </div>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="tk-grid">
          {paged.map((task) => {
            const done = task.criteria.filter((criterion) => criterion.done).length;
            const total = task.criteria.length;
            const percent = total === 0 ? 0 : Math.round((done / total) * 100);
            const thumb = thumbnailFor(task);
            return (
              <article className="tk-card" key={task.id} onClick={() => !isTrash && onOpenTask(task.id)}>
                <div className="tk-card-thumb">
                  {thumb ? (
                    <img src={thumb} alt="" />
                  ) : (
                    <ClipboardList size={26} />
                  )}
                </div>
                <div className="tk-card-body">
                  <div className="tk-card-top">
                    <span className={`tk-status is-${isTrash ? "deleted" : task.status}`}>
                      <i />
                      {isTrash ? t("В корзине") : TASK_STATUS_LABELS[task.status]}
                    </span>
                    <small>{formatDate(task.updated_at)}</small>
                  </div>
                  <b>{task.title}</b>
                  <p>{task.goal || t("Цель пока не задана")}</p>
                  <div className="tk-card-meta">
                    <span>{projectName || ENGINE_LABELS[task.engine]}</span>
                    <span>{taskTypeValue(task.type)}</span>
                  </div>
                  <div className="tk-criteria">
                    <span className="tk-progress">
                      <i style={{ width: `${percent}%` }} />
                    </span>
                    <small>
                      {done}/{total}
                    </small>
                  </div>
                </div>
                <div className="tk-card-actions">
                  {!isTrash ? (
                    <button
                      type="button"
                      className="tk-icon-btn"
                      title={t("Открыть задачу")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenTask(task.id);
                      }}
                    >
                      <Play size={13} />
                    </button>
                  ) : null}
                  <div className="task-menu-wrap">
                    <button
                      type="button"
                      className="tk-icon-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenuFor(menuFor === task.id ? null : task.id);
                      }}
                    >
                      <Ellipsis size={15} />
                    </button>
                    {menuFor === task.id ? renderMenu(task) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <footer className="tk-footer">
        <span>
          {t("Показано {from}–{to} из {count}", {
            from: currentPage * PAGE_SIZE + 1,
            to: Math.min(visible.length, (currentPage + 1) * PAGE_SIZE),
            count: visible.length,
          })}{" "}
          {tp(visible.length, ["задача", "задачи", "задач"], "task", "tasks")}
        </span>
        <div className="tk-pager">
          <button
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage(Math.max(0, currentPage - 1))}
            aria-label={t("Назад")}
          >
            <ChevronLeft size={14} />
          </button>
          <span>{currentPage + 1}</span>
          <button
            type="button"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
            aria-label={t("Вперёд")}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </footer>
      {libraryOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLibraryOpen(false);
          }}
        >
          <div className="modal modal-wide template-library">
            <div className="modal-header">
              <span className="modal-title">
                <BookOpen size={15} />
                {t("Библиотека задач")}
              </span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setLibraryOpen(false)}
                aria-label={t("Закрыть")}
              >
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              <p className="detail-muted">
                {t("Готовые брифы с целью и критериями готовности. Выбери шаблон — Kova откроет задачу с заполненными полями.")}
              </p>
              <div className="template-library-grid">
                {templates.map((template) => (
                  <article className="template-card" key={template.id}>
                    <div className="template-card-head">
                      <b>{template.label}</b>
                      <span className="template-engine">{ENGINE_LABELS[template.engine]}</span>
                    </div>
                    {template.id.includes("::") ? (
                      <small className="template-package">из пакета</small>
                    ) : null}
                    <small className="template-type">{TASK_TYPE_LABELS[template.type]}</small>
                    <p>{template.goal}</p>
                    <ul>
                      {template.criteria.slice(0, 3).map((criterion) => (
                        <li key={criterion}>{criterion}</li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      onClick={() => {
                        setLibraryOpen(false);
                        onUseTemplate(template.id);
                      }}
                    >
                      <Plus size={13} />
                      {t("Использовать")}
                    </button>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
