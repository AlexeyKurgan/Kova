import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

type Props = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export default function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger = false,
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
      <div className="modal confirm-modal">
        <div className="modal-header">
          <span className="modal-title">
            <AlertTriangle size={16} className={danger ? "confirm-icon is-danger" : "confirm-icon"} />
            {title}
          </span>
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
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
