import { GraduationCap, Languages, MessageSquareText, RotateCcw, SlidersHorizontal } from "lucide-react";
import {
  CHAT_CODE_OPTIONS,
  CHAT_FONT_OPTIONS,
  CHAT_LINE_OPTIONS,
  type ChatPreferences,
} from "../../lib/chatPreferences";

type Props = {
  preferences: ChatPreferences;
  onPreferences: (value: ChatPreferences) => void;
  onReset: () => void;
  onOnboarding: () => void;
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
  onReset,
  onOnboarding,
}: Props) {
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
