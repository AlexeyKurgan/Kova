export type EditorExtension = {
  id: string;
  name: string;
  description: string;
  publisher: string;
  category: string;
  badge: string;
  color: string;
};

export const EXTENSION_CATEGORIES = [
  { id: "all", label: "Все" },
  { id: "common", label: "Базовые" },
  { id: "roblox", label: "Roblox" },
  { id: "unity", label: "Unity" },
  { id: "godot", label: "Godot" },
  { id: "blender", label: "Blender" },
  { id: "unreal", label: "Unreal" },
  { id: "web", label: "Web / Apps" },
  { id: "rust", label: "Rust" },
  { id: "go", label: "Go" },
] as const;

export const EDITOR_EXTENSIONS: EditorExtension[] = [
  {
    id: "johnnymorganz.luau-lsp",
    name: "Luau Language Server",
    description: "Типы, автодополнение и диагностика для Luau и Roblox API.",
    publisher: "JohnnyMorganz",
    category: "roblox",
    badge: "Lu",
    color: "#6aa9ff",
  },
  {
    id: "evaera.vscode-rojo",
    name: "Rojo",
    description: "Синхронизация файлов проекта с Roblox Studio.",
    publisher: "evaera",
    category: "roblox",
    badge: "Rj",
    color: "#e26d6d",
  },
  {
    id: "johnnymorganz.stylua",
    name: "StyLua",
    description: "Форматирование Luau-кода по единому стилю.",
    publisher: "JohnnyMorganz",
    category: "roblox",
    badge: "St",
    color: "#5cc8a1",
  },
  {
    id: "kevingamer3d2.selene-vscode",
    name: "Selene",
    description: "Быстрый линтер Luau с правилами проекта.",
    publisher: "kevingamer3d2",
    category: "roblox",
    badge: "Se",
    color: "#e5a45a",
  },
  {
    id: "muhammad-sammy.csharp",
    name: "C#",
    description: "IntelliSense, навигация и отладка для C# и Unity.",
    publisher: "Muhammad Sammy",
    category: "unity",
    badge: "C#",
    color: "#9b7bd8",
  },
  {
    id: "zlorn.vstuc",
    name: "Unity",
    description: "Интеграция редактора с Unity: ассеты и отладка.",
    publisher: "Zlorn",
    category: "unity",
    badge: "Un",
    color: "#6aa9ff",
  },
  {
    id: "geequlim.godot-tools",
    name: "godot-tools",
    description: "GDScript, сцены и отладка проектов Godot.",
    publisher: "geequlim",
    category: "godot",
    badge: "Gd",
    color: "#6aa9ff",
  },
  {
    id: "ms-python.python",
    name: "Python",
    description: "IntelliSense, отладка и окружения Python.",
    publisher: "Microsoft",
    category: "blender",
    badge: "Py",
    color: "#e5a45a",
  },
  {
    id: "jbq.dcc-python-toolkit",
    name: "DCC Python ToolKit",
    description: "Помощь с Python для Blender, Maya и других DCC.",
    publisher: "JBQ",
    category: "blender",
    badge: "DC",
    color: "#e0a94f",
  },
  {
    id: "llvm-vs-code-extensions.vscode-clangd",
    name: "clangd",
    description: "C/C++ IntelliSense и навигация для Unreal.",
    publisher: "LLVM",
    category: "unreal",
    badge: "C+",
    color: "#6aa9ff",
  },
  {
    id: "esbenp.prettier-vscode",
    name: "Prettier",
    description: "Автоформатирование JS, TS, CSS и JSON.",
    publisher: "Prettier",
    category: "web",
    badge: "Pr",
    color: "#e5a45a",
  },
  {
    id: "dbaeumer.vscode-eslint",
    name: "ESLint",
    description: "Проверка JS/TS по правилам проекта.",
    publisher: "Microsoft",
    category: "web",
    badge: "ES",
    color: "#9b7bd8",
  },
  {
    id: "bradlc.vscode-tailwindcss",
    name: "Tailwind CSS IntelliSense",
    description: "Классы Tailwind с автодополнением и превью.",
    publisher: "Tailwind Labs",
    category: "web",
    badge: "Tw",
    color: "#5cc8a1",
  },
  {
    id: "rust-lang.rust-analyzer",
    name: "rust-analyzer",
    description: "Языковой сервер Rust: типы, рефакторинг, тесты.",
    publisher: "rust-lang",
    category: "rust",
    badge: "Rs",
    color: "#e5a45a",
  },
  {
    id: "golang.go",
    name: "Go",
    description: "Поддержка Go, отладка и запуск тестов.",
    publisher: "Go Team",
    category: "go",
    badge: "Go",
    color: "#6aa9ff",
  },
  {
    id: "editorconfig.editorconfig",
    name: "EditorConfig",
    description: "Единый стиль отступов и переводов строк.",
    publisher: "EditorConfig",
    category: "common",
    badge: "EC",
    color: "#6b7c93",
  },
  {
    id: "usernamehw.errorlens",
    name: "Error Lens",
    description: "Ошибки и предупреждения прямо в строках кода.",
    publisher: "Alexander",
    category: "common",
    badge: "EL",
    color: "#e26d6d",
  },
  {
    id: "streetsidesoftware.code-spell-checker",
    name: "Code Spell Checker",
    description: "Проверка орфографии в коде и комментариях.",
    publisher: "Street Side Software",
    category: "common",
    badge: "CS",
    color: "#5cc8a1",
  },
  {
    id: "christian-kohler.path-intellisense",
    name: "Path Intellisense",
    description: "Автодополнение путей к файлам проекта.",
    publisher: "Christian Kohler",
    category: "common",
    badge: "PI",
    color: "#6aa9ff",
  },
  {
    id: "eamodio.gitlens",
    name: "GitLens",
    description: "История, авторство и сравнение Git в редакторе.",
    publisher: "GitKraken",
    category: "common",
    badge: "GL",
    color: "#e0a94f",
  },
];

export type EditorPack = {
  id: string;
  label: string;
  extensions: EditorExtension[];
};

export const EXTENSION_PACKS: EditorPack[] = EXTENSION_CATEGORIES.filter(
  (category) => category.id !== "all",
)
  .map((category) => ({
    id: category.id,
    label: category.label,
    extensions: EDITOR_EXTENSIONS.filter(
      (extension) => extension.category === category.id,
    ),
  }))
  .filter((pack) => pack.extensions.length > 0);
