import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BookOpen,
  Box,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Gamepad2,
  LayoutGrid,
  List,
  Lock,
  MoreVertical,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import BrandIcon from "../../components/BrandIcon";
import { useConfirm } from "../../components/ConfirmProvider";
import {
  createSkill,
  deleteSkill,
  getSkill,
  updateSkill,
} from "../../lib/coreClient";
import { copyText } from "../../lib/clipboard";
import { formatDate } from "../../lib/format";
import type { Skill, SkillCategory, SkillDetail, Task } from "../../lib/types";

type Props = {
  skills: Skill[];
  tasks: Task[];
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
  onChanged: () => void;
};

const CATEGORY_ORDER: SkillCategory[] = [
  "blender",
  "code",
  "roblox",
  "unity",
  "godot",
  "unreal",
  "general",
];

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  blender: "Blender",
  code: "Код",
  roblox: "Roblox",
  unity: "Unity",
  godot: "Godot",
  unreal: "Unreal",
  general: "Общее",
};

const CATEGORY_ICONS = {
  blender: Box,
  code: Code2,
  roblox: Gamepad2,
  unity: Gamepad2,
  godot: Gamepad2,
  unreal: Gamepad2,
  general: Wrench,
};

function extractCode(content: string) {
  const match = content.match(/```[a-zA-Z0-9_+-]*\n([\s\S]*?)```/);
  return match ? match[1].trim() : "";
}

function formatKb(text: string) {
  const bytes = new Blob([text]).size;
  if (bytes < 1024) return `${bytes} Б`;
  return `${(bytes / 1024).toFixed(1)} КБ`;
}

function short(text: string, limit = 150) {
  if (!text) return "";
  const first = text.split(". ")[0]?.trim() ?? "";
  return first.length > limit ? `${first.slice(0, limit - 1)}…` : first;
}

