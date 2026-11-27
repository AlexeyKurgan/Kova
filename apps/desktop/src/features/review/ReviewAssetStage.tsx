import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Film,
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
import type {
  AssetPassport,
  AssetPreviewFrame,
  ReviewComment,
} from "../../lib/types";

const VIDEO_RE = /\.(mp4|webm|mov|mkv|avi)$/i;

type Props = {
  asset: AssetPassport;
  comments: ReviewComment[];
  onAddComment: (input: {
    body: string;
    assetId: string;
    versionId: string;
    x: number;
    y: number;
    timestamp?: number | null;
    frame?: number | null;
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

function framesFor(asset: AssetPassport, versionId: string): AssetPreviewFrame[] {
  const version = asset.versions.find((item) => item.id === versionId);
  if (version?.preview_frames?.length) return version.preview_frames;
  return asset.preview_frames ?? [];
}

function framePreviewFor(
  asset: AssetPassport,
  versionId: string,
  frame: number,
) {
  return mediaUrl(`/assets/${asset.id}/preview`, {
    version_id: versionId,
    frame,
    v: `${frame}-${asset.versions.find((item) => item.id === versionId)?.file_hash || asset.file_hash}`,
  });
}

function videoFor(asset: AssetPassport, versionId: string) {
  const version = asset.versions.find((item) => item.id === versionId);
  const path = version?.path || asset.path;
  if (asset.type !== "video" && !VIDEO_RE.test(path)) return "";
  return mediaUrl(`/assets/${asset.id}/media`, {
    version_id: versionId,
    v: version?.file_hash || asset.file_hash,
  });
}

function formatClock(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
  const [draft, setDraft] = useState<{
    x: number;
    y: number;
    timestamp?: number | null;
    frame?: number | null;
  } | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [frame, setFrame] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const selectedVersion = asset.versions.find((item) => item.id === versionId) ?? lastVersion;
  const baseSource = compare ? compareB : selectedVersion?.id ?? "";
  const overlaySource = compare ? compareA : "";
  const basePreview = baseSource ? previewFor(asset, baseSource) : "";
  const overlayPreview = overlaySource ? previewFor(asset, overlaySource) : "";
  const baseVideo = baseSource ? videoFor(asset, baseSource) : videoFor(asset, "");
  const video = Boolean(baseVideo) && !compare;
  const frameList = useMemo(
    () => (compare ? [] : framesFor(asset, baseSource || selectedVersion?.id || "")),
    [asset, baseSource, compare, selectedVersion?.id],
  );
  const frameAnimated = frameList.length > 0;
  const activeFrame =
    frameList.find((item) => item.frame === frame) ?? frameList[0] ?? null;
  const canCompare =
    !video &&
    !frameAnimated &&
    asset.versions.length > 1 &&
    asset.versions.every((item) => item.preview);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setFrame(framesFor(asset, baseSource || selectedVersion?.id || "")[0]?.frame ?? null);
  }, [asset, baseSource, selectedVersion?.id]);


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
    setDraft({
      x,
      y,
      timestamp: video ? videoRef.current?.currentTime ?? 0 : null,
      frame: frameAnimated ? activeFrame?.frame ?? null : null,
    });
    setBody("");
    setError("");
  };

  const seekTo = (value: number) => {
    const player = videoRef.current;
    if (!player) return;
    player.currentTime = Math.min(Math.max(0, value), duration || value);
    setCurrentTime(player.currentTime);
  };

  const selectFrame = (value: number) => {
    setFrame(value);
    setDraft(null);
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
        timestamp: draft.timestamp ?? null,
        frame: draft.frame ?? null,
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

  const displayPreview =
    frameAnimated && activeFrame
      ? framePreviewFor(asset, baseSource || selectedVersion?.id || "", activeFrame.frame)
      : basePreview;
  const stageComments =
    frameAnimated && activeFrame
      ? visibleComments.filter(
          (comment) => comment.frame == null || comment.frame === activeFrame.frame,
        )
      : visibleComments;
  const commentNumber = (commentId: string) =>
    comments.filter((comment) => comment.asset_id === asset.id).findIndex(
      (comment) => comment.id === commentId,
    ) + 1;
  const frameIndex = activeFrame
    ? Math.max(
        0,
        frameList.findIndex((item) => item.frame === activeFrame.frame),
      )
    : 0;

  if (!basePreview && !video && !frameAnimated) return null;

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
        {video ? (
          <button
            type="button"
            className="review-stage-toggle"
            onClick={() => {
              setPinMode(false);
              setDraft({
                x: 0.5,
                y: 0.5,
                timestamp: videoRef.current?.currentTime ?? 0,
              });
              setBody("");
              setError("");
            }}
          >
            <Film size={13} />
            Пин на {formatClock(currentTime)}
          </button>
        ) : null}
        {frameAnimated && activeFrame ? (
          <button
            type="button"
            className="review-stage-toggle"
            onClick={() => {
              setPinMode(false);
              setDraft({
                x: 0.5,
                y: 0.5,
                frame: activeFrame.frame,
              });
              setBody("");
              setError("");
            }}
          >
            <Film size={13} />
            Пин на кадре {activeFrame.frame}
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
          setDraft({
            x: 0.5,
            y: 0.5,
            timestamp: video ? videoRef.current?.currentTime ?? 0 : null,
            frame: frameAnimated ? activeFrame?.frame ?? null : null,
          });
        }}
      >
        {video ? (
          <video
            ref={videoRef}
            className="review-stage-video"
            src={baseVideo}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration;
              setDuration(Number.isFinite(value) ? value : 0);
            }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          />
        ) : (
          <img
            className="review-stage-image"
            src={displayPreview}
            alt={
              frameAnimated && activeFrame
                ? `${asset.name}, кадр ${activeFrame.frame}`
                : asset.name
            }
          />
        )}
        {video && pinMode ? <span className="review-stage-pin-layer" /> : null}
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
        {stageComments.map((comment) => (
          <button
            type="button"
            key={comment.id}
            className={`review-pin${comment.resolved ? " is-resolved" : ""}`}
            style={{ left: `${comment.x * 100}%`, top: `${comment.y * 100}%` }}
            title={
              comment.timestamp != null
                ? `${formatClock(comment.timestamp)} · ${comment.body}`
                : comment.frame != null
                  ? `Кадр ${comment.frame} · ${comment.body}`
                  : comment.body
            }
            onClick={(event) => {
              event.stopPropagation();
              setPinMode(false);
              setDraft(null);
              setBody(comment.body);
              if (comment.timestamp != null) seekTo(comment.timestamp);
              if (comment.frame != null) selectFrame(comment.frame);
            }}
          >
            {commentNumber(comment.id)}
          </button>
        ))}
        {draft && (!frameAnimated || draft.frame === activeFrame?.frame) ? (
          <span
            className="review-pin is-draft"
            style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}
          >
            +
          </span>
        ) : null}
        {pinMode ? (
          <span className="review-stage-hint">
            {video
              ? "Кликни по кадру, чтобы привязать пин ко времени"
              : frameAnimated
                ? "Кликни по изображению, чтобы привязать пин к кадру"
                : "Кликни по изображению, чтобы поставить пин"}
          </span>
        ) : null}
      </div>

      {video ? (
        <div className="review-video-timeline">
          <div
            className="review-video-track"
            role="slider"
            tabIndex={0}
            aria-label="Таймлайн видео"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, duration)}
            aria-valuenow={currentTime}
            onClick={(event) => {
              if (!duration) return;
              const rect = event.currentTarget.getBoundingClientRect();
              if (!rect.width) return;
              seekTo(((event.clientX - rect.left) / rect.width) * duration);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") seekTo(currentTime - 1);
              if (event.key === "ArrowRight") seekTo(currentTime + 1);
            }}
          >
            <i style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }} />
            {visibleComments
              .filter((comment) => comment.timestamp != null && duration > 0)
              .map((comment, index) => (
                <button
                  type="button"
                  key={comment.id}
                  className={`review-video-marker${comment.resolved ? " is-resolved" : ""}`}
                  style={{
                    left: `${Math.min(100, ((comment.timestamp ?? 0) / duration) * 100)}%`,
                  }}
                  title={`${formatClock(comment.timestamp ?? 0)} · ${comment.body}`}
                  aria-label={`Перейти к пину ${index + 1}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    seekTo(comment.timestamp ?? 0);
                  }}
                >
                  {index + 1}
                </button>
              ))}
            {draft?.timestamp != null && duration > 0 ? (
              <span
                className="review-video-marker is-draft"
                style={{
                  left: `${Math.min(100, (draft.timestamp / duration) * 100)}%`,
                }}
              >
                +
              </span>
            ) : null}
          </div>
          <div className="review-video-time">
            <span>{formatClock(currentTime)}</span>
            <span>{formatClock(duration)}</span>
          </div>
        </div>
      ) : null}

      {frameAnimated && activeFrame ? (
        <div className="review-frame-timeline">
          <div className="review-frame-head">
            <span>
              Кадр <b>{activeFrame.frame}</b>
              {asset.frame_end ? ` из ${asset.frame_end}` : ""}
            </span>
            <small>
              {frameList.length} превью
              {asset.fps ? ` · ${Math.round(asset.fps)} fps` : ""}
            </small>
          </div>
          <div className="review-frame-track">
            <input
              type="range"
              min={0}
              max={Math.max(0, frameList.length - 1)}
              step={1}
              value={frameIndex}
              aria-label="Кадр анимации"
              onChange={(event) => {
                const next = frameList[Number(event.target.value)];
                if (next) selectFrame(next.frame);
              }}
            />
            {visibleComments
              .filter((comment) => comment.frame != null)
              .map((comment) => {
                const index = frameList.findIndex(
                  (item) => item.frame === comment.frame,
                );
                if (index < 0) return null;
                return (
                  <button
                    type="button"
                    key={comment.id}
                    className={`review-frame-marker${
                      comment.resolved ? " is-resolved" : ""
                    }`}
                    style={{
                      left: `${(index / Math.max(1, frameList.length - 1)) * 100}%`,
                    }}
                    title={`Кадр ${comment.frame} · ${comment.body}`}
                    aria-label={`Перейти к пину на кадре ${comment.frame}`}
                    onClick={() => selectFrame(comment.frame ?? activeFrame.frame)}
                  >
                    {commentNumber(comment.id)}
                  </button>
                );
              })}
          </div>
        </div>
      ) : null}

      {draft ? (
        <div className="review-pin-form">
          <div className="review-pin-form-head">
            <span>
              <Pin size={12} /> Пин на {versionLabel(baseSource)}
              {draft.timestamp != null
                ? ` · ${formatClock(draft.timestamp)}`
                : draft.frame != null
                  ? ` · кадр ${draft.frame}`
                  : ""}
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
                    {comment.timestamp != null
                      ? `${formatClock(comment.timestamp)} · `
                      : comment.frame != null
                        ? `кадр ${comment.frame} · `
                        : ""}
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
