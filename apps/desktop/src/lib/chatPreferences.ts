export type ChatWidth = "narrow" | "normal" | "wide";

export type ChatPreferences = {
  font: number;
  lineHeight: number;
  width: ChatWidth;
  codeFont: number;
  enterToSend: boolean;
  showTimestamps: boolean;
  reduceMotion: boolean;
};

export const CHAT_FONT_OPTIONS = [13, 14, 15, 16, 17, 18, 20, 22];
export const CHAT_LINE_OPTIONS = [1.4, 1.55, 1.7, 1.85];
export const CHAT_CODE_OPTIONS = [10, 11, 12, 13, 14];

export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
  font: 16,
  lineHeight: 1.6,
  width: "normal",
  codeFont: 12,
  enterToSend: true,
  showTimestamps: true,
  reduceMotion: false,
};

const STORAGE_KEY = "kova-chat-preferences";

export function loadChatPreferences(): ChatPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CHAT_PREFERENCES;
    const value = JSON.parse(raw) as Partial<ChatPreferences>;
    return {
      font:
        typeof value.font === "number" && value.font >= 12 && value.font <= 28
          ? value.font
          : DEFAULT_CHAT_PREFERENCES.font,
      lineHeight:
        typeof value.lineHeight === "number" &&
        value.lineHeight >= 1.2 &&
        value.lineHeight <= 2.2
          ? value.lineHeight
          : DEFAULT_CHAT_PREFERENCES.lineHeight,
      width:
        value.width === "narrow" || value.width === "wide"
          ? value.width
          : "normal",
      codeFont:
        typeof value.codeFont === "number" &&
        value.codeFont >= 9 &&
        value.codeFont <= 18
          ? value.codeFont
          : DEFAULT_CHAT_PREFERENCES.codeFont,
      enterToSend: value.enterToSend !== false,
      showTimestamps: value.showTimestamps !== false,
      reduceMotion: value.reduceMotion === true,
    };
  } catch {
    return DEFAULT_CHAT_PREFERENCES;
  }
}

export function saveChatPreferences(value: ChatPreferences): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function applyChatPreferences(value: ChatPreferences): void {
  const root = document.documentElement;
  root.style.setProperty("--chat-font-size", `${value.font}px`);
  root.style.setProperty("--chat-line-height", `${value.lineHeight}`);
  root.style.setProperty(
    "--chat-bubble-max",
    value.width === "narrow" ? "720px" : value.width === "wide" ? "1180px" : "920px",
  );
  root.style.setProperty("--chat-code-size", `${value.codeFont}px`);
  root.dataset.reduceMotion = value.reduceMotion ? "true" : "false";
}
