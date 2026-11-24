import { useEffect, useMemo, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import type { Skill, Task } from "../../lib/types";

type Props = {
  task: Task;
  skills: Skill[];
  onClose: () => void;
  onSave: (names: string[]) => Promise<void>;
};

const CATEGORY_ORDER = ["blender", "code", "roblox", "unity", "godot", "unreal", "general"];

function short(text: string) {
  if (!text) return "";
  const first = text.split(". ")[0]?.trim() ?? "";
  return first.length > 150 ? `${first.slice(0, 147)}…` : first;
}

export default function SkillPickerModal({ task, skills, onClose, onSave }: Props) {
  const [selected, setSelected] = useState<string[]>(task.skills);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return skills;
    return skills.filter((skill) =>
      `${skill.name} ${skill.description}`.toLowerCase().includes(search),
    );
  }, [query, skills]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: Skill[] }>();
    for (const skill of filtered) {
      const entry = map.get(skill.category) ?? { label: skill.category_label, items: [] };
      entry.items.push(skill);
      map.set(skill.category, entry);
    }
    return [...map.entries()].sort(
      ([left], [right]) => CATEGORY_ORDER.indexOf(left) - CATEGORY_ORDER.indexOf(right),
    );
  }, [filtered]);

  const toggle = (name: string) => {
    setSelected((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить скиллы");
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal skill-picker">
        <div className="modal-header">
          <span className="modal-title">Скиллы задачи</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <p className="skill-picker-hint">
            Выбери скиллы для этой задачи. Если ничего не выбрано, Kova подберёт их по типу
            задачи и движку.
          </p>
          <input
            type="search"
            className="skill-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти скилл"
            aria-label="Найти скилл"
          />

          <div className="skill-groups">
            {groups.map(([key, group]) => (
              <div className="skill-group" key={key}>
                <div className="skill-group-title">{group.label}</div>
                {group.items.map((skill) => {
                  const active = selected.includes(skill.name);
                  return (
                    <label
                      className={`skill-option${active ? " is-selected" : ""}`}
                      key={skill.name}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggle(skill.name)}
                      />
                      <span className="skill-option-copy">
                        <span className="skill-option-name">
                          {skill.name.replace("blender-", "")}
                          {skill.locked ? <em className="skill-lock">AI lock</em> : null}
                        </span>
                        <span className="skill-option-desc">{short(skill.description)}</span>
                      </span>
                      {active ? <Check size={14} className="skill-option-check" /> : null}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>

          {error ? <p className="modal-error">{error}</p> : null}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => setSelected([])}
          >
            <RotateCcw size={14} />
            Авто
          </button>
          <span className="skill-picker-count">
            {selected.length === 0 ? "авто" : `выбрано: ${selected.length}`}
          </span>
          <span className="modal-footer-spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            <Check size={15} />
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
