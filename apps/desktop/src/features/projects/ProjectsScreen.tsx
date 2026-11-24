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
  Search,
  Trash2,
  X,
} from "lucide-react";
import BrandIcon from "../../components/BrandIcon";
import { engineBrand } from "../../lib/brands";
import { coreUrl } from "../../lib/coreClient";
import { plural } from "../../lib/format";
import { pickFolder, pickImage } from "../../lib/dialogs";
import { ENGINE_LABELS } from "../../lib/labels";
import type {
  CreateProjectInput,
  DuplicateProjectInput,
  Engine,
  ProjectCard,
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
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [engineFilter, setEngineFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [menuFor, setMenuFor] = useState<string | null>(null);

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
    setDeleteFiles(false);
    setError(null);
    setMenuFor(null);
    setDialog({ kind: "delete", project });
  };

  const chooseParent = async () => {
    const selected = await pickFolder("Куда сохранить проект");
    if (selected) setParent(selected);
  };

  const chooseCover = async (project: ProjectCard) => {
    setMenuFor(null);
    const selected = await pickImage("Обложка проекта");
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await onCover(project.id, selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить обложку");
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
      }
      setDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить действие");
    } finally {
      setBusy(false);
    }
  };

  const openProject = async (project: ProjectCard) => {
    if (!project.exists || project.active) return;
    setBusy(true);
    setError(null);
    try {
      await onOpen(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось открыть проект");
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
          <h1>Проекты</h1>
          <p className="subtitle">
            Все игры Kova в одном месте: создавай, дублируй, меняй обложку и папку хранения.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={15} />
            Новый проект
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
            placeholder="Поиск проектов…"
            aria-label="Поиск проектов"
          />
        </label>
        <select
          className="filter-select"
          value={engineFilter}
          onChange={(event) => setEngineFilter(event.target.value)}
          aria-label="Движок"
        >
          <option value="all">Все движки</option>
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
          aria-label="Статус проекта"
        >
          <option value="all">Все статусы</option>
          <option value="active">Активный</option>
          <option value="other">Не открыт</option>
          <option value="missing">Папка не найдена</option>
        </select>
        <select
          className="filter-select"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          aria-label="Сортировка"
        >
          <option value="recent">Последние</option>
          <option value="name">По имени</option>
          <option value="tasks">По задачам</option>
        </select>
        <div className="view-toggle">
          <button
            type="button"
            className={view === "grid" ? "is-active" : ""}
            onClick={() => setView("grid")}
            title="Сетка"
            aria-label="Сетка"
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            className={view === "list" ? "is-active" : ""}
            onClick={() => setView("list")}
            title="Список"
            aria-label="Список"
          >
            <List size={15} />
          </button>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={onRefresh}
          title="Обновить список"
          aria-label="Обновить список"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {error ? <p className="modal-error resource-error">{error}</p> : null}

      {filtered.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-art">
            <FolderKanban size={26} />
          </div>
          <h2 className="empty-title">
            {projects.length === 0 ? "Пока нет проектов" : "Ничего не найдено"}
          </h2>
          <p className="empty-text">
            {projects.length === 0
              ? "Создай первый проект Kova — папку можно выбрать вручную."
              : "Попробуй другой запрос или сбрось фильтры."}
          </p>
          {projects.length === 0 ? (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Plus size={15} />
              Создать проект
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
                    <img src={coreUrl(project.cover_url)} alt="" loading="lazy" />
                  ) : brand ? (
                    <BrandIcon name={brand} size={50} />
                  ) : (
                    <FolderKanban size={46} />
                  )}
                </button>

                <div className="project-body2">
                  <div className="project-top2">
                    {project.active ? (
                      <span className="project-active2">Активный проект</span>
                    ) : null}
                    <div className="project-menu-wrap">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setMenuFor(menuFor === project.id ? null : project.id)}
                        aria-label="Действия с проектом"
                        title="Действия"
                      >
                        <Ellipsis size={16} />
                      </button>
                      {menuFor === project.id ? (
                        <div className="project-menu">
                          <button type="button" onClick={() => openEdit(project)}>
                            <Pencil size={13} />
                            Переименовать
                          </button>
                          <button type="button" onClick={() => void chooseCover(project)}>
                            <ImagePlus size={13} />
                            Обложка
                          </button>
                          <button type="button" onClick={() => openDuplicate(project)}>
                            <Copy size={13} />
                            Дублировать
                          </button>
                          <button
                            type="button"
                            className="is-danger"
                            onClick={() => openDelete(project)}
                          >
                            <Trash2 size={13} />
                            Удалить
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
                    <div className="project-missing2">Папка проекта не найдена</div>
                  ) : (
                    <div className="project-stats2">
                      <span>
                        <ClipboardList size={13} />
                        <b>{project.tasks_total}</b> {plural(project.tasks_total, ["задача", "задачи", "задач"])}
                      </span>
                      <span>
                        <Box size={13} />
                        <b>{project.assets_total}</b> {plural(project.assets_total, ["ассет", "ассета", "ассетов"])}
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
                      {project.active ? "Открыт" : "Открыть"}
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

      {loading ? <p className="projects-loading">Загрузка проектов…</p> : null}

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
                  ? "Новый проект"
                  : dialog.kind === "edit"
                    ? "Настройки проекта"
                    : dialog.kind === "duplicate"
                      ? "Дублировать проект"
                      : "Удалить проект"}
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
              {dialog.kind === "delete" ? (
                <>
                  <p className="project-delete-title">
                    Что сделать с «{dialog.project.name}»?
                  </p>
                  <div className="project-delete-options">
                    <label className={`project-delete-option${deleteFiles ? "" : " is-selected"}`}>
                      <input
                        type="radio"
                        checked={!deleteFiles}
                        onChange={() => setDeleteFiles(false)}
                      />
                      <span>
                        <b>Убрать из Kova</b>
                        <small>Папка и файлы останутся на диске.</small>
                      </span>
                    </label>
                    <label className={`project-delete-option${deleteFiles ? " is-selected" : ""}`}>
                      <input
                        type="radio"
                        checked={deleteFiles}
                        onChange={() => setDeleteFiles(true)}
                      />
                      <span>
                        <b>Удалить с диска</b>
                        <small>Проект, .hub и все ассеты будут удалены безвозвратно.</small>
                      </span>
                    </label>
                  </div>
                  <p className="project-delete-path">{dialog.project.path}</p>
                </>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="project-name">Название</label>
                    <input
                      id="project-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Например: Blade Evolve"
                      maxLength={120}
                      autoFocus
                    />
                  </div>

                  {dialog.kind !== "duplicate" ? (
                    <div className="field">
                      <label htmlFor="project-engine">Движок</label>
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
                      <label htmlFor="project-parent">Папка хранения</label>
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
                          title="Выбрать папку"
                          aria-label="Выбрать папку"
                        >
                          <FolderOpen size={15} />
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {dialog.kind === "duplicate" ? (
                    <p className="project-hint">
                      Копируются скрипты, ассеты и настройки. Кеш, снапшоты и node_modules —
                      нет.
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
                Отмена
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
                    ? "Создать"
                    : dialog.kind === "edit"
                      ? "Сохранить"
                      : dialog.kind === "duplicate"
                        ? "Дублировать"
                        : deleteFiles
                          ? "Удалить с диска"
                          : "Убрать из Kova"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
