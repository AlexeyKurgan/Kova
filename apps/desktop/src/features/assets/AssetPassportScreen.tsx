import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowLeft,
  Box,
  Check,
  ChevronRight,
  ClipboardList,
  FolderOpen,
  ImageIcon,
  Link2,
  Plus,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import BrandIcon from "../../components/BrandIcon";
import { coreUrl } from "../../lib/coreClient";
import { formatBytes, formatDate, plural } from "../../lib/format";
import {
  ASSET_TYPE_LABELS,
  ASSET_VERSION_STATUS_LABELS,
  ENGINE_LABELS,
  TASK_STATUS_LABELS,
} from "../../lib/labels";
import type { AssetPassport, CheckResult, CheckStatus, Task } from "../../lib/types";

const AssetViewer3D = lazy(() => import("./AssetViewer3D"));

function supports3d(path: string) {
  return /\.(glb|gltf|blend|fbx|obj)$/i.test(path);
}

type Props = {
  asset: AssetPassport;
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
  onAddVersion: () => void;
  onActivateVersion: (versionId: string) => void;
  onSelectVersion: (versionId: string) => void;
};

const CHECK_TONES: Record<CheckStatus, string> = {
  passed: "is-done",
  warning: "is-review",
  failed: "is-blocked",
  error: "is-blocked",
  pending: "is-draft",
  skipped: "is-draft",
};

const CHECK_LABELS: Record<CheckStatus, string> = {
  passed: "Пройдено",
  warning: "Внимание",
  failed: "Ошибка",
  error: "Ошибка",
  pending: "Ожидает",
  skipped: "Пропущено",
};

