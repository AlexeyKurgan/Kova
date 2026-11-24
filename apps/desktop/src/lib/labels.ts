import type {
  AssetVersionStatus,
  Engine,
  ReviewStatus,
  TaskStatus,
  TaskType,
} from "./types";

export const ENGINE_LABELS: Record<Engine, string> = {
  generic: "Без движка",
  blender: "Blender",
  roblox: "Roblox",
  godot: "Godot",
  unity: "Unity",
  unreal: "Unreal",
  rpgmaker: "RPG Maker",
  web: "Web",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  draft: "Черновик",
  ready: "Готова",
  working: "В работе",
  checking: "Проверка",
  review: "Review",
  done: "Готово",
  blocked: "Блок",
  archived: "Архив",
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  model: "Модель",
  animation: "Анимация",
  effect: "Эффект",
  texture: "Текстура",
  code: "Код",
  level: "Уровень",
  export: "Экспорт",
};

export const ASSET_TYPE_LABELS: Record<string, string> = {
  model: "Модель",
  animation: "Анимация",
  effect: "Эффект",
  texture: "Текстура",
  audio: "Аудио",
  code: "Код",
  scene: "Сцена",
  other: "Другое",
};

export const ASSET_VERSION_STATUS_LABELS: Record<AssetVersionStatus, string> = {
  draft: "Черновик",
  review: "Review",
  accepted: "Принято",
  archived: "Архив",
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: "Ждёт приёмки",
  accepted: "Принято",
  rework: "Доработка",
  archived: "Архив",
};

export const LEDGER_TYPE_LABELS: Record<string, string> = {
  "task.created": "Задача создана",
  "task.status": "Статус задачи изменён",
  "task.deleted": "Задача удалена",
  "task.restored": "Задача восстановлена",
  "task.purged": "Задача удалена навсегда",
  "project.created": "Проект создан",
  "capsule.created": "Капсула подготовлена",
  "response.imported": "Ответ AI импортирован",
  "review.accepted": "Результат принят",
  "review.rework": "Отправлено на доработку",
  "snapshot.created": "Снапшот создан",
  "snapshot.restored": "Откат к снапшоту",
  "asset.imported": "Ассет импортирован",
  "asset.checked": "Ассеты проверены",
  "asset.blender": "Ассет проверен в Blender",
  "asset.version": "Версия ассета изменена",
  "asset.linked": "Ассет привязан к задаче",
  "asset.unlinked": "Ассет отвязан от задачи",
  "blender.connected": "Blender подключён",
  "blender.workspace": "Папка Blender создана",
  "blender.model": "Модель создана",
  "blender.run": "Скрипт модели запущен",
  "blender.render": "Рендер модели",
  "blender.qa": "QA модели",
  "blender.build": "Модель собрана",
  "blender.screenshot": "Снимок Blender",
  "ai.run.started": "AI-запуск начат",
  "ai.run.finished": "AI завершил задачу",
  "ai.run.failed": "AI завершился с ошибкой",
  "agent.run.interrupted": "Запуск агента прерван",
  "agent.handoff.created": "Передача работы агенту",
  "task.validation": "Проверка задачи",
  "task.validation.added": "Проверка добавлена",
  "task.validation.deleted": "Проверка удалена",
};
