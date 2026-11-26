import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Sparkles, SquareCheckBig, X } from "lucide-react";
import type { CreateTaskInput, Engine, TaskType } from "../../lib/types";

type Props = {
  defaultEngine: Engine;
  initialAssetIds?: string[];
  onClose: () => void;
  onSubmit: (input: CreateTaskInput) => Promise<void>;
};

const TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: "model", label: "Модель" },
  { value: "animation", label: "Анимация" },
  { value: "effect", label: "Эффект" },
  { value: "texture", label: "Текстура" },
  { value: "code", label: "Код" },
  { value: "level", label: "Уровень" },
  { value: "export", label: "Экспорт" },
];

type Template = {
  id: string;
  label: string;
  title: string;
  type: TaskType;
  engine: Engine;
  goal: string;
  criteria: string[];
};

const TEMPLATES: Template[] = [
  {
    id: "roblox-prop",
    label: "Модель для Roblox",
    title: "Модель для Roblox",
    type: "model",
    engine: "roblox",
    goal: "Создать low-poly модель для Roblox с чистым силуэтом и игровым масштабом.",
    criteria: ["≤ 20 000 треугольников", "UV и один материал", "Пивот в игровой точке", "Экспорт FBX/GLB"],
  },
  {
    id: "sword",
    label: "Меч",
    type: "model",
    engine: "roblox",
    title: "Стилизованный меч",
    goal: "Сделать стилизованный меч для Roblox: клинок, гарда, рукоять и навершие.",
    criteria: ["≤ 5 000 треугольников", "Один материал или атлас", "Пивот у рукояти", "Готов к импорту в Studio"],
  },
  {
    id: "animation-hit",
    label: "Анимация удара",
    title: "Анимация удара",
    type: "animation",
    engine: "roblox",
    goal: "Создать игровую анимацию удара с читаемым замахом и возвратом в стойку.",
    criteria: ["Длительность 0.6–1.2 с", "Loop/return pose", "Root motion проверен", "Экспорт в движок"],
  },
  {
    id: "uv-fix",
    label: "UV fix",
    title: "Исправить UV",
    type: "texture",
    engine: "blender",
    goal: "Исправить UV-развёртку и перекрытия, сохранить текстуры.",
    criteria: ["Нет UV вне 0..1", "Нет пересечений островов", "Текстура не растянута", "QA пройден"],
  },
  {
    id: "lod",
    label: "LOD",
    title: "Сделать LOD",
    type: "model",
    engine: "blender",
    goal: "Подготовить LOD-цепочку для игрового ассета.",
    criteria: ["LOD0/LOD1/LOD2", "Силуэт сохраняется", "Бюджеты треугольников", "Экспорт проверен"],
  },
  {
    id: "vfx",
    label: "VFX",
    title: "Эффект для игры",
    type: "effect",
    engine: "roblox",
    goal: "Создать читаемый игровой эффект с бюджетом частиц.",
    criteria: ["Бюджет частиц", "Длительность и loop", "Цвет и слои", "Playtest без ошибок"],
  },
  {
    id: "roblox-export",
    label: "Экспорт в Roblox",
    title: "Экспорт ассета в Roblox",
    type: "export",
    engine: "roblox",
    goal: "Подготовить принятый ассет к импорту в Roblox Studio.",
    criteria: ["Масштаб и оси", "Материалы/текстуры", "FBX/GLB", "Импорт и Asset ID"],
  },
  {
    id: "code-feature",
    label: "Кодовая фича",
    title: "Новая кодовая фича",
    type: "code",
    engine: "generic",
    goal: "Реализовать небольшую фичу с тестами и без регрессий.",
    criteria: ["Код собирается", "Тесты проходят", "Нет лишних файлов", "Есть отчёт"],
  },
];

const ENGINE_OPTIONS: { value: Engine; label: string }[] = [
  { value: "roblox", label: "Roblox" },
  { value: "blender", label: "Blender" },
  { value: "godot", label: "Godot" },
  { value: "unity", label: "Unity" },
  { value: "unreal", label: "Unreal" },
  { value: "generic", label: "Без движка" },
];

export default function TaskDialog({
  defaultEngine,
  initialAssetIds = [],
  onClose,
  onSubmit,
}: Props) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("model");
  const [engine, setEngine] = useState<Engine>(defaultEngine);
  const [goal, setGoal] = useState("");
  const [criteria, setCriteria] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const applyTemplate = (template: Template) => {
    setTemplateId(template.id);
    setTitle(template.title);
    setType(template.type);
    setEngine(template.engine);
    setGoal(template.goal);
    setCriteria(template.criteria.join("\n"));
    titleRef.current?.focus();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        type,
        engine,
        goal: goal.trim(),
        criteria: criteria
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        asset_ids: initialAssetIds,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать задачу");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className="modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <span className="modal-title">Новая задача</span>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="task-template-block">
            <span>
              <Sparkles size={14} />
              Шаблон
            </span>
            <div className="task-template-grid">
              {TEMPLATES.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  className={`task-template-chip${templateId === template.id ? " is-active" : ""}`}
                  onClick={() => applyTemplate(template)}
                >
                  {template.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="task-title">Название</label>
            <input
              id="task-title"
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Например: Сундук для стартовой локации"
              maxLength={200}
              required
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="task-type">Тип</label>
              <select
                id="task-type"
                value={type}
                onChange={(event) => setType(event.target.value as TaskType)}
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-engine">Движок</label>
              <select
                id="task-engine"
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
          </div>

          <div className="field">
            <label htmlFor="task-goal">Цель</label>
            <textarea
              id="task-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Что должно получиться в результате"
              rows={3}
            />
          </div>

          <div className="field">
            <label htmlFor="task-criteria">Критерии готовности — по одному на строку</label>
            <textarea
              id="task-criteria"
              value={criteria}
              onChange={(event) => setCriteria(event.target.value)}
              placeholder={"≤ 800 треугольников\nПивот внизу\nКрышка отдельным объектом"}
              rows={4}
            />
          </div>

          {error ? <p className="modal-error">{error}</p> : null}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!title.trim() || submitting}
          >
            <SquareCheckBig size={15} />
            {submitting ? "Создание…" : "Создать задачу"}
          </button>
        </div>
      </form>
    </div>
  );
}