export default function AssetPassportScreen({
  asset,
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
  onCreateTask,
  onOpenTask,
  onUpdateDescription,
  onAddVersion,
  onActivateVersion,
  onSelectVersion,
}: Props) {
  const [description, setDescription] = useState(asset.description);
  const [versionId, setVersionId] = useState(
    asset.current_version_id ?? asset.versions[asset.versions.length - 1]?.id ?? "",
  );
  const [previewMode, setPreviewMode] = useState<"3d" | "render">("render");
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
    ? `${coreUrl(`/assets/${asset.id}/preview`)}?version_id=${encodeURIComponent(
        selectedVersion.id,
      )}&v=${encodeURIComponent(selectedVersion.preview)}`
    : null;

  useEffect(() => {
    setVersionId(asset.current_version_id ?? asset.versions[asset.versions.length - 1]?.id ?? "");
  }, [asset.current_version_id, asset.id]);

  useEffect(() => {
    setDescription(asset.description);
  }, [asset.description, asset.id]);

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
        ? { label: "Blender проверен", tone: "is-done", icon: Check }
        : { label: "Не проверялся", tone: "is-draft", icon: ShieldCheck }
      : failed.length > 0
        ? { label: "Есть ошибки", tone: "is-blocked", icon: TriangleAlert }
        : !blenderChecked
          ? { label: "Только базовые проверки", tone: "is-review", icon: ShieldCheck }
          : warnings.length > 0
            ? { label: "Есть предупреждения", tone: "is-review", icon: TriangleAlert }
            : { label: "Blender-проверка пройдена", tone: "is-done", icon: Check };
  const CheckIcon = checkState.icon;

  const addTask = (taskId: string) => {
    if (!taskId) return;
    onLinkTasks([...asset.task_ids, taskId]);
  };

  const removeTask = (taskId: string) => {
    onLinkTasks(asset.task_ids.filter((item) => item !== taskId));
  };

  return (
    <section className="assets-screen asset-detail">
      <div className="task-detail-bar asset-detail-bar">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          <ArrowLeft size={15} />
          Ассеты
        </button>
        <span className="task-status is-draft">{ASSET_TYPE_LABELS[asset.type] ?? asset.type}</span>
        <span className={`task-status ${checkState.tone}`}>
          <CheckIcon size={11} />
          {checkState.label}
        </span>
        <span className="task-summary-id" title={`Текущая версия: ${currentVersion?.label ?? "—"}`}>
          {selectedVersion?.label ?? "v1"}
          {selectedVersion && !isCurrent ? " · не текущая" : ""}
        </span>
        <span className="task-detail-spacer" />
        <button
          type="button"
          className="icon-btn action-btn"
          title="Открыть папку проекта"
          aria-label="Открыть папку проекта"
          onClick={onOpenFolder}
        >
          <FolderOpen size={16} />
        </button>
      </div>

      <div className="assets-heading asset-heading2">
        <Box size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>{asset.name}</h1>
          <p className="subtitle">
            {ASSET_TYPE_LABELS[asset.type] ?? asset.type} · {ENGINE_LABELS[asset.engine]} ·{" "}
            импортирован {formatDate(asset.created_at)}
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={checking || blenderRunning || !isCurrent}
            onClick={onRunChecks}
            title={isCurrent ? "Проверить текущую версию" : "Сначала сделай версию текущей"}
          >
            <ShieldCheck size={15} />
            {checking ? "Проверка…" : "Проверить"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!blenderInstalled || blenderRunning || checking || !isCurrent}
            onClick={onRunBlender}
            title={
              !blenderInstalled
                ? "Blender не найден"
                : isCurrent
                  ? "Открыть или проверить в Blender"
                  : "Сначала сделай версию текущей"
            }
          >
            <BrandIcon name="blender" size={15} />
            {blenderRunning ? "Blender…" : "Blender"}
          </button>
          <button type="button" className="btn btn-primary" onClick={onCreateTask}>
            <Plus size={15} />
            Создать задачу
          </button>
        </div>
      </div>

      <div className="asset-main-grid">
        <article className="detail-card asset-preview-card">
          {can3d && previewMode === "3d" ? (
            <Suspense
              fallback={
                <div className="asset-viewer3d asset-viewer3d-fallback">
                  <span className="asset-viewer3d-note">Загрузка 3D…</span>
                </div>
              }
            >
              <AssetViewer3D
                url={`${coreUrl(`/assets/${asset.id}/viewer`)}?version_id=${encodeURIComponent(
                  selectedVersion?.id ?? "",
                )}&v=${encodeURIComponent(versionHash || asset.updated_at)}`}
              />
            </Suspense>
          ) : previewUrl ? (
            <img className="asset-preview2" src={previewUrl} alt={`Превью ${asset.name}`} />
          ) : (
            <div className="asset-preview2 is-empty">
              <ImageIcon size={34} />
              <b>Превью ещё нет</b>
              <span>
                {isCurrent
                  ? "Blender может отрендерить модель и сохранить изображение."
                  : "У этой версии нет превью. Сделай её текущей и запусти Blender."}
              </span>
              {isCurrent ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={!blenderInstalled || blenderRunning}
                  onClick={onRunBlender}
                >
                  <BrandIcon name="blender" size={14} />
                  Проверить в Blender
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => onActivateVersion(selectedVersion?.id ?? "")}
                >
                  Сделать текущей
                </button>
              )}
            </div>
          )}
          {!isCurrent ? (
            <div className="asset-version-note">
              Просмотр версии {selectedVersion?.label}. Проект использует{" "}
              {currentVersion?.label ?? "другую версию"} — нажми «Сделать текущей», чтобы
              переключиться.
            </div>
          ) : null}
          <div className="asset-preview-foot">
            <span>{versionPath}</span>
            <span>{formatBytes(versionSize)}</span>
            {can3d ? (
              <span className="asset-preview-modes">
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
                  Рендер
                </button>
              </span>
            ) : null}
          </div>
        </article>

        <article className="detail-card asset-info-card">
          <div className="asset-info-head">
            <h2>Информация</h2>
            <span className="asset-hash">{versionHash.slice(0, 10) || "hash —"}</span>
          </div>
          <div className="asset-prop">
            <span>Версия</span>
            <div className="asset-version-control">
              <div className="asset-version-select-row">
                <select
                  value={versionId}
                  onChange={(event) => pickVersion(event.target.value)}
                  aria-label="Версия ассета"
                >
                  {asset.versions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label} · {ASSET_VERSION_STATUS_LABELS[item.status]}
                    </option>
                  ))}
                </select>
                {isCurrent ? <span className="asset-current-tag">Текущая</span> : null}
              </div>
              {!isCurrent ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => onActivateVersion(versionId)}
                >
                  Сделать текущей
                </button>
              ) : null}
            </div>
          </div>
          <div className="asset-prop">
            <span>Проверки</span>
            <b className={`asset-check-state ${checkState.tone}`}>{checkState.label}</b>
          </div>
          <div className="asset-prop">
            <span>Размер</span>
            <b>{formatBytes(versionSize)}</b>
          </div>
          <div className="asset-prop">
            <span>Путь</span>
            <b className="mono-inline" title={versionPath}>
              {versionPath}
            </b>
          </div>
          <div className="asset-prop">
            <span>Лицензия</span>
            <b>{asset.license || "Не указана"}</b>
          </div>
          <div className="asset-prop">
            <span>Движок</span>
            <b>{ENGINE_LABELS[asset.engine]}</b>
          </div>
          <div className="asset-prop">
            <span>Происхождение</span>
            <b>{asset.origin || "Не указано"}</b>
          </div>

          <h2 className="asset-subhead">Метрики Blender</h2>
          {metrics.triangles === null ? (
            <div className="asset-metrics-empty">
              <BrandIcon name="blender" size={18} />
              <span>
                Метрик пока нет. Запусти Blender-проверку — Kova покажет полигоны, материалы и
                текстуры.
              </span>
            </div>
          ) : (
            <div className="asset-metrics">
              <span>Треугольники <b>{metrics.triangles}</b></span>
              <span>Вершины <b>{metrics.vertices ?? 0}</b></span>
              <span>Материалы <b>{metrics.materials ?? 0}</b></span>
              <span>Текстуры <b>{metrics.textures ?? 0}</b></span>
              <span>Кости <b>{metrics.bones ?? 0}</b></span>
              <span>Анимации <b>{metrics.animations ?? 0}</b></span>
            </div>
          )}
        </article>
      </div>

      <div className="asset-lower-grid">
        <article className="detail-card">
          <div className="asset-section-head">
            <h2>
              <Link2 size={14} />
              Использование
            </h2>
            <span className="asset-usage-count">
              {usage.length} {plural(usage.length, ["задача", "задачи", "задач"])}
            </span>
          </div>
          {usage.length === 0 ? (
            <p className="detail-muted">
              Ассет хранится в библиотеке проекта и пока не привязан к задачам.
            </p>
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
                    title="Отвязать от задачи"
                    aria-label="Отвязать от задачи"
                    onClick={() => removeTask(task.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="asset-link-row">
            <select
              value=""
              onChange={(event) => addTask(event.target.value)}
              aria-label="Добавить задачу"
            >
              <option value="">Привязать к задаче…</option>
              {unlinked.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </div>
        </article>

        <article className="detail-card">
          <h2>Описание</h2>
          <textarea
            className="asset-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Назначение ассета, заметки и ограничения"
            rows={4}
          />
          <div className="asset-description-foot">
            <span>Заметки хранятся в паспорте ассета</span>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={description === asset.description}
              onClick={() => onUpdateDescription(description)}
            >
              Сохранить
            </button>
          </div>
        </article>
      </div>

      <div className="asset-lower-grid">
        <article className="detail-card">
          <div className="asset-section-head">
            <h2>Версии</h2>
            <button type="button" className="btn btn-secondary btn-small" onClick={onAddVersion}>
              <Plus size={14} />
              Добавить версию
            </button>
          </div>
          {asset.versions.length === 0 ? (
            <p className="detail-muted">Версий пока нет</p>
          ) : (
            <div className="asset-version-list">
              {asset.versions.map((item) => (
                <button
                  type="button"
                  className={`asset-version-row${
                    item.id === asset.current_version_id ? " is-current-version" : ""
                  }${item.id === versionId ? " is-selected" : ""}`}
                  key={item.id}
                  onClick={() => pickVersion(item.id)}
                  title={`Показать ${item.label}`}
                >
                  <span className="mono-inline">{item.label}</span>
                  <span>{ASSET_VERSION_STATUS_LABELS[item.status]}</span>
                  <span className="detail-muted">{item.reason || "без описания"}</span>
                  <span className="detail-muted">{formatBytes(item.file_size)}</span>
                  {item.id === asset.current_version_id ? (
                    <span className="asset-current-tag">Текущая</span>
                  ) : (
                    <span />
                  )}
                  <span className="detail-muted">{formatDate(item.created_at)}</span>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="detail-card">
          <div className="asset-section-head">
            <h2>Проверки</h2>
            <span className={`task-status ${checkState.tone}`}>
              {passed.length} пройдено · {warnings.length} внимание · {failed.length} ошибок
            </span>
          </div>
          {checks.length === 0 ? (
            <p className="detail-muted">
              {blenderChecked
                ? "Метрики этой версии сохранены, но список проверок пуст. Запусти «Проверить» или «Blender»."
                : "Проверки ещё не запускались. Нажми «Проверить» или «Blender»."}
            </p>
          ) : (
            <div className="check-list">
              {checks.map((check) => (
                <div className="check-row" key={check.id}>
                  <span className={`task-status ${CHECK_TONES[check.status]}`}>
                    {CHECK_LABELS[check.status]}
                  </span>
                  <div className="check-copy">
                    <span>{check.name}</span>
                    <span className="check-message">{check.message}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
