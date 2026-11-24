import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Box,
  Bone,
  Check,
  Copy,
  FileCode2,
  Palette,
  Puzzle,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";
import { copyText } from "../../lib/clipboard";
import { getBlenderSkill } from "../../lib/coreClient";
import type { BlenderSkill, BlenderSkillDetail, Task } from "../../lib/types";

type Props = {
  skills: BlenderSkill[];
  tasks: Task[];
};

const GROUP_ORDER = ["core", "modeling", "materials", "rig", "fx", "pipeline", "other"];

const GROUP_ICONS = {
  core: BookOpen,
  modeling: Box,
  materials: Palette,
  rig: Bone,
  fx: Sparkles,
  pipeline: Settings2,
  other: Puzzle,
};

function pretty(name: string) {
  return name
    .replace(/^blender-/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function firstSentence(text: string) {
  if (!text) return "";
  const sentence = text.split(". ")[0]?.trim() ?? "";
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}

export default function SkillsScreen({ skills, tasks }: Props) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BlenderSkillDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const skill of skills) {
      const entry = map.get(skill.group) ?? { label: skill.group_label, count: 0 };
      entry.count += 1;
      map.set(skill.group, entry);
    }
    return [...map.entries()].sort(
      ([left], [right]) => GROUP_ORDER.indexOf(left) - GROUP_ORDER.indexOf(right),
    );
  }, [skills]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return skills.filter((skill) => {
      if (group !== "all" && skill.group !== group) return false;
      if (!search) return true;
      return `${skill.name} ${skill.description} ${skill.group_label}`
        .toLowerCase()
        .includes(search);
    });
  }, [group, query, skills]);

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      for (const name of task.skills) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return counts;
  }, [tasks]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    getBlenderSkill(selected)
      .then((data) => {
        if (alive) setDetail(data);
      })
      .catch((err) => {
        if (alive) {
          setError(err instanceof Error ? err.message : "Не удалось открыть скилл");
          setDetail(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  const copy = async () => {
    if (!detail) return;
    if (await copyText(detail.content)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const GroupIcon =
    GROUP_ICONS[(detail?.group as keyof typeof GROUP_ICONS) ?? "core"] ?? BookOpen;

  return (
    <section className="assets-screen skills-screen">
      <div className="assets-heading">
        <Sparkles size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>Скиллы Blender</h1>
          <p className="subtitle">
            Готовые инструкции для AI: что делать, какие инструменты использовать и что проверить.
            Выбирай нужные в задаче — остальные не тратят контекст.
          </p>
        </div>
        <div className="skills-heading-count">
          <b>{skills.length}</b>
          <span>скиллов</span>
        </div>
      </div>

      <div className="skills-toolbar">
        <label className="projects-search skills-search">
          <Search size={14} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти скилл: uv, материал, анимация…"
            aria-label="Найти скилл"
          />
        </label>
        <select
          className="filter-select"
          value={group}
          onChange={(event) => setGroup(event.target.value)}
          aria-label="Группа скиллов"
        >
          <option value="all">Все группы ({skills.length})</option>
          {groups.map(([key, entry]) => (
            <option key={key} value={key}>
              {entry.label} ({entry.count})
            </option>
          ))}
        </select>
      </div>

      <div className="skills-layout">
        <div className="skills-grid">
          {filtered.map((skill) => {
            const Icon = GROUP_ICONS[skill.group as keyof typeof GROUP_ICONS] ?? BookOpen;
            const used = usage.get(skill.name) ?? 0;
            return (
              <button
                type="button"
                className={`skill-card is-${skill.group}${
                  selected === skill.name ? " is-selected" : ""
                }`}
                key={skill.name}
                onClick={() => setSelected(skill.name)}
              >
                <span className={`skill-glyph is-${skill.group}`}>
                  <Icon size={20} strokeWidth={1.7} />
                </span>
                <span className="skill-card-main">
                  <span className="skill-card-title">{pretty(skill.name)}</span>
                  <span className="skill-card-desc">{firstSentence(skill.description)}</span>
                </span>
                <span className="skill-card-foot">
                  <span className="skill-card-group">{skill.group_label}</span>
                  <span className="skill-card-meta">
                    {skill.files.length > 0 ? `${skill.files.length} файлов` : "1 файл"}
                    {used > 0 ? ` · ${used} задач` : ""}
                  </span>
                </span>
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <div className="skills-empty">
              <Search size={22} />
              <p>Ничего не найдено. Попробуй другой запрос.</p>
            </div>
          ) : null}
        </div>

        <aside className="skill-detail-panel">
          {!selected ? (
            <div className="skill-detail-empty">
              <span className="skill-glyph is-core">
                <BookOpen size={22} strokeWidth={1.7} />
              </span>
              <h3>Выбери скилл</h3>
              <p>
                Слева — карточки с описанием. Здесь появится полный текст инструкции и файлы,
                которые AI будет использовать.
              </p>
            </div>
          ) : loading ? (
            <div className="skill-detail-empty">
              <span className="skill-glyph is-core">
                <Sparkles size={22} strokeWidth={1.7} />
              </span>
              <p>Загрузка скилла…</p>
            </div>
          ) : error ? (
            <div className="skill-detail-empty">
              <p className="modal-error">{error}</p>
            </div>
          ) : detail ? (
            <>
              <div className="skill-detail-head">
                <span className={`skill-glyph is-${detail.group}`}>
                  <GroupIcon size={20} strokeWidth={1.7} />
                </span>
                <div>
                  <h2>{pretty(detail.name)}</h2>
                  <span className={`skill-badge is-${detail.group}`}>{detail.group_label}</span>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => void copy()}
                  title="Скопировать скилл"
                  aria-label="Скопировать скилл"
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>

              <p className="skill-detail-desc">{detail.description}</p>

              <div className="skill-detail-meta">
                <span>
                  <FileCode2 size={13} />
                  {detail.files.length + 1} файлов
                </span>
                <span>Задач с этим скиллом: {usage.get(detail.name) ?? 0}</span>
              </div>

              <div className="skill-detail-files">
                <span className="skill-file is-main">SKILL.md</span>
                {detail.files.map((file) => (
                  <span className="skill-file" key={file}>
                    {file}
                  </span>
                ))}
              </div>

              <pre className="skill-md">{detail.content}</pre>
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
