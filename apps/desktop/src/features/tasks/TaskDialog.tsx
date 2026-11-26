import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Sparkles, SquareCheckBig, X } from "lucide-react";
import type { CreateTaskInput, Engine, TaskType } from "../../lib/types";
import { TASK_TEMPLATES, type TaskTemplate } from "../../lib/taskTemplates";

type Props = {
  defaultEngine: Engine;
  initialAssetIds?: string[];
  initialTemplateId?: string | null;
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
  initialTemplateId = null,
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

  const applyTemplate = (template: TaskTemplate) => {
    setTemplateId(template.id);
    setTitle(template.title);
    setType(template.type);
    setEngine(template.engine);
    setGoal(template.goal);
    setCriteria(template.criteria.join("\n"));
    titleRef.current?.focus();
  };

  useEffect(() => {
    if (!initialTemplateId) return;
    const template = TASK_TEMPLATES.find((item) => item.id === initialTemplateId);
    if (template) applyTemplate(template);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTemplateId]);

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
              {TASK_TEMPLATES.map((template) => (
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
