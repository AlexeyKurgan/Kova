import type { AiRunStatus } from "./types";
import { t } from "./i18n";

const RUN_LABELS_BASE: Record<AiRunStatus, string> = {
  queued: "В очереди",
  running: "Работает",
  waiting_approval: "Ждёт подтверждения",
  succeeded: "Готово",
  failed: "Ошибка",
  cancelled: "Отменено",
  interrupted: "Прервано",
};

export const RUN_LABELS = new Proxy(RUN_LABELS_BASE, {
  get(target, property: string | symbol) {
    if (typeof property !== "string") return Reflect.get(target, property);
    const value = Reflect.get(target, property);
    return typeof value === "string" ? t(value) : value;
  },
});

export const RUN_DOT: Record<AiRunStatus, string> = {
  queued: "is-queued",
  running: "is-running",
  waiting_approval: "is-waiting",
  succeeded: "is-succeeded",
  failed: "is-failed",
  cancelled: "is-cancelled",
  interrupted: "is-interrupted",
};
