import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Box,
  Check,
  ClipboardList,
  ExternalLink,
  FolderOpen,
  GitCompareArrows,
  History,
  ImageIcon,
  Info,
  Link2,
  Network,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import BrandIcon from "../../components/BrandIcon";
import {
  getAssetContract,
  getEngineInfo,
  getPackage,
  importAssetToEngine,
  reimportEngine,
  mediaUrl,
} from "../../lib/coreClient";
import { formatBytes, formatDate } from "../../lib/format";
import { t, tp } from "../../lib/i18n";
import {
  ASSET_TYPE_LABELS,
  ASSET_VERSION_STATUS_LABELS,
  ENGINE_LABELS,
  TASK_STATUS_LABELS,
} from "../../lib/labels";
import type {
  AssetDependency,
  AssetMetrics,
  AssetPassport,
  AssetVersion,
  CheckResult,
  SceneObject,
  ContractReport,
  EngineInfo,
  CheckStatus,
  Engine,
  ExportProfile,
  Task,
} from "../../lib/types";

const AssetViewer3D = lazy(() => import("./AssetViewer3D"));

function supports3d(path: string) {
  return /\.(glb|gltf|blend|fbx|obj)$/i.test(path);
}

type Props = {
  asset: AssetPassport;
  assets: AssetPassport[];
  tasks: Task[];
  checks: CheckResult[];
  checking: boolean;
  blenderInstalled: boolean;
  blenderRunning: boolean;
  onBack: () => void;
  onRunChecks: () => void;
  onRunBlender: () => void;
  onOpenFolder: () => void;
  onLinkTasks: (taskIds: string[]) => void;
  onCreateTask: () => void;
  onOpenTask: (taskId: string) => void;
  onUpdateDescription: (text: string) => void;
  onUpdateExportProfiles: (profiles: ExportProfile[]) => void;
  onUpdateDependencies: (dependencies: AssetDependency[]) => void;
  onOpenAsset: (assetId: string) => void;
  onAddVersion: () => void;
  onActivateVersion: (versionId: string) => void;
  onSelectVersion: (versionId: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onOpenEditor: () => void;
};

const CHECK_TONES: Record<CheckStatus, string> = {
  passed: "is-done",
  warning: "is-review",
  failed: "is-blocked",
  error: "is-blocked",
  pending: "is-draft",
  skipped: "is-draft",
};

const METRIC_ROWS: Array<[keyof AssetMetrics, string]> = [
  ["objects", "Объекты"],
  ["triangles", "Треугольники"],
  ["vertices", "Вершины"],
  ["materials", "Материалы"],
  ["textures", "Текстуры"],
  ["bones", "Кости"],
  ["animations", "Анимации"],
];

const EXPORT_FORMATS = ["FBX", "GLB", "glTF", "OBJ", "USD", "USDZ", "RBXM", "RBXMX", "PNG"];

const CHECK_LABELS: Record<CheckStatus, string> = {
  passed: "Пройдено",
  warning: "Внимание",
  failed: "Ошибка",
  error: "Ошибка",
  pending: "Ожидает",
  skipped: "Пропущено",
};

type SceneChange = {
  name: string;
  status: "added" | "removed" | "changed";
  fields: string[];
  before: SceneObject | null;
  after: SceneObject | null;
};

function sameNumbers(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sceneDiff(left: SceneObject[], right: SceneObject[]): SceneChange[] {
  const before = new Map(left.map((item) => [item.name, item]));
  const after = new Map(right.map((item) => [item.name, item]));
  const names = new Set([...before.keys(), ...after.keys()]);
  const rows: SceneChange[] = [];
  for (const name of names) {
    const a = before.get(name) ?? null;
    const b = after.get(name) ?? null;
    if (!a) {
      rows.push({ name, status: "added", fields: [], before: a, after: b });
      continue;
    }
    if (!b) {
      rows.push({ name, status: "removed", fields: [], before: a, after: b });
      continue;
    }
    const fields: string[] = [];
    if (a.type !== b.type) fields.push(t("тип"));
    if (a.parent !== b.parent) fields.push(t("родитель"));
    if (a.triangles !== b.triangles) fields.push(t("треугольники"));
    if (a.vertices !== b.vertices) fields.push(t("вершины"));
    if (a.materials.join(",") !== b.materials.join(",")) fields.push(t("материалы"));
    if (!sameNumbers(a.location, b.location)) fields.push(t("позиция"));
    if (!sameNumbers(a.rotation, b.rotation)) fields.push(t("поворот"));
    if (!sameNumbers(a.scale, b.scale)) fields.push(t("масштаб"));
    if (!sameNumbers(a.dimensions, b.dimensions)) fields.push(t("размеры"));
    if (fields.length > 0) {
      rows.push({ name, status: "changed", fields, before: a, after: b });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export default function AssetPassportScreen({
  asset,
  assets,
  tasks,
  checks,
  checking,
  blenderInstalled,
  blenderRunning,
  onBack,
  onRunChecks,
  onRunBlender,
  onOpenFolder,
  onLinkTasks,
  onOpenTask,
  onUpdateDescription,
  onUpdateExportProfiles,
  onUpdateDependencies,
  onOpenAsset,
  onAddVersion,
  onActivateVersion,
  onSelectVersion,
  onDelete,
  onDuplicate,
  onOpenEditor,
}: Props) {
  const [description, setDescription] = useState(asset.description);
  const [versionId, setVersionId] = useState(
    asset.current_version_id ?? asset.versions[asset.versions.length - 1]?.id ?? "",
  );
  const [previewMode, setPreviewMode] = useState<"3d" | "render">("render");
  const [tab, setTab] = useState<"overview" | "files" | "usage" | "related">("overview");
  const [editingDescription, setEditingDescription] = useState(false);
  const [contract, setContract] = useState<ContractReport | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [exportEngine, setExportEngine] = useState<Engine>(
    asset.engine === "generic" ? "roblox" : asset.engine,
  );
  const [exportFormat, setExportFormat] = useState("FBX");
  const [depTarget, setDepTarget] = useState("");
  const [depKind, setDepKind] = useState("texture");
  const [diffMode, setDiffMode] = useState<"metrics" | "scene">("metrics");
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [enginePackageReady, setEnginePackageReady] = useState(false);
  const [engineImport, setEngineImport] = useState<{
    relative: string;
    target: string;
  } | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [engineError, setEngineError] = useState("");
  const [reimportBusy, setReimportBusy] = useState(false);
  const [reimportResult, setReimportResult] = useState<{
    status: string;
    duration_ms: number;
    output: string;
  } | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const currentVersion =
    asset.versions.find((item) => item.id === asset.current_version_id) ??
    asset.versions[asset.versions.length - 1] ??
    null;
  const selectedVersion =
    asset.versions.find((item) => item.id === versionId) ?? currentVersion;
  const isCurrent = Boolean(selectedVersion) && selectedVersion?.id === asset.current_version_id;
  const versionPath = selectedVersion?.path || asset.path;
  const versionHash = selectedVersion?.file_hash || asset.file_hash;
  const versionSize = selectedVersion?.file_size ?? asset.file_size;
  const metrics = selectedVersion?.metrics ?? asset.metrics;
  const can3d = asset.type === "model" && supports3d(versionPath);
  const direct3d = /\.(glb|gltf)$/i.test(versionPath);
  const previewUrl = selectedVersion?.preview
    ? mediaUrl(`/assets/${asset.id}/preview`, {
        version_id: selectedVersion.id,
        v: selectedVersion.preview,
      })
    : null;

  useEffect(() => {
    setVersionId(asset.current_version_id ?? asset.versions[asset.versions.length - 1]?.id ?? "");
  }, [asset.current_version_id, asset.id]);

  useEffect(() => {
    setDescription(asset.description);
  }, [asset.description, asset.id]);

  useEffect(() => {
    const latest = asset.versions[asset.versions.length - 1]?.id ?? "";
    const previous = asset.versions[Math.max(0, asset.versions.length - 2)]?.id ?? latest;
    setCompareA(previous);
    setCompareB(latest);
    setCompareOpen(false);
  }, [asset.id, asset.versions.length]);

  useEffect(() => {
    setExportEngine(asset.engine === "generic" ? "roblox" : asset.engine);
  }, [asset.engine, asset.id]);

  useEffect(() => {
    const supported = ["godot", "unity", "unreal", "rpgmaker", "web"];
    if (!supported.includes(asset.engine)) {
      setEngineInfo(null);
      setEnginePackageReady(false);
      return;
    }
    let alive = true;
    Promise.all([
      getEngineInfo(asset.engine),
      getPackage(`${asset.engine}-core`).catch(() => null),
    ])
      .then(([info, pkg]) => {
        if (!alive) return;
        setEngineInfo(info);
        setEnginePackageReady(Boolean(pkg?.installed && pkg.enabled));
      })
      .catch(() => {
        if (alive) {
          setEngineInfo(null);
          setEnginePackageReady(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [asset.engine, asset.id]);

  useEffect(() => {
    let alive = true;
    getAssetContract(asset.id)
      .then((value) => {
        if (alive) setContract(value);
      })
      .catch(() => {
        if (alive) setContract(null);
      });
    return () => {
      alive = false;
    };
  }, [asset.engine, asset.id, asset.updated_at]);

  useEffect(() => {
    if (!can3d) {
      setPreviewMode("render");
      return;
    }
    setPreviewMode(direct3d || !previewUrl ? "3d" : "render");
  }, [can3d, direct3d, previewUrl, versionPath]);

  const pickVersion = (nextId: string) => {
    setVersionId(nextId);
    onSelectVersion(nextId);
  };
  const usage = tasks.filter((task) => asset.task_ids.includes(task.id));
  const unlinked = tasks.filter((task) => !asset.task_ids.includes(task.id));
  const failed = checks.filter((check) => check.status === "failed" || check.status === "error");
  const warnings = checks.filter((check) => check.status === "warning");
  const passed = checks.filter((check) => check.status === "passed");
  const blenderChecked = metrics.triangles !== null;
  const checkState =
    checks.length === 0
      ? blenderChecked
        ? { label: t("Blender проверен"), tone: "is-done", icon: Check }
        : { label: t("Не проверялся"), tone: "is-draft", icon: ShieldCheck }
      : failed.length > 0
        ? { label: t("Есть ошибки"), tone: "is-blocked", icon: TriangleAlert }
        : !blenderChecked
          ? { label: t("Только базовые проверки"), tone: "is-review", icon: ShieldCheck }
          : warnings.length > 0
            ? { label: t("Есть предупреждения"), tone: "is-review", icon: TriangleAlert }
            : { label: t("Blender-проверка пройдена"), tone: "is-done", icon: Check };

  const addTask = (taskId: string) => {
    if (!taskId) return;
    onLinkTasks([...asset.task_ids, taskId]);
  };

  const removeTask = (taskId: string) => {
    onLinkTasks(asset.task_ids.filter((item) => item !== taskId));
  };

  const verified = failed.length === 0 && (checks.length > 0 || blenderChecked);
  const statusLabel = failed.length > 0
    ? t("Есть ошибки")
    : verified
      ? t("Проверен")
      : t("Не проверялся");
  const fileFormat = versionPath.includes(".")
    ? `.${versionPath.split(".").pop()?.toUpperCase()}`
    : "—";

  const findVersion = (id: string): AssetVersion | null =>
    asset.versions.find((item) => item.id === id) ?? null;
  const versionA = findVersion(compareA);
  const versionB = findVersion(compareB);
  const sceneChanges = sceneDiff(versionA?.scene ?? [], versionB?.scene ?? []);
  const versionPreview = (version: AssetVersion | null) => {
    const preview = version?.preview || (version?.id === asset.current_version_id ? asset.preview : "");
    if (!preview || !version) return "";
    return mediaUrl(`/assets/${asset.id}/preview`, {
      version_id: version.id,
      v: preview,
    });
  };
  const metricValue = (version: AssetVersion | null, key: keyof AssetMetrics) =>
    version?.metrics?.[key] ?? null;
  const reimportInEngine = async () => {
    if (engineBusy || reimportBusy) return;
    setReimportBusy(true);
    setEngineError("");
    setReimportResult(null);
    try {
      const result = await reimportEngine(asset.engine, 180);
      setReimportResult(result);
      if (result.status !== "ok") setEngineError(t("Переиндексация: {status}", { status: result.status }));
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : t("Не удалось переиндексировать проект"));
    } finally {
      setReimportBusy(false);
    }
  };

  const importToEngine = async () => {
    if (!engineInfo || engineBusy) return;
    setEngineBusy(true);
    setEngineError("");
    setEngineImport(null);
    try {
      const result = await importAssetToEngine(asset.engine, asset.id);
      setEngineImport({ relative: result.relative, target: result.target });
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : t("Не удалось импортировать ассет"));
    } finally {
      setEngineBusy(false);
    }
  };

  const addDependency = () => {
    if (!depTarget || depTarget === asset.id) return;
    const target = assets.find((item) => item.id === depTarget);
    onUpdateDependencies([
      ...asset.dependencies,
      {
        kind: depKind,
        target_id: depTarget,
        label: target?.name ?? depTarget,
      },
    ]);
    setDepTarget("");
  };

  const addExportProfile = () => {
    const format = exportFormat.trim();
    if (!format) return;
    if (
      asset.export_profiles.some(
        (profile) => profile.engine === exportEngine && profile.format.toLowerCase() === format.toLowerCase(),
      )
    ) {
      return;
    }
    onUpdateExportProfiles([
      ...asset.export_profiles,
      { engine: exportEngine, format, options: {} },
    ]);
  };

  const scrollStrip = (direction: number) => {
    stripRef.current?.scrollBy({ left: direction * 220, behavior: "smooth" });
  };

  return (
    <section className="assets-screen asset-detail ad3-page">
      <div className="ad3-topbar">
        <button type="button" className="btn btn-secondary btn-small" onClick={onBack}>
          <ArrowLeft size={14} />
          {t("Назад")}
        </button>
        <span className={`ad3-status ${verified ? "is-ok" : failed.length ? "is-fail" : "is-idle"}`}>
          {failed.length ? <TriangleAlert size={11} /> : <Check size={11} />}
          {statusLabel}
        </span>
        <span className="ad3-spacer" />
        <button
          type="button"
          className="icon-btn is-danger"
          title={t("Удалить ассет")}
          aria-label={t("Удалить ассет")}
          onClick={onDelete}
        >
          <Trash2 size={15} />
        </button>
      </div>

      <header className="ad3-head">
        <span className="ad3-head-icon">
          <Box size={30} strokeWidth={1.35} />
        </span>
        <div className="ad3-head-copy">
          <div className="ad3-title-row">
            <h1>{asset.name}</h1>
            <span className={`ad3-status ${verified ? "is-ok" : failed.length ? "is-fail" : "is-idle"}`}>
              {verified ? <Check size={11} /> : <ShieldCheck size={11} />}
              {statusLabel}
            </span>
          </div>
          <p>
            {ASSET_TYPE_LABELS[asset.type] ?? asset.type} · {ENGINE_LABELS[asset.engine]} ·{" "}
            {t("импортирован")} {formatDate(asset.created_at)}
          </p>
        </div>
        <div className="ad3-head-actions">
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={checking || !isCurrent}
            onClick={onRunChecks}
            title={isCurrent ? t("Проверить текущую версию") : t("Сначала сделай версию текущей")}
          >
            <ShieldCheck size={14} />
            {checking ? t("Проверка…") : t("Проверить")}
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={onOpenEditor}>
            <ExternalLink size={14} />
            {t("Открыть в редакторе")}
          </button>
          <button type="button" className="btn btn-primary btn-small" onClick={onDuplicate}>
            <Plus size={14} />
            {t("Создать копию")}
          </button>
        </div>
      </header>

      <div className="ad3-tabs">
        {(
          [
            ["overview", t("Обзор"), undefined],
            ["files", t("Файлы"), asset.versions.length],
            ["usage", t("Использование"), usage.length],
            ["related", t("Связанные"), usage.length + asset.dependencies.length],
          ] as const
        ).map(([id, label, count]) => (
          <button
            type="button"
            key={id}
            className={tab === id ? "is-active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
            {typeof count === "number" ? <b>{count}</b> : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="ad3-stack">
          <div className="ad3-overview">
            <article className="ad3-preview">
              <div className="ad3-preview-toolbar">
                {can3d ? (
                  <div className="asset-preview-modes">
                    <button
                      type="button"
                      className={previewMode === "3d" ? "is-active" : ""}
                      onClick={() => setPreviewMode("3d")}
                    >
                      3D
                    </button>
                    <button
                      type="button"
                      className={previewMode === "render" ? "is-active" : ""}
                      disabled={!previewUrl}
                      onClick={() => setPreviewMode("render")}
                    >
                      {t("Рендер")}
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="icon-btn"
                  title={t("Открыть папку проекта")}
                  onClick={onOpenFolder}
                >
                  <FolderOpen size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title={t("Проверить в Blender")}
                  disabled={!blenderInstalled || blenderRunning || checking}
                  onClick={onRunBlender}
                >
                  <BrandIcon name="blender" size={14} />
                </button>
              </div>
              {can3d && previewMode === "3d" ? (
                <Suspense
                  fallback={
                    <div className="asset-viewer3d asset-viewer3d-fallback">
                      <span className="asset-viewer3d-note">{t("Загрузка 3D…")}</span>
                    </div>
                  }
                >
                  <AssetViewer3D
                    url={mediaUrl(`/assets/${asset.id}/viewer`, {
                      version_id: selectedVersion?.id ?? "",
                      v: versionHash || asset.updated_at,
                    })}
                  />
                </Suspense>
              ) : previewUrl ? (
                <img className="asset-preview2" src={previewUrl} alt={t("Превью {name}", { name: asset.name })} />
              ) : (
                <div className="asset-preview2 is-empty">
                  <ImageIcon size={30} />
                  <b>{t("Превью ещё нет")}</b>
                  <span>{t("Blender может отрендерить модель и сохранить изображение.")}</span>
                </div>
              )}
              <div className="ad3-strip-wrap">
                <button
                  type="button"
                  className="ad3-strip-arrow"
                  onClick={() => scrollStrip(-1)}
                  aria-label={t("Назад")}
                >
                  <ChevronLeft size={14} />
                </button>
                <div className="ad3-strip" ref={stripRef}>
                  {asset.versions.map((item) => {
                    const preview = item.preview
                      ? mediaUrl(`/assets/${asset.id}/preview`, {
                          version_id: item.id,
                          v: item.preview,
                        })
                      : "";
                    return (
                      <button
                        type="button"
                        key={item.id}
                        className={`ad3-thumb${item.id === versionId ? " is-active" : ""}`}
                        title={item.label}
                        onClick={() => pickVersion(item.id)}
                      >
                        {preview ? (
                          <img src={preview} alt="" />
                        ) : (
                          <Box size={18} />
                        )}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="ad3-strip-arrow"
                  onClick={() => scrollStrip(1)}
                  aria-label={t("Вперёд")}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </article>

            <article className="ad3-info">
              <h2>
                <Info size={14} />
                {t("Информация")}
              </h2>
              <div className="ad3-info-rows">
                <div><span>{t("Название")}</span><b>{asset.name}</b></div>
                <div><span>{t("Категория")}</span><b>{ASSET_TYPE_LABELS[asset.type] ?? asset.type}</b></div>
                <div><span>{t("Размер")}</span><b>{formatBytes(versionSize)}</b></div>
                <div><span>{t("Формат")}</span><b>{fileFormat}</b></div>
                <div><span>{t("Импортирован")}</span><b>{formatDate(asset.created_at)}</b></div>
                <div><span>{t("Движок")}</span><b>{ENGINE_LABELS[asset.engine]}</b></div>
                <div><span>{t("Лицензия")}</span><b>{asset.license || t("Не указана")}</b></div>
                <div><span>{t("Версия")}</span><b>{selectedVersion?.label ?? "—"}{isCurrent ? ` ${t("· текущая")}` : ""}</b></div>
                {selectedVersion?.preview_frames.length ? (
                  <div>
                    <span>{t("Анимация")}</span>
                    <b>
                      {t("{count} превью", { count: selectedVersion.preview_frames.length })} ·{" "}
                      {t("Кадр {frame} из {end}", {
                        frame: selectedVersion.frame_start,
                        end: selectedVersion.frame_end,
                      })}
                    </b>
                  </div>
                ) : null}
              </div>

              <div className="ad3-description">
                <div className="ad3-section-head">
                  <h3>{t("Описание")}</h3>
                  {!editingDescription ? (
                    <button
                      type="button"
                      className="agent-link"
                      onClick={() => setEditingDescription(true)}
                    >
                      {t("Редактировать")}
                    </button>
                  ) : null}
                </div>
                {editingDescription ? (
                  <>
                    <textarea
                      rows={4}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                    <div className="ad3-description-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        onClick={() => {
                          onUpdateDescription(description);
                          setEditingDescription(false);
                        }}
                      >
                        {t("Сохранить")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => {
                          setDescription(asset.description);
                          setEditingDescription(false);
                        }}
                      >
                        {t("Отмена")}
                      </button>
                    </div>
                  </>
                ) : (
                  <p>{asset.description || t("Описание не задано.")}</p>
                )}
              </div>

              <div className="ad3-tags">
                <h3>{t("Теги")}</h3>
                <div>
                  <span>{asset.name}</span>
                  <span>{ASSET_TYPE_LABELS[asset.type] ?? asset.type}</span>
                  <span>{ENGINE_LABELS[asset.engine]}</span>
                </div>
              </div>
            </article>
          </div>

          <div className="ad3-lower">
            <article className="ad3-card">
              <div className="ad3-card-head">
                <h2><Link2 size={14} /> {t("Связанные задачи")}</h2>
                <span>{usage.length}</span>
              </div>
              {usage.length === 0 ? (
                <p className="ad3-empty">{t("Ассет пока не привязан к задачам.")}</p>
              ) : (
                <div className="ad3-related-list">
                  {usage.slice(0, 3).map((task) => (
                    <button type="button" key={task.id} onClick={() => onOpenTask(task.id)}>
                      <ClipboardList size={15} />
                      <span>
                        <b>{task.title}</b>
                        <small>{TASK_STATUS_LABELS[task.status]}</small>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              )}
            </article>

            <article className="ad3-card">
              <div className="ad3-card-head">
                <h2><Box size={14} /> {t("Использование")}</h2>
                <span>{t("{count} задач", { count: usage.length })}</span>
              </div>
              <div className="ad3-usage">
                <b>{usage.length}</b>
                <span>{t("Раз в проектах")}</span>
              </div>
              {asset.dependencies.length > 0 ? (
                <p className="ad3-empty">{t("{count} связанных ресурсов", {
                  count: asset.dependencies.length,
                })}</p>
              ) : (
                <p className="ad3-empty">{t("Связанных ресурсов нет.")}</p>
              )}
            </article>

            {engineInfo ? (
              <article className="ad3-card ad3-engine-import">
                <div className="ad3-card-head">
                  <h2><Upload size={14} /> {t("Импорт в движок")}</h2>
                  <span className={`task-status ${engineInfo.installed && engineInfo.project_detected ? "is-done" : "is-review"}`}>
                    {engineInfo.installed && engineInfo.project_detected ? t("Готов") : t("Не готов")}
                  </span>
                </div>
                <div className="ad3-engine-meta">
                  <div><span>{t("Движок")}</span><b>{engineInfo.name}</b></div>
                  <div><span>{t("Версия")}</span><b>{engineInfo.version || "—"}</b></div>
                  <div><span>{t("Проект")}</span><b>{engineInfo.project_detected ? t("найден") : t("не найден")}</b></div>
                  <div><span>{t("Папка")}</span><b>{engineInfo.import_dir || "—"}</b></div>
                </div>
                <p className="ad3-engine-message">{engineInfo.message || t("Проверь установку движка.")}</p>
                {engineInfo.formats.length > 0 ? (
                  <div className="ad3-engine-formats">
                    {engineInfo.formats.map((format) => (
                      <span key={format}>{format}</span>
                    ))}
                  </div>
                ) : null}
                {engineInfo.installed && engineInfo.project_detected && enginePackageReady ? (
                  <div className="ad3-engine-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      disabled={engineBusy}
                      onClick={() => void importToEngine()}
                    >
                      <Upload size={13} />
                      {engineBusy ? t("Импорт…") : t("Импортировать текущую версию")}
                    </button>
                    {asset.engine === "godot" || asset.engine === "unity" || asset.engine === "unreal" ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={reimportBusy || engineBusy}
                        onClick={() => void reimportInEngine()}
                      >
                        <RefreshCw size={13} />
                        {reimportBusy ? t("Переиндексация…") : t("Переиндексировать в движке")}
                      </button>
                    ) : null}
                  </div>
                ) : engineInfo.installed && engineInfo.project_detected ? (
                  <p className="ad3-engine-message">
                    {t("Установи и включи пакет {package} в разделе «Пакеты».", {
                      package: `${asset.engine}-core`,
                    })}
                  </p>
                ) : null}
                {engineError ? <p className="review-opinion-error">{engineError}</p> : null}
                {engineImport ? (
                  <p className="ad3-engine-success">
                    {t("Импортировано:")} <code>{engineImport.relative}</code>
                  </p>
                ) : null}
                {reimportResult ? (
                  <div className="ad3-reimport">
                    <b>
                      {reimportResult.status === "ok" ? t("Готово") : t("Есть ошибка")} ·{" "}
                      {(reimportResult.duration_ms / 1000).toFixed(1)}{t(" с")}
                    </b>
                    {reimportResult.output ? <pre>{reimportResult.output}</pre> : null}
                  </div>
                ) : null}
              </article>
            ) : null}

            <article className="ad3-card ad3-contract">
              <div className="ad3-card-head">
                <h2><Box size={14} /> {t("Контракт движка")}</h2>
                {contract ? (
                  <span className={`task-status ${contract.checks.length ? "is-review" : "is-done"}`}>
                    {contract.checks.length
                      ? `${contract.checks.length} ${tp(contract.checks.length, ["замечание", "замечания", "замечаний"], "issue", "issues")}`
                      : t("Соблюдён")}
                  </span>
                ) : null}
              </div>
              {contract ? (
                <>
                  <div className="ad3-contract-title">
                    <b>{t(contract.contract.title)}</b>
                    <small>{t(contract.contract.notes)}</small>
                  </div>
                  <div className="ad3-contract-grid">
                    <div><span>{t("Форматы")}</span><b>{contract.contract.formats.join(" · ") || "—"}</b></div>
                    <div><span>{t("Оси")}</span><b>{contract.contract.up_axis} · {contract.contract.forward_axis}</b></div>
                    <div><span>{t("Масштаб")}</span><b>{contract.contract.scale}</b></div>
                    <div><span>{t("Пивот")}</span><b>{contract.contract.pivot}</b></div>
                    <div>
                      <span>{t("Бюджеты")}</span>
                      <b>
                        {contract.contract.max_triangles
                          ? `${contract.contract.max_triangles.toLocaleString("ru-RU")} ${t("треугольники")}`
                          : t("без лимита")}
                      </b>
                    </div>
                    <div><span>{t("Материалы")}</span><b>{contract.contract.max_materials ?? "—"}</b></div>
                  </div>
                  {contract.checks.length > 0 ? (
                    <div className="ad3-contract-checks">
                      {contract.checks.map((check) => (
                        <div key={check.id}>
                          <TriangleAlert size={11} />
                          <span>{check.message}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="ad3-empty">{t("Ассет проходит контракт движка.")}</p>
                  )}
                </>
              ) : (
                <p className="ad3-empty">{t("Контракт загружается…")}</p>
              )}
            </article>

            <article className="ad3-card ad3-provenance">
              <div className="ad3-card-head">
                <h2><History size={14} /> {t("Происхождение")}</h2>
              </div>
              <div className="ad3-info-rows">
                <div>
                  <span>{t("Источник")}</span>
                  <b title={asset.origin || t("не указан")}>
                    {asset.origin ? asset.origin.split(/[\\/]/).pop() : "—"}
                  </b>
                </div>
                <div>
                  <span>{t("Автор")}</span>
                  <b>{asset.agent || asset.human_author || t("Не указан")}</b>
                </div>
                <div><span>{t("Лицензия")}</span><b>{asset.license || t("Не указана")}</b></div>
                <div className="advanced-only">
                  <span>{t("Хеш")}</span>
                  <b className="mono-inline" title={asset.file_hash}>
                    {asset.file_hash ? `${asset.file_hash.slice(0, 12)}…` : "—"}
                  </b>
                </div>
                <div><span>{t("Создан")}</span><b>{formatDate(asset.created_at)}</b></div>
                <div><span>{t("Обновлён")}</span><b>{formatDate(asset.updated_at)}</b></div>
              </div>
            </article>
          </div>
        </div>
      ) : null}

      {tab === "files" ? (
        <div className="ad3-stack">
          <article className="ad3-card">
            <div className="ad3-card-head">
              <h2><Box size={14} /> {t("Файлы и версии")}</h2>
              <button type="button" className="btn btn-secondary btn-small" onClick={onAddVersion}>
                <Plus size={13} />
                {t("Добавить версию")}
              </button>
            </div>
            <div className="ad3-version-table">
              <div className="ad3-version-row is-head">
                <span>{t("Версия")}</span>
                <span>{t("Статус")}</span>
                <span>{t("Файл")}</span>
                <span>{t("Размер")}</span>
                <span>{t("Дата")}</span>
                <span />
              </div>
              {asset.versions.map((item) => (
                <div
                  className={`ad3-version-row${item.id === versionId ? " is-selected" : ""}`}
                  key={item.id}
                  onClick={() => pickVersion(item.id)}
                >
                  <span className="mono-inline">{item.label}</span>
                  <span>
                    <span className={`task-status is-${item.status}`}>
                      {ASSET_VERSION_STATUS_LABELS[item.status]}
                    </span>
                  </span>
                  <span className="detail-muted" title={item.path}>{item.path.split(/[\\/]/).pop()}</span>
                  <span className="detail-muted">{formatBytes(item.file_size)}</span>
                  <span className="detail-muted">{formatDate(item.created_at)}</span>
                  <span className="ad3-version-action">
                    {item.id === asset.current_version_id ? (
                      <span className="asset-current-tag">{t("Текущая")}</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={(event) => {
                          event.stopPropagation();
                          onActivateVersion(item.id);
                        }}
                      >
                        {t("Сделать текущей")}
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </article>

          <article className="ad3-card ad3-diff advanced-only">
            <div className="ad3-card-head">
              <h2><GitCompareArrows size={14} /> {t("Diff версий")}</h2>
              {asset.versions.length > 1 ? (
                <button
                  type="button"
                  className="agent-link"
                  onClick={() => setCompareOpen((value) => !value)}
                >
                  {compareOpen ? t("Скрыть") : t("Сравнить")}
                </button>
              ) : null}
            </div>
            {asset.versions.length < 2 ? (
              <p className="ad3-empty">{t("Для сравнения нужно минимум две версии.")}</p>
            ) : !compareOpen ? (
              <p className="ad3-empty">
                {t("Сравни объекты, полигоны, материалы и размер между версиями.")}
              </p>
            ) : (
              <>
                <div className="ad3-diff-pickers">
                  <label>
                    {t("Было")}
                    <select value={compareA} onChange={(event) => setCompareA(event.target.value)}>
                      {asset.versions.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("Стало")}
                    <select value={compareB} onChange={(event) => setCompareB(event.target.value)}>
                      {asset.versions.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="ad3-diff-mode">
                    <button
                      type="button"
                      className={diffMode === "metrics" ? "is-active" : ""}
                      onClick={() => setDiffMode("metrics")}
                    >
                      {t("Метрики")}
                    </button>
                    <button
                      type="button"
                      className={diffMode === "scene" ? "is-active" : ""}
                      onClick={() => setDiffMode("scene")}
                    >
                      {t("Сцена")}
                    </button>
                  </div>
                </div>
                <div className="ad3-diff-grid">
                  <div className="ad3-diff-previews">
                    {[versionA, versionB].map((version, index) => {
                      const preview = versionPreview(version);
                      return (
                        <figure key={index}>
                          {preview ? (
                            <img src={preview} alt={version?.label ?? ""} />
                          ) : (
                            <span className="ad3-diff-nopreview">
                              <ImageIcon size={18} />
                              {t("нет превью")}
                            </span>
                          )}
                          <figcaption>
                            {index === 0 ? t("Было") : t("Стало")} · {version?.label ?? "—"}
                          </figcaption>
                        </figure>
                      );
                    })}
                  </div>
                  {diffMode === "metrics" ? (
                  <div className="ad3-diff-metrics">
                    <div className="ad3-diff-row is-head">
                      <span>{t("Метрика")}</span>
                      <span>{versionA?.label ?? "A"}</span>
                      <span>{versionB?.label ?? "B"}</span>
                      <span>Δ</span>
                    </div>
                    {METRIC_ROWS.map(([key, label]) => {
                      const left = metricValue(versionA, key);
                      const right = metricValue(versionB, key);
                      const delta =
                        left === null || right === null ? null : right - left;
                      return (
                        <div className="ad3-diff-row" key={key}>
                          <span>{t(label)}</span>
                          <span>{left ?? "—"}</span>
                          <span>{right ?? "—"}</span>
                          <span
                            className={
                              delta === null || delta === 0
                                ? "is-flat"
                                : delta > 0
                                  ? "is-up"
                                  : "is-down"
                            }
                          >
                            {delta === null ? "—" : delta > 0 ? `+${delta}` : String(delta)}
                          </span>
                        </div>
                      );
                    })}
                    <div className="ad3-diff-row">
                      <span>{t("Размер файла")}</span>
                      <span>{formatBytes(versionA?.file_size ?? 0)}</span>
                      <span>{formatBytes(versionB?.file_size ?? 0)}</span>
                      <span
                        className={
                          versionA && versionB && versionB.file_size === versionA.file_size
                            ? "is-flat"
                            : versionA && versionB && versionB.file_size > versionA.file_size
                              ? "is-up"
                              : "is-down"
                        }
                      >
                        {versionA && versionB
                          ? `${versionB.file_size - versionA.file_size > 0 ? "+" : ""}${formatBytes(
                              versionB.file_size - versionA.file_size,
                            )}`
                          : "—"}
                      </span>
                    </div>
                  </div>
                  ) : (
                    <div className="ad3-scene-diff">
                      {!versionA?.scene.length || !versionB?.scene.length ? (
                        <p className="ad3-empty">
                          {t("Сцена не снята: проверь обе версии через Blender, чтобы увидеть объекты и трансформации.")}
                        </p>
                      ) : sceneChanges.length === 0 ? (
                        <p className="ad3-empty">{t("Объекты и трансформации не отличаются.")}</p>
                      ) : (
                        <>
                          <div className="ad3-scene-row is-head">
                            <span>{t("Объект")}</span>
                            <span>{t("Статус")}</span>
                            <span>{t("Δ треуг.")}</span>
                            <span>{t("Изменения")}</span>
                          </div>
                          {sceneChanges.map((change) => {
                            const before = change.before?.triangles ?? 0;
                            const after = change.after?.triangles ?? 0;
                            const delta = after - before;
                            return (
                              <div className={`ad3-scene-row is-${change.status}`} key={change.name}>
                                <span title={change.name}>{change.name}</span>
                                <span>
                                  {change.status === "added"
                                    ? t("+ добавлен")
                                    : change.status === "removed"
                                      ? t("− удалён")
                                      : t("~ изменён")}
                                </span>
                                <span className={delta === 0 ? "is-flat" : delta > 0 ? "is-up" : "is-down"}>
                                  {change.status === "added"
                                    ? `+${after}`
                                    : change.status === "removed"
                                      ? `−${before}`
                                      : delta === 0
                                        ? "0"
                                        : delta > 0
                                          ? `+${delta}`
                                          : String(delta)}
                                </span>
                                <span className="ad3-scene-fields">
                                  {change.fields.length > 0 ? change.fields.join(" · ") : "—"}
                                </span>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </article>

          <article className="ad3-card">
            <div className="ad3-card-head">
              <h2><ShieldCheck size={14} /> {t("Проверки")}</h2>
              <span className={`task-status ${checkState.tone}`}>
                {passed.length} / {warnings.length} / {failed.length}
              </span>
            </div>
            {checks.length === 0 ? (
              <p className="ad3-empty">{t("Проверки ещё не запускались.")}</p>
            ) : (
              <div className="ad3-checks">
                {checks.map((check) => (
                  <div className="check-row" key={check.id}>
                    <span className={`ad2-check-dot is-${CHECK_TONES[check.status]}`}>
                      {check.status === "passed" ? <Check size={11} /> : <TriangleAlert size={11} />}
                    </span>
                    <div className="check-copy">
                      <span>{check.name}</span>
                      <span className="check-message">{check.message}</span>
                    </div>
                    <span className={`task-status ${CHECK_TONES[check.status]}`}>
                      {t(CHECK_LABELS[check.status])}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
      ) : null}

      {tab === "usage" ? (
        <div className="ad3-split">
          <article className="ad3-card">
            <div className="ad3-card-head">
              <h2><ClipboardList size={14} /> {t("Использование")}</h2>
              <span>{t("{count} задач", { count: usage.length })}</span>
            </div>
            {usage.length === 0 ? (
              <p className="ad3-empty">{t("Ассет хранится в библиотеке и пока не привязан к задачам.")}</p>
            ) : (
              <div className="asset-usage-list">
                {usage.map((task) => (
                  <div className="asset-usage-row" key={task.id}>
                    <button type="button" onClick={() => onOpenTask(task.id)}>
                      <ClipboardList size={14} />
                      <span>
                        <b>{task.title}</b>
                        <small>{TASK_STATUS_LABELS[task.status]}</small>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title={t("Отвязать от задачи")}
                      onClick={() => removeTask(task.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </article>
          <article className="ad3-card">
            <div className="ad3-card-head">
              <h2><Plus size={14} /> {t("Привязать к задаче")}</h2>
            </div>
            <div className="ad3-link-panel">
              <p>{t("Привязка не копирует файл. Задача получает ссылку на текущую версию ассета.")}</p>
              <select
                value=""
                onChange={(event) => addTask(event.target.value)}
                aria-label={t("Добавить задачу")}
              >
                <option value="">{t("Выбрать задачу…")}</option>
                {unlinked.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </div>
          </article>
        </div>
      ) : null}

      {tab === "related" ? (
        <div className="ad3-stack">
          <article className="ad3-card">
            <div className="ad3-card-head">
              <h2><Link2 size={14} /> {t("Связанные задачи")}</h2>
              <span>{usage.length}</span>
            </div>
            {usage.length === 0 ? (
              <p className="ad3-empty">{t("Связанных задач нет.")}</p>
            ) : (
              <div className="ad3-related-list">
                {usage.map((task) => (
                  <button type="button" key={task.id} onClick={() => onOpenTask(task.id)}>
                    <ClipboardList size={15} />
                    <span>
                      <b>{task.title}</b>
                      <small>{TASK_STATUS_LABELS[task.status]}</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            )}
          </article>
          <article className="ad3-card ad3-depmap-card">
            <div className="ad3-card-head">
              <h2><Network size={14} /> {t("Карта зависимостей")}</h2>
              <span>{asset.dependencies.length + usage.length}</span>
            </div>
            <div className="ad3-depmap">
              <div className="ad3-dep-root">
                <Box size={18} />
                <b>{asset.name}</b>
                <small>{t("текущий ассет")}</small>
              </div>
              <div className="ad3-dep-branch">
                <span>{t("Зависит от")}</span>
                {asset.dependencies.length === 0 ? (
                  <small className="ad3-dep-empty">{t("пока нет связей")}</small>
                ) : (
                  asset.dependencies.map((dependency, index) => {
                    const target = assets.find((item) => item.id === dependency.target_id);
                    return (
                      <div className="ad3-dep-node" key={`${dependency.kind}:${dependency.target_id}:${index}`}>
                        <button
                          type="button"
                          disabled={!target}
                          onClick={() => target && onOpenAsset(target.id)}
                          title={target ? t("Открыть ассет") : dependency.target_id}
                        >
                          <Box size={12} />
                          <span>
                            <b>{dependency.label || target?.name || dependency.target_id}</b>
                            <small>{dependency.kind}</small>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="icon-btn is-danger"
                          title={t("Удалить связь")}
                          onClick={() =>
                            onUpdateDependencies(
                              asset.dependencies.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="ad3-dep-branch">
                <span>{t("Используется в")}</span>
                {usage.length === 0 ? (
                  <small className="ad3-dep-empty">{t("задач пока нет")}</small>
                ) : (
                  usage.slice(0, 4).map((task) => (
                    <button
                      type="button"
                      className="ad3-dep-task"
                      key={task.id}
                      onClick={() => onOpenTask(task.id)}
                    >
                      <ClipboardList size={12} />
                      <span>
                        <b>{task.title}</b>
                        <small>{TASK_STATUS_LABELS[task.status]}</small>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="ad3-dep-form">
              <select
                value={depTarget}
                onChange={(event) => setDepTarget(event.target.value)}
                aria-label={t("Ассет-зависимость")}
              >
                <option value="">{t("Добавить зависимость…")}</option>
                {assets
                  .filter(
                    (item) =>
                      item.id !== asset.id &&
                      !asset.dependencies.some((dependency) => dependency.target_id === item.id),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
              <select
                value={depKind}
                onChange={(event) => setDepKind(event.target.value)}
                aria-label={t("Тип зависимости")}
              >
                <option value="texture">{t("Текстура")}</option>
                <option value="material">{t("Материал")}</option>
                <option value="animation">{t("Анимация")}</option>
                <option value="prefab">{t("Префаб")}</option>
                <option value="reference">{t("Референс")}</option>
              </select>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={!depTarget}
                onClick={addDependency}
              >
                <Plus size={13} />
                {t("Связать")}
              </button>
            </div>
          </article>

          <article className="ad3-card">
            <div className="ad3-card-head">
              <h2><Box size={14} /> {t("Зависимости")}</h2>
              <span>{asset.dependencies.length}</span>
            </div>
            {asset.dependencies.length === 0 ? (
              <p className="ad3-empty">{t("Зависимостей нет.")}</p>
            ) : (
              <ul className="td2-list">
                {asset.dependencies.map((dependency, index) => (
                  <li key={`${dependency.kind}:${dependency.target_id}:${index}`}>
                    <span>{dependency.label || dependency.kind}</span>
                    <small>{dependency.target_id}</small>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="ad3-card advanced-only">
            <div className="ad3-card-head">
              <h2><Box size={14} /> {t("Профили экспорта")}</h2>
              <span>{asset.export_profiles.length}</span>
            </div>
            {asset.export_profiles.length === 0 ? (
              <p className="ad3-empty">
                {t("Профили не заданы. Добавь формат, в котором ассет должен уходить в движок.")}
              </p>
            ) : (
              <div className="ad3-export-list">
                {asset.export_profiles.map((profile, index) => (
                  <div className="ad3-export-row" key={`${profile.engine}:${profile.format}:${index}`}>
                    <span className="task-status is-done">{ENGINE_LABELS[profile.engine]}</span>
                    <b className="mono-inline">{profile.format}</b>
                    <span className="detail-muted">
                      {Object.entries(profile.options).length > 0
                        ? Object.entries(profile.options)
                            .map(([key, value]) => `${key}=${value}`)
                            .join(" · ")
                        : t("по умолчанию")}
                    </span>
                    <button
                      type="button"
                      className="icon-btn is-danger"
                      title={t("Удалить профиль")}
                      aria-label={t("Удалить профиль")}
                      onClick={() =>
                        onUpdateExportProfiles(
                          asset.export_profiles.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="ad3-export-form">
              <select
                value={exportEngine}
                onChange={(event) => setExportEngine(event.target.value as Engine)}
                aria-label={t("Движок профиля")}
              >
                {(Object.keys(ENGINE_LABELS) as Engine[]).map((engine) => (
                  <option key={engine} value={engine}>{ENGINE_LABELS[engine]}</option>
                ))}
              </select>
              <input
                value={exportFormat}
                list="kova-export-formats"
                onChange={(event) => setExportFormat(event.target.value)}
                placeholder={t("Формат")}
                aria-label={t("Формат экспорта")}
              />
              <datalist id="kova-export-formats">
                {EXPORT_FORMATS.map((format) => (
                  <option key={format} value={format} />
                ))}
              </datalist>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={addExportProfile}
              >
                <Plus size={13} />
                {t("Добавить")}
              </button>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
