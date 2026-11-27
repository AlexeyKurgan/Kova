import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  Camera,
  ChevronRight,
  GitCompareArrows,
  History,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { formatBytes, formatDate } from "../../lib/format";
import { t } from "../../lib/i18n";
import type { Snapshot, SnapshotDiff } from "../../lib/types";

type Props = {
  snapshots: Snapshot[];
  onCreate: (reason: string) => Promise<void>;
  onRestore: (snapshotId: string) => void;
  onDelete: (snapshotId: string) => Promise<void>;
  onCleanup: () => Promise<void>;
  onDiff: (snapshotId: string) => Promise<SnapshotDiff>;
};

type DiffRow = {
  path: string;
  status: "added" | "removed" | "changed";
  before?: SnapshotFileLike;
  after?: SnapshotFileLike;
};

type SnapshotFileLike = Snapshot["files"][number];

function diffSnapshots(left: Snapshot, right: Snapshot): DiffRow[] {
  const before = new Map(left.files.map((file) => [file.path, file]));
  const after = new Map(right.files.map((file) => [file.path, file]));
  const paths = new Set([...before.keys(), ...after.keys()]);
  const rows: DiffRow[] = [];
  for (const path of paths) {
    const a = before.get(path);
    const b = after.get(path);
    if (!a) rows.push({ path, status: "added", after: b });
    else if (!b) rows.push({ path, status: "removed", before: a });
    else if (a.hash !== b.hash) rows.push({ path, status: "changed", before: a, after: b });
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

export default function SnapshotsScreen({
  snapshots,
  onCreate,
  onRestore,
  onDelete,
  onCleanup,
  onDiff,
}: Props) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busySnapshot, setBusySnapshot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Snapshot | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [previewDiff, setPreviewDiff] = useState<SnapshotDiff | null>(null);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    if (!reasonOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReasonOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reasonOpen]);

  useEffect(() => {
    if (!preview) {
      setPreviewDiff(null);
      setPreviewError("");
      return;
    }
    let alive = true;
    setPreviewDiff(null);
    setPreviewError("");
    void onDiff(preview.id)
      .then((value) => {
        if (alive) setPreviewDiff(value);
      })
      .catch((err) => {
        if (alive) {
          setPreviewError(
            err instanceof Error ? err.message : t("Не удалось сравнить с текущим проектом"),
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [onDiff, preview]);

  useEffect(() => {
    if (snapshots.length < 2) return;
    setCompareA((current) => current || snapshots[snapshots.length - 2]?.id || "");
    setCompareB((current) => current || snapshots[0]?.id || "");
  }, [snapshots]);

  const groups = useMemo(() => {
    const map = new Map<string, Snapshot[]>();
    for (const snapshot of snapshots) {
      const date = new Date(snapshot.created_at);
      const key = Number.isNaN(date.getTime())
        ? t("Без даты")
        : date.toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
            year: "numeric",
          });
      const rows = map.get(key) ?? [];
      rows.push(snapshot);
      map.set(key, rows);
    }
    return [...map.entries()];
  }, [snapshots]);

  const diff = useMemo(() => {
    const left = snapshots.find((snapshot) => snapshot.id === compareA);
    const right = snapshots.find((snapshot) => snapshot.id === compareB);
    return left && right ? diffSnapshots(left, right) : [];
  }, [compareA, compareB, snapshots]);

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
      setError(err instanceof Error ? err.message : t("Не удалось создать снапшот"));
    }
    setSubmitting(false);
  };

  const deleteOne = async (snapshotId: string) => {
    if (!window.confirm(t("Удалить этот снапшот навсегда?"))) return;
    setBusySnapshot(snapshotId);
    setError(null);
    try {
      await onDelete(snapshotId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Не удалось удалить снапшот"));
    } finally {
      setBusySnapshot(null);
    }
  };

  const cleanupOld = async () => {
    if (!window.confirm(t("Удалить снапшоты старше 30 дней, кроме последних 10?"))) return;
    setBusySnapshot("cleanup");
    setError(null);
    try {
      await onCleanup();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Не удалось очистить снапшоты"));
    } finally {
      setBusySnapshot(null);
    }
  };

  const added = diff.filter((row) => row.status === "added").length;
  const removed = diff.filter((row) => row.status === "removed").length;
  const changed = diff.filter((row) => row.status === "changed").length;

  return (
    <section className="assets-screen">
      <div className="assets-heading">
        <Camera size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>{t("Снапшоты")}</h1>
          <p className="subtitle">
            {t("Точки восстановления проекта: экспериментируй безопасно, откатывайся в один клик.")}
          </p>
        </div>
        <div className="header-actions">
          {snapshots.length > 1 ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCompareOpen((value) => !value)}
            >
              <GitCompareArrows size={15} />
              {compareOpen ? t("Скрыть сравнение") : t("Сравнить")}
            </button>
          ) : null}
          {snapshots.length ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busySnapshot !== null}
              onClick={() => void cleanupOld()}
            >
              <Trash2 size={15} />
              {t("Очистить старые")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setReasonOpen(true)}
          >
            <Plus size={15} />
            {t("Создать снапшот")}
          </button>
        </div>
      </div>

      {error ? <p className="modal-error resource-error">{error}</p> : null}

      {compareOpen && snapshots.length > 1 ? (
        <article className="snap-compare">
          <div className="snap-compare-head">
            <span>
              <GitCompareArrows size={14} /> {t("Сравнение снапшотов")}
            </span>
            <span className="snap-compare-stats">
              <b className="is-added">+{added}</b>
              <b className="is-changed">~{changed}</b>
              <b className="is-removed">−{removed}</b>
            </span>
          </div>
          <div className="snap-compare-pickers">
            <label>
              {t("Было")}
              <select value={compareA} onChange={(event) => setCompareA(event.target.value)}>
                {snapshots.map((snapshot) => (
                  <option key={snapshot.id} value={snapshot.id}>
                    {formatDate(snapshot.created_at)} · {snapshot.reason}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Стало")}
              <select value={compareB} onChange={(event) => setCompareB(event.target.value)}>
                {snapshots.map((snapshot) => (
                  <option key={snapshot.id} value={snapshot.id}>
                    {formatDate(snapshot.created_at)} · {snapshot.reason}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {diff.length === 0 ? (
            <p className="ad3-empty">{t("Файлы не отличаются.")}</p>
          ) : (
            <div className="snap-diff">
              {diff.slice(0, 80).map((row) => (
                <div className={`snap-diff-row is-${row.status}`} key={row.path}>
                  <span>
                    {row.status === "added" ? "+" : row.status === "removed" ? "−" : "~"}
                  </span>
                  <code>{row.path}</code>
                  <small>
                    {row.before ? formatBytes(row.before.size) : "—"} →{" "}
                    {row.after ? formatBytes(row.after.size) : "—"}
                  </small>
                </div>
              ))}
              {diff.length > 80 ? (
                <p className="ad3-empty">{t("Показаны первые 80 из {count} файлов.", { count: diff.length })}</p>
              ) : null}
            </div>
          )}
        </article>
      ) : null}

      {snapshots.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-art">
            <Camera size={72} strokeWidth={1.05} />
            <Sparkles size={22} className="empty-sparkle" />
          </div>
          <h2 className="empty-title">{t("Снапшотов пока нет")}</h2>
          <p className="empty-text">
            {t("Создай точку восстановления перед экспериментом — откат вернёт файлы проекта к этому состоянию.")}
          </p>
        </div>
      ) : (
        <div className="snap-timeline">
          {groups.map(([label, rows]) => (
            <section className="snap-day" key={label}>
              <div className="snap-day-head">
                <span className="snap-dot" />
                <b>{label}</b>
                <small>{rows.length}</small>
              </div>
              {rows.map((snapshot) => (
                <article className="task-card snap-card" key={snapshot.id}>
                  <div className="task-card-main">
                    <span className="task-status is-draft">
                      {snapshot.created_by === "kova" ? t("Авто") : t("Вручную")}
                    </span>
                    <h2>{snapshot.reason}</h2>
                    <p className="task-meta">
                      {formatDate(snapshot.created_at)} · {t("файлов: {count}", { count: snapshot.files.length })}
                    </p>
                  </div>
                  <div className="review-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setPreview(snapshot)}
                    >
                      <History size={15} />
                      {t("Состав")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onRestore(snapshot.id)}
                    >
                      <RotateCcw size={15} />
                      {t("Откатить")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-small"
                      disabled={busySnapshot !== null}
                      onClick={() => void deleteOne(snapshot.id)}
                    >
                      <Trash2 size={13} />
                      {t("Удалить")}
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>
      )}

      {preview ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreview(null);
          }}
        >
          <div className="modal modal-wide">
            <div className="modal-header">
              <span className="modal-title">
                <History size={15} /> {preview.reason}
              </span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setPreview(null)}
                aria-label={t("Закрыть")}
              >
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              <div className="snap-preview-meta">
                <span>{t("Создан {date}", { date: formatDate(preview.created_at) })}</span>
                <span>{t("{count} файлов", { count: preview.files.length })}</span>
                <span>
                  {preview.created_by === "kova" ? t("Автоматически") : t("Вручную")}
                </span>
              </div>
              <p className="detail-muted">
                {t("Откат вернёт проект к этой точке. Перед откатом Kova создаст аварийный снапшот текущего состояния.")}
              </p>
              {previewError ? <p className="modal-error">{previewError}</p> : null}
              {!previewDiff && !previewError ? (
                <p className="ad3-empty">{t("Сравниваю снапшот с текущим проектом…")}</p>
              ) : null}
              {previewDiff ? (
                previewDiff.changes.length === 0 ? (
                  <p className="ad3-empty">
                    {t("Текущий проект совпадает со снапшотом — откат ничего не изменит.")}
                  </p>
                ) : (
                  <>
                    <div className="snap-preview-meta">
                      <span>
                        {t("{count} отличий от текущего проекта", {
                          count: previewDiff.total,
                        })}
                        {previewDiff.truncated ? t(" (показаны первые)") : ""}
                      </span>
                    </div>
                    <div className="snap-file-list">
                      {previewDiff.changes.map((change) => (
                        <div
                          className={`snap-file-row is-${change.status}`}
                          key={change.path}
                        >
                          <span>
                            {change.status === "added"
                              ? "+"
                              : change.status === "deleted"
                                ? "−"
                                : "~"}
                          </span>
                          <code>{change.path}</code>
                          <small>
                            {change.status === "added"
                              ? t("появился после снапшота")
                              : change.status === "deleted"
                                ? t("удалён после снапшота")
                                : t("изменён")}
                          </small>
                        </div>
                      ))}
                    </div>
                  </>
                )
              ) : (
                <div className="snap-file-list">
                  {preview.files.slice(0, 80).map((file) => (
                    <div className="snap-file-row" key={file.path}>
                      <ChevronRight size={11} />
                      <code>{file.path}</code>
                      <small>{formatBytes(file.size)}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setPreview(null)}>
                {t("Закрыть")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onRestore(preview.id);
                  setPreview(null);
                }}
              >
                <RotateCcw size={15} />
                {t("Откатить к этой точке")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reasonOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReasonOpen(false);
          }}
        >
          <form className="modal" onSubmit={handleSubmit}>
            <div className="modal-header">
              <span className="modal-title">{t("Новый снапшот")}</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setReasonOpen(false)}
                aria-label={t("Закрыть")}
              >
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label htmlFor="snapshot-reason">{t("Причина / метка")}</label>
                <input
                  id="snapshot-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t("Например: перед правкой пивота")}
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
                {t("Отмена")}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!reason.trim() || submitting}
              >
                <Camera size={15} />
                {submitting ? t("Создание…") : t("Создать")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
