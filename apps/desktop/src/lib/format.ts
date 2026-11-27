import { getLanguage } from "./i18n";

export function formatBytes(size: number): string {
  const en = getLanguage() === "en";
  if (!size) return en ? "0 B" : "0 Б";
  if (size < 1024) return `${size} ${en ? "B" : "Б"}`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} ${en ? "KB" : "КБ"}`;
  return `${(size / (1024 * 1024)).toFixed(1)} ${en ? "MB" : "МБ"}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(getLanguage() === "en" ? "en-US" : "ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function plural(count: number, forms: [string, string, string]): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}
