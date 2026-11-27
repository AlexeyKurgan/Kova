import { useEffect, useState } from "react";
import { Check, Palette, Save, TriangleAlert } from "lucide-react";
import { getStyle, listStyleViolations, updateStyle } from "../../lib/coreClient";
import type { StyleBible, StyleViolation } from "../../lib/types";

const BUDGETS: Array<{
  key: keyof Pick<
    StyleBible,
    "max_triangles" | "max_vertices" | "max_materials" | "max_textures" | "max_bones"
  >;
  label: string;
  placeholder: string;
}> = [
  { key: "max_triangles", label: "Треугольники", placeholder: "напр. 8000" },
  { key: "max_vertices", label: "Вершины", placeholder: "напр. 5000" },
  { key: "max_materials", label: "Материалы", placeholder: "напр. 2" },
  { key: "max_textures", label: "Текстуры", placeholder: "напр. 3" },
  { key: "max_bones", label: "Кости", placeholder: "напр. 32" },
];

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

export default function StyleBibleCard() {
  const [bible, setBible] = useState<StyleBible | null>(null);
  const [violations, setViolations] = useState<StyleViolation[]>([]);
  const [palette, setPalette] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([getStyle(), listStyleViolations().catch(() => [])])
      .then(([value, rows]) => {
        if (!alive) return;
        setBible(value);
        setPalette(value.palette.join(", "));
        setViolations(rows);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Не удалось загрузить стиль");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!bible) {
    return (
      <article className="settings-card is-wide">
        <div className="settings-card-head">
          <span className="settings-icon">
            <Palette size={16} />
          </span>
          <div>
            <b>Style Bible</b>
            <small>{error || "Загрузка правил стиля…"}</small>
          </div>
        </div>
      </article>
    );
  }

  const set = <K extends keyof StyleBible>(key: K, value: StyleBible[K]) => {
    setBible((current) => (current ? { ...current, [key]: value } : current));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const updated = await updateStyle({
        ...bible,
        palette: palette
          .split(/[,\s]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setBible(updated);
      setPalette(updated.palette.join(", "));
      const rows = await listStyleViolations().catch(() => []);
      setViolations(rows);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить Style Bible");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="settings-card is-wide style-bible-card">
      <div className="settings-card-head">
        <span className="settings-icon">
          <Palette size={16} />
        </span>
        <div>
          <b>Style Bible</b>
          <small>Лимиты и правила, по которым Kova проверяет ассеты</small>
        </div>
        <label className="style-toggle">
          <input
            type="checkbox"
            checked={bible.enabled}
            onChange={(event) => set("enabled", event.target.checked)}
          />
          Включён
        </label>
      </div>

      <div className="style-bible-grid">
        <label className="style-field is-wide">
          <span>Название стиля</span>
          <input
            value={bible.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Например: Uncharted — low-poly"
          />
        </label>
        <label className="style-field is-wide">
          <span>Описание / правила простым языком</span>
          <textarea
            rows={2}
            value={bible.description}
            onChange={(event) => set("description", event.target.value)}
            placeholder="Например: тёплый металл, минимум мелких деталей, один атлас на объект."
          />
        </label>
        <label className="style-field is-wide">
          <span>Палитра (hex через запятую)</span>
          <input
            value={palette}
            onChange={(event) => {
              setPalette(event.target.value);
              setSaved(false);
            }}
            placeholder="#D8A657, #1C232B"
          />
        </label>
        {BUDGETS.map((row) => (
          <label className="style-field" key={row.key}>
            <span>{row.label}</span>
            <input
              type="number"
              min={0}
              value={bible[row.key] ?? ""}
              placeholder={row.placeholder}
              onChange={(event) => set(row.key, numberOrNull(event.target.value))}
            />
          </label>
        ))}
        <label className="style-field is-wide">
          <span>Шаблон имени ассета (regex, пусто — не проверять)</span>
          <input
            value={bible.naming_pattern}
            onChange={(event) => set("naming_pattern", event.target.value)}
            placeholder="^[a-z][a-z0-9-]*$"
          />
        </label>
      </div>

      <div className="settings-checks">
        <label className="agent-check">
          <input
            type="checkbox"
            checked={bible.require_license}
            onChange={(event) => set("require_license", event.target.checked)}
          />
          Требовать указанную лицензию
        </label>
      </div>

      {error ? <p className="modal-error">{error}</p> : null}
      {saved ? (
        <p className="style-saved">
          <Check size={12} /> Style Bible сохранён
        </p>
      ) : null}

      {bible.enabled ? (
        <div className="style-violations">
          <b>
            {violations.length === 0
              ? "Все ассеты в стиле"
              : `Вне стиля: ${violations.length}`}
          </b>
          {violations.slice(0, 6).map((row) => (
            <div className="style-violation-row" key={row.asset_id}>
              <TriangleAlert size={11} />
              <span>{row.asset_name}</span>
              <small>
                {row.checks
                  .slice(0, 3)
                  .map((check) => check.message)
                  .join(" · ")}
              </small>
            </div>
          ))}
        </div>
      ) : null}

      <div className="style-bible-actions">
        <button type="button" className="btn btn-primary btn-small" disabled={saving} onClick={() => void save()}>
          <Save size={13} />
          {saving ? "Сохранение…" : "Сохранить Style Bible"}
        </button>
      </div>
    </article>
  );
}
