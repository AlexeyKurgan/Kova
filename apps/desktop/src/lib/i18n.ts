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
  "Английский: бета — основные экраны":
    "English beta: navigation, overview, tasks, assets, review and settings. Other tools remain in Russian.",
  "Русский": "Russian",
  "English (beta)": "English (beta)",
  Доступность: "Accessibility",
  "Меньше движения и резких анимаций": "Less motion and fewer abrupt animations",
  "Уменьшить анимации": "Reduce animations",
  "Сбросить настройки": "Reset settings",

  // Shared labels
  "Без движка": "No engine",
  Черновик: "Draft",
  Готова: "Ready",
  "В работе": "Working",
  Проверка: "Checking",
  Готово: "Done",
  Блок: "Blocked",
  Архив: "Archive",
  Модель: "Model",
  Анимация: "Animation",
  Эффект: "Effect",
  Текстура: "Texture",
  Код: "Code",
  Уровень: "Level",
  Экспорт: "Export",
  Аудио: "Audio",
  Видео: "Video",
  Сцена: "Scene",
  Другое: "Other",
  Принято: "Accepted",
  "Ждёт приёмки": "Pending review",
  Доработка: "Rework",
  "Задача создана": "Task created",
  "Статус задачи изменён": "Task status changed",
  "Задача удалена": "Task deleted",
  "Задача восстановлена": "Task restored",
  "Задача удалена навсегда": "Task permanently deleted",
  "Проект создан": "Project created",
  "Капсула подготовлена": "Capsule prepared",
  "Ответ AI импортирован": "AI response imported",
  "Результат принят": "Result accepted",
  "Отправлено на доработку": "Sent for rework",
  "Комментарий к результату": "Result comment",
  "Запрошено второе мнение": "Second opinion requested",
  "Снапшот создан": "Snapshot created",
  "Откат к снапшоту": "Snapshot restored",
  "Ассет импортирован": "Asset imported",
  "Ассеты проверены": "Assets checked",
  "Ассет проверен в Blender": "Asset checked in Blender",
  "Версия ассета изменена": "Asset version changed",
  "Ассет привязан к задаче": "Asset linked to task",
  "Ассет отвязан от задачи": "Asset unlinked from task",
  "Blender подключён": "Blender connected",
  "Папка Blender создана": "Blender folder created",
  "Модель создана": "Model created",
  "Скрипт модели запущен": "Model script started",
  "Рендер модели": "Model render",
  "QA модели": "Model QA",
  "Модель собрана": "Model built",
  "Снимок Blender": "Blender screenshot",
  "AI-запуск начат": "AI run started",
  "AI завершил задачу": "AI finished the task",
  "AI завершился с ошибкой": "AI failed",
  "Запуск агента прерван": "Agent run interrupted",
  "Передача работы агенту": "Handoff to agent",
  "Проверка задачи": "Task validation",
  "Проверка добавлена": "Validation added",
  "Проверка удалена": "Validation removed",
  "Запрошено объяснение": "Explanation requested",

  // Overview
  Проект: "Project",
  "папка не выбрана": "no folder selected",
  "Новая задача": "New task",
  "Импорт…": "Importing…",
  "Импорт ассета": "Import asset",
  "Продолжить работу": "Continue work",
  "Все задачи": "All tasks",
  "Цель пока не задана": "No goal yet",
  "Критерии {done}/{total}": "Criteria {done}/{total}",
  "Открыть задачу": "Open task",
  "Активных задач нет": "No active tasks",
  "Создай новую или открой готовые в разделе «Задачи».":
    "Create a new one or browse completed tasks.",
  "Все проекты": "All projects",
  Открыт: "Open",
  "Все результаты": "All results",
  "Нет результатов для проверки": "Nothing to review",
  "Когда агент закончит задачу, результат появится здесь.":
    "Results appear here when an agent finishes a task.",
  "К задачам": "Go to tasks",
  "Результат AI": "AI result",
  "Быстрый доступ": "Quick access",
  "Открыть код проекта": "Open project code",
  "Сцена и рендеры": "Scene and renders",
  "Подключить сцену": "Connect scene",
  "в библиотеке": "in library",
  "Последняя активность": "Recent activity",
  "Все события": "All events",
  "Пока нет событий.": "No events yet.",

  // Tasks
  Активные: "Active",
  Готовые: "Done",
  Корзина: "Trash",
  "Поиск задач…": "Search tasks…",
  "Поиск задач": "Search tasks",
  "Статус задач": "Task status",
  "Тип задачи": "Task type",
  Сортировка: "Sort",
  Списком: "List",
  Плиткой: "Grid",
  "Все типы": "All types",
  Последние: "Recent",
  "По названию": "By name",
  "По прогрессу": "By progress",
  "Корзина пуста": "Trash is empty",
  "Пока нет задач": "No tasks yet",
  "Здесь пусто": "Nothing here",
  "Удалённые задачи появятся здесь — их можно восстановить.":
    "Deleted tasks appear here and can be restored.",
  "Нажми «Новая задача» в правом верхнем углу.":
    "Use “New task” in the top-right corner.",
  "Смени фильтры или сбрось поиск.": "Change filters or clear the search.",
  "В корзине": "In trash",
  Задача: "Task",
  Статус: "Status",
  Тип: "Type",
  Обновлена: "Updated",
  Критерии: "Criteria",
  "Удалить навсегда": "Delete forever",
  Открыть: "Open",
  "Вернуть из архива": "Restore from archive",
  "В архив": "Archive",
  "В корзину": "Move to trash",
  Восстановить: "Restore",
  "Действия с задачей": "Task actions",
  Шаблоны: "Templates",
  "Цель, критерии готовности и связанные ассеты.":
    "Goal, acceptance criteria and linked assets.",
  "Удалить задачу?": "Delete task?",
  "Задача «{title}» переместится в корзину.": "“{title}” will move to trash.",
  "Задачу можно восстановить из корзины.": "The task can be restored from trash.",
  "Ассеты и файлы проекта не удаляются.": "Assets and project files are not deleted.",
  "Удалить задачу навсегда?": "Delete task forever?",
  "Задача «{title}» и её файлы будут удалены.": "“{title}” and its files will be deleted.",
  "Это действие нельзя отменить.": "This cannot be undone.",
  "Корзина не сохранит копию.": "Trash will not keep a copy.",

  "Показано {from}–{to} из {count}": "Showing {from}–{to} of {count}",
  Назад: "Back",
  Вперёд: "Next",
  Закрыть: "Close",
  "Библиотека задач": "Task library",
  "Готовые брифы с целью и критериями готовности. Выбери шаблон — Kova откроет задачу с заполненными полями.":
    "Ready-made briefs with a goal and acceptance criteria. Pick a template and Kova opens a prefilled task.",
  "Использовать": "Use template",
  "из пакета": "from package",

  // Assets
  "Библиотека ассетов": "Asset library",
  "Модели, текстуры, анимации и другие ресурсы проекта. Ассет принадлежит проекту, а задачи используют его по необходимости.":
    "Models, textures, animations and other project resources. An asset belongs to the project and tasks use it when needed.",
  "Импортировать ассет": "Import asset",
  "Поиск ассетов…": "Search assets…",
  "Поиск ассетов": "Search assets",
  "Тип ассета": "Asset type",
  Движок: "Engine",
  "Все движки": "All engines",
  "Статус ассета": "Asset status",
  "Все статусы": "All statuses",
  "Сетка": "Grid",
  "Список": "List",
  "Библиотека пока пуста": "Asset library is empty",
  "Ничего не найдено": "Nothing found",
  "Импортируй первый ассет — Kova сохранит версии, проверки и происхождение.":
    "Import your first asset — Kova keeps versions, checks and provenance.",
  "Попробуй другой запрос или сбрось фильтры.":
    "Try another query or reset the filters.",
  Ассет: "Asset",
  Размер: "Size",
  Обновлён: "Updated",
  "По имени": "By name",
  "По размеру": "By size",
  "Открыть ассет": "Open asset",
  "Удалить ассет": "Delete asset",
  свободен: "unassigned",

  // Review
  "Применить изменения?": "Apply changes?",
  "Файлы из worktree будут перенесены в проект.":
    "Files from the worktree will be moved into the project.",
  "Перед переносом Kova создаст снапшот проекта.":
    "Kova creates a project snapshot before applying.",
  "Файлы, не относящиеся к запуску, не затрагиваются.":
    "Files unrelated to the run are untouched.",
  Применить: "Apply",
  "Не удалось применить worktree": "Could not apply the worktree",
  "Не удалось загрузить ответ": "Could not load the response",
  "Не удалось подготовить второе мнение": "Could not prepare a second opinion",
  "Бинарный файл: текстовый патч недоступен.":
    "Binary file: text patch is unavailable.",
  "Патч недоступен.": "Patch unavailable.",
  "Не удалось загрузить патч.": "Could not load the patch.",
  "Принять с ошибками?": "Accept with failures?",
  "Проверки не пройдены. Результат всё равно будет принят.":
    "Some checks failed. The result will be accepted anyway.",
  "Полный список смотри во вкладке проверок.":
    "See the checks tab for the full list.",
  "Принять всё равно": "Accept anyway",
  "Принять без проверок?": "Accept without checks?",
  "Проверки ещё не запускались.": "Checks have not run yet.",
  "Принять без проверок": "Accept without checks",
  "Архив пуст": "Archive is empty",
  "Очередь пуста": "Queue is empty",
  "Принятые и заархивированные результаты появятся здесь.":
    "Accepted and archived results will appear here.",
  "Когда импортируешь ответ AI в задаче, он появится здесь для приёмки.":
    "Import an AI response in a task and it will appear here for review.",
  "Пройдено": "Passed",
  Ошибка: "Failed",
  Скрыть: "Hide",
  Детали: "Details",
  "Отдельная копия": "Separate copy",
  "Перенос…": "Applying…",
  "Применить в проект": "Apply to project",
  Все: "All",
  "файл…": "file…",
  "Показать патч": "Show patch",
  "Загрузка патча…": "Loading patch…",
  Ответ: "Response",
  "Готовлю…": "Preparing…",
  "Второе мнение": "Second opinion",
  Принять: "Accept",
  "Пины и версии": "Pins and versions",
  "Версия для просмотра": "Version to view",
  Сравнить: "Compare",
  "Обычный вид": "Normal view",
  "Позиция сравнения": "Comparison position",
  Было: "Before",
  Стало: "After",
  "Оставить пин": "Add pin",
  "Отменить пин": "Cancel pin",
  "Пин на {version}": "Pin on {version}",
  "Пин на {time}": "Pin at {time}",
  "Перейти к пину {index}": "Go to pin {index}",
  "Перейти к пину на кадре {frame}": "Go to pin on frame {frame}",
  "Пин на кадре {frame}": "Pin on frame {frame}",
  "Кликни по кадру, чтобы привязать пин ко времени":
    "Click the frame to pin a comment to a time",
  "Кликни по изображению, чтобы привязать пин к кадру":
    "Click the image to pin a comment to a frame",
  "Кликни по изображению, чтобы поставить пин":
    "Click the image to place a pin",
  "Таймлайн видео": "Video timeline",
  "Кадр анимации": "Animation frame",
  "Кадр {frame}": "Frame {frame}",
  "кадр {frame}": "frame {frame}",
  "Кадр {frame} из {end}": "Frame {frame} of {end}",
  "{count} превью": "{count} previews",
  "Убрать пин": "Remove pin",
  "Что поправить в этом месте?": "What should be fixed here?",
  "Ctrl+Enter — отправить": "Ctrl+Enter to send",
  "Сохраняю…": "Saving…",
  "Добавить пин": "Add pin",
  "Комментарии к ассету": "Asset comments",
  "Скрыть решённые": "Hide resolved",
  "Показать решённые": "Show resolved",
  "Комментариев пока нет. Включи «Оставить пин» и кликни по проблемному месту.":
    "No comments yet. Turn on “Add pin” and click the problem area.",
  "Вернуть в работу": "Reopen",
  Решено: "Resolved",
  "Удалить пин": "Delete pin",
  "Напиши комментарий к пину.": "Write a comment for the pin.",
  "Не удалось сохранить пин": "Could not save the pin",
  "нарушение": "issue",
  "нарушения": "issues",
  "нарушений": "issues",
  "ошибка": "error",
  "ошибки": "errors",
  "ошибок": "errors",
  "Перенесено файлов: {added}, удалено: {deleted}":
    "Files applied: {added}, deleted: {deleted}",
  "Файлы не изменились": "Files did not change",
  "Нет файлов по фильтру": "No files match the filter",
  "Очередь приёмки: AI не пишет в проект без твоего подтверждения.":
    "Review queue: AI never writes to the project without your approval.",
  "Загружаю архив…": "Loading archive…",
  "Показано {shown} из {total} ассетов": "Showing {shown} of {total} assets",

  // Confirmations and notifications
  "Kova: есть результат": "Kova: result ready",
  "Агент закончил — проверь Review.": "An agent finished — check Review.",
  "Новых результатов: {count}. Проверь Review.":
    "New results: {count}. Check Review.",
  "Откатить проект?": "Restore project?",
  "Файлы проекта вернутся к выбранному снапшоту.":
    "Project files will return to the selected snapshot.",
  "Текущее состояние сначала сохранится отдельным снапшотом.":
    "The current state is saved as a separate snapshot first.",
  "Незакоммиченные изменения вне проекта не затрагиваются.":
    "Uncommitted changes outside the project are untouched.",
  Откатить: "Restore",
  "Удалить ассет?": "Delete asset?",
  "Ассет «{name}» будет удалён из библиотеки.":
    "“{name}” will be removed from the asset library.",
  "Будут удалены паспорт, превью и проверки.":
    "The passport, previews and checks will be deleted.",
  "Скопированные файлы удалятся, если их не использует другой ассет.":
    "Copied files are deleted unless another asset uses them.",
  "Связи с задачами будут сняты.": "Links to tasks will be removed.",
  Удалить: "Delete",

  // Inspector
  "Состояние проекта": "Project status",
  "Скрыть панель": "Hide panel",
  Подключения: "Connections",
  "Не проверен": "Not checked",
  "Подключён": "Connected",
  "Не найден": "Not found",
  "Не запущен": "Not running",
  "Нужен аддон": "Addon required",
  "Нажми, чтобы подключить": "Click to connect",
  "Плагин не запущен": "Plugin not running",
  "Не настроен": "Not configured",
  "Roblox Studio подключён": "Roblox Studio connected",
  "Настроить Roblox Studio": "Set up Roblox Studio",
  "Проверка Git": "Git check",
  "В порядке": "OK",
  "Требует внимания": "Needs attention",
  "Всё в порядке": "All good",
  "Проблемные ассеты": "Problem assets",
  "Заблокированные задачи": "Blocked tasks",
  "Проверки Doctor": "Doctor checks",
  "Память проекта": "Project memory",
  "Последний: {date}": "Latest: {date}",
  "Пока нет снапшотов": "No snapshots yet",
  Совет: "Tip",

  "Подключи Blender": "Connect Blender",
  "Kova сможет собирать модели, запускать QA и делать превью прямо из задачи.":
    "Kova can build models, run QA and render previews right from a task.",
  "Открыть Blender": "Open Blender",
  "Есть что проверить": "There is something to review",
  "Результаты AI ждут приёмки. Прими удачные и отправь слабые на доработку.":
    "AI results are waiting for review. Accept good ones and send weak ones back.",
  "Открыть Review": "Open Review",
  "Добавь первый ассет": "Add your first asset",
  "Импортируй модель или текстуру — Kova сохранит паспорт, версию и проверки.":
    "Import a model or texture — Kova keeps a passport, version and checks.",
  Импортировать: "Import",
  "Задач нет": "No tasks",
  "Открой раздел «Задачи» и создай первую — Kova соберёт капсулу и выбранные скиллы.":
    "Open Tasks and create one — Kova will build a capsule and selected skills.",
  "Открыть задачи": "Open tasks",
  "Проект в порядке": "Project looks healthy",
  "Можно продолжать работу или проверить окружение через Doctor.":
    "You can keep working or check the environment in Doctor.",
  "Открыть Doctor": "Open Doctor",

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


export function tp(
  count: number,
  ru: [string, string, string],
  enOne: string,
  enMany: string,
): string {
  if (language === "en") return count === 1 ? enOne : enMany;
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return ru[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return ru[1];
  return ru[2];
}
