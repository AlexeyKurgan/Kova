import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowLeft,
  Box,
  Check,
  ChevronRight,
  ClipboardList,
  FolderOpen,
  ImageIcon,
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
  const [tab, setTab] = useState<"overview" | "versions" | "checks" | "usage" | "notes">(
    "overview",
  );
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
    <section className="assets-screen asset-detail ad2-page">
      <div className="ad2-topbar">
        <button type="button" className="btn btn-secondary btn-small" onClick={onBack}>
          <ArrowLeft size={14} />
          Ассеты
        </button>
        <span className="task-status is-draft">
          {ASSET_TYPE_LABELS[asset.type] ?? asset.type}
        </span>
        <span className={`task-status ${checkState.tone}`}>
          <CheckIcon size={11} />
          {checkState.label}
        </span>
        <span className="ad2-version">
          {selectedVersion?.label ?? "v1"}
          {selectedVersion && !isCurrent ? " · не текущая" : ""}
        </span>
        <span className="ad2-spacer" />
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

      <header className="ad2-head">
        <span className="ad2-head-icon">
          <Box size={30} strokeWidth={1.35} />
        </span>
        <div className="ad2-head-copy">
          <h1>{asset.name}</h1>
          <p>
            {ASSET_TYPE_LABELS[asset.type] ?? asset.type} · {ENGINE_LABELS[asset.engine]} ·
            импортирован {formatDate(asset.created_at)}
          </p>
        </div>
        <div className="ad2-head-actions">
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={checking || blenderRunning || !isCurrent}
            onClick={onRunChecks}
            title={isCurrent ? "Проверить текущую версию" : "Сначала сделай версию текущей"}
          >
            <ShieldCheck size={14} />
            {checking ? "Проверка…" : "Проверить"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
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
            <BrandIcon name="blender" size={14} />
            {blenderRunning ? "Blender…" : "Blender"}
          </button>
          <button type="button" className="btn btn-primary btn-small" onClick={onCreateTask}>
            <Plus size={14} />
            Создать задачу
          </button>
        </div>
      </header>

      <div className="ad2-tabs">
        {(
          [
            ["overview", "Обзор", undefined],
            ["versions", "Версии", asset.versions.length],
            ["checks", "Проверки", checks.length],
            ["usage", "Использование", usage.length],
            ["notes", "Описание", undefined],
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
        <div className="ad2-stack">
          <div className="ad2-stats">
            <article className="ad2-stat">
              <span>Версия</span>
              <b>{selectedVersion?.label ?? "—"}</b>
              <small>{isCurrent ? "текущая" : "не текущая"}</small>
            </article>
            <article className="ad2-stat">
              <span>Размер</span>
              <b>{formatBytes(versionSize)}</b>
              <small>{versionPath.split(/[\\/]/).pop()}</small>
            </article>
            <article className="ad2-stat">
              <span>Геометрия</span>
              <b>{metrics.triangles === null ? "Unknown" : `${metrics.triangles} трис.`}</b>
              <small>
                {metrics.vertices === null ? "метрик нет" : `${metrics.vertices} вершин`}
              </small>
            </article>
            <article className="ad2-stat">
              <span>Проверки</span>
              <b>{checkState.label}</b>
              <small>
                {checks.length > 0
                  ? `${passed.length} / ${warnings.length} / ${failed.length}`
                  : "ещё не запускались"}
              </small>
            </article>
          </div>

          <div className="ad2-grid">
            <article className="ad2-card ad2-preview-card">
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
                  <ImageIcon size={30} />
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
                      <BrandIcon name="blender" size={13} />
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
                  Просмотр {selectedVersion?.label}. Проект использует{" "}
                  {currentVersion?.label ?? "другую версию"}.
                </div>
              ) : null}
              <div className="asset-preview-foot">
                <span title={versionPath}>{versionPath}</span>
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

            <article className="ad2-card ad2-info">
              <div className="ad2-card-head">
                <h2>Информация</h2>
                <span className="asset-hash">{versionHash.slice(0, 10) || "hash —"}</span>
              </div>
              <div className="ad2-props">
                <div>
                  <span>Версия</span>
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
                </div>
                <div>
                  <span>Лицензия</span>
                  <b>{asset.license || "Не указана"}</b>
                </div>
                <div>
                  <span>Движок</span>
                  <b>{ENGINE_LABELS[asset.engine]}</b>
                </div>
                <div>
                  <span>Происхождение</span>
                  <b>{asset.origin || "Не указано"}</b>
                </div>
                <div className="is-wide">
                  <span>Путь</span>
                  <b className="mono-inline" title={versionPath}>
                    {versionPath}
                  </b>
                </div>
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
              <h2 className="ad2-subhead">Метрики Blender</h2>
              {metrics.triangles === null ? (
                <div className="asset-metrics-empty">
                  <BrandIcon name="blender" size={18} />
                  <span>Метрик пока нет. Запусти Blender-проверку.</span>
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
        </div>
      ) : null}

      {tab === "versions" ? (
        <div className="ad2-stack">
          <div className="ad2-stats is-three">
            <article className="ad2-stat">
              <span>Всего версий</span>
              <b>{asset.versions.length}</b>
              <small>история сохраняется</small>
            </article>
            <article className="ad2-stat">
              <span>Текущая</span>
              <b>{currentVersion?.label ?? "—"}</b>
              <small>{currentVersion ? ASSET_VERSION_STATUS_LABELS[currentVersion.status] : "нет"}</small>
            </article>
            <article className="ad2-stat">
              <span>Размер текущей</span>
              <b>{formatBytes(currentVersion?.file_size ?? asset.file_size)}</b>
              <small>{currentVersion ? formatDate(currentVersion.created_at) : "—"}</small>
            </article>
          </div>
          <article className="ad2-card">
            <div className="ad2-card-head">
              <h2>История версий</h2>
              <button type="button" className="btn btn-secondary btn-small" onClick={onAddVersion}>
                <Plus size={13} />
                Добавить версию
              </button>
            </div>
            {asset.versions.length === 0 ? (
              <p className="detail-muted">Версий пока нет</p>
            ) : (
              <div className="ad2-version-table">
                <div className="ad2-version-row is-head">
                  <span>Версия</span>
                  <span>Статус</span>
                  <span>Причина</span>
                  <span>Размер</span>
                  <span>Дата</span>
                  <span />
                </div>
                {asset.versions.map((item) => (
                  <div
                    className={`ad2-version-row${
                      item.id === asset.current_version_id ? " is-current" : ""
                    }${item.id === versionId ? " is-selected" : ""}`}
                    key={item.id}
                    onClick={() => pickVersion(item.id)}
                  >
                    <span className="mono-inline">{item.label}</span>
                    <span>
                      <span className={`task-status is-${item.status}`}>
                        {ASSET_VERSION_STATUS_LABELS[item.status]}
                      </span>
                    </span>
                    <span className="detail-muted">{item.reason || "без описания"}</span>
                    <span className="detail-muted">{formatBytes(item.file_size)}</span>
                    <span className="detail-muted">{formatDate(item.created_at)}</span>
                    <span className="ad2-version-action">
                      {item.id === asset.current_version_id ? (
                        <span className="asset-current-tag">Текущая</span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          onClick={(event) => {
                            event.stopPropagation();
                            onActivateVersion(item.id);
                          }}
                        >
                          Сделать текущей
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
      ) : null}

      {tab === "checks" ? (
        <div className="ad2-stack">
          <div className="ad2-stats is-three">
            <article className="ad2-stat">
              <span>Пройдено</span>
              <b>{passed.length}</b>
              <small>без замечаний</small>
            </article>
            <article className="ad2-stat">
              <span>Внимание</span>
              <b>{warnings.length}</b>
              <small>стоит проверить</small>
            </article>
            <article className="ad2-stat">
              <span>Ошибки</span>
              <b>{failed.length}</b>
              <small>{failed.length === 0 ? "критичных нет" : "нужно исправить"}</small>
            </article>
          </div>
          <article className="ad2-card">
            <div className="ad2-card-head">
              <h2>Проверки</h2>
              <span className={`task-status ${checkState.tone}`}>{checkState.label}</span>
            </div>
            {checks.length === 0 ? (
              <div className="ad2-empty-state">
                <ShieldCheck size={26} />
                <b>Проверок пока нет</b>
                <p>
                  {blenderChecked
                    ? "Метрики сохранены, но список проверок пуст."
                    : "Нажми «Проверить» или запусти Blender, чтобы получить список."}
                </p>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={checking || !isCurrent}
                  onClick={onRunChecks}
                >
                  <ShieldCheck size={13} />
                  {checking ? "Проверка…" : "Запустить проверки"}
                </button>
              </div>
            ) : (
              <div className="check-list ad2-check-list">
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
                      {CHECK_LABELS[check.status]}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
      ) : null}

      {tab === "usage" ? (
        <div className="ad2-split">
          <article className="ad2-card">
            <div className="ad2-card-head">
              <h2>Использование</h2>
              <span className="asset-usage-count">
                {usage.length} {plural(usage.length, ["задача", "задачи", "задач"])}
              </span>
            </div>
            {usage.length === 0 ? (
              <div className="ad2-empty-state">
                <ClipboardList size={26} />
                <b>Ассет пока свободен</b>
                <p>Он хранится в библиотеке и не привязан к задачам. Это нормально.</p>
              </div>
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
                      onClick={() => removeTask(task.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </article>
          <article className="ad2-card">
            <div className="ad2-card-head">
              <h2>Привязать к задаче</h2>
            </div>
            <div className="ad2-link-panel">
              <p>
                Привязка не копирует файл. Задача просто получает ссылку на этот ассет и его
                текущую версию.
              </p>
              <select
                value=""
                onChange={(event) => addTask(event.target.value)}
                aria-label="Добавить задачу"
              >
                <option value="">Выбрать задачу…</option>
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

      {tab === "notes" ? (
        <div className="ad2-split">
          <article className="ad2-card">
            <div className="ad2-card-head">
              <h2>Описание ассета</h2>
            </div>
            <textarea
              className="asset-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Назначение ассета, заметки и ограничения"
              rows={7}
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
          <article className="ad2-card">
            <div className="ad2-card-head">
              <h2>О файле</h2>
            </div>
            <div className="ad2-props is-single">
              <div>
                <span>Тип</span>
                <b>{ASSET_TYPE_LABELS[asset.type] ?? asset.type}</b>
              </div>
              <div>
                <span>Движок</span>
                <b>{ENGINE_LABELS[asset.engine]}</b>
              </div>
              <div>
                <span>Лицензия</span>
                <b>{asset.license || "Не указана"}</b>
              </div>
              <div>
                <span>Происхождение</span>
                <b>{asset.origin || "Не указано"}</b>
              </div>
              <div>
                <span>Импортирован</span>
                <b>{formatDate(asset.created_at)}</b>
              </div>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
