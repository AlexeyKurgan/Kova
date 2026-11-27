import {
  DatabaseBackup,
  GraduationCap,
  Languages,
  MessageSquareText,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import {
  CHAT_CODE_OPTIONS,
  CHAT_FONT_OPTIONS,
  CHAT_LINE_OPTIONS,
  type ChatPreferences,
} from "../../lib/chatPreferences";
import type { AppPreferences } from "../../lib/appPreferences";
import { formatDate } from "../../lib/format";
import type { Snapshot } from "../../lib/types";
import AboutCard from "./AboutCard";
import SandboxCard from "./SandboxCard";
import StyleBibleCard from "./StyleBibleCard";

type Props = {
  preferences: ChatPreferences;
  onPreferences: (value: ChatPreferences) => void;
  appPreferences: AppPreferences;
  onAppPreferences: (value: AppPreferences) => void;
  onReset: () => void;
  onOnboarding: () => void;
  snapshots: Snapshot[];
  onCreateSnapshot: () => void;
  onOpenSnapshots: () => void;
};

function update(
  preferences: ChatPreferences,
  patch: Partial<ChatPreferences>,
): ChatPreferences {
  return { ...preferences, ...patch };
}

export default function SettingsScreen({
  preferences,
  onPreferences,
  appPreferences,
  onAppPreferences,
  onReset,
  onOnboarding,
  snapshots,
  onCreateSnapshot,
  onOpenSnapshots,
}: Props) {
  const latestSnapshot = [...snapshots].sort((left, right) =>
    (right.created_at || "").localeCompare(left.created_at || ""),
  )[0];
  return (
    <section className="settings-screen">
      <div className="assets-heading">
        <SlidersHorizontal size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>Настройки</h1>
          <p className="subtitle">
            Внешний вид, язык и поведение. Настройки проекта — в «Агентах».
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={onOnboarding}>
            <GraduationCap size={15} />
            Обучение
          </button>
        </div>
      </div>

      <div className="settings-grid">
        <article className="settings-card is-wide">
          <div className="settings-card-head">
            <span className="settings-icon">
              <MessageSquareText size={16} />
            </span>
            <div>
              <b>Чат</b>
              <small>Размер, ширина и поведение сообщений</small>
            </div>
          </div>

          <div className="settings-rows">
            <label className="settings-row">
              <span>
                <b>Размер текста</b>
                <small>Основной текст сообщений</small>
              </span>
              <select
                value={preferences.font}
                onChange={(event) =>
                  onPreferences(update(preferences, { font: Number(event.target.value) }))
                }
              >
                {CHAT_FONT_OPTIONS.map((value) => (
                  <option value={value} key={value}>
                    {value} px
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-row">
              <span>
                <b>Межстрочный интервал</b>
                <small>Больше — воздушнее и легче читать</small>
              </span>
              <select
                value={preferences.lineHeight}
                onChange={(event) =>
                  onPreferences(
                    update(preferences, { lineHeight: Number(event.target.value) }),
                  )
                }
              >
                {CHAT_LINE_OPTIONS.map((value) => (
                  <option value={value} key={value}>
                    {value.toFixed(2)}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-row">
              <span>
                <b>Ширина сообщений</b>
                <small>Насколько широко растягивать ответы</small>
              </span>
              <select
                value={preferences.width}
                onChange={(event) =>
                  onPreferences(
                    update(preferences, {
                      width: event.target.value as ChatPreferences["width"],
                    }),
                  )
                }
              >
                <option value="narrow">Узкая</option>
                <option value="normal">Обычная</option>
                <option value="wide">Широкая</option>
              </select>
            </label>

            <label className="settings-row">
              <span>
                <b>Размер кода</b>
                <small>Блоки кода и команды</small>
              </span>
              <select
                value={preferences.codeFont}
                onChange={(event) =>
                  onPreferences(
                    update(preferences, { codeFont: Number(event.target.value) }),
                  )
                }
              >
                {CHAT_CODE_OPTIONS.map((value) => (
                  <option value={value} key={value}>
                    {value} px
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="settings-checks">
            <label className="agent-check">
              <input
                type="checkbox"
                checked={preferences.enterToSend}
                onChange={(event) =>
                  onPreferences(
                    update(preferences, { enterToSend: event.target.checked }),
                  )
                }
              />
              Enter отправляет сообщение
            </label>
            <label className="agent-check">
              <input
                type="checkbox"
                checked={preferences.showTimestamps}
                onChange={(event) =>
                  onPreferences(
                    update(preferences, { showTimestamps: event.target.checked }),
                  )
                }
              />
              Показывать время сообщений
            </label>
          </div>

          <div
            className="settings-chat-preview"
            style={{
              fontSize: `${preferences.font}px`,
              lineHeight: preferences.lineHeight,
            }}
          >
            <b>Важно:</b> так будет выглядеть текст ответа.
            <span> Таблицы, списки и предупреждения используют те же настройки.</span>
          </div>
        </article>

        <article className="settings-card is-wide">
          <div className="settings-card-head">
            <span className="settings-icon">
              <UserRound size={16} />
            </span>
            <div>
              <b>Режим работы</b>
              <small>Сколько подсказок и технических деталей показывать</small>
            </div>
          </div>
          <div className="settings-modes">
            {(
              [
                ["beginner", "Beginner", "Спокойный интерфейс: главное на виду, технические детали скрыты."],
                ["pro", "Pro", "Плотнее, больше метрик, путей и диагностики на экране."],
              ] as const
            ).map(([mode, title, text]) => (
              <button
                type="button"
                key={mode}
                className={`settings-mode${appPreferences.mode === mode ? " is-active" : ""}`}
                onClick={() => onAppPreferences({ ...appPreferences, mode })}
              >
                <b>{title}</b>
                <span>{text}</span>
                {appPreferences.mode === mode ? <i>Включён</i> : null}
              </button>
            ))}
          </div>
          <div className="settings-rows">
            <label className="settings-row">
              <span>
                <b>Плотность</b>
                <small>Comfortable или компактный Pro-режим</small>
              </span>
              <select
                value={appPreferences.density}
                onChange={(event) =>
                  onAppPreferences({
                    ...appPreferences,
                    density: event.target.value as AppPreferences["density"],
                  })
                }
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
          </div>
        </article>

        <article className="settings-card is-wide">
          <div className="settings-card-head">
            <span className="settings-icon">
              <DatabaseBackup size={16} />
            </span>
            <div>
              <b>Резервные копии</b>
              <small>Снапшоты проекта и быстрый откат</small>
            </div>
          </div>
          <div className="settings-backup">
            <div className="settings-backup-stat">
              <b>{snapshots.length}</b>
              <span>снапшотов</span>
              <small>
                {latestSnapshot
                  ? `Последний · ${latestSnapshot.reason || "без описания"} · ${formatDate(
                      latestSnapshot.created_at,
                    )}`
                  : "Резервных копий ещё нет"}
              </small>
            </div>
            <div className="settings-backup-actions">
              <button type="button" className="btn btn-secondary" onClick={onCreateSnapshot}>
                <DatabaseBackup size={14} />
                Создать снапшот
              </button>
              <button type="button" className="btn btn-secondary" onClick={onOpenSnapshots}>
                Открыть снапшоты
              </button>
            </div>
          </div>
          <div className="settings-checks">
            <label className="agent-check">
              <input type="checkbox" checked readOnly />
              Снапшот создаётся перед применением изменений worktree
            </label>
            <span className="settings-note">
              <ShieldCheck size={12} /> Все копии хранятся локально в папке проекта.
            </span>
          </div>
        </article>

        <StyleBibleCard />

        <SandboxCard />

        <AboutCard />

        <article className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon">
              <Languages size={16} />
            </span>
            <div>
              <b>Язык</b>
              <small>Язык интерфейса</small>
            </div>
          </div>
          <div className="settings-rows">
            <label className="settings-row">
              <span>
                <b>Интерфейс</b>
                <small>Английский появится позже</small>
              </span>
              <select value="ru" disabled>
                <option value="ru">Русский</option>
                <option value="en">English (скоро)</option>
              </select>
            </label>
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon">
              <SlidersHorizontal size={16} />
            </span>
            <div>
              <b>Доступность</b>
              <small>Меньше движения и резких анимаций</small>
            </div>
          </div>
          <label className="agent-check">
            <input
              type="checkbox"
              checked={preferences.reduceMotion}
              onChange={(event) =>
                onPreferences(
                  update(preferences, { reduceMotion: event.target.checked }),
                )
              }
            />
            Уменьшить анимации
          </label>
        </article>
      </div>

      <div className="settings-footer">
        <button type="button" className="btn btn-secondary" onClick={onReset}>
          <RotateCcw size={14} />
          Сбросить настройки
        </button>
      </div>
    </section>
  );
}
