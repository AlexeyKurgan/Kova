import {
  ArrowRight,
  Bot,
  Box,
  Camera,
  ClipboardList,
  Clock3,
  Code2,
  FolderKanban,
  Play,
  Plus,
  Star,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import BrandIcon from "../../components/BrandIcon";
import type { BrandName } from "../../components/brandPaths";
import { engineBrand } from "../../lib/brands";
import { mediaUrl } from "../../lib/coreClient";
import { formatDate } from "../../lib/format";
import { t, tp } from "../../lib/i18n";
import {
  ENGINE_LABELS,
  LEDGER_TYPE_LABELS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
} from "../../lib/labels";
import type {
  AssetPassport,
  BlenderStatus,
  LedgerEvent,
  Project,
  ProjectCard,
  ReviewItem,
  Task,
} from "../../lib/types";

type Props = {
  project: Project | null;
  projectPath: string | null;
  tasks: Task[];
  assets: AssetPassport[];
  review: ReviewItem[];
  projects: ProjectCard[];
  events: LedgerEvent[];
  blender: BlenderStatus | null;
  importing: boolean;
  onCreateTask: () => void;
  onImportAsset: () => void;
  onOpenEditor: () => void;
  onOpenBlender: () => void;
  onOpenProjects: () => void;
  onOpenTasks: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenProject: (projectId: string) => void;
  onOpenReview: () => void;
  onOpenAssets: () => void;
  onOpenActivity: () => void;
};

type EventMeta = {
  icon?: LucideIcon;
  brand?: BrandName;
  tone: string;
};

function eventMeta(type: string): EventMeta {
  if (type.startsWith("blender.")) return { brand: "blender", tone: "blender" };
  if (type.startsWith("asset.")) return { icon: Box, tone: "asset" };
  if (type.startsWith("ai.") || type.startsWith("response.")) {
    return { icon: Bot, tone: "ai" };
  }
  if (type.startsWith("review.")) return { icon: Star, tone: "review" };
  if (type.startsWith("snapshot.")) return { icon: Camera, tone: "snapshot" };
  if (type.startsWith("project.")) return { icon: FolderKanban, tone: "project" };
  return { icon: ClipboardList, tone: "task" };
}

export default function OverviewScreen({
  project,
  projectPath,
  tasks,
  assets,
  review,
  projects,
  events,
  blender,
  importing,
  onCreateTask,
  onImportAsset,
  onOpenEditor,
  onOpenBlender,
  onOpenProjects,
  onOpenTasks,
  onOpenTask,
  onOpenProject,
  onOpenReview,
  onOpenAssets,
  onOpenActivity,
}: Props) {
  const pendingReview = review.filter((item) => item.status === "pending");
  const active = tasks.filter(
    (task) => task.status !== "done" && task.status !== "archived",
  );
  const currentTask =
    active.find((task) => task.status === "working") ??
    active.find((task) => task.status === "checking") ??
    active.find((task) => task.status === "ready") ??
    active[0] ??
    null;
  const currentProject = projects.find((item) => item.active) ?? projects[0];
  const cover = currentProject?.cover_url ? mediaUrl(currentProject.cover_url) : "";
  const heroBrand = project ? engineBrand(project.engine) : null;
  const done = currentTask
    ? currentTask.criteria.filter((criterion) => criterion.done).length
    : 0;
  const total = currentTask?.criteria.length ?? 0;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <section className="assets-screen overview-screen">
      <div
        className={`ov-hero${cover ? " has-cover" : ""}`}
        style={cover ? { backgroundImage: `url("${cover}")` } : undefined}
      >
        <div className="ov-hero-overlay" />
        <div className="ov-hero-content">
          <span className="ov-hero-mark">
            {heroBrand ? (
              <BrandIcon name={heroBrand} size={34} />
            ) : (
              <FolderKanban size={30} strokeWidth={1.4} />
            )}
          </span>
          <div className="ov-hero-copy">
            <h1>{project?.name ?? "Kova Hub"}</h1>
            <p>
              {project ? ENGINE_LABELS[project.engine] : t("Проект")}
              <span>·</span>
              {projectPath ?? t("папка не выбрана")}
            </p>
          </div>
          <div className="ov-hero-actions">
            <button type="button" className="btn btn-primary" onClick={onCreateTask}>
              <Plus size={15} />
              {t("Новая задача")}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={importing}
              onClick={onImportAsset}
            >
              <Box size={15} />
              {importing ? t("Импорт…") : t("Импорт ассета")}
            </button>
          </div>
        </div>
      </div>

      <div className="ov-columns">
        <div className="ov-col">
        <article className="ov-card ov-continue">
          <div className="ov-card-head">
            <span className="ov-head-icon is-accent">
              <Play size={15} />
            </span>
            <h2>{t("Продолжить работу")}</h2>
            <button type="button" className="ov-link" onClick={onOpenTasks}>
              {t("Все задачи")}
            </button>
          </div>

          {currentTask ? (
            <div className="ov-continue-body">
              <div className="ov-task-mark">
                <ClipboardList size={26} strokeWidth={1.4} />
              </div>
              <div className="ov-task-copy">
                <div className="ov-task-top">
                  <span className={`task-status is-${currentTask.status}`}>
                    {TASK_STATUS_LABELS[currentTask.status]}
                  </span>
                  <span className="ov-task-type">
                    {TASK_TYPE_LABELS[currentTask.type]}
                  </span>
                  <span className="ov-task-date">
                    {formatDate(currentTask.updated_at)}
                  </span>
                </div>
                <h3>{currentTask.title}</h3>
                <p>{currentTask.goal || t("Цель пока не задана")}</p>
                <div className="ov-progress">
                  <span className="ov-progress-bar">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                  <small>
                    {t("Критерии {done}/{total}", { done, total })}
                  </small>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onOpenTask(currentTask.id)}
              >
                {t("Открыть задачу")}
                <ArrowRight size={15} />
              </button>
            </div>
          ) : (
            <div className="ov-empty-row">
              <span className="ov-empty-icon">
                <CheckIcon />
              </span>
              <div>
                <b>{t("Активных задач нет")}</b>
                <small>{t("Создай новую или открой готовые в разделе «Задачи».")}</small>
              </div>
            </div>
          )}
        </article>

        <article className="ov-card ov-projects">
          <div className="ov-card-head">
            <span className="ov-head-icon is-accent">
              <FolderKanban size={15} />
            </span>
            <h2>{t("Проекты")}</h2>
            <button type="button" className="ov-link" onClick={onOpenProjects}>
              {t("Все проекты")}
            </button>
          </div>
          <div className="ov-project-list">
            {projects.slice(0, 4).map((item) => {
              const brand = engineBrand(item.engine);
              return (
              <button
                type="button"
                className={`ov-project-row${item.active ? " is-active" : ""}`}
                key={item.id}
                onClick={() => onOpenProject(item.id)}
              >
                <span className={`ov-project-thumb is-${item.engine}`}>
                  {item.cover_url ? (
                    <img src={mediaUrl(item.cover_url)} alt="" />
                  ) : brand ? (
                    <BrandIcon name={brand} size={17} />
                  ) : (
                    <FolderKanban size={15} />
                  )}
                </span>
                <span className="ov-project-copy">
                  <b>{item.name}</b>
                  <small>
                    {ENGINE_LABELS[item.engine]} · {item.tasks_total}{" "}
                    {tp(item.tasks_total, ["задача", "задачи", "задач"], "task", "tasks")}
                  </small>
                </span>
                {item.active ? <span className="ov-active">{t("Открыт")}</span> : null}
                <ArrowRight size={14} />
              </button>
              );
            })}
          </div>
        </article>

        <article className="ov-card ov-review">
          <div className="ov-card-head">
            <span className="ov-head-icon is-accent">
              <Star size={15} />
            </span>
            <h2>Review</h2>
            <button type="button" className="ov-link" onClick={onOpenReview}>
              {t("Все результаты")}
            </button>
          </div>
          {pendingReview.length === 0 ? (
            <div className="ov-review-empty">
              <span className="ov-empty-icon">
                <Star size={20} />
              </span>
              <div>
                <b>{t("Нет результатов для проверки")}</b>
                <small>
                  {t("Когда агент закончит задачу, результат появится здесь.")}
                </small>
              </div>
              <button type="button" className="btn btn-secondary btn-small" onClick={onOpenTasks}>
                {t("К задачам")}
              </button>
            </div>
          ) : (
            <div className="ov-review-list">
              {pendingReview.slice(0, 6).map((item) => {
                const task = tasks.find((entry) => entry.id === item.task_id);
                return (
                  <button
                    type="button"
                    className="ov-review-item"
                    key={item.id}
                    onClick={onOpenReview}
                  >
                    <span className="ov-review-mark">
                      <Star size={14} />
                    </span>
                    <span>
                      <b>{item.summary || t("Результат AI")}</b>
                      <small>{task ? task.title : t("Задача")}</small>
                    </span>
                    <ArrowRight size={14} />
                  </button>
                );
              })}
            </div>
          )}
        </article>
        </div>
        <div className="ov-col">
        <article className="ov-card ov-shortcuts">
          <div className="ov-card-head">
            <span className="ov-head-icon is-blue">
              <Zap size={15} />
            </span>
            <h2>{t("Быстрый доступ")}</h2>
          </div>
          <div className="ov-shortcut-list">
            <button type="button" className="ov-shortcut" onClick={onOpenEditor}>
              <span className="ov-shortcut-icon is-editor">
                <Code2 size={17} />
              </span>
              <span>
                <b>{t("Редактор")}</b>
                <small>{t("Открыть код проекта")}</small>
              </span>
              <ArrowRight size={14} />
            </button>
            <button type="button" className="ov-shortcut" onClick={onOpenBlender}>
              <span className="ov-shortcut-icon is-blender">
                <BrandIcon name="blender" size={18} />
              </span>
              <span>
                <b>Blender</b>
                <small>
                  {blender?.connected ? t("Сцена и рендеры") : t("Подключить сцену")}
                </small>
              </span>
              <ArrowRight size={14} />
            </button>
            <button type="button" className="ov-shortcut" onClick={onOpenAssets}>
              <span className="ov-shortcut-icon is-assets">
                <Box size={17} />
              </span>
              <span>
                <b>{t("Ассеты")}</b>
                <small>
                  {assets.length} {t("в библиотеке")}
                </small>
              </span>
              <ArrowRight size={14} />
            </button>
          </div>
        </article>

        <article className="ov-card ov-activity">
          <div className="ov-card-head">
            <span className="ov-head-icon is-muted">
              <Clock3 size={15} />
            </span>
            <h2>{t("Последняя активность")}</h2>
            <button type="button" className="ov-link" onClick={onOpenActivity}>
              {t("Все события")}
            </button>
          </div>
          {events.length === 0 ? (
            <p className="ov-muted">{t("Пока нет событий.")}</p>
          ) : (
            <div className="ov-event-list">
              {events.slice(0, 4).map((event) => {
                const meta = eventMeta(event.type);
                const Icon = meta.icon;
                return (
                  <div className="ov-event" key={event.id}>
                    <span className={`ov-event-icon is-${meta.tone}`}>
                      {meta.brand ? (
                        <BrandIcon name={meta.brand} size={15} />
                      ) : Icon ? (
                        <Icon size={14} />
                      ) : null}
                    </span>
                    <span className="ov-event-copy">
                      <b>{LEDGER_TYPE_LABELS[event.type] ?? event.type}</b>
                      <small>{formatDate(event.at)}</small>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        </div>
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5 9.2 17 19 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
