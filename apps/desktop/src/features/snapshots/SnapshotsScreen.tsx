import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Camera, Plus, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { formatDate } from "../../lib/format";
import type { Snapshot } from "../../lib/types";

type Props = {
  snapshots: Snapshot[];
  onCreate: (reason: string) => Promise<void>;
  onRestore: (snapshotId: string) => void;
  onDelete: (snapshotId: string) => Promise<void>;
  onCleanup: () => Promise<void>;
};

export default function SnapshotsScreen({
  snapshots,
  onCreate,
  onRestore,
  onDelete,
  onCleanup,
}: Props) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busySnapshot, setBusySnapshot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reasonOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReasonOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reasonOpen]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(reason.trim());
      setReasonOpen(false);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать снапшот");
    }
    setSubmitting(false);
  };

  const deleteOne = async (snapshotId: string) => {
    if (!window.confirm("Удалить этот снапшот навсегда?")) return;
    setBusySnapshot(snapshotId);
    setError(null);
    try {
      await onDelete(snapshotId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить снапшот");
    } finally {
      setBusySnapshot(null);
    }
  };

  const cleanupOld = async () => {
    if (!window.confirm("Удалить снапшоты старше 30 дней, кроме последних 10?")) return;
    setBusySnapshot("cleanup");
    setError(null);
    try {
      await onCleanup();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось очистить снапшоты");
    } finally {
      setBusySnapshot(null);
    }
  };

  return (
    <section className="assets-screen">
      <div className="assets-heading">
        <Camera size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>Снапшоты</h1>
          <p className="subtitle">
            Точки восстановления проекта: экспериментируй безопасно, откатывайся в один клик.
          </p>
        </div>
        <div className="header-actions">
          {snapshots.length ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busySnapshot !== null}
              onClick={() => void cleanupOld()}
            >
              <Trash2 size={15} />
              Очистить старые
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setReasonOpen(true)}
          >
            <Plus size={15} />
            Создать снапшот
          </button>
        </div>
      </div>

      {snapshots.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-art">
            <Camera size={72} strokeWidth={1.05} />
            <Sparkles size={22} className="empty-sparkle" />
          </div>
          <h2 className="empty-title">Снапшотов пока нет</h2>
          <p className="empty-text">
            Создай точку восстановления перед экспериментом — откат вернёт файлы
            проекта к этому состоянию.
          </p>
        </div>
      ) : (
        <div className="task-list">
          {snapshots.map((snapshot) => (
            <article className="task-card" key={snapshot.id}>
              <div className="task-card-main">
                <span className="task-status is-draft">
                  {snapshot.created_by === "kova" ? "Авто" : "Вручную"}
                </span>
                <h2>{snapshot.reason}</h2>
                <p className="task-meta">
                  {formatDate(snapshot.created_at)} · файлов: {snapshot.files.length}
                </p>
              </div>
              <div className="review-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onRestore(snapshot.id)}
                >
                  <RotateCcw size={15} />
                  Откатить
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-small"
                  disabled={busySnapshot !== null}
                  onClick={() => void deleteOne(snapshot.id)}
                >
                  <Trash2 size={13} />
                  Удалить
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {reasonOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReasonOpen(false);
          }}
        >
          <form className="modal" onSubmit={handleSubmit}>
            <div className="modal-header">
              <span className="modal-title">Новый снапшот</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setReasonOpen(false)}
                aria-label="Закрыть"
              >
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label htmlFor="snapshot-reason">Причина / метка</label>
                <input
                  id="snapshot-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Например: перед правкой пивота"
                  maxLength={200}
                  autoFocus
                  required
                />
              </div>
              {error ? <p className="modal-error">{error}</p> : null}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setReasonOpen(false)}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!reason.trim() || submitting}
              >
                <Camera size={15} />
                {submitting ? "Создание…" : "Создать"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
