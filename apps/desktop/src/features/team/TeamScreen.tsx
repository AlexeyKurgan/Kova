import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FilePenLine,
  FilePlus2,
  FileX2,
  FolderOpen,
  FolderSync,
  GitBranch,
  History,
  KeyRound,
  Link2,
  RefreshCw,
  RotateCcw,
  Send,
  Unplug,
  Users,
  X,
} from "lucide-react";
import { useConfirm } from "../../components/ConfirmProvider";
import {
  applyTeamBundle,
  connectTeam,
  getTeam,
  getTeamHistory,
  leaveTeam,
  listTeamIncoming,
  previewTeamBundle,
  publishTeam,
  rollbackTeam,
  setTeamMember,
} from "../../lib/coreClient";
import { pickFolder } from "../../lib/dialogs";
import { formatBytes, formatDate } from "../../lib/format";
import { t } from "../../lib/i18n";
import type {
  TeamBundle,
  TeamChange,
  TeamHistoryRow,
  TeamPreview,
  TeamSpaceKind,
  TeamStatus,
} from "../../lib/types";

type Props = {
  onChanged: () => void;
};

const STATUS_LABEL: Record<TeamChange["status"], string> = {
  added: "Добавлен",
  modified: "Изменён",
  deleted: "Удалён",
};

const STATUS_ICON = {
  added: FilePlus2,
  modified: FilePenLine,
  deleted: FileX2,
} as const;

const HISTORY_LABEL: Record<string, string> = {
  publish: "Публикация",
  apply: "Применено",
};

