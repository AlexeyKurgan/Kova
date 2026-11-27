import { setLanguage, type Language } from "./i18n";

export type UiMode = "beginner" | "pro";
export type Density = "comfortable" | "compact";

export type AppPreferences = {
  mode: UiMode;
  density: Density;
  language: Language;
  autoSnapshots: boolean;
  confirmWrites: boolean;
  telemetryOptIn: boolean;
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  mode: "beginner",
  density: "comfortable",
  language: "ru",
  autoSnapshots: true,
  confirmWrites: true,
  telemetryOptIn: false,
};

const STORAGE_KEY = "kova-app-preferences";

export function loadAppPreferences(): AppPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setLanguage("ru");
      return DEFAULT_APP_PREFERENCES;
    }
    const value = JSON.parse(raw) as Partial<AppPreferences>;
    const resolved: AppPreferences = {
      mode: value.mode === "pro" ? "pro" : "beginner",
      density: value.density === "compact" ? "compact" : "comfortable",
      language: value.language === "en" ? "en" : "ru",
      autoSnapshots: value.autoSnapshots !== false,
      confirmWrites: value.confirmWrites !== false,
      telemetryOptIn: value.telemetryOptIn === true,
    };
    setLanguage(resolved.language);
    return resolved;
  } catch {
    setLanguage("ru");
    return DEFAULT_APP_PREFERENCES;
  }
}

export function saveAppPreferences(value: AppPreferences): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function applyAppPreferences(value: AppPreferences): void {
  setLanguage(value.language);
  const root = document.documentElement;
  root.dataset.mode = value.mode;
  root.dataset.density = value.density;
}
