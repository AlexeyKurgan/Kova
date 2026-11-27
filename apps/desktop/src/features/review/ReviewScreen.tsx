import { useEffect, useMemo, useState } from "react";
import { Box as BoxIcon, Check, ChevronDown, ChevronRight, RotateCcw, Sparkles, Star, TriangleAlert } from "lucide-react";
import { mediaUrl } from "../../lib/coreClient";
import {
  addReviewComment,
  applyWorktreeRun,
  deleteReviewComment,
  getRunChangePatch,
  listAiRuns,
  listReviewArchive,
  listReviewComments,
  listStyleViolations,
  listValidationResults,
  reviewResponse,
  updateReviewComment,
} from "../../lib/coreClient";
import ReviewAssetStage from "./ReviewAssetStage";
import { useConfirm } from "../../components/ConfirmProvider";
import { formatDate, plural } from "../../lib/format";
import { REVIEW_STATUS_LABELS } from "../../lib/labels";
import type {
  AiRun,
  AssetPassport,
  CheckResult,
  ReviewComment,
  ReviewItem,
  Task,
  ValidationResult,
} from "../../lib/types";

type Props = {
  items: ReviewItem[];
  tasks: Task[];
  assets: AssetPassport[];
  onOpenAsset: (assetId: string) => void;
  onAccept: (reviewId: string) => void;
  onRework: (reviewId: string) => void;
};

