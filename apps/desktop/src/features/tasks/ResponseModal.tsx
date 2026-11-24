import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Inbox, X } from "lucide-react";

type Props = {
  onClose: () => void;
  onSubmit: (text: string) => Promise<void>;
};

export default function ResponseModal({ onClose, onSubmit }: Props) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(text.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось импортировать ответ");
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
      <form className="modal modal-wide" onSubmit={handleSubmit}>
        <div className="modal-header">
          <span className="modal-title">Ответ AI</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label htmlFor="response-text">Вставь ответ агента целиком</label>
            <textarea
              id="response-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={"Что сделано, изменённые файлы, что проверить дальше…"}
              rows={12}
              autoFocus
            />
          </div>
          <p className="detail-muted">
            Ответ сохранится как артефакт и попадёт в Review Inbox — в проект он не
            применяется без твоего подтверждения.
          </p>
          {error ? <p className="modal-error">{error}</p> : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={!text.trim() || submitting}>
            <Inbox size={15} />
            {submitting ? "Импорт…" : "В Review"}
          </button>
        </div>
      </form>
    </div>
  );
}
