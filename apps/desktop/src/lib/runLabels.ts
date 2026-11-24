import type { AiRunStatus } from "./types";

export const RUN_LABELS: Record<AiRunStatus, string> = {
  queued: "В очереди",
  running: "Работает",
  succeeded: "Готово",
  failed: "Ошибка",
  cancelled: "Отменено",
  interrupted: "Прервано",
};

export const RUN_DOT: Record<AiRunStatus, string> = {
  queued: "is-queued",
  running: "is-running",
  succeeded: "is-succeeded",
  failed: "is-failed",
  cancelled: "is-cancelled",
  interrupted: "is-interrupted",
};
