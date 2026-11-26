import { useMemo, useRef, useState } from "react";
import {
  Check,
  GitCompareArrows,
  MessageSquarePlus,
  Pin,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { mediaUrl } from "../../lib/coreClient";
import { formatDate } from "../../lib/format";
import type { AssetPassport, ReviewComment } from "../../lib/types";

type Props = {
  asset: AssetPassport;
  comments: ReviewComment[];
  onAddComment: (input: {
    body: string;
    assetId: string;
    versionId: string;
    x: number;
    y: number;
  }) => Promise<void>;
  onResolve: (commentId: string, resolved: boolean) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
};

function previewFor(asset: AssetPassport, versionId: string) {
  const version = asset.versions.find((item) => item.id === versionId);
  const preview = version?.preview || asset.preview;
  if (!preview) return "";
  return mediaUrl(`/assets/${asset.id}/preview`, {
    version_id: versionId,
    v: preview,
  });
}

export default function ReviewAssetStage({
  asset,
  comments,
  onAddComment,
  onResolve,
  onDelete,
}: Props) {
  const lastVersion =
    asset.versions.find((item) => item.id === asset.current_version_id) ??
    asset.versions[asset.versions.length - 1];
  const [versionId, setVersionId] = useState(lastVersion?.id ?? "");
  const [compare, setCompare] = useState(false);
  const [compareA, setCompareA] = useState(
    asset.versions[Math.max(0, asset.versions.length - 2)]?.id ?? "",
  );
  const [compareB, setCompareB] = useState(lastVersion?.id ?? "");
  const [split, setSplit] = useState(50);
  const [pinMode, setPinMode] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const selectedVersion = asset.versions.find((item) => item.id === versionId) ?? lastVersion;
  const baseSource = compare ? compareB : selectedVersion?.id ?? "";
  const overlaySource = compare ? compareA : "";
  const basePreview = baseSource ? previewFor(asset, baseSource) : "";
  const overlayPreview = overlaySource ? previewFor(asset, overlaySource) : "";
  const canCompare = asset.versions.length > 1 && asset.versions.every((item) => item.preview);

  const visibleComments = useMemo(
    () =>
      comments.filter(
        (comment) =>
          comment.asset_id === asset.id &&
          (comment.version_id === null ||
            comment.version_id === baseSource ||
            comment.version_id === overlaySource) &&
          (showResolved || !comment.resolved),
      ),
    [asset.id, baseSource, comments, overlaySource, showResolved],
  );
  const openCount = comments.filter(
    (comment) => comment.asset_id === asset.id && !comment.resolved,
  ).length;

  const pickPoint = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!pinMode || !baseSource) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    setDraft({ x, y });
    setBody("");
    setError("");
  };

  const submit = async () => {
    if (!draft || !baseSource) return;
    const text = body.trim();
    if (!text) {
      setError("Напиши комментарий к пину.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onAddComment({
        body: text,
        assetId: asset.id,
        versionId: baseSource,
        x: draft.x,
        y: draft.y,
      });
      setDraft(null);
      setBody("");
      setPinMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить пин");
    } finally {
      setBusy(false);
    }
  };

  const versionLabel = (id: string) =>
    asset.versions.find((item) => item.id === id)?.label ?? "—";

  if (!basePreview) return null;

  return (
    <div className={`review-stage${pinMode ? " is-pinning" : ""}`}>
      <div className="review-stage-head">
        <span className="review-stage-title">
          <Pin size={13} />
          Пины и версии
          {openCount > 0 ? <b>{openCount}</b> : null}
        </span>
        <span className="review-stage-spacer" />
        {asset.versions.length > 1 ? (
          <select
            value={versionId}
            onChange={(event) => {
              setVersionId(event.target.value);
              setCompare(false);
              setDraft(null);
            }}
            aria-label="Версия для просмотра"
          >
            {asset.versions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
                {item.id === asset.current_version_id ? " · текущая" : ""}
              </option>
            ))}
          </select>
        ) : null}
        {canCompare ? (
          <button
            type="button"
            className={`review-stage-toggle${compare ? " is-active" : ""}`}
            onClick={() => {
              setCompare((value) => !value);
              setPinMode(false);
              setDraft(null);
            }}
          >
            <GitCompareArrows size={13} />
            {compare ? "Обычный вид" : "Сравнить"}
          </button>
        ) : null}
        <button
          type="button"
          className={`review-stage-toggle${pinMode ? " is-active" : ""}`}
          onClick={() => {
            setPinMode((value) => !value);
            setCompare(false);
            setDraft(null);
          }}
        >
          <MessageSquarePlus size={13} />
          {pinMode ? "Отменить пин" : "Оставить пин"}
        </button>
      </div>

      {compare ? (
        <div className="review-stage-compare-bar">
          <label>
            Было
            <select value={compareA} onChange={(event) => setCompareA(event.target.value)}>
              {asset.versions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Стало
            <select value={compareB} onChange={(event) => setCompareB(event.target.value)}>
              {asset.versions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={split}
            onChange={(event) => setSplit(Number(event.target.value))}
            aria-label="Позиция сравнения"
          />
          <b>{split}%</b>
        </div>
      ) : null}

      <div
        className="review-stage-canvas"
        ref={stageRef}
        onClick={pickPoint}
        role={pinMode ? "button" : undefined}
        tabIndex={pinMode ? 0 : undefined}
        onKeyDown={(event) => {
          if (!pinMode || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          setDraft({ x: 0.5, y: 0.5 });
        }}
      >
        <img className="review-stage-image" src={basePreview} alt={`${asset.name}`} />
        {compare && overlayPreview ? (
          <img
            className="review-stage-image is-overlay"
            src={overlayPreview}
            alt=""
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
          />
        ) : null}
        {compare ? (
          <span className="review-stage-divider" style={{ left: `${split}%` }} />
        ) : null}
        {compare ? (
          <>
            <span className="review-stage-tag is-left">{versionLabel(compareA)}</span>
            <span className="review-stage-tag is-right">{versionLabel(compareB)}</span>
          </>
        ) : null}
        {visibleComments.map((comment, index) => (
          <button
            type="button"
            key={comment.id}
            className={`review-pin${comment.resolved ? " is-resolved" : ""}`}
            style={{ left: `${comment.x * 100}%`, top: `${comment.y * 100}%` }}
            title={comment.body}
            onClick={(event) => {
              event.stopPropagation();
              setPinMode(false);
              setDraft(null);
              setBody(comment.body);
            }}
          >
            {index + 1}
          </button>
        ))}
        {draft ? (
          <span
            className="review-pin is-draft"
            style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}
          >
            +
          </span>
        ) : null}
        {pinMode ? (
          <span className="review-stage-hint">
            Кликни по изображению, чтобы поставить пин
          </span>
        ) : null}
      </div>

      {draft ? (
        <div className="review-pin-form">
          <div className="review-pin-form-head">
            <span>
              <Pin size={12} /> Пин на {versionLabel(baseSource)}
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Убрать пин"
              onClick={() => setDraft(null)}
            >
              <X size={13} />
            </button>
          </div>
          <textarea
            rows={3}
            autoFocus
            value={body}
            placeholder="Что поправить в этом месте?"
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
          {error ? <small className="form-error">{error}</small> : null}
          <div className="review-pin-form-actions">
            <small>Ctrl+Enter — отправить</small>
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={busy || !body.trim()}
              onClick={() => void submit()}
            >
              <Send size={13} />
              {busy ? "Сохраняю…" : "Добавить пин"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="review-comments">
        <div className="review-comments-head">
          <span>Комментарии к ассету</span>
          <b>{comments.filter((comment) => comment.asset_id === asset.id).length}</b>
          <span className="review-stage-spacer" />
          <button
            type="button"
            className="agent-link"
            onClick={() => setShowResolved((value) => !value)}
          >
            {showResolved ? "Скрыть решённые" : "Показать решённые"}
          </button>
        </div>
        {comments.filter((comment) => comment.asset_id === asset.id).length === 0 ? (
          <p className="review-comments-empty">
            Комментариев пока нет. Включи «Оставить пин» и кликни по проблемному месту.
          </p>
        ) : (
          comments
            .filter((comment) => comment.asset_id === asset.id)
            .map((comment, index) => (
              <div
                className={`review-comment${comment.resolved ? " is-resolved" : ""}`}
                key={comment.id}
              >
                <span className="review-comment-index">{index + 1}</span>
                <div className="review-comment-copy">
                  <p>{comment.body}</p>
                  <small>
                    {comment.version_id ? `${versionLabel(comment.version_id)} · ` : ""}
                    {formatDate(comment.created_at)}
                  </small>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  title={comment.resolved ? "Вернуть в работу" : "Решено"}
                  aria-label={comment.resolved ? "Вернуть в работу" : "Решено"}
                  onClick={() => void onResolve(comment.id, !comment.resolved)}
                >
                  {comment.resolved ? <RotateCcw size={13} /> : <Check size={13} />}
                </button>
                <button
                  type="button"
                  className="icon-btn is-danger"
                  title="Удалить пин"
                  aria-label="Удалить пин"
                  onClick={() => void onDelete(comment.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