export default function ReviewScreen({
  items,
  tasks,
  assets,
  onOpenAsset,
  onAccept,
  onRework,
}: Props) {
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState<Record<string, ValidationResult[]>>({});
  const [runsByTask, setRunsByTask] = useState<Record<string, AiRun[]>>({});
  const [patchOpen, setPatchOpen] = useState<string | null>(null);
  const [patches, setPatches] = useState<Record<string, string>>({});
  const [showAllChanges, setShowAllChanges] = useState<Record<string, boolean>>({});
  const [validationOpen, setValidationOpen] = useState<Record<string, boolean>>({});
  const [changeFilter, setChangeFilter] = useState<
    Record<string, "all" | "added" | "modified" | "deleted">
  >({});
  const [changeQuery, setChangeQuery] = useState<Record<string, string>>({});
  const [applyBusy, setApplyBusy] = useState<string | null>(null);
  const [applyNote, setApplyNote] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, ReviewComment[]>>({});
  const [archive, setArchive] = useState<ReviewItem[]>([]);
  const [showArchive, setShowArchive] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveKey, setArchiveKey] = useState(0);
  const [styleChecksByAsset, setStyleChecksByAsset] = useState<Record<string, CheckResult[]>>({});
  const [stageAsset, setStageAsset] = useState<Record<string, string>>({});

  const applyRun = async (run: AiRun) => {
    if (applyBusy) return;
    const ok = await confirm({
      title: "Применить изменения?",
      message: "Файлы из worktree будут перенесены в проект.",
      details: [
        "Перед переносом Kova создаст снапшот проекта.",
        "Файлы, не относящиеся к запуску, не затрагиваются.",
      ],
      confirmLabel: "Применить",
    });
    if (!ok) return;
    setApplyBusy(run.id);
    try {
      const updated = await applyWorktreeRun(run.id);
      setRunsByTask((current) => ({
        ...current,
        [run.task_id]: (current[run.task_id] ?? []).map((item) =>
          item.id === updated.id ? updated : item,
        ),
      }));
      setApplyNote((current) => ({
        ...current,
        [run.id]: `Перенесено файлов: ${updated.worktree_applied}, удалено: ${updated.worktree_deleted}`,
      }));
    } catch (err) {
      setApplyNote((current) => ({
        ...current,
        [run.id]: err instanceof Error ? err.message : "Не удалось применить worktree",
      }));
    } finally {
      setApplyBusy(null);
    }
  };

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

  const visibleItems = showArchive ? archive : items;

  const taskIds = useMemo(
    () => [...new Set(visibleItems.map((item) => item.task_id))],
    [visibleItems],
  );

  useEffect(() => {
    let alive = true;
    const load = () => {
      Promise.all(
        taskIds.map(async (taskId) => {
          const [rows, runs] = await Promise.all([
            listValidationResults(taskId).catch(() => []),
            listAiRuns(taskId).catch(() => []),
          ]);
          return [taskId, rows, runs] as const;
        }),
      ).then((rows) => {
        if (!alive) return;
        setValidation(Object.fromEntries(rows.map(([taskId, items]) => [taskId, items])));
        setRunsByTask(Object.fromEntries(rows.map(([taskId, , runs]) => [taskId, runs])));
      });
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [taskIds]);

  useEffect(() => {
    if (!showArchive) return;
    let alive = true;
    setArchiveLoading(true);
    listReviewArchive()
      .then((rows) => {
        if (alive) setArchive(rows);
      })
      .catch(() => {
        if (alive) setArchive([]);
      })
      .finally(() => {
        if (alive) setArchiveLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [showArchive, archiveKey]);

  const reviewKey = visibleItems.map((item) => item.id).join(",");

  useEffect(() => {
    let alive = true;
    listStyleViolations()
      .then((rows) => {
        if (alive) {
          setStyleChecksByAsset(
            Object.fromEntries(rows.map((row) => [row.asset_id, row.checks])),
          );
        }
      })
      .catch(() => {
        if (alive) setStyleChecksByAsset({});
      });
    return () => {
      alive = false;
    };
  }, [reviewKey]);
  useEffect(() => {
    let alive = true;
    const loadComments = () =>
      Promise.all(
        visibleItems.map(async (item) => {
          const list = await listReviewComments(item.id).catch(() => []);
          return [item.id, list] as const;
        }),
      );
    void loadComments().then((values) => {
      if (alive) setComments(Object.fromEntries(values));
    });
    const timer = window.setInterval(() => {
      void loadComments().then((values) => {
        if (alive) setComments(Object.fromEntries(values));
      });
    }, 10000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewKey]);

  const addComment = async (
    reviewId: string,
    input: { body: string; assetId: string; versionId: string; x: number; y: number },
  ) => {
    const created = await addReviewComment(reviewId, {
      body: input.body,
      asset_id: input.assetId,
      version_id: input.versionId,
      x: input.x,
      y: input.y,
    });
    setComments((current) => ({
      ...current,
      [reviewId]: [...(current[reviewId] ?? []), created],
    }));
  };

  const resolveComment = async (reviewId: string, commentId: string, resolved: boolean) => {
    const updated = await updateReviewComment(reviewId, commentId, { resolved });
    setComments((current) => ({
      ...current,
      [reviewId]: (current[reviewId] ?? []).map((item) =>
        item.id === updated.id ? updated : item,
      ),
    }));
  };

  const removeComment = async (reviewId: string, commentId: string) => {
    await deleteReviewComment(reviewId, commentId);
    setComments((current) => ({
      ...current,
      [reviewId]: (current[reviewId] ?? []).filter((item) => item.id !== commentId),
    }));
  };

  const togglePatch = async (run: AiRun, index: number) => {
    const key = `${run.id}:${index}`;
    if (patchOpen === key) {
      setPatchOpen(null);
      return;
    }
    setPatchOpen(key);
    if (patches[key] !== undefined) return;
    const change = run.changes[index];
    if (!change.patch_path) {
      setPatches((current) => ({
        ...current,
        [key]: change.binary
          ? "Бинарный файл: текстовый патч недоступен."
          : "Патч недоступен.",
      }));
      return;
    }
    try {
      const text = await getRunChangePatch(run.id, index);
      setPatches((current) => ({ ...current, [key]: text }));
    } catch {
      setPatches((current) => ({ ...current, [key]: "Не удалось загрузить патч." }));
    }
  };

  const taskTitle = (taskId: string) =>
    tasks.find((task) => task.id === taskId)?.title ?? "Задача";

  const linkedAssets = (taskId: string) =>
    assets.filter((asset) => asset.task_ids.includes(taskId));

  const assetPreview = (asset: AssetPassport) => {
    const version =
      asset.versions.find((item) => item.id === asset.current_version_id) ??
      asset.versions[asset.versions.length - 1];
    const preview = version?.preview || asset.preview;
    if (!preview) return "";
    return mediaUrl(`/assets/${asset.id}/preview`, {
      version_id: version?.id,
      v: preview,
    });
  };

  const validationSummary = (taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.validation.length === 0) return null;
    const latest = new Map<string, ValidationResult>();
    for (const row of validation[taskId] ?? []) latest.set(row.command_id, row);
    const rows = [...latest.values()];
    const passed = rows.filter((row) => row.status === "passed").length;
    const failedRows = rows.filter((row) => row.status !== "passed");
    const run =
      (runsByTask[taskId] ?? []).find(
        (item) => item.status !== "queued" && item.status !== "running",
      ) ?? null;
    const stale = Boolean(
      run &&
        rows.length > 0 &&
        rows.some((row) => row.agent_run_id !== run.id),
    );
    return {
      passed,
      failed: failedRows.length,
      total: rows.length,
      failedLabels: failedRows.map((row) => row.label),
      rows,
      stale,
    };
  };

  const acceptItem = async (
    item: ReviewItem,
    summary: ReturnType<typeof validationSummary>,
  ) => {
    if (summary && summary.failed > 0) {
      const ok = await confirm({
        title: "Принять с ошибками?",
        message: "Проверки не пройдены. Результат всё равно будет принят.",
        details: summary.failedLabels.slice(0, 6),
        note: "Полный список смотри во вкладке проверок.",
        confirmLabel: "Принять всё равно",
        danger: true,
      });
      if (!ok) return;
    } else if (summary && summary.total === 0) {
      const ok = await confirm({
        title: "Принять без проверок?",
        message: "Проверки ещё не запускались.",
        details: ["Kova не подтверждает, что изменения работают."],
        confirmLabel: "Принять без проверок",
        danger: true,
      });
      if (!ok) return;
    }
    onAccept(item.id);
  };

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
        <div className="header-actions">
          <div className="review-archive-switch">
            <button
              type="button"
              className={!showArchive ? "is-active" : ""}
              onClick={() => setShowArchive(false)}
            >
              Inbox
              <b>{items.length}</b>
            </button>
            <button
              type="button"
              className={showArchive ? "is-active" : ""}
              onClick={() => {
                setShowArchive(true);
                setArchiveKey((value) => value + 1);
              }}
            >
              Архив
            </button>
          </div>
        </div>
      </div>

      {showArchive && archiveLoading ? (
        <div className="empty-panel">
          <div className="empty-art">
            <Star size={52} strokeWidth={1.05} />
          </div>
          <h2 className="empty-title">Загружаю архив…</h2>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-art">
            <Star size={72} strokeWidth={1.05} />
            <Sparkles size={22} className="empty-sparkle" />
          </div>
          <h2 className="empty-title">{showArchive ? "Архив пуст" : "Очередь пуста"}</h2>
          <p className="empty-text">
            {showArchive
              ? "Принятые и заархивированные результаты появятся здесь."
              : "Когда импортируешь ответ AI в задаче, он появится здесь для приёмки."}
          </p>
        </div>
      ) : (
        <div className="task-list">
          {visibleItems.map((item) => {
            const summary = validationSummary(item.task_id);
            const hasFailures = Boolean(summary && summary.failed > 0);
            const notRun = Boolean(summary && summary.total === 0);
            const stale = Boolean(summary?.stale);
            const blocked = hasFailures || stale;
            const run =
              (runsByTask[item.task_id] ?? []).find(
                (candidate) => candidate.review_id === item.id,
              ) ?? null;
            const added = run?.changes.filter((change) => change.status === "added").length ?? 0;
            const modified =
              run?.changes.filter((change) => change.status === "modified").length ?? 0;
            const deleted = run?.changes.filter((change) => change.status === "deleted").length ?? 0;
            const filter = changeFilter[item.id] ?? "all";
            const query = (changeQuery[item.id] ?? "").trim().toLowerCase();
            const indexedChanges = run
              ? run.changes.map((change, index) => ({ change, index }))
              : [];
            const filteredChanges = indexedChanges.filter(
              ({ change }) =>
                (filter === "all" || change.status === filter) &&
                (!query || change.path.toLowerCase().includes(query)),
            );
            const changesShown = showAllChanges[item.id]
              ? filteredChanges
              : filteredChanges.slice(0, 6);
            const reviewAssets = linkedAssets(item.task_id);
            const stageCandidates = reviewAssets.filter((asset) => assetPreview(asset));
            const stageCandidateId = stageAsset[item.id] ?? stageCandidates[0]?.id ?? "";
            const activeStage =
              stageCandidates.find((asset) => asset.id === stageCandidateId) ??
              stageCandidates[0];
            const styleChecks = reviewAssets.flatMap(
              (asset) => styleChecksByAsset[asset.id] ?? [],
            );
            return (
            <article className="task-card review-card" key={item.id}>
              <div className="task-card-main">
                <span className={`task-status is-${item.status}`}>
                  {REVIEW_STATUS_LABELS[item.status]}
                </span>
                <h2>{taskTitle(item.task_id)}</h2>
                <p className="task-meta">{formatDate(item.created_at)}</p>
                <p className="task-goal">{item.summary}</p>
                {linkedAssets(item.task_id).length > 0 ? (
                  <div className="review-assets">
                    {linkedAssets(item.task_id).slice(0, 4).map((asset) => {
                      const preview = assetPreview(asset);
                      return (
                        <button
                          type="button"
                          className="review-asset"
                          key={asset.id}
                          onClick={() => onOpenAsset(asset.id)}
                          title={`Открыть ассет ${asset.name}`}
                        >
                          {preview ? (
                            <img src={preview} alt={asset.name} />
                          ) : (
                            <span className="review-asset-empty">
                              <BoxIcon />
                            </span>
                          )}
                          <span>
                            <b>{asset.name}</b>
                            <small>{asset.type}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {styleChecks.length > 0 ? (
                  <div
                    className="review-style-warning"
                    title={styleChecks.map((check) => check.message).join(" · ")}
                  >
                    <TriangleAlert size={12} />
                    <b>Style Guard</b>
                    <span>
                      {styleChecks.length}{" "}
                      {plural(styleChecks.length, ["нарушение", "нарушения", "нарушений"])}
                    </span>
                    <small>{styleChecks[0].message}</small>
                  </div>
                ) : null}
                {!showArchive && activeStage ? (
                  <div className="review-stage-block">
                    {stageCandidates.length > 1 ? (
                      <div className="review-stage-assets">
                        {stageCandidates.map((asset) => (
                          <button
                            type="button"
                            key={asset.id}
                            className={asset.id === activeStage.id ? "is-active" : ""}
                            onClick={() =>
                              setStageAsset((current) => ({
                                ...current,
                                [item.id]: asset.id,
                              }))
                            }
                          >
                            {asset.name}
                            <small>{asset.versions.length} версий</small>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <ReviewAssetStage
                      asset={activeStage}
                      comments={comments[item.id] ?? []}
                      onAddComment={(input) => addComment(item.id, input)}
                      onResolve={(commentId, resolved) =>
                        resolveComment(item.id, commentId, resolved)
                      }
                      onDelete={(commentId) => removeComment(item.id, commentId)}
                    />
                  </div>
                ) : null}
                {summary ? (
                  <div
                    className={`review-validation${
                      summary.stale
                        ? " is-stale"
                        : summary.failed > 0
                          ? " is-failed"
                          : summary.total > 0
                            ? " is-passed"
                            : ""
                    }`}
                  >
                    <span>Проверки</span>
                    {summary.stale ? (
                      <b>устарели после нового запуска</b>
                    ) : summary.total === 0 ? (
                      <b>не запускались</b>
                    ) : (
                      <b>
                        {summary.passed} пройдено
                        {summary.failed > 0
                          ? ` · ${summary.failed} ${plural(summary.failed, ["ошибка", "ошибки", "ошибок"])}`
                          : ""}
                      </b>
                    )}
                    {summary.total > 0 ? (
                      <button
                        type="button"
                        className="agent-link"
                        onClick={() =>
                          setValidationOpen((current) => ({
                            ...current,
                            [item.id]: !current[item.id],
                          }))
                        }
                      >
                        {validationOpen[item.id] ? "Скрыть" : "Детали"}
                      </button>
                    ) : null}
                    {validationOpen[item.id] ? (
                      <div className="review-validation-details">
                        {summary.rows.map((row) => (
                          <div className="review-validation-row" key={row.command_id}>
                            <span className={`review-validation-state is-${row.status}`}>
                              {row.status === "passed" ? "Пройдено" : "Ошибка"}
                            </span>
                            <b>{row.label}</b>
                            <small>
                              {row.duration_ms} мс · {formatDate(row.created_at)}
                            </small>
                            {row.output ? <pre>{row.output.slice(0, 600)}</pre> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {run ? (
                  <div className="review-changes">
                    <div className="review-changes-head">
                      <span>Изменения</span>
                      {run.isolation !== "direct" ? (
                        <span
                          className="review-isolation"
                          title={run.worktree_path || "Отдельная копия"}
                        >
                          {run.isolation === "sandbox" ? "sandbox копия" : "worktree"}
                        </span>
                      ) : null}
                      <b>
                        +{added} ~{modified} -{deleted}
                      </b>
                      {run.isolation !== "direct" && !run.worktree_applied_at ? (
                        <button
                          type="button"
                          className="agent-link"
                          disabled={applyBusy === run.id}
                          onClick={() => void applyRun(run)}
                        >
                          {applyBusy === run.id ? "Перенос…" : "Применить в проект"}
                        </button>
                      ) : null}
                      {filteredChanges.length > 6 ? (
                        <button
                          type="button"
                          className="agent-link"
                          onClick={() =>
                            setShowAllChanges((current) => ({
                              ...current,
                              [item.id]: !current[item.id],
                            }))
                          }
                        >
                          {showAllChanges[item.id] ? "Свернуть" : `Все (${filteredChanges.length})`}
                        </button>
                      ) : null}
                    </div>
                    {run.changes.length > 0 ? (
                      <div className="review-change-filters">
                        {(
                          [
                            ["all", "Все"],
                            ["added", "+"],
                            ["modified", "~"],
                            ["deleted", "-"],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            type="button"
                            key={value}
                            className={filter === value ? "is-active" : ""}
                            title={value}
                            onClick={() =>
                              setChangeFilter((current) => ({
                                ...current,
                                [item.id]: value,
                              }))
                            }
                          >
                            {label}
                          </button>
                        ))}
                        <input
                          value={changeQuery[item.id] ?? ""}
                          placeholder="файл…"
                          onChange={(event) =>
                            setChangeQuery((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ) : null}
                    {run.changes_error ? (
                      <small>{run.changes_error}</small>
                    ) : run.changes.length === 0 ? (
                      <small>Файлы не изменились</small>
                    ) : changesShown.length === 0 ? (
                      <small>Нет файлов по фильтру</small>
                    ) : (
                      <ul className={showAllChanges[item.id] ? "is-expanded" : ""}>
                        {changesShown.map(({ change, index }) => {
                          const key = `${run.id}:${index}`;
                          return (
                            <li key={change.path} className={`is-${change.status}`}>
                              <button
                                type="button"
                                className="review-change"
                                title="Показать патч"
                                onClick={() => void togglePatch(run, index)}
                              >
                                <span>
                                  {change.status === "added"
                                    ? "+"
                                    : change.status === "deleted"
                                      ? "-"
                                      : "~"}
                                </span>
                                <code>{change.path}</code>
                                <small>
                                  +{change.additions} -{change.deletions}
                                </small>
                                {patchOpen === key ? (
                                  <ChevronDown size={11} />
                                ) : (
                                  <ChevronRight size={11} />
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {run.changes_truncated ? (
                      <small>Показаны первые {run.changes.length} из {run.changes_total}</small>
                    ) : null}
                    {applyNote[run.id] ? <small>{applyNote[run.id]}</small> : null}
                    {patchOpen?.startsWith(`${run.id}:`) ? (
                      <pre className="review-patch">
                        {patches[patchOpen] ?? "Загрузка патча…"}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
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
                {showArchive ? (
                  <span className={`task-status is-${item.status}`}>
                    {REVIEW_STATUS_LABELS[item.status]}
                  </span>
                ) : (
                  <>
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
                      className={`btn ${blocked ? "btn-danger" : "btn-primary"}`}
                      onClick={() => void acceptItem(item, summary)}
                    >
                      {blocked ? <TriangleAlert size={15} /> : <Check size={15} />}
                      {stale
                        ? "Принять без проверок"
                        : hasFailures
                          ? "Принять всё равно"
                          : notRun
                            ? "Принять без проверок"
                            : "Принять"}
                    </button>
                  </>
                )}
              </div>
            </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
