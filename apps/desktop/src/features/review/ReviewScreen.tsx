import { useState } from "react";
import { Check, RotateCcw, Sparkles, Star } from "lucide-react";
import { reviewResponse } from "../../lib/coreClient";
import { formatDate } from "../../lib/format";
import { REVIEW_STATUS_LABELS } from "../../lib/labels";
import type { ReviewItem, Task } from "../../lib/types";

type Props = {
  items: ReviewItem[];
  tasks: Task[];
  onAccept: (reviewId: string) => void;
  onRework: (reviewId: string) => void;
};

export default function ReviewScreen({ items, tasks, onAccept, onRework }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const toggle = async (reviewId: string) => {
    if (expanded === reviewId) {
      setExpanded(null);
      return;
    }
    setExpanded(reviewId);
    if (!previews[reviewId]) {
      try {
        const text = await reviewResponse(reviewId);
        setPreviews((current) => ({ ...current, [reviewId]: text }));
      } catch {
        setPreviews((current) => ({ ...current, [reviewId]: "Не удалось загрузить ответ" }));
      }
    }
  };

  const taskTitle = (taskId: string) =>
    tasks.find((task) => task.id === taskId)?.title ?? "Задача";

  return (
    <section className="assets-screen">
      <div className="assets-heading">
        <Star size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>Review Inbox</h1>
          <p className="subtitle">
            Очередь приёмки: AI не пишет в проект без твоего подтверждения.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-art">
            <Star size={72} strokeWidth={1.05} />
            <Sparkles size={22} className="empty-sparkle" />
          </div>
          <h2 className="empty-title">Очередь пуста</h2>
          <p className="empty-text">
            Когда импортируешь ответ AI в задаче, он появится здесь для приёмки.
          </p>
        </div>
      ) : (
        <div className="task-list">
          {items.map((item) => (
            <article className="task-card review-card" key={item.id}>
              <div className="task-card-main">
                <span className={`task-status is-${item.status}`}>
                  {REVIEW_STATUS_LABELS[item.status]}
                </span>
                <h2>{taskTitle(item.task_id)}</h2>
                <p className="task-meta">{formatDate(item.created_at)}</p>
                <p className="task-goal">{item.summary}</p>
                {expanded === item.id && previews[item.id] ? (
                  <pre className="capsule-pre is-small">{previews[item.id]}</pre>
                ) : null}
              </div>
              <div className="review-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void toggle(item.id)}
                >
                  {expanded === item.id ? "Скрыть" : "Ответ"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onRework(item.id)}
                >
                  <RotateCcw size={15} />
                  Доработать
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onAccept(item.id)}
                >
                  <Check size={15} />
                  Принять
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
