import type { Engine, TaskType } from "./types";

export type TaskTemplate = {
  id: string;
  label: string;
  title: string;
  type: TaskType;
  engine: Engine;
  goal: string;
  criteria: string[];
};

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "roblox-prop",
    label: "Модель для Roblox",
    title: "Модель для Roblox",
    type: "model",
    engine: "roblox",
    goal: "Создать low-poly модель для Roblox с чистым силуэтом и игровым масштабом.",
    criteria: ["≤ 20 000 треугольников", "UV и один материал", "Пивот в игровой точке", "Экспорт FBX/GLB"],
  },
  {
    id: "sword",
    label: "Меч",
    type: "model",
    engine: "roblox",
    title: "Стилизованный меч",
    goal: "Сделать стилизованный меч для Roblox: клинок, гарда, рукоять и навершие.",
    criteria: ["≤ 5 000 треугольников", "Один материал или атлас", "Пивот у рукояти", "Готов к импорту в Studio"],
  },
  {
    id: "animation-hit",
    label: "Анимация удара",
    title: "Анимация удара",
    type: "animation",
    engine: "roblox",
    goal: "Создать игровую анимацию удара с читаемым замахом и возвратом в стойку.",
    criteria: ["Длительность 0.6–1.2 с", "Loop/return pose", "Root motion проверен", "Экспорт в движок"],
  },
  {
    id: "uv-fix",
    label: "UV fix",
    title: "Исправить UV",
    type: "texture",
    engine: "blender",
    goal: "Исправить UV-развёртку и перекрытия, сохранить текстуры.",
    criteria: ["Нет UV вне 0..1", "Нет пересечений островов", "Текстура не растянута", "QA пройден"],
  },
  {
    id: "lod",
    label: "LOD",
    title: "Сделать LOD",
    type: "model",
    engine: "blender",
    goal: "Подготовить LOD-цепочку для игрового ассета.",
    criteria: ["LOD0/LOD1/LOD2", "Силуэт сохраняется", "Бюджеты треугольников", "Экспорт проверен"],
  },
  {
    id: "vfx",
    label: "VFX",
    title: "Эффект для игры",
    type: "effect",
    engine: "roblox",
    goal: "Создать читаемый игровой эффект с бюджетом частиц.",
    criteria: ["Бюджет частиц", "Длительность и loop", "Цвет и слои", "Playtest без ошибок"],
  },
  {
    id: "roblox-export",
    label: "Экспорт в Roblox",
    title: "Экспорт ассета в Roblox",
    type: "export",
    engine: "roblox",
    goal: "Подготовить принятый ассет к импорту в Roblox Studio.",
    criteria: ["Масштаб и оси", "Материалы/текстуры", "FBX/GLB", "Импорт и Asset ID"],
  },
  {
    id: "code-feature",
    label: "Кодовая фича",
    title: "Новая кодовая фича",
    type: "code",
    engine: "generic",
    goal: "Реализовать небольшую фичу с тестами и без регрессий.",
    criteria: ["Код собирается", "Тесты проходят", "Нет лишних файлов", "Есть отчёт"],
  },
];


export type { TaskTemplate as Template };
