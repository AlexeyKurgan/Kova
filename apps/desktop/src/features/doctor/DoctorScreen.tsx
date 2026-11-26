import {
  AlertTriangle,
  Box,
  Camera,
  CheckCircle2,
  FolderTree,
  Gamepad2,
  GitBranch,
  HardDrive,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Wifi,
  XCircle,
} from "lucide-react";
import type { CheckResult, CheckStatus } from "../../lib/types";

type Props = {
  checks: CheckResult[];
  onRefresh: () => void;
};

const STATUS_LABELS: Record<CheckStatus, string> = {
  passed: "Норма",
  warning: "Внимание",
  failed: "Ошибка",
  error: "Ошибка",
  pending: "Ожидает",
  skipped: "Пропущено",
};

const STATUS_TONES: Record<CheckStatus, string> = {
  passed: "ok",
  warning: "warn",
  failed: "bad",
  error: "bad",
  pending: "muted",
  skipped: "muted",
};

const GROUPS: Array<{ title: string; names: string[] }> = [
  {
    title: "Проект",
    names: ["Структура .hub", "Движок проекта", "Снапшоты", "Корзина проектов"],
  },
  { title: "Инструменты", names: ["Git", "Blender"] },
  {
    title: "Безопасность",
    names: [
      "Изоляция агентов",
      "Локальный режим",
      "Сетевой щит",
      "Process containment",
      "OS sandbox",
      "Токен Core API",
    ],
  },
  { title: "Система", names: ["Свободное место"] },
];

const ICONS: Record<string, typeof FolderTree> = {
  "Структура .hub": FolderTree,
  "Движок проекта": Gamepad2,
  Снапшоты: Camera,
  "Корзина проектов": Trash2,
  Git: GitBranch,
  Blender: Box,
  "Изоляция агентов": ShieldCheck,
  "Локальный режим": ShieldCheck,
  "Сетевой щит": Wifi,
  "Process containment": ShieldCheck,
  "OS sandbox": ShieldCheck,
  "Токен Core API": KeyRound,
  "Свободное место": HardDrive,
};

const HINTS: Record<string, string> = {
  Git: "Установи Git — без него недоступны worktree и история изменений.",
  Blender: "Установи Blender или укажи путь в настройках Blender.",
  "Изоляция агентов": "Открой «Агенты» и нажми «Настроить за меня».",
  "Локальный режим": "Это нормально для облачных моделей. Включай, только если есть локальная модель.",
  "Сетевой щит": "Включи в «Агентах → Дополнительно», если он выключен.",
  "OS sandbox": "Нужен WSL2, Docker или Windows Sandbox. Сейчас используется sandbox-копия.",
  "Токен Core API": "Задай KOVA_CORE_TOKEN, чтобы локальные процессы не могли управлять core API.",
  "Корзина проектов": "Проекты можно восстановить или очистить в разделе «Проекты».",
};

export default function DoctorScreen({ checks, onRefresh }: Props) {
  const passed = checks.filter((check) => check.status === "passed").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  const errors = checks.filter(
    (check) => check.status === "failed" || check.status === "error",
  ).length;

  const known = new Set(GROUPS.flatMap((group) => group.names));
  const groups = GROUPS.map((group) => ({
    ...group,
    checks: checks.filter((check) => group.names.includes(check.name)),
  })).filter((group) => group.checks.length);
  const other = checks.filter((check) => !known.has(check.name));
  if (other.length) groups.push({ title: "Другое", names: [], checks: other });

  return (
    <section className="doctor-screen">
      <div className="assets-heading">
        <Stethoscope size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>Doctor</h1>
          <p className="subtitle">
            Проверки окружения и безопасности. Жёлтое — рекомендация, красное — проблема.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={onRefresh}>
            <RefreshCw size={15} />
            Проверить снова
          </button>
        </div>
      </div>

      <div className="doctor-summary">
        <div className="doctor-summary-card">
          <span>Всего</span>
          <b>{checks.length}</b>
        </div>
        <div className="doctor-summary-card is-ok">
          <span>Норма</span>
          <b>{passed}</b>
        </div>
        <div className="doctor-summary-card is-warn">
          <span>Внимание</span>
          <b>{warnings}</b>
        </div>
        <div className="doctor-summary-card is-bad">
          <span>Ошибки</span>
          <b>{errors}</b>
        </div>
      </div>

      {groups.map((group) => (
        <div className="doctor-group" key={group.title}>
          <div className="doctor-group-head">
            <h2>{group.title}</h2>
            <span>{group.checks.length}</span>
          </div>
          <div className="doctor-grid">
            {group.checks.map((check) => {
              const tone = STATUS_TONES[check.status] || "muted";
              const Icon = ICONS[check.name] || Stethoscope;
              const hint = check.status === "warning" ? HINTS[check.name] : "";
              return (
                <article className={`doctor-card is-${tone}`} key={check.id}>
                  <div className="doctor-card-top">
                    <span className="doctor-card-icon">
                      <Icon size={16} />
                    </span>
                    <span className={`doctor-badge is-${tone}`}>
                      {check.status === "passed" ? (
                        <CheckCircle2 size={11} />
                      ) : check.status === "warning" ? (
                        <AlertTriangle size={11} />
                      ) : check.status === "failed" || check.status === "error" ? (
                        <XCircle size={11} />
                      ) : null}
                      {STATUS_LABELS[check.status]}
                    </span>
                  </div>
                  <b>{check.name}</b>
                  <p>{check.message}</p>
                  {hint ? <small>{hint}</small> : null}
                </article>
              );
            })}
          </div>
        </div>
      ))}

      {checks.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-art">
            <Stethoscope size={26} />
          </div>
          <h2 className="empty-title">Проверок пока нет</h2>
          <p className="empty-text">Нажми «Проверить снова».</p>
        </div>
      ) : null}
    </section>
  );
}
