import { useEffect, useState } from "react";
import { t } from "../../lib/i18n";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Box,
  CheckCircle2,
  FolderOpen,
  Gamepad2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  X,
  XCircle,
} from "lucide-react";
import type {
  BlenderStatus,
  CheckResult,
  ProjectCard,
  ProviderInfo,
  RobloxStatus,
} from "../../lib/types";

type Props = {
  open: boolean;
  projects: ProjectCard[];
  providers: ProviderInfo[];
  doctor: CheckResult[];
  blender: BlenderStatus | null;
  roblox: RobloxStatus | null;
  onClose: () => void;
  onOpenProjects: () => void;
  onOpenAgents: () => void;
  onOpenDoctor: () => void;
  onOpenRoblox: () => void;
};

const STEPS = ["Добро пожаловать", "Проект", "Окружение", "AI", "Готово"];

function doctorCheck(checks: CheckResult[], name: string): CheckResult | undefined {
  return checks.find((check) => check.name === name);
}

function StatusIcon({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok) return <CheckCircle2 size={15} className="onb-ok" />;
  if (warn) return <AlertTriangle size={15} className="onb-warn" />;
  return <XCircle size={15} className="onb-bad" />;
}

export default function OnboardingModal({
  open,
  projects,
  providers,
  doctor,
  blender,
  roblox,
  onClose,
  onOpenProjects,
  onOpenAgents,
  onOpenDoctor,
  onOpenRoblox,
}: Props) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open) return null;

  const activeProject = projects.find((item) => item.active);
  const installedProviders = providers.filter((item) => item.installed || item.has_key);
  const defaultProvider = providers.find((item) => item.default) ?? installedProviders[0];
  const git = doctorCheck(doctor, "Git");
  const sandbox = doctorCheck(doctor, "OS sandbox");
  const token = doctorCheck(doctor, "Токен Core API");

  const go = (next: number) => {
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal onboarding-modal">
        <div className="onb-top">
          <span className="onb-mark">
            <Sparkles size={18} />
          </span>
          <div className="onb-progress">
            {STEPS.map((label, index) => (
              <span
                key={label}
                className={index <= step ? "is-active" : ""}
                title={t(label)}
              />
            ))}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Закрыть")}>
            <X size={14} />
          </button>
        </div>

        <div className="onb-body">
          {step === 0 ? (
            <div className="onb-welcome">
              <div className="onb-logo">
                <Sparkles size={34} />
              </div>
              <h1>{t("Твой проект. Твои инструменты. Твой AI.")}</h1>
              <p>
                {t("Kova Hub — мастерская, где AI не теряет контекст, Blender и движок показывают результат, а ты принимаешь работу. Начнём с простого.")}
              </p>
              <div className="onb-pills">
                <span>{t("Локально")}</span>
                <span>{t("Без облака")}</span>
                <span>{t("С откатом")}</span>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="onb-section">
              <div className="onb-section-head">
                <FolderOpen size={22} />
                <div>
                  <h2>{t("Проект")}</h2>
                  <p>{t("Одна папка — один проект. Память живёт в `.hub`.")}</p>
                </div>
              </div>
              <div className="onb-card">
                <div className="onb-card-row">
                  <span>{t("Активный проект")}</span>
                  <b>{activeProject?.name ?? t("Пока нет")}</b>
                </div>
                <div className="onb-card-row">
                  <span>{t("Всего проектов")}</span>
                  <b>{projects.length}</b>
                </div>
                <div className="onb-card-row">
                  <span>{t("Память")}</span>
                  <b>{activeProject ? t(".hub на месте") : t("создастся при первом проекте")}</b>
                </div>
              </div>
              <button type="button" className="btn btn-primary" onClick={onOpenProjects}>
                <FolderOpen size={15} />
                {t("Открыть «Проекты»")}
              </button>
              <p className="onb-hint">
                {t("Создай новый проект или открой существующую папку — Kova сама создаст `.hub`, задачи и паспорта.")}
              </p>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="onb-section">
              <div className="onb-section-head">
                <Stethoscope size={22} />
                <div>
                  <h2>{t("Окружение")}</h2>
                  <p>{t("Проверим, что есть на машине. Это можно пропустить.")}</p>
                </div>
              </div>
              <div className="onb-checks">
                <div className="onb-check">
                  <Box size={15} />
                  <span>Blender</span>
                  <small>
                    {blender?.installed
                      ? blender.connected
                        ? t("подключён")
                        : t("установлен")
                      : t("не найден")}
                  </small>
                  <StatusIcon ok={Boolean(blender?.installed)} warn={!blender?.connected} />
                </div>
                <div className="onb-check">
                  <Gamepad2 size={15} />
                  <span>Roblox Studio</span>
                  <small>
                    {roblox?.studio_installed
                      ? roblox.connected
                        ? t("мост подключён")
                        : roblox.plugin_installed
                          ? t("плагин установлен")
                          : t("нужен плагин")
                      : t("не найден")}
                  </small>
                  <StatusIcon ok={Boolean(roblox?.connected)} warn={Boolean(roblox?.studio_installed)} />
                </div>
                <div className="onb-check">
                  <ShieldCheck size={15} />
                  <span>Git</span>
                  <small>{git?.message ?? t("проверка")}</small>
                  <StatusIcon ok={git?.status === "passed"} warn={git?.status === "warning"} />
                </div>
                <div className="onb-check">
                  <ShieldCheck size={15} />
                  <span>Owner token</span>
                  <small>{token?.status === "passed" ? t("включён") : t("проверь Doctor")}</small>
                  <StatusIcon ok={token?.status === "passed"} warn={token?.status === "warning"} />
                </div>
                <div className="onb-check">
                  <ShieldCheck size={15} />
                  <span>OS sandbox</span>
                  <small>{sandbox?.status === "warning" ? t("недоступен, есть fallback") : t("готов")}</small>
                  <StatusIcon ok={sandbox?.status === "passed"} warn={sandbox?.status === "warning"} />
                </div>
              </div>
              <div className="onb-actions">
                <button type="button" className="btn btn-secondary" onClick={onOpenDoctor}>
                  {t("Открыть Doctor")}
                </button>
                {roblox?.studio_installed ? (
                  <button type="button" className="btn btn-secondary" onClick={onOpenRoblox}>
                    {t("Настроить Roblox")}
                  </button>
                ) : null}
              </div>
              <p className="onb-hint">
                {t("Если чего-то нет — не страшно. Clipboard-режим и базовые задачи работают без Blender и движка.")}
              </p>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="onb-section">
              <div className="onb-section-head">
                <Bot size={22} />
                <div>
                  <h2>AI</h2>
                  <p>{t("Один провайдер — уже достаточно. Остальные добавишь позже.")}</p>
                </div>
              </div>
              <div className="onb-card">
                <div className="onb-card-row">
                  <span>{t("Подключено")}</span>
                  <b>{t("{count} провайдеров", { count: installedProviders.length })}</b>
                </div>
                <div className="onb-card-row">
                  <span>{t("По умолчанию")}</span>
                  <b>{defaultProvider?.name ?? t("не выбран")}</b>
                </div>
                <div className="onb-card-row">
                  <span>{t("Режим")}</span>
                  <b>{t("локальный / CLI / API")}</b>
                </div>
              </div>
              <button type="button" className="btn btn-primary" onClick={onOpenAgents}>
                <Bot size={15} />
                {t("Открыть «Агенты»")}
              </button>
              <p className="onb-hint">
                {t("Нет ключа? Начни с Clipboard: Kova подготовит капсулу, ты вставишь её в любой браузерный AI и вернёшь ответ.")}
              </p>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="onb-section">
              <div className="onb-section-head">
                <ShieldCheck size={22} />
                <div>
                  <h2>{t("Готово")}</h2>
                  <p>{t("Три правила, которые сохранят проект.")}</p>
                </div>
              </div>
              <div className="onb-rules">
                <div>
                  <b>{t("1. Сначала Review")}</b>
                  <span>{t("AI предлагает — ты принимаешь. Запись только после проверки.")}</span>
                </div>
                <div>
                  <b>{t("2. Снапшот перед изменением")}</b>
                  <span>{t("Любой результат можно сравнить и откатить.")}</span>
                </div>
                <div>
                  <b>{t("3. Память в `.hub`")}</b>
                  <span>{t("Задачи, решения и ассеты остаются в проекте, а не в чате.")}</span>
                </div>
              </div>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                <ArrowRight size={15} />
                {t("Начать работу")}
              </button>
            </div>
          ) : null}
        </div>

        <div className="onb-footer">
          <button type="button" className="btn btn-secondary btn-small" onClick={onClose}>
            {t("Пропустить")}
          </button>
          <span className="onb-step-label">
            {t("Шаг {step} из {total}", {
              step: step + 1,
              total: STEPS.length,
            })}
          </span>
          <div className="onb-footer-actions">
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={step === 0}
              onClick={() => go(step - 1)}
            >
              {t("Назад")}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={step === STEPS.length - 1}
              onClick={() => go(step + 1)}
            >
              {t("Дальше")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}