export default function TeamScreen({ onChanged }: Props) {
  const confirm = useConfirm();
  const [status, setStatus] = useState<TeamStatus | null>(null);
  const [incoming, setIncoming] = useState<TeamBundle[]>([]);
  const [history, setHistory] = useState<TeamHistoryRow[]>([]);
  const [preview, setPreview] = useState<TeamPreview | null>(null);
  const [selected, setSelected] = useState("");
  const [resolutions, setResolutions] = useState<Record<string, "local" | "remote">>({});
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [kind, setKind] = useState<TeamSpaceKind>("folder");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [branch, setBranch] = useState("kova-team");
  const [token, setToken] = useState("");
  const [member, setMember] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState("");
  const [memberDraft, setMemberDraft] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const value = await getTeam();
      setStatus(value);
      setMemberDraft(value.identity.member);
      if (value.connected) {
        const [rows, hist] = await Promise.all([listTeamIncoming(), getTeamHistory()]);
        setIncoming(rows.bundles);
        setHistory(hist.history);
        setStatus(rows.space);
      } else {
        setIncoming([]);
        setHistory([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Не удалось загрузить команду"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openPreview = async (bundle: TeamBundle) => {
    setSelected(bundle.id);
    setPreview(null);
    setPreviewing(true);
    setError("");
    setNotice("");
    try {
      const value = await previewTeamBundle(bundle.id);
      setPreview(value);
      const defaults: Record<string, "local" | "remote"> = {};
      for (const row of value.changes) {
        if (row.conflict) defaults[row.path] = "local";
      }
      setResolutions(defaults);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Не удалось открыть изменения"));
    } finally {
      setPreviewing(false);
    }
  };

  const check = async () => {
    setChecking(true);
    setError("");
    setNotice("");
    try {
      const value = await listTeamIncoming();
      setIncoming(value.bundles);
      setStatus(value.space);
      setSelected("");
      setPreview(null);
      setNotice(
        value.bundles.length
          ? t("Новых срезов: {count}", { count: value.bundles.length })
          : t("Новых изменений нет"),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Не удалось проверить изменения"));
    } finally {
      setChecking(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    const unresolved = preview.changes.filter(
      (row) => row.conflict && !resolutions[row.path],
    );
    if (unresolved.length) {
      setError(t("Выбери версию для каждого конфликта"));
      return;
    }
    setApplying(true);
    setError("");
    try {
      const value = await applyTeamBundle(preview.bundle.id, resolutions);
      setNotice(
        t("Применено: {written} файлов, удалено: {deleted}", {
          written: value.written,
          deleted: value.deleted,
        }),
      );
      setSelected("");
      setPreview(null);
      onChanged();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Не удалось применить изменения"));
    } finally {
      setApplying(false);
    }
  };

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    setPublishing(true);
    setError("");
    setNotice("");
    try {
      const value = await publishTeam(message.trim());
      setMessage("");
      setNotice(
        t("Опубликовано: {files} файлов, {size}", {
          files: value.bundle.files,
          size: formatBytes(value.bundle.bytes),
        }),
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Не удалось опубликовать"));
    } finally {
      setPublishing(false);
    }
  };

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    setConnecting(true);
    setError("");
    try {
      await connectTeam({
        kind,
        location: location.trim(),
        name: name.trim(),
        branch: kind === "git" ? branch.trim() : undefined,
        token: kind === "git" && token.trim() ? token.trim() : undefined,
        member: member.trim() || undefined,
      });
      setToken("");
      setNotice(t("Пространство подключено"));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Не удалось подключиться"));
    } finally {
      setConnecting(false);
    }
  };

  const saveMember = async () => {
    if (!memberDraft.trim()) return;
    try {
      const value = await setTeamMember(memberDraft.trim());
      setStatus(value);
      setNotice(t("Имя участника сохранено"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Не удалось сохранить имя"));
    }
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: t("Отключить командное пространство?"),
      message: t(
        "Локальный проект останется на месте. Публикация и получение изменений станут недоступны.",
      ),
      confirmLabel: t("Отключить"),
      danger: true,
    });
    if (!ok) return;
    try {
      await leaveTeam();
      setIncoming([]);
      setHistory([]);
      setPreview(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Не удалось отключиться"));
    }
  };

  const rollback = async () => {
    const ok = await confirm({
      title: t("Откатить последнее применение?"),
      message: t(
        "Файлы вернутся к состоянию до применения среза. Опубликованные срезы останутся в пространстве.",
      ),
      confirmLabel: t("Откатить"),
      danger: true,
    });
    if (!ok) return;
    try {
      const value = await rollbackTeam();
      setNotice(
        t("Откат готов: восстановлено {restored}, удалено {removed}", {
          restored: value.restored,
          removed: value.removed,
        }),
      );
      onChanged();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Не удалось откатить"));
    }
  };

  const visibleChanges = useMemo(
    () => preview?.changes.slice(0, 400) ?? [],
    [preview],
  );
  const conflictCount = preview?.changes.filter((row) => row.conflict).length ?? 0;

  if (loading && !status) {
    return (
      <section className="packages-screen team-screen">
        <div className="pkg-loading">{t("Загружаю пространство…")}</div>
      </section>
    );
  }

  return (
    <section className="packages-screen team-screen">
      <div className="pkg-hero">
        <div className="pkg-hero-copy">
          <span className="pkg-kicker">
            <Users size={13} />
            {t("Командное пространство")}
          </span>
          <h1>{t("Работайте над проектом вместе")}</h1>
          <p>
            {t(
              "Публикуйте срезы проекта в общую папку или Git-ветку. Изменения приходят с явным списком файлов, конфликтами и откатом.",
            )}
          </p>
          <div className="pkg-hero-pills">
            {status?.connected && status.space ? (
              <>
                <span>
                  {status.space.kind === "git" ? (
                    <GitBranch size={12} />
                  ) : (
                    <FolderSync size={12} />
                  )}
                  {status.space.name}
                </span>
                <span>{status.identity.member}</span>
                <span>{status.applied ?? 0} {t("срезов")}</span>
              </>
            ) : (
              <span>{t("не подключено")}</span>
            )}
          </div>
        </div>
        <div className="pkg-hero-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={checking || !status?.connected}
            onClick={() => void check()}
          >
            <RefreshCw size={15} className={checking ? "is-spinning" : undefined} />
            {checking ? t("Проверяю…") : t("Проверить изменения")}
          </button>
          {status?.connected && status.can_rollback ? (
            <button type="button" className="btn btn-secondary" onClick={() => void rollback()}>
              <RotateCcw size={15} />
              {t("Откатить применение")}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="sk-error team-banner">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label={t("Закрыть")}>
            <X size={14} />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="team-notice">
          <CheckCircle2 size={14} />
          <span>{notice}</span>
        </div>
      ) : null}

      {!status?.connected ? (
        <form className="pkg-card team-connect" onSubmit={(event) => void connect(event)}>
          <div className="team-card-head">
            <Link2 size={18} />
            <div>
              <b>{t("Подключить пространство")}</b>
              <small>
                {t(
                  "Создай новое пространство в пустой папке или подключись к существующему.",
                )}
              </small>
            </div>
          </div>

          <div className="pkg-tabs team-kind">
            <button
              type="button"
              className={`pkg-tab${kind === "folder" ? " is-active" : ""}`}
              onClick={() => setKind("folder")}
            >
              <FolderSync size={13} />
              {t("Общая папка")}
            </button>
            <button
              type="button"
              className={`pkg-tab${kind === "git" ? " is-active" : ""}`}
              onClick={() => setKind("git")}
            >
              <GitBranch size={13} />
              GitHub / Git
            </button>
          </div>

          <div className="team-form-grid">
            <label>
              <span>{t("Название")}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("Команда проекта")}
                maxLength={80}
              />
            </label>
            <label>
              <span>{t("Твоё имя")}</span>
              <input
                value={member}
                onChange={(event) => setMember(event.target.value)}
                placeholder={status?.identity.member ?? ""}
                maxLength={60}
              />
            </label>
            <label className="team-span-2">
              <span>{kind === "folder" ? t("Папка") : t("Git-адрес")}</span>
              <div className="team-path-row">
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder={
                    kind === "folder"
                      ? "D:\\Kova Team\\Project"
                      : "https://github.com/team/kova-team.git"
                  }
                  required
                />
                {kind === "folder" ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      void pickFolder(t("Выбрать папку пространства")).then((selected) => {
                        if (!selected) return;
                        setLocation(selected);
                        if (!name.trim()) {
                          const parts = selected.split(/[\\/]/).filter(Boolean);
                          setName(parts[parts.length - 1] ?? "");
                        }
                      });
                    }}
                  >
                    <FolderOpen size={14} />
                    {t("Выбрать")}
                  </button>
                ) : null}
              </div>
            </label>
            {kind === "git" ? (
              <>
                <label>
                  <span>{t("Ветка")}</span>
                  <input
                    value={branch}
                    onChange={(event) => setBranch(event.target.value)}
                    placeholder="kova-team"
                    maxLength={120}
                  />
                </label>
                <label>
                  <span>
                    {t("Токен доступа")} <small>{t("необязательно для публичного репозитория")}</small>
                  </span>
                  <input
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    type="password"
                    autoComplete="off"
                    placeholder={t("хранится в системном хранилище")}
                  />
                </label>
              </>
            ) : null}
          </div>

          <p className="team-hint">
            {kind === "folder"
              ? t(
                  "Подойдёт OneDrive, Dropbox, iCloud Drive, Nextcloud, NAS или сетевая папка. Файлы проекта не покидают выбранное хранилище.",
                )
              : t(
                  "Kova хранит срезы на отдельной ветке и не трогает основную историю проекта. Токен не записывается в .git/config.",
                )}
          </p>

          <div className="pkg-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={connecting || !location.trim()}
            >
              <Link2 size={15} />
              {connecting ? t("Подключаю…") : t("Подключить")}
            </button>
          </div>
        </form>
      ) : (
        <div className="team-layout">
          <div className="team-column">
            <article className="pkg-card team-space-card">
              <div className="team-card-head">
                {status.space?.kind === "git" ? (
                  <GitBranch size={18} />
                ) : (
                  <FolderSync size={18} />
                )}
                <div>
                  <b>{status.space?.name}</b>
                  <small>
                    {status.space?.kind === "git"
                      ? t("Git-пространство · ветка {branch}", {
                          branch: status.space?.branch ?? "",
                        })
                      : t("Общая папка")}
                  </small>
                </div>
                <span className="pkg-status is-installed">
                  {status.space?.has_token ? (
                    <>
                      <KeyRound size={11} />
                      {t("токен")}
                    </>
                  ) : (
                    t("подключено")
                  )}
                </span>
              </div>
              <dl className="team-meta">
                <div>
                  <dt>{t("Адрес")}</dt>
                  <dd title={status.space?.location}>{status.space?.location}</dd>
                </div>
                <div>
                  <dt>{t("Срезы")}</dt>
                  <dd>
                    {status.applied ?? 0} · {status.base_files ?? 0} {t("файлов в базе")}
                  </dd>
                </div>
                <div>
                  <dt>{t("Последнее применение")}</dt>
                  <dd>{status.last_apply_at ? formatDate(status.last_apply_at) : "—"}</dd>
                </div>
              </dl>
              <div className="team-member-row">
                <Users size={14} />
                <input
                  value={memberDraft}
                  onChange={(event) => setMemberDraft(event.target.value)}
                  maxLength={60}
                  aria-label={t("Твоё имя")}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void saveMember()}
                  disabled={!memberDraft.trim() || memberDraft.trim() === status.identity.member}
                >
                  {t("Сохранить")}
                </button>
              </div>
              <div className="pkg-actions">
                <button type="button" className="btn btn-secondary" onClick={() => void disconnect()}>
                  <Unplug size={15} />
                  {t("Отключить")}
                </button>
              </div>
            </article>

            <form className="pkg-card team-publish" onSubmit={(event) => void publish(event)}>
              <div className="team-card-head">
                <ArrowUpFromLine size={18} />
                <div>
                  <b>{t("Опубликовать срез")}</b>
                  <small>
                    {t("Отправь текущее состояние проекта команде. Секреты и кэши не попадают в срез.")}
                  </small>
                </div>
              </div>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={t("Что изменилось? Например: собрал интерфейс магазина и починил инвентарь")}
                maxLength={200}
                rows={3}
              />
              {incoming.length > 0 ? (
                <p className="team-conflict-note">
                  {t(
                    "В пространстве есть неприменённые срезы. Проверь их, чтобы не потерять чужие изменения.",
                  )}
                </p>
              ) : null}
              <div className="pkg-actions">
                <button type="submit" className="btn btn-primary" disabled={publishing}>
                  <Send size={15} />
                  {publishing ? t("Публикую…") : t("Опубликовать")}
                </button>
                <span className="team-count">
                  <Clock3 size={12} />
                  {t("срезов в пространстве: {count}", {
                    count: status.applied ?? 0,
                  })}
                </span>
              </div>
            </form>

            <article className="pkg-card team-history">
              <div className="team-card-head">
                <History size={18} />
                <div>
                  <b>{t("История")}</b>
                  <small>{t("Публикации и применения на этом устройстве.")}</small>
                </div>
              </div>
              {history.length === 0 ? (
                <p className="pkg-loading">{t("Пока пусто")}</p>
              ) : (
                <ul className="team-history-list">
                  {history.map((row) => (
                    <li key={`${row.id}-${row.at}`}>
                      <span className={`team-history-action is-${row.action}`}>
                        {row.action === "publish" ? (
                          <ArrowUpFromLine size={12} />
                        ) : (
                          <ArrowDownToLine size={12} />
                        )}
                        {HISTORY_LABEL[row.action] ?? row.action}
                      </span>
                      <div>
                        <b>{row.message || row.id}</b>
                        <small>
                          {row.author || t("без автора")} · {formatDate(row.at)}
                        </small>
                      </div>
                      <span className="team-count">{row.files} {t("файлов")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>

          <div className="team-column">
            <article className="pkg-card team-incoming">
              <div className="team-card-head">
                <ArrowDownToLine size={18} />
                <div>
                  <b>{t("Входящие срезы")}</b>
                  <small>
                    {t("Чужие публикации, которые ещё не применены на этом устройстве.")}
                  </small>
                </div>
                <span className="pkg-status">{incoming.length}</span>
              </div>
              {incoming.length === 0 ? (
                <div className="team-empty">
                  <CheckCircle2 size={20} />
                  <b>{t("Всё синхронизировано")}</b>
                  <small>{t("Нажми «Проверить изменения», если команда уже опубликовала срез.")}</small>
                </div>
              ) : (
                <ul className="team-bundles">
                  {incoming.map((bundle) => (
                    <li key={bundle.id}>
                      <button
                        type="button"
                        className={`team-bundle${selected === bundle.id ? " is-active" : ""}`}
                        onClick={() => void openPreview(bundle)}
                      >
                        <span className="team-bundle-icon">
                          <ArrowDownToLine size={14} />
                        </span>
                        <span className="team-bundle-copy">
                          <b>{bundle.message || t("Срез проекта")}</b>
                          <small>
                            {bundle.author} · {formatDate(bundle.created_at)} · {bundle.files}{" "}
                            {t("файлов")} · {formatBytes(bundle.bytes)}
                          </small>
                        </span>
                        <ChevronRight size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            {previewing ? (
              <div className="pkg-loading">{t("Сравниваю файлы…")}</div>
            ) : preview ? (
              <article className="pkg-card team-preview">
                <div className="team-card-head">
                  <AlertTriangle size={18} />
                  <div>
                    <b>{preview.bundle.message || t("Срез проекта")}</b>
                    <small>
                      {preview.bundle.author} · {formatDate(preview.bundle.created_at)} ·{" "}
                      {preview.bundle.id}
                    </small>
                  </div>
                </div>
                <div className="team-stats">
                  <span>+{preview.stats.added} {t("добавлено")}</span>
                  <span>~{preview.stats.modified} {t("изменено")}</span>
                  <span>−{preview.stats.deleted} {t("удалено")}</span>
                  {conflictCount ? (
                    <span className="is-conflict">
                      <AlertTriangle size={11} />
                      {conflictCount} {t("конфликтов")}
                    </span>
                  ) : null}
                </div>

                {conflictCount ? (
                  <p className="team-conflict-note">
                    {t(
                      "Эти файлы изменены и здесь, и в команде. Для каждого выбери версию — по умолчанию остаётся твоя.",
                    )}
                  </p>
                ) : null}

                <ul className="team-files">
                  {visibleChanges.map((row) => {
                    const Icon = STATUS_ICON[row.status];
                    return (
                      <li
                        key={row.path}
                        className={`team-file is-${row.status}${row.conflict ? " is-conflict" : ""}`}
                      >
                        <Icon size={13} />
                        <span className="team-file-path" title={row.path}>
                          {row.path}
                        </span>
                        <span className="team-file-size">{formatBytes(row.size)}</span>
                        <span className="team-file-status">{t(STATUS_LABEL[row.status])}</span>
                        {row.conflict ? (
                          <span className="team-resolution">
                            <button
                              type="button"
                              className={resolutions[row.path] !== "remote" ? "is-active" : ""}
                              onClick={() =>
                                setResolutions((current) => ({
                                  ...current,
                                  [row.path]: "local",
                                }))
                              }
                            >
                              {t("Моя")}
                            </button>
                            <button
                              type="button"
                              className={resolutions[row.path] === "remote" ? "is-active" : ""}
                              onClick={() =>
                                setResolutions((current) => ({
                                  ...current,
                                  [row.path]: "remote",
                                }))
                              }
                            >
                              {t("Из команды")}
                            </button>
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {preview.changes.length > visibleChanges.length ? (
                  <p className="pkg-loading">
                    {t("Показаны первые {shown} из {total} файлов.", {
                      shown: visibleChanges.length,
                      total: preview.changes.length,
                    })}
                  </p>
                ) : null}
                <div className="pkg-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={applying || (conflictCount > 0 && Object.keys(resolutions).length < conflictCount)}
                    onClick={() => void apply()}
                  >
                    <ArrowDownToLine size={15} />
                    {applying
                      ? t("Применяю…")
                      : t("Применить {count} файлов", { count: preview.changes.length })}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setPreview(null);
                      setSelected("");
                    }}
                  >
                    {t("Закрыть")}
                  </button>
                </div>
              </article>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
