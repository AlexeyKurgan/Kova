import {
  Box,
  Camera,
  Check,
  ChevronRight,
  ClipboardList,
  Lightbulb,
  Plug,
  Sparkles,
  Star,
  Stethoscope,
  X,
} from "lucide-react";
import catSleeping from "../assets/cat-sleeping.svg";
import BrandIcon from "./BrandIcon";
import { formatDate } from "../lib/format";
import { t } from "../lib/i18n";
import type { BlenderStatus, RobloxStatus } from "../lib/types";

type Attention = {
  reviews: number;
  problems: number;
  blocked: number;
  doctor: number;
};

type Tip = {
  title: string;
  text: string;
  action: string;
  onAction: () => void;
};

type Props = {
  onClose: () => void;
  onOpenBlender: () => void;
  onOpenRoblox: () => void;
  roblox: RobloxStatus | null;
  onOpenReview: () => void;
  onOpenAssets: () => void;
  onOpenTasks: () => void;
  onOpenDoctor: () => void;
  onOpenSnapshots: () => void;
  blender: BlenderStatus | null;
  git: { ok: boolean; message: string } | null;
  attention: Attention;
  snapshots: { count: number; lastAt: string | null };
  tip: Tip;
};

export default function Inspector({
  onClose,
  onOpenBlender,
  onOpenRoblox,
  roblox,
  onOpenReview,
  onOpenAssets,
  onOpenTasks,
  onOpenDoctor,
  onOpenSnapshots,
  blender,
  git,
  attention,
  snapshots,
  tip,
}: Props) {
  const blenderTone = blender?.connected
    ? "is-on"
    : blender?.installed
      ? "is-unknown"
      : "is-off";
  const blenderLabel = !blender
    ? t("Не проверен")
    : blender.connected
      ? t("Подключён")
      : !blender.installed
        ? t("Не найден")
        : blender.addon_installed
          ? t("Не запущен")
          : t("Нужен аддон");
  const blenderTitle = blender?.connected
    ? `Blender ${blender.version} · ${blender.host}:${blender.port}`
    : [blender?.path, blender?.message, t("Нажми, чтобы подключить")]
        .filter(Boolean)
        .join(" · ");

  const robloxConnected = Boolean(roblox?.connected);
  const robloxLabel = !roblox
    ? t("Не проверен")
    : robloxConnected
      ? t("Подключён")
      : roblox.token_configured
        ? t("Плагин не запущен")
        : t("Не настроен");
  const robloxTone = robloxConnected ? "is-on" : roblox ? "is-unknown" : "is-off";

  const totalAttention =
    attention.reviews + attention.problems + attention.blocked + attention.doctor;

  return (
    <aside className="inspector">
      <div className="inspector-header">
        <Sparkles size={15} className="inspector-sparkle" />
        <span>{t("Состояние проекта")}</span>
        <button
          type="button"
          className="icon-btn inspector-close"
          onClick={onClose}
          aria-label={t("Скрыть панель")}
        >
          <X size={14} />
        </button>
      </div>

      <div className="section-label">
        <Plug size={12} />
        {t("Подключения")}
      </div>

      <div className="conn-list">
        <button
          type="button"
          className="conn-row is-action"
          title={blenderTitle}
          onClick={onOpenBlender}
        >
          <BrandIcon name="blender" size={15} />
          <span>Blender</span>
          <span className={`conn-state ${blenderTone}`}>
            <span className="dot" />
            {blenderLabel}
          </span>
        </button>
        <button
          type="button"
          className="conn-row is-action"
          title={
            robloxConnected
              ? t("Roblox Studio подключён")
              : t("Настроить Roblox Studio")
          }
          onClick={onOpenRoblox}
        >
          <BrandIcon name="roblox" size={15} />
          <span>Roblox Studio</span>
          <span className={`conn-state ${robloxTone}`}>
            <span className="dot" />
            {robloxLabel}
          </span>
        </button>
        <div className="conn-row" title={git?.message ?? t("Проверка Git")}>
          <BrandIcon name="git" size={15} />
          <span>Git</span>
          <span
            className={`conn-state ${
              git === null ? "is-unknown" : git.ok ? "is-on" : "is-off"
            }`}
          >
            <span className="dot" />
            {git === null
              ? t("Не проверен")
              : git.ok
                ? t("В порядке")
                : t("Не найден")}
          </span>
        </div>
      </div>

      <div className="section-label">
        <Star size={12} />
        {t("Требует внимания")}
      </div>

      {totalAttention === 0 ? (
        <div className="attention-ok">
          <Check size={13} />
          {t("Всё в порядке")}
        </div>
      ) : (
        <div className="attention-list">
          {attention.reviews > 0 ? (
            <button type="button" className="attention-row" onClick={onOpenReview}>
              <span className="attention-icon is-review">
                <Star size={13} />
              </span>
              <span>Review</span>
              <span className="attention-count">{attention.reviews}</span>
              <ChevronRight size={13} />
            </button>
          ) : null}
          {attention.problems > 0 ? (
            <button type="button" className="attention-row" onClick={onOpenAssets}>
              <span className="attention-icon is-danger">
                <Box size={13} />
              </span>
              <span>{t("Проблемные ассеты")}</span>
              <span className="attention-count">{attention.problems}</span>
              <ChevronRight size={13} />
            </button>
          ) : null}
          {attention.blocked > 0 ? (
            <button type="button" className="attention-row" onClick={onOpenTasks}>
              <span className="attention-icon is-danger">
                <ClipboardList size={13} />
              </span>
              <span>{t("Заблокированные задачи")}</span>
              <span className="attention-count">{attention.blocked}</span>
              <ChevronRight size={13} />
            </button>
          ) : null}
          {attention.doctor > 0 ? (
            <button type="button" className="attention-row" onClick={onOpenDoctor}>
              <span className="attention-icon is-warning">
                <Stethoscope size={13} />
              </span>
              <span>{t("Проверки Doctor")}</span>
              <span className="attention-count">{attention.doctor}</span>
              <ChevronRight size={13} />
            </button>
          ) : null}
        </div>
      )}

      <div className="section-label">
        <Camera size={12} />
        {t("Память проекта")}
      </div>
      <button type="button" className="snapshot-row" onClick={onOpenSnapshots}>
        <span>
          <b>{t("Снапшоты")}</b>
          <small>
            {snapshots.count > 0
              ? t("Последний: {date}", {
                  date: snapshots.lastAt ? formatDate(snapshots.lastAt) : "—",
                })
              : t("Пока нет снапшотов")}
          </small>
        </span>
        <span className="snapshot-count">{snapshots.count}</span>
        <ChevronRight size={13} />
      </button>

      <div className="inspector-tip">
        <div className="inspector-tip-copy">
          <span className="section-label">
            <Lightbulb size={12} />
            {t("Совет")}
          </span>
          <h3>{tip.title}</h3>
          <p>{tip.text}</p>
          <button type="button" className="tip-action" onClick={tip.onAction}>
            {tip.action}
            <ChevronRight size={13} />
          </button>
        </div>
        <img src={catSleeping} alt="" aria-hidden="true" />
      </div>
    </aside>
  );
}
