export type Language = "ru" | "en";

let language: Language = "ru";

const EN: Record<string, string> = {
  // Navigation
  "Рабочее пространство": "Workspace",
  Создание: "Create",
  Контроль: "Review",
  Инструменты: "Tools",
  Обзор: "Overview",
  Проекты: "Projects",
  Задачи: "Tasks",
  Чат: "Chat",
  Ассеты: "Assets",
  Скиллы: "Skills",
  Пакеты: "Packages",
  Review: "Review",
  Снапшоты: "Snapshots",
  Память: "Memory",
  Дневник: "Diary",
  Агенты: "Agents",
  "Ночная смена": "Night Shift",
  Doctor: "Doctor",
  Редактор: "Editor",
  "Развернуть панель": "Expand sidebar",
  "Свернуть панель": "Collapse sidebar",
  Свернуть: "Collapse",
  Развернуть: "Expand",

  // Top bar
  проверка: "checking",
  "в порядке": "online",
  "не запущен": "offline",
  "Поиск по проекту": "Search project",
  "Инструменты проверяются": "Checking tools",
  "Инструменты: {count}": "Tools: {count}",
  "Инструменты в порядке": "Tools OK",
  Уведомления: "Notifications",
  "Уведомления: {count}": "Notifications: {count}",
  "Светлая тема": "Light theme",
  "Тёмная тема": "Dark theme",
  Настройки: "Settings",
  "Показать состояние проекта": "Show project status",

  // Settings
  "Внешний вид, язык и поведение. Настройки проекта — в «Агентах».":
    "Appearance, language and behavior. Project settings live in Agents.",
  Обучение: "Tutorial",
  "Размер, ширина и поведение сообщений": "Message size, width and behavior",
  "Размер текста": "Text size",
  "Основной текст сообщений": "Message body text",
  "Межстрочный интервал": "Line height",
  "Больше — воздушнее и легче читать": "More space is easier to read",
  "Ширина сообщений": "Message width",
  "Насколько широко растягивать ответы": "How wide responses can stretch",
  Узкая: "Narrow",
  Обычная: "Normal",
  Широкая: "Wide",
  "Размер кода": "Code size",
  "Блоки кода и команды": "Code blocks and commands",
  "Enter отправляет сообщение": "Enter sends the message",
  "Показывать время сообщений": "Show message timestamps",
  "Важно:": "Preview:",
  "так будет выглядеть текст ответа.": "this is how a response will look.",
  "Таблицы, списки и предупреждения используют те же настройки.":
    "Tables, lists and warnings use the same settings.",
  "Режим работы": "Work mode",
  "Сколько подсказок и технических деталей показывать":
    "How many hints and technical details to show",
  "Спокойный интерфейс: главное на виду, технические детали скрыты.":
    "Calm interface: the essentials stay visible, technical details are hidden.",
  "Плотнее, больше метрик, путей и диагностики на экране.":
    "Denser layout with more metrics, paths and diagnostics.",
  Включён: "Active",
  Плотность: "Density",
  "Comfortable или компактный Pro-режим": "Comfortable or compact Pro mode",
  "Резервные копии": "Backups",
  "Снапшоты проекта и быстрый откат": "Project snapshots and quick restore",
  снапшотов: "snapshots",
  "Последний · {reason} · {date}": "Latest · {reason} · {date}",
  "без описания": "no description",
  "Резервных копий ещё нет": "No backups yet",
  "Создать снапшот": "Create snapshot",
  "Открыть снапшоты": "Open snapshots",
  "Снапшот создаётся перед применением изменений worktree":
    "A snapshot is created before applying worktree changes",
  "Все копии хранятся локально в папке проекта.":
    "All copies are stored locally in the project folder.",
  Язык: "Language",
  "Язык интерфейса": "Interface language",
  Интерфейс: "Interface",
  "Английский: бета — навигация, верхняя панель и настройки":
    "English beta: navigation, top bar and settings. Other screens remain in Russian.",
  "Русский": "Russian",
  "English (beta)": "English (beta)",
  Доступность: "Accessibility",
  "Меньше движения и резких анимаций": "Less motion and fewer abrupt animations",
  "Уменьшить анимации": "Reduce animations",
  "Сбросить настройки": "Reset settings",

  // Sandbox card
  Песочница: "Sandbox",
  "OS sandbox или безопасный fallback для агентов":
    "OS sandbox or a safe fallback for agents",
  "Проверить снова": "Check again",
  доступен: "available",
  "Проверяю sandbox…": "Checking sandbox…",
  "Не удалось проверить sandbox": "Could not check the sandbox",
  Fallback: "Fallback",
  "Kova не запускает CLI провайдера внутри Docker/WSL: бинарник и авторизация должны быть установлены в контейнере. Это ограничение указано явно, а не маскируется под готовую изоляцию.":
    "Kova does not run a provider CLI inside Docker/WSL: the binary and authorization must be installed in the container. This limitation is stated explicitly instead of being disguised as ready isolation.",
};

export function setLanguage(value: Language): void {
  language = value === "en" ? "en" : "ru";
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
  }
}

export function getLanguage(): Language {
  return language;
}

export function t(
  text: string,
  values?: Record<string, string | number>,
): string {
  const template = language === "en" ? EN[text] ?? text : text;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match,
  );
}
