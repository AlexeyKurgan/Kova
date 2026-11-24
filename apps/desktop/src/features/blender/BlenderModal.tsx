import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Check,
  Copy,
  Download,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  X,
} from "lucide-react";
import BrandIcon from "../../components/BrandIcon";
import { copyText } from "../../lib/clipboard";
import { getBlenderSkill } from "../../lib/coreClient";
import type {
  BlenderSkill,
  BlenderSkillDetail,
  BlenderStatus,
  BlenderWorkspace,
} from "../../lib/types";

type Busy = "connect" | "setup" | "workspace" | "shot" | null;

type Props = {
  status: BlenderStatus | null;
  workspace: BlenderWorkspace | null;
  skills: BlenderSkill[];
  screenshot: string | null;
  busy: Busy;
  error: string | null;
  onClose: () => void;
  onConnect: () => void;
  onSetup: () => void;
  onRefresh: () => void;
  onWorkspace: () => void;
  onScreenshot: () => void;
  onOpenFolder: (path: string) => void;
};

function stateTone(ready: boolean) {
  return ready ? "is-on" : "is-off";
}

export default function BlenderModal({
  status,
  workspace,
  skills,
  screenshot,
  busy,
  error,
  onClose,
  onConnect,
  onSetup,
  onRefresh,
  onWorkspace,
  onScreenshot,
  onOpenFolder,
}: Props) {
  const [detail, setDetail] = useState<BlenderSkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (detail) setDetail(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detail, onClose]);

  const openSkill = async (name: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setCopied(false);
    try {
      setDetail(await getBlenderSkill(name));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Не удалось открыть скилл");
    } finally {
      setDetailLoading(false);
    }
  };

  const copySkill = async () => {
    if (!detail) return;
    if (await copyText(detail.content)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const installed = status?.installed ?? false;
  const connected = status?.connected ?? false;
  const addon = status?.addon_installed ?? false;
  const working = busy !== null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal blender-modal">
        <div className="modal-header">
          <span className="modal-title">
            <BrandIcon name="blender" size={16} />
            Blender
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          {detail ? (
            <>
              <div className="skill-viewer-head">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => setDetail(null)}
                >
                  <ArrowLeft size={14} />
                  К Blender
                </button>
                <span className="skill-viewer-group">{detail.group_label}</span>
              </div>
              <h3 className="skill-viewer-title">{detail.name.replace("blender-", "")}</h3>
              <p className="blender-note">{detail.description}</p>
              {detail.files.length > 0 ? (
                <div className="blender-chips">
                  {detail.files.slice(0, 10).map((file) => (
                    <span className="blender-chip" key={file}>
                      {file}
                    </span>
                  ))}
                  {detail.files.length > 10 ? (
                    <span className="blender-chip is-muted">+{detail.files.length - 10}</span>
                  ) : null}
                </div>
              ) : null}
              <pre className="skill-md">{detail.content}</pre>
            </>
          ) : (
            <>
              <div className="blender-status">
                <div className="blender-row">
                  <span className="blender-label">Приложение</span>
                  <span className="blender-value" title={status?.path || ""}>
                    {installed ? status?.version || "Установлен" : "Не найден"}
                  </span>
                </div>
                <div className="blender-row">
                  <span className="blender-label">Аддон</span>
                  <span className="blender-value">
                    {addon ? `Kova Bridge ${status?.addon_version}` : "Не установлен"}
                  </span>
                </div>
                <div className="blender-row">
                  <span className="blender-label">Соединение</span>
                  <span className={`blender-value is-state ${stateTone(connected)}`}>
                    <span className="dot" />
                    {connected
                      ? `${status?.host}:${status?.port}`
                      : status?.addon_installed
                        ? "Blender не запущен"
                        : "Нет аддона"}
                  </span>
                </div>
                <div className="blender-row">
                  <span className="blender-label">Сцена</span>
                  <span className="blender-value">
                    {status?.scene
                      ? `${status.scene.name} · ${status.scene.object_count} объектов`
                      : "Нет данных"}
                  </span>
                </div>
              </div>

              {!installed ? (
                <p className="blender-note">
                  Blender 4.2 или новее не найден. Установи Blender, чтобы Kova могла запускать
                  скрипты моделей и проверки.
                </p>
              ) : null}

              {status?.message && !connected ? (
                <p className="blender-note">{status.message}</p>
              ) : null}

              {error ? <p className="modal-error">{error}</p> : null}
              {detailError ? <p className="modal-error">{detailError}</p> : null}

              {screenshot ? (
                <img className="blender-shot" src={screenshot} alt="Снимок viewport Blender" />
              ) : null}

              <div className="blender-panel">
                <div className="blender-panel-head">
                  <span>Папка моделей</span>
                  <span className="blender-panel-path" title={workspace?.root || ""}>
                    {workspace?.exists ? workspace.root : "не создана"}
                  </span>
                </div>
                {workspace?.exists ? (
                  <>
                    <div className="blender-stats">
                      <span>
                        Скриптов: <b>{workspace.scripts.length}</b>
                      </span>
                      <span>
                        Моделей: <b>{workspace.models.length}</b>
                      </span>
                      <span>
                        Проверок: <b>{workspace.checks.length}</b>
                      </span>
                    </div>
                    {workspace.scripts.length > 0 ? (
                      <div className="blender-models">
                        {workspace.scripts.slice(0, 4).map((item) => (
                          <span className="blender-chip" key={item.name}>
                            {item.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="blender-panel-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => onOpenFolder(workspace.root)}
                      >
                        <FolderOpen size={14} />
                        Открыть папку
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="blender-panel-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      disabled={working}
                      onClick={onWorkspace}
                    >
                      <FolderPlus size={14} />
                      {busy === "workspace" ? "Создание…" : "Создать папку"}
                    </button>
                  </div>
                )}
              </div>

              <div className="blender-skills">
                <span className="blender-label">Скиллы Blender</span>
                <span className="blender-skill-count">{skills.length}</span>
                {skills.length > 6 ? (
                  <button
                    type="button"
                    className="blender-link"
                    onClick={() => setShowAll((current) => !current)}
                  >
                    {showAll ? "Свернуть" : "Показать все"}
                  </button>
                ) : null}
                <div className="blender-chips">
                  {(showAll ? skills : skills.slice(0, 6)).map((skill) => (
                    <button
                      type="button"
                      className="blender-chip is-clickable"
                      key={skill.name}
                      title={skill.description}
                      onClick={() => void openSkill(skill.name)}
                    >
                      {skill.name.replace("blender-", "")}
                    </button>
                  ))}
                  {!showAll && skills.length > 6 ? (
                    <button
                      type="button"
                      className="blender-chip is-muted is-clickable"
                      onClick={() => setShowAll(true)}
                    >
                      +{skills.length - 6}
                    </button>
                  ) : null}
                </div>
                {detailLoading ? <p className="blender-note">Загрузка скилла…</p> : null}
              </div>
            </>
          )}
        </div>

        {detail ? (
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDetail(null)}
            >
              <ArrowLeft size={15} />
              К Blender
            </button>
            <span className="modal-footer-spacer" />
            <button type="button" className="btn btn-secondary" onClick={() => void copySkill()}>
              <Copy size={14} />
              {copied ? "Скопировано" : "Скопировать"}
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Закрыть
            </button>
          </div>
        ) : (
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={working}
              onClick={onRefresh}
            >
              <RefreshCw size={14} className={busy === "connect" ? "is-spinning" : undefined} />
              Обновить
            </button>
            <span className="modal-footer-spacer" />
            {installed && !addon ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={working}
                onClick={onSetup}
              >
                <Download size={14} />
                {busy === "setup" ? "Установка…" : "Установить аддон"}
              </button>
            ) : null}
            {connected ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={working}
                onClick={onScreenshot}
              >
                <Camera size={15} />
                {busy === "shot" ? "Снимок…" : "Снимок viewport"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!installed || working}
                onClick={onConnect}
                title={installed ? "Запустить Blender и подключить мост" : "Blender не найден"}
              >
                {addon ? <RefreshCw size={15} /> : <Download size={15} />}
                {busy === "connect" ? "Подключение…" : addon ? "Подключить" : "Установить и подключить"}
              </button>
            )}
            {connected ? (
              <span className="blender-connected" title="Мост активен">
                <Check size={13} />
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