export default function SkillsScreen({
  skills,
  tasks,
  loading,
  loadError,
  onRetry,
  onChanged,
}: Props) {
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | SkillCategory>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftLocked, setDraftLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCategory, setNewCategory] = useState<SkillCategory>("general");
  const [newContent, setNewContent] = useState("");
  const [newLocked, setNewLocked] = useState(false);
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<"list" | "grid">("list");
  const [page, setPage] = useState(0);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [listWidth, setListWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem("kova-skills-list-width"));
    return Number.isFinite(stored) && stored >= 300 ? stored : 440;
  });
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of tasks) {
      for (const name of task.skills) map.set(name, (map.get(name) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return skills
      .filter((skill) => {
        if (category !== "all" && skill.category !== category) return false;
        if (!search) return true;
        return `${skill.name} ${skill.description} ${skill.category_label}`
          .toLowerCase()
          .includes(search);
      })
      .sort((a, b) => {
        const left = CATEGORY_ORDER.indexOf(a.category);
        const right = CATEGORY_ORDER.indexOf(b.category);
        if (left !== right) return left - right;
        return a.name.localeCompare(b.name, "ru");
      });
  }, [category, query, skills]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let alive = true;
    setBusy(true);
    setError(null);
    getSkill(selectedId)
      .then((row) => {
        if (!alive) return;
        setDetail(row);
        setDraft(row.content);
        setDraftDescription(row.description);
        setDraftLocked(row.locked);
        setEditing(false);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Не удалось открыть скилл");
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedId, skills]);

  useEffect(() => {
    if (selectedId && !skills.some((skill) => skill.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, skills]);

  const save = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const row = await updateSkill(
        detail.id,
        {
          content: draft,
          description: draftDescription,
          locked: draftLocked,
        },
        true,
      );
      setDetail(row);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить скилл");
    } finally {
      setBusy(false);
    }
  };

  const unlockAndEdit = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const row = await updateSkill(detail.id, { locked: false });
      setDetail(row);
      setDraftLocked(false);
      setEditing(true);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось снять защиту");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!detail) return;
    const ok = await confirm({
      title: "Удалить скилл?",
      message: `Скилл «${detail.name}» будет удалён из библиотеки.`,
      details: ["Если скилл встроенный, он будет скрыт как переопределение."],
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSkill(detail.id, true);
      setSelectedId(null);
      setDetail(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить скилл");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const row = await createSkill({
        name: newName.trim(),
        description: newDescription.trim(),
        category: newCategory,
        content: newContent,
        locked: newLocked,
      });
      setCreating(false);
      setNewName("");
      setNewDescription("");
      setNewContent("");
      setNewLocked(false);
      setNewCategory("general");
      setSelectedId(row.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать скилл");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!detail) return;
    if (await copyText(detail.content)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    map.set("all", skills.length);
    for (const skill of skills) {
      map.set(skill.category, (map.get(skill.category) ?? 0) + 1);
    }
    return map;
  }, [skills]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "ru");
      if (sort === "usage") return (counts.get(b.name) ?? 0) - (counts.get(a.name) ?? 0);
      if (sort === "category") {
        const left = CATEGORY_ORDER.indexOf(a.category);
        const right = CATEGORY_ORDER.indexOf(b.category);
        return left - right || a.name.localeCompare(b.name, "ru");
      }
      const left = a.updated_at || "";
      const right = b.updated_at || "";
      return right.localeCompare(left) || a.name.localeCompare(b.name, "ru");
    });
    return rows;
  }, [counts, filtered, sort]);

  const PAGE_SIZE = 8;
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const statusFor = (skill: Skill) => {
    if (skill.locked) return { label: "Защищён", tone: "locked" };
    if (skill.source === "builtin") return { label: "Системный", tone: "system" };
    return { label: "Активный", tone: "active" };
  };

  const categoryIcon = (category: SkillCategory) => {
    if (category === "blender") return <BrandIcon name="blender" size={24} />;
    const Icon = CATEGORY_ICONS[category] ?? BookOpen;
    return <Icon size={22} strokeWidth={1.5} />;
  };

  const codeExample = detail ? extractCode(detail.content) : "";

  const toggleLock = async (skill: Skill, locked: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const row = await updateSkill(skill.id, { locked });
      if (detail?.id === skill.id) {
        setDetail(row);
        setDraftLocked(row.locked);
      }
      setMenuFor(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить защиту");
    } finally {
      setBusy(false);
    }
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = workspaceRef.current;
    if (!container) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = listWidth;
    const move = (moveEvent: PointerEvent) => {
      const next = Math.max(
        300,
        Math.min(startWidth + moveEvent.clientX - startX, container.clientWidth - 330),
      );
      setListWidth(next);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      setListWidth((width) => {
        window.localStorage.setItem("kova-skills-list-width", String(width));
        return width;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  useEffect(() => {
    if (!menuFor) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".sk-row-menu-wrap")) return;
      setMenuFor(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuFor]);

  const copyExample = async () => {
    if (!codeExample) return;
    if (await copyText(codeExample)) {
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1500);
    }
  };

  const exportSkills = async () => {
    setBusy(true);
    setError(null);
    try {
      const rows = [];
      for (const skill of skills) {
        const detail = await getSkill(skill.id);
        rows.push({
          name: detail.name,
          description: detail.description,
          category: detail.category,
          content: detail.content,
          locked: false,
        });
      }
      const payload = {
        version: 1,
        exported_at: new Date().toISOString(),
        skills: rows,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `kova-skills-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось экспортировать скиллы");
    } finally {
      setBusy(false);
    }
  };

  const importSkills = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(await file.text()) as
        | { skills?: unknown }
        | unknown[];
      const rows = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { skills?: unknown }).skills)
          ? ((parsed as { skills?: unknown[] }).skills ?? [])
          : [];
      let imported = 0;
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const item = row as Record<string, unknown>;
        const name = String(item.name ?? "").trim();
        if (!name) continue;
        const category = String(item.category ?? "general") as SkillCategory;
        await createSkill({
          name,
          description: String(item.description ?? ""),
          category: CATEGORY_ORDER.includes(category) ? category : "general",
          content: String(item.content ?? ""),
          locked: false,
        });
        imported += 1;
      }
      if (imported === 0) {
        setError("В файле не найдено скиллов");
      } else {
        onChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось импортировать скиллы");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="skills-page">
      <header className="sk-head">
        <span className="sk-head-icon">
          <Sparkles size={32} strokeWidth={1.4} />
        </span>
        <div className="sk-head-copy">
          <h1>Скиллы</h1>
          <p>
            Инструкции для AI: Blender, код, движки и общие правила. Выбирай нужные в задаче —
            остальные не тратят контекст.
          </p>
        </div>
        <div className="sk-head-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || skills.length === 0}
            onClick={() => void exportSkills()}
          >
            <Download size={15} />
            Экспорт
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => importRef.current?.click()}
          >
            <Upload size={15} />
            Импорт
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setCreating(true);
              setError(null);
            }}
          >
            <Plus size={15} />
            Новый скилл
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importSkills(file);
            }}
          />
        </div>
      </header>

      <div className="sk-categories">
        <button
          type="button"
          className={`sk-category${category === "all" ? " is-active" : ""}`}
          onClick={() => {
            setCategory("all");
            setPage(0);
          }}
        >
          <LayoutGrid size={17} />
          <span>Все</span>
          <b>({skills.length})</b>
        </button>
        {CATEGORY_ORDER.map((item) => {
          const Icon = CATEGORY_ICONS[item];
          return (
            <button
              type="button"
              key={item}
              className={`sk-category${category === item ? " is-active" : ""}`}
              onClick={() => {
                setCategory(item);
                setPage(0);
              }}
            >
              {item === "blender" ? (
                <BrandIcon name="blender" size={17} />
              ) : (
                <Icon size={16} />
              )}
              <span>{CATEGORY_LABELS[item]}</span>
              <b>({categoryCounts.get(item) ?? 0})</b>
            </button>
          );
        })}
      </div>

      <div className="sk-toolbar">
        <select
          className="filter-select"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value);
            setPage(0);
          }}
          aria-label="Сортировка"
        >
          <option value="recent">Последние</option>
          <option value="name">По имени</option>
          <option value="usage">По использованию</option>
          <option value="category">По категории</option>
        </select>
        <label className="resource-search">
          <Search size={14} />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Найти скилл: uv, материал, анимация…"
            aria-label="Найти скилл"
          />
        </label>
        <div className="tk-view-switch">
          <button
            type="button"
            className={view === "list" ? "is-active" : ""}
            title="Списком"
            onClick={() => setView("list")}
          >
            <List size={15} />
          </button>
          <button
            type="button"
            className={view === "grid" ? "is-active" : ""}
            title="Плиткой"
            onClick={() => setView("grid")}
          >
            <LayoutGrid size={15} />
          </button>
        </div>
      </div>

      {error ? <p className="modal-error">{error}</p> : null}

      {loadError ? (
        <div className="sk-load-error">
          <span>Не удалось загрузить скиллы: {loadError}</span>
          <button type="button" className="btn btn-secondary btn-compact" onClick={onRetry} disabled={loading}>
            Повторить
          </button>
        </div>
      ) : null}
      {loading && skills.length === 0 ? (
        <p className="sk-loading">Загружаю скиллы…</p>
      ) : null}

      <div
        className="sk-workspace"
        ref={workspaceRef}
        style={{ gridTemplateColumns: `${listWidth}px 8px minmax(0, 1fr)` }}
      >
        <div className="sk-list-column">
          {pageRows.length === 0 ? (
            <div className="sk-empty">
              <Search size={20} />
              <b>
                {loading
                  ? "Загружаю скиллы…"
                  : loadError
                    ? "Скиллы не загрузились"
                    : "Ничего не найдено"}
              </b>
              <span>
                {loading
                  ? "Подожди пару секунд."
                  : loadError
                    ? "Нажми «Повторить» выше."
                    : "Попробуй другой запрос или создай новый скилл."}
              </span>
            </div>
          ) : view === "grid" ? (
            <div className="sk-card-grid">
              {pageRows.map((skill) => {
                const status = statusFor(skill);
                return (
                  <button
                    type="button"
                    key={skill.id}
                    className={`sk-grid-card${selectedId === skill.id ? " is-selected" : ""}`}
                    onClick={() => setSelectedId(skill.id)}
                  >
                    <span className="sk-grid-icon">{categoryIcon(skill.category)}</span>
                    <span className="sk-grid-copy">
                      <b>{skill.name}</b>
                      <small>{short(skill.description, 120)}</small>
                    </span>
                    <span className={`sk-status is-${status.tone}`}>
                      <i />
                      {status.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="sk-rows">
              {pageRows.map((skill) => {
                const status = statusFor(skill);
                return (
                  <div
                    key={skill.id}
                    className={`sk-row${selectedId === skill.id ? " is-selected" : ""}`}
                    onClick={() => setSelectedId(skill.id)}
                  >
                    <span className="sk-row-icon">{categoryIcon(skill.category)}</span>
                    <span className="sk-row-copy">
                      <b>{skill.name}</b>
                      <small>{short(skill.description, 130)}</small>
                    </span>
                    <span className={`sk-cat is-${skill.category}`}>
                      {skill.category_label}
                    </span>
                    <span className={`sk-status is-${status.tone}`}>
                      <i />
                      {status.label}
                    </span>
                    <div className="sk-row-menu-wrap">
                      <button
                        type="button"
                        className="tk-icon-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuFor(menuFor === skill.id ? null : skill.id);
                        }}
                        aria-label="Действия со скиллом"
                      >
                        <MoreVertical size={14} />
                      </button>
                      {menuFor === skill.id ? (
                        <div className="project-menu sk-row-menu">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedId(skill.id);
                              setMenuFor(null);
                            }}
                          >
                            <ExternalLink size={13} />
                            Открыть
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void toggleLock(skill, !skill.locked);
                            }}
                          >
                            <Lock size={13} />
                            {skill.locked ? "Снять защиту" : "Защитить от AI"}
                          </button>
                          <button
                            type="button"
                            className="is-danger"
                            disabled={skill.locked}
                            onClick={() => {
                              void (async () => {
                                const ok = await confirm({
                                  title: "Удалить скилл?",
                                  message: `Скилл «${skill.name}» будет удалён из библиотеки.`,
                                  details: [
                                    skill.source === "builtin"
                                      ? "Встроенный скилл будет скрыт, оригинал не изменится."
                                      : "Скилл будет удалён без возможности восстановления.",
                                  ],
                                  confirmLabel: "Удалить",
                                  danger: true,
                                });
                                if (!ok) return;
                                await deleteSkill(skill.id, true);
                                if (selectedId === skill.id) setDetail(null);
                                setMenuFor(null);
                                onChanged();
                              })();
                            }}
                          >
                            <Trash2 size={13} />
                            Удалить
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <footer className="sk-pagination">
            <div className="tk-pager">
              <button
                type="button"
                disabled={currentPage === 0}
                onClick={() => setPage(Math.max(0, currentPage - 1))}
                aria-label="Назад"
              >
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: pageCount }, (_, index) => index)
                .filter(
                  (index) =>
                    pageCount <= 7 ||
                    index === 0 ||
                    index === pageCount - 1 ||
                    Math.abs(index - currentPage) <= 1,
                )
                .map((index, position, array) => (
                  <span className="sk-page-cell" key={index}>
                    {position > 0 && index - array[position - 1] > 1 ? <em>…</em> : null}
                    <button
                      type="button"
                      className={index === currentPage ? "is-active" : ""}
                      onClick={() => setPage(index)}
                    >
                      {index + 1}
                    </button>
                  </span>
                ))}
              <button
                type="button"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
                aria-label="Вперёд"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <span>Всего: {sorted.length} навыков</span>
          </footer>
        </div>

        <div
          className="sk-resizer"
          onPointerDown={startResize}
          onDoubleClick={() => {
            setListWidth(440);
            window.localStorage.setItem("kova-skills-list-width", "440");
          }}
          title="Потяни, чтобы изменить ширину. Двойной клик — сброс."
        />

        <div className="sk-detail">
          {creating ? (
            <article className="sk-panel">
              <div className="sk-panel-head">
                <h2>Новый скилл</h2>
                <button type="button" className="icon-btn" onClick={() => setCreating(false)}>
                  <X size={14} />
                </button>
              </div>
              <div className="sk-form">
                <label>
                  <span>Название</span>
                  <input
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder="например: roblox-hitboxes"
                  />
                </label>
                <label>
                  <span>Категория</span>
                  <select
                    value={newCategory}
                    onChange={(event) => setNewCategory(event.target.value as SkillCategory)}
                  >
                    {CATEGORY_ORDER.map((item) => (
                      <option key={item} value={item}>
                        {CATEGORY_LABELS[item]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="is-wide">
                  <span>Короткое описание</span>
                  <input
                    value={newDescription}
                    onChange={(event) => setNewDescription(event.target.value)}
                    placeholder="когда применять"
                  />
                </label>
                <label className="is-wide">
                  <span>Инструкции (Markdown)</span>
                  <textarea
                    rows={12}
                    value={newContent}
                    onChange={(event) => setNewContent(event.target.value)}
                    placeholder="Что делать, какие инструменты использовать, что проверить…"
                  />
                </label>
                <label className="sk-check is-wide">
                  <input
                    type="checkbox"
                    checked={newLocked}
                    onChange={(event) => setNewLocked(event.target.checked)}
                  />
                  Защитить от изменений AI
                </label>
              </div>
              <div className="sk-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={busy || !newName.trim()}
                  onClick={() => void create()}
                >
                  Создать
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => setCreating(false)}
                >
                  Отмена
                </button>
              </div>
            </article>
          ) : !detail ? (
            <div className="sk-placeholder">
              <BookOpen size={26} />
              <b>Выбери скилл</b>
              <span>
                Слева — карточки. Здесь появится полный текст инструкции, категория и защита от
                изменений AI.
              </span>
            </div>
          ) : (
            <article className="sk-panel sk-detail-panel">
              <div className="sk-detail-head">
                <span className="sk-detail-icon">{categoryIcon(detail.category)}</span>
                <div className="sk-detail-title">
                  <h2>{detail.name}</h2>
                  <span className={`sk-status is-${statusFor(detail).tone}`}>
                    <i />
                    {statusFor(detail).label}
                  </span>
                </div>
                <div className="sk-panel-actions">
                  <button
                    type="button"
                    className={`sk-lock-btn${detail.locked ? " is-on" : ""}`}
                    disabled={busy}
                    onClick={() => {
                      if (detail.locked) {
                        void unlockAndEdit();
                      } else {
                        void toggleLock(detail, true);
                      }
                    }}
                  >
                    <Lock size={12} />
                    {detail.locked ? "Снять защиту" : "Защитить от AI"}
                  </button>
                </div>
              </div>

              <p className="sk-detail-desc">{detail.description || "Описание не задано."}</p>

              <div className="sk-chips">
                <span className={`sk-cat is-${detail.category}`}>{detail.category_label}</span>
                <span className="sk-chip">{detail.source === "builtin" ? "Системный" : "Свой"}</span>
                {counts.get(detail.name) ? (
                  <span className="sk-chip">{counts.get(detail.name)} задач</span>
                ) : null}
              </div>

              <div className="sk-meta">
                <span>
                  <Box size={13} />
                  <small>Совместимость</small>
                  <b>AI-агенты</b>
                </span>
                <span>
                  <FileText size={13} />
                  <small>Размер</small>
                  <b>{formatKb(detail.content)}</b>
                </span>
                <span>
                  <Calendar size={13} />
                  <small>Обновлён</small>
                  <b>{detail.updated_at ? formatDate(detail.updated_at) : "встроенный"}</b>
                </span>
              </div>

              {editing ? (
                <>
                  <input
                    className="sk-desc-input"
                    value={draftDescription}
                    onChange={(event) => setDraftDescription(event.target.value)}
                    placeholder="Короткое описание"
                  />
                  <textarea
                    className="sk-editor"
                    rows={16}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <div className="sk-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      disabled={busy}
                      onClick={() => void save()}
                    >
                      Сохранить
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => {
                        setEditing(false);
                        setDraft(detail.content);
                        setDraftDescription(detail.description);
                        setDraftLocked(detail.locked);
                      }}
                    >
                      Отмена
                    </button>
                    <label className="sk-check">
                      <input
                        type="checkbox"
                        checked={draftLocked}
                        onChange={(event) => setDraftLocked(event.target.checked)}
                      />
                      Защита от AI
                    </label>
                  </div>
                </>
              ) : (
                <>
                  {codeExample ? (
                    <>
                      <h3 className="sk-block-title">Пример использования</h3>
                      <div className="sk-code">
                        <pre>{codeExample}</pre>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Копировать пример"
                          onClick={() => void copyExample()}
                        >
                          {copiedCode ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </div>
                    </>
                  ) : null}
                  <h3 className="sk-block-title">Инструкция</h3>
                  <pre className="sk-content">{detail.content || "Инструкции пока пустые."}</pre>
                  <div className="sk-chips sk-category-chips">
                    <span className="sk-block-title">Категории</span>
                    <span className={`sk-cat is-${detail.category}`}>
                      {detail.category_label}
                    </span>
                    <span className="sk-chip">AI</span>
                  </div>
                  <div className="sk-actions sk-detail-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      disabled={detail.locked}
                      onClick={() => setEditing(true)}
                    >
                      <ExternalLink size={13} />
                      Открыть в редакторе
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => void copy()}
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      {copied ? "Скопировано" : "Копировать"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small is-danger"
                      disabled={detail.locked}
                      onClick={() => void remove()}
                    >
                      <Trash2 size={12} />
                      Удалить
                    </button>
                  </div>
                </>
              )}
              {detail.source === "builtin" ? (
                <small className="sk-source">
                  Встроенный скилл. Изменения хранятся как переопределение проекта.
                </small>
              ) : null}
            </article>
          )}
        </div>
      </div>
    </section>
  );
}
