import { useEffect, useMemo, useState } from "react";
import {
  Box,
  ClipboardList,
  Copy,
  Ellipsis,
  FolderKanban,
  FolderOpen,
  ImagePlus,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import BrandIcon from "../../components/BrandIcon";
import { engineBrand } from "../../lib/brands";
import {
  cleanupProjectTrash,
  mediaUrl,
  listProjectTrash,
  purgeProjectTrash,
  restoreProjectTrash,
} from "../../lib/coreClient";
import { t, tp } from "../../lib/i18n";
import { pickFolder, pickImage } from "../../lib/dialogs";
import { ENGINE_LABELS } from "../../lib/labels";
import type {
  CreateProjectInput,
  DuplicateProjectInput,
  Engine,
  ProjectCard,
  TrashProject,
} from "../../lib/types";

type Props = {
  projects: ProjectCard[];
  defaultParent: string;
  loading: boolean;
  onRefresh: () => void;
  onOpen: (projectId: string) => Promise<void>;
  onCreate: (input: CreateProjectInput) => Promise<void>;
  onUpdate: (projectId: string, input: { name?: string; engine?: Engine }) => Promise<void>;
  onDuplicate: (projectId: string, input: DuplicateProjectInput) => Promise<void>;
  onDelete: (projectId: string, deleteFiles: boolean) => Promise<void>;
  onCover: (projectId: string, path: string) => Promise<void>;
};

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; project: ProjectCard }
  | { kind: "duplicate"; project: ProjectCard }
  | { kind: "delete"; project: ProjectCard }
  | null;

const ENGINE_OPTIONS: { value: Engine; label: string }[] = [
  { value: "roblox", label: "Roblox" },
  { value: "blender", label: "Blender" },
  { value: "godot", label: "Godot" },
  { value: "unity", label: "Unity" },
  { value: "unreal", label: "Unreal" },
  { value: "generic", label: "Без движка" },
];

function shortPath(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return path;
  return `…\\${parts.slice(-2).join("\\")}`;
}

function projectBrand(project: ProjectCard) {
  return engineBrand(project.engine);
}

