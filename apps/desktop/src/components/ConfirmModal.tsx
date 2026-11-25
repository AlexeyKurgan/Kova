import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

type Props = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  details?: string[];
  note?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export default function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger = false,
  details = [],
  note = "",
  onCancel,
  onConfirm,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить действие");
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className={`modal confirm-modal${danger ? " is-danger" : ""}`}>
        <div className="confirm-head">
          <span className={`confirm-head-icon${danger ? " is-danger" : ""}`}>
            <AlertTriangle size={20} />
          </span>
          <div className="confirm-head-copy">
            <span className="modal-title">{title}</span>
            <p>{danger ? "Действие нельзя отменить." : "Подтверди действие."}</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onCancel}
            aria-label="Закрыть"
            disabled={busy}
          >
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          <p className="confirm-message">{message}</p>
          {details.length > 0 ? (
            <ul className="confirm-details">
              {details.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {note ? <p className="confirm-note">{note}</p> : null}
          {error ? <p className="modal-error">{error}</p> : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Отмена
          </button>
          <span className="modal-footer-spacer" />
          <button
            type="button"
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? "Выполняется…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
