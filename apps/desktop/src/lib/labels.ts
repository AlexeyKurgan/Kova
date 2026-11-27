import type {
  AssetVersionStatus,
  Engine,
  ReviewStatus,
  TaskStatus,
  TaskType,
} from "./types";
import { t } from "./i18n";

function translated<T extends Record<string, string>>(values: T): T {
  return new Proxy(values, {
    get(target, property: string | symbol) {
      if (typeof property !== "string") return Reflect.get(target, property);
      const value = Reflect.get(target, property);
      return typeof value === "string" ? t(value) : value;
    },
  });
}

const ENGINE_LABELS_BASE: Record<Engine, string> = {
  generic: "Без движка",
  blender: "Blender",
  roblox: "Roblox",
  godot: "Godot",
  unity: "Unity",
  unreal: "Unreal",
  rpgmaker: "RPG Maker",
  web: "Web",
};

export const ENGINE_LABELS = translated(ENGINE_LABELS_BASE);

const TASK_STATUS_LABELS_BASE: Record<TaskStatus, string> = {
  draft: "Черновик",
  ready: "Готова",
  working: "В работе",
  checking: "Проверка",
  review: "Review",
  done: "Готово",
  blocked: "Блок",
  archived: "Архив",
};

export const TASK_STATUS_LABELS = translated(TASK_STATUS_LABELS_BASE);

const TASK_TYPE_LABELS_BASE: Record<TaskType, string> = {
  model: "Модель",
  animation: "Анимация",
  effect: "Эффект",
  texture: "Текстура",
  code: "Код",
  level: "Уровень",
  export: "Экспорт",
};

export const TASK_TYPE_LABELS = translated(TASK_TYPE_LABELS_BASE);

const ASSET_TYPE_LABELS_BASE: Record<string, string> = {
  model: "Модель",
  animation: "Анимация",
  effect: "Эффект",
  texture: "Текстура",
  audio: "Аудио",
  video: "Видео",
  code: "Код",
  scene: "Сцена",
  other: "Другое",
};

export const ASSET_TYPE_LABELS = translated(ASSET_TYPE_LABELS_BASE);

const ASSET_VERSION_STATUS_LABELS_BASE: Record<AssetVersionStatus, string> = {
  draft: "Черновик",
  review: "Review",
  accepted: "Принято",
  archived: "Архив",
};

export const ASSET_VERSION_STATUS_LABELS = translated(ASSET_VERSION_STATUS_LABELS_BASE);

const REVIEW_STATUS_LABELS_BASE: Record<ReviewStatus, string> = {
  pending: "Ждёт приёмки",
  accepted: "Принято",
  rework: "Доработка",
  archived: "Архив",
};

export const REVIEW_STATUS_LABELS = translated(REVIEW_STATUS_LABELS_BASE);

const LEDGER_TYPE_LABELS_BASE: Record<string, string> = {
  "task.created": "Задача создана",
  "task.status": "Статус задачи изменён",
  "task.deleted": "Задача удалена",
  "task.restored": "Задача восстановлена",
  "task.purged": "Задача удалена навсегда",
  "project.created": "Проект создан",
  "project.imported": "Проект импортирован",
  "capsule.created": "Капсула подготовлена",
  "response.imported": "Ответ AI импортирован",
  "review.accepted": "Результат принят",
  "review.rework": "Отправлено на доработку",
  "review.commented": "Комментарий к результату",
  "review.second_opinion": "Запрошено второе мнение",
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
  "task.explained": "Запрошено объяснение",
};

export const LEDGER_TYPE_LABELS = translated(LEDGER_TYPE_LABELS_BASE);
