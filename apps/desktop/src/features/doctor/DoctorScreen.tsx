import { useState } from "react";
import {
  AlertTriangle,
  Box,
  Camera,
  CheckCircle2,
  Download,
  FolderLock,
  FolderTree,
  Gamepad2,
  GitBranch,
  HardDrive,
  KeyRound,
  Network,
  Package,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Wifi,
  Wrench,
  XCircle,
} from "lucide-react";
import type { CheckResult, CheckStatus } from "../../lib/types";

type Props = {
  checks: CheckResult[];
  onRefresh: () => void;
  onExport: () => void;
  onRepair: () => Promise<string[]>;
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
    names: [
      "Структура .hub",
      "Движок проекта",
      "Пакеты проекта",
      "Снапшоты",
      "Корзина проектов",
    ],
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
  {
    title: "Система",
    names: ["Права на запись", "Порты Kova", "Свободное место"],
  },
];

const ICONS: Record<string, typeof FolderTree> = {
  "Структура .hub": FolderTree,
  "Движок проекта": Gamepad2,
  "Пакеты проекта": Package,
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
  "Права на запись": FolderLock,
  "Порты Kova": Network,
  "Свободное место": HardDrive,
};

const HINTS: Record<string, string> = {
  Git: "Установи Git — без него недоступны worktree и история изменений.",
  Blender: "Установи Blender или укажи путь в настройках Blender.",
  "Изоляция агентов": "Открой «Агенты» и нажми «Настроить за меня».",
  "Локальный режим": "Это нормально для облачных моделей. Включай, только если есть локальная модель.",
  "Сетевой щит": "Включи в «Агентах → Дополнительно», если он выключен.",
  "OS sandbox": "OS sandbox не поддерживается. Провайдеры работают в sandbox-копии проекта + process containment.",
  "Токен Core API": "Задай KOVA_CORE_TOKEN, чтобы локальные процессы не могли управлять core API.",
  "Корзина проектов": "Проекты можно восстановить или очистить в разделе «Проекты».",
  "Пакеты проекта": "Проверь пакеты в разделе «Пакеты»: включи пакет движка и переустанови повреждённые.",
  "Права на запись": "Проверь, что папка проекта и .hub не защищены от записи и не заняты другой программой.",
  "Порты Kova": "8765 — core, 47832 — Blender, 48620 — редактор. Занятый порт может принадлежать другой копии Kova.",
};

export default function DoctorScreen({ checks, onRefresh, onExport, onRepair }: Props) {
  const [repairing, setRepairing] = useState(false);
  const [repairNote, setRepairNote] = useState<string[]>([]);
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
          <button
            type="button"
            className="btn btn-secondary"
            disabled={repairing}
            onClick={() => {
              setRepairing(true);
              void onRepair()
                .then((actions) => setRepairNote(actions))
                .catch((err) =>
                  setRepairNote([
                    err instanceof Error ? err.message : "Не удалось выполнить починку",
                  ]),
                )
                .finally(() => setRepairing(false));
            }}
          >
            <Wrench size={15} />
            {repairing ? "Починка…" : "Починить"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onExport}>
            <Download size={15} />
            Экспорт диагностики
          </button>
          <button type="button" className="btn btn-secondary" onClick={onRefresh}>
            <RefreshCw size={15} />
            Проверить снова
          </button>
        </div>
      </div>

      {repairNote.length > 0 ? (
        <div className="doctor-repair-note">
          <b>Что сделал Doctor</b>
          <ul>
            {repairNote.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
          <button
            type="button"
            className="icon-btn"
            aria-label="Скрыть"
            onClick={() => setRepairNote([])}
          >
            <XCircle size={14} />
          </button>
        </div>
      ) : null}

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