export default function ProjectsScreen({
  projects,
  defaultParent,
  loading,
  onRefresh,
  onOpen,
  onCreate,
  onUpdate,
  onDuplicate,
  onDelete,
  onCover,
}: Props) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [name, setName] = useState("");
  const [engine, setEngine] = useState<Engine>("roblox");
  const [parent, setParent] = useState(defaultParent);
  const [deleteFiles, setDeleteFiles] = useState(true);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [engineFilter, setEngineFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashItems, setTrashItems] = useState<TrashProject[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashBusy, setTrashBusy] = useState<string | null>(null);
  const [trashError, setTrashError] = useState<string | null>(null);

  useEffect(() => {
    if (!menuFor) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".project-menu-wrap")) return;
      setMenuFor(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuFor]);

  useEffect(() => {
    setParent(defaultParent);
  }, [defaultParent]);

  useEffect(() => {
    if (!dialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setDialog(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, busy]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    const rows = projects.filter((project) => {
      if (engineFilter !== "all" && project.engine !== engineFilter) return false;
      if (statusFilter === "active" && !project.active) return false;
      if (statusFilter === "other" && project.active) return false;
      if (statusFilter === "missing" && project.exists) return false;
      if (!search) return true;
      return `${project.name} ${project.path} ${project.engine}`.toLowerCase().includes(search);
    });
    return [...rows].sort((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name, "ru");
      if (sort === "tasks") return right.tasks_total - left.tasks_total;
      return (right.last_opened_at || "").localeCompare(left.last_opened_at || "");
    });
  }, [engineFilter, projects, query, sort, statusFilter]);

  const openCreate = () => {
    setName("");
    setEngine("roblox");
    setParent(defaultParent);
    setError(null);
    setDialog({ kind: "create" });
  };

  const openEdit = (project: ProjectCard) => {
    setName(project.name);
    setEngine(project.engine);
    setError(null);
    setMenuFor(null);
    setDialog({ kind: "edit", project });
  };

  const openDuplicate = (project: ProjectCard) => {
    setName(`${project.name} Copy`);
    setParent(defaultParent);
    setError(null);
    setMenuFor(null);
    setDialog({ kind: "duplicate", project });
  };

  const openDelete = (project: ProjectCard) => {
    setDeleteFiles(true);
    setNotice("");
    setError(null);
    setMenuFor(null);
    setDialog({ kind: "delete", project });
  };

  const chooseParent = async () => {
    const selected = await pickFolder(t("Куда сохранить проект"));
    if (selected) setParent(selected);
  };

  const chooseCover = async (project: ProjectCard) => {
    setMenuFor(null);
    const selected = await pickImage(t("Обложка проекта"));
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await onCover(project.id, selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Не удалось обновить обложку"));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!dialog || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (dialog.kind === "create") {
        await onCreate({ name: name.trim(), engine, parent: parent.trim() || undefined });
      } else if (dialog.kind === "edit") {
        await onUpdate(dialog.project.id, { name: name.trim(), engine });
      } else if (dialog.kind === "duplicate") {
        await onDuplicate(dialog.project.id, {
          name: name.trim(),
          parent: parent.trim() || undefined,
        });
      } else {
        await onDelete(dialog.project.id, deleteFiles);
        setNotice(
          deleteFiles
            ? t("Проект перемещён в корзину. Восстановить можно в «Проектах → Корзина».")
            : t("Проект убран из Kova. Папка осталась на диске."),
        );
      }
      setDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Не удалось выполнить действие"));
    } finally {
      setBusy(false);
    }
  };

  const loadTrash = async () => {
    setTrashLoading(true);
    setTrashError(null);
    try {
      const data = await listProjectTrash();
      setTrashItems(data.items);
    } catch (err) {
      setTrashError(err instanceof Error ? err.message : t("Не удалось загрузить корзину"));
    } finally {
      setTrashLoading(false);
    }
  };

  const openTrash = () => {
    setTrashOpen(true);
    void loadTrash();
  };

  const restoreTrash = async (item: TrashProject) => {
    setTrashBusy(item.id);
    setTrashError(null);
    try {
      await restoreProjectTrash(item.id);
      await loadTrash();
      onRefresh();
    } catch (err) {
      setTrashError(err instanceof Error ? err.message : t("Не удалось восстановить проект"));
    } finally {
      setTrashBusy(null);
    }
  };

  const cleanupTrash = async () => {
    if (!window.confirm(t("Удалить из корзины проекты старше 30 дней?"))) return;
    setTrashBusy("cleanup");
    setTrashError(null);
    try {
      const result = await cleanupProjectTrash(30);
      await loadTrash();
      if (!result.removed) setTrashError(t("Старых записей нет."));
    } catch (err) {
      setTrashError(err instanceof Error ? err.message : t("Не удалось очистить корзину"));
    } finally {
      setTrashBusy(null);
    }
  };

  const purgeTrash = async (item: TrashProject) => {
    if (!window.confirm(t("Удалить «{name}» из корзины навсегда?", { name: item.name }))) return;
    setTrashBusy(item.id);
    setTrashError(null);
    try {
      await purgeProjectTrash(item.id);
      await loadTrash();
    } catch (err) {
      setTrashError(err instanceof Error ? err.message : t("Не удалось очистить корзину"));
    } finally {
      setTrashBusy(null);
    }
  };

  const openProject = async (project: ProjectCard) => {
    if (!project.exists || project.active) return;
    setBusy(true);
    setError(null);
    try {
      await onOpen(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Не удалось открыть проект"));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = dialog?.kind === "delete" ? true : name.trim().length > 0 && !busy;

  return (
    <section className="assets-screen projects-screen">
      <div className="assets-heading">
        <FolderKanban size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>{t("Проекты")}</h1>
          <p className="subtitle">
            {t("Все игры Kova в одном месте: создавай, дублируй, меняй обложку и папку хранения.")}
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={openTrash}>
            <Trash2 size={15} />
            {t("Корзина")}
          </button>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={15} />
            {t("Новый проект")}
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
            placeholder={t("Поиск проектов…")}
            aria-label={t("Поиск проектов")}
          />
        </label>
        <select
          className="filter-select"
          value={engineFilter}
          onChange={(event) => setEngineFilter(event.target.value)}
          aria-label={t("Движок")}
        >
          <option value="all">{t("Все движки")}</option>
          {ENGINE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label={t("Статус проекта")}
        >
          <option value="all">{t("Все статусы")}</option>
          <option value="active">{t("Активный")}</option>
          <option value="other">{t("Не открыт")}</option>
          <option value="missing">{t("Папка не найдена")}</option>
        </select>
        <select
          className="filter-select"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          aria-label={t("Сортировка")}
        >
          <option value="recent">{t("Последние")}</option>
          <option value="name">{t("По имени")}</option>
          <option value="tasks">{t("По задачам")}</option>
        </select>
        <div className="view-toggle">
          <button
            type="button"
            className={view === "grid" ? "is-active" : ""}
            onClick={() => setView("grid")}
            title={t("Сетка")}
            aria-label={t("Сетка")}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            className={view === "list" ? "is-active" : ""}
            onClick={() => setView("list")}
            title={t("Список")}
            aria-label={t("Список")}
          >
            <List size={15} />
          </button>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={onRefresh}
          title={t("Обновить список")}
          aria-label={t("Обновить список")}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {notice ? <div className="projects-notice">{notice}</div> : null}
      {error ? <p className="modal-error resource-error">{error}</p> : null}

      {filtered.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-art">
            <FolderKanban size={26} />
          </div>
          <h2 className="empty-title">
            {projects.length === 0 ? t("Пока нет проектов") : t("Ничего не найдено")}
          </h2>
          <p className="empty-text">
            {projects.length === 0
              ? t("Создай первый проект Kova — папку можно выбрать вручную.")
              : t("Попробуй другой запрос или сбрось фильтры.")}
          </p>
          {projects.length === 0 ? (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Plus size={15} />
              {t("Создать проект")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className={`projects-grid2${view === "list" ? " is-list" : ""}`}>
          {filtered.map((project) => {
            const brand = projectBrand(project);
            return (
              <article
                className={`project-card2${project.active ? " is-active" : ""}${
                  project.exists ? "" : " is-missing"
                }`}
                key={project.id}
              >
                <button
                  type="button"
                  className="project-cover2"
                  onClick={() => void openProject(project)}
                  title={project.path}
                >
                  {project.cover_url ? (
                    <img src={mediaUrl(project.cover_url)} alt="" loading="lazy" />
                  ) : brand ? (
                    <BrandIcon name={brand} size={50} />
                  ) : (
                    <FolderKanban size={46} />
                  )}
                </button>

                <div className="project-body2">
                  <div className="project-top2">
                    {project.active ? (
                      <span className="project-active2">{t("Активный проект")}</span>
                    ) : null}
                    <div className="project-menu-wrap">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setMenuFor(menuFor === project.id ? null : project.id)}
                        aria-label={t("Действия с проектом")}
                        title={t("Действия")}
                      >
                        <Ellipsis size={16} />
                      </button>
                      {menuFor === project.id ? (
                        <div className="project-menu">
                          <button type="button" onClick={() => openEdit(project)}>
                            <Pencil size={13} />
                            {t("Переименовать")}
                          </button>
                          <button type="button" onClick={() => void chooseCover(project)}>
                            <ImagePlus size={13} />
                            {t("Обложка")}
                          </button>
                          <button type="button" onClick={() => openDuplicate(project)}>
                            <Copy size={13} />
                            {t("Дублировать")}
                          </button>
                          <button
                            type="button"
                            className="is-danger"
                            onClick={() => openDelete(project)}
                          >
                            <Trash2 size={13} />
                            {t("Удалить")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <h2>{project.name}</h2>
                  <div className="project-path2" title={project.path}>
                    {shortPath(project.path)}
                  </div>
                  {!project.exists ? (
                    <div className="project-missing2">{t("Папка проекта не найдена")}</div>
                  ) : (
                    <div className="project-stats2">
                      <span>
                        <ClipboardList size={13} />
                        <b>{project.tasks_total}</b>{" "}
                        {tp(project.tasks_total, ["задача", "задачи", "задач"], "task", "tasks")}
                      </span>
                      <span>
                        <Box size={13} />
                        <b>{project.assets_total}</b>{" "}
                        {tp(project.assets_total, ["ассет", "ассета", "ассетов"], "asset", "assets")}
                      </span>
                    </div>
                  )}
                  <div className="project-actions2">
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      disabled={!project.exists || busy || project.active}
                      onClick={() => void openProject(project)}
                    >
                      <FolderOpen size={14} />
                      {project.active ? t("Открыт") : t("Открыть")}
                    </button>
                    <span className="project-engine2">
                      {brand ? <BrandIcon name={brand} size={12} /> : null}
                      {ENGINE_LABELS[project.engine]}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {loading ? <p className="projects-loading">{t("Загрузка проектов…")}</p> : null}

      {dialog ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setDialog(null);
          }}
        >
          <div className="modal project-dialog">
            <div className="modal-header">
              <span className="modal-title">
                {dialog.kind === "create"
                  ? t("Новый проект")
                  : dialog.kind === "edit"
                    ? t("Настройки проекта")
                    : dialog.kind === "duplicate"
                      ? t("Дублировать проект")
                      : t("Удалить проект")}
              </span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => !busy && setDialog(null)}
                aria-label={t("Закрыть")}
              >
                <X size={14} />
              </button>
            </div>

            <div className="modal-body">
              {dialog.kind === "delete" ? (
                <>
                  <p className="project-delete-title">
                    {t("Что сделать с «{name}»?", { name: dialog.project.name })}
                  </p>
                  <div className="project-delete-options">
                    <label className={`project-delete-option${deleteFiles ? " is-selected" : ""}`}>
                      <input
                        type="radio"
                        checked={deleteFiles}
                        onChange={() => setDeleteFiles(true)}
                      />
                      <span>
                        <b>{t("Переместить в корзину")}</b>
                        <small>{t("Проект исчезнет из Kova, папку можно восстановить из корзины.")}</small>
                      </span>
                    </label>
                    <label className={`project-delete-option${!deleteFiles ? " is-selected" : ""}`}>
                      <input
                        type="radio"
                        checked={!deleteFiles}
                        onChange={() => setDeleteFiles(false)}
                      />
                      <span>
                        <b>{t("Оставить папку на диске")}</b>
                        <small>{t("Убрать только из списка Kova. В корзину не попадёт.")}</small>
                      </span>
                    </label>
                  </div>
                  <p className="project-delete-path">{dialog.project.path}</p>
                </>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="project-name">{t("Название")}</label>
                    <input
                      id="project-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={t("Например: Blade Evolve")}
                      maxLength={120}
                      autoFocus
                    />
                  </div>

                  {dialog.kind !== "duplicate" ? (
                    <div className="field">
                      <label htmlFor="project-engine">{t("Движок")}</label>
                      <select
                        id="project-engine"
                        value={engine}
                        onChange={(event) => setEngine(event.target.value as Engine)}
                      >
                        {ENGINE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  {dialog.kind !== "edit" ? (
                    <div className="field">
                      <label htmlFor="project-parent">{t("Папка хранения")}</label>
                      <div className="project-parent-row">
                        <input
                          id="project-parent"
                          value={parent}
                          onChange={(event) => setParent(event.target.value)}
                          placeholder={defaultParent}
                        />
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => void chooseParent()}
                          title={t("Выбрать папку")}
                          aria-label={t("Выбрать папку")}
                        >
                          <FolderOpen size={15} />
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {dialog.kind === "duplicate" ? (
                    <p className="project-hint">
                      {t("Копируются скрипты, ассеты и настройки. Кеш, снапшоты и node_modules — нет.")}
                    </p>
                  ) : null}
                </>
              )}

              {error ? <p className="modal-error">{error}</p> : null}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                {t("Отмена")}
              </button>
              <span className="modal-footer-spacer" />
              <button
                type="button"
                className={`btn ${dialog.kind === "delete" ? "btn-danger" : "btn-primary"}`}
                disabled={!canSubmit}
                onClick={() => void submit()}
              >
                {busy
                  ? "…"
                  : dialog.kind === "create"
                    ? t("Создать")
                    : dialog.kind === "edit"
                      ? t("Сохранить")
                      : dialog.kind === "duplicate"
                        ? t("Дублировать")
                        : deleteFiles
                          ? t("Переместить в корзину")
                          : t("Убрать из списка")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {trashOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !trashBusy) setTrashOpen(false);
          }}
        >
          <div className="modal project-trash-dialog">
            <div className="modal-header">
              <span className="modal-title">{t("Корзина проектов")}</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => !trashBusy && setTrashOpen(false)}
                aria-label={t("Закрыть")}
              >
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              {trashError ? <p className="modal-error">{trashError}</p> : null}
              {trashLoading ? (
                <p className="project-hint">{t("Загрузка…")}</p>
              ) : trashItems.length === 0 ? (
                <p className="project-hint">{t("Корзина пуста.")}</p>
              ) : (
                <div className="project-trash-list">
                  {trashItems.map((item) => (
                    <div className="project-trash-row" key={item.id}>
                      <div className="project-trash-copy">
                        <b>{item.name}</b>
                        <small title={item.original_path}>{item.original_path}</small>
                        <span>
                          {item.deleted_at
                            ? new Date(item.deleted_at).toLocaleString()
                            : t("Удалён")}
                        </span>
                      </div>
                      <div className="project-trash-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          disabled={trashBusy !== null}
                          onClick={() => void restoreTrash(item)}
                        >
                          <RotateCcw size={12} />
                          {t("Восстановить")}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-small"
                          disabled={trashBusy !== null}
                          onClick={() => void purgeTrash(item)}
                        >
                          <Trash2 size={12} />
                          {t("Навсегда")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={trashBusy !== null || trashItems.length === 0}
                onClick={() => void cleanupTrash()}
              >
                {t("Очистить старше 30 дней")}
              </button>
              <span className="modal-footer-spacer" />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={trashBusy !== null}
                onClick={() => setTrashOpen(false)}
              >
                {t("Закрыть")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
