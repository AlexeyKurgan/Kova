import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Filter,
  FolderOpen,
  History,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import ProviderIcon from "../../components/ProviderIcon";
import { useConfirm } from "../../components/ConfirmProvider";
import { providerBrand } from "../../lib/brands";
import {
  cleanupAgentHistory,
  discoverProviderModels,
  getProviderCatalog,
  getModelCatalog,
  getAgentRouting,
  getAgentUsage,
  getProject,
  saveAgentRouting,
  listRecentAiRuns,
  updateProject,
} from "../../lib/coreClient";
import { formatDate } from "../../lib/format";
import { RUN_DOT, RUN_LABELS } from "../../lib/runLabels";
import type {
  AgentRouting,
  AgentUsage,
  ProviderCatalogItem,
  AiRun,
  IsolationMode,
  ProjectResponse,
  ProviderInfo,
  ModelCatalogGroup,
} from "../../lib/types";

type Props = {
  providers: ProviderInfo[];
  onRefresh: () => void;
  onSave: (
    providerId: string,
    input: {
      name?: string;
      description?: string;
      command?: string;
      args?: string[];
      enabled?: boolean;
      timeout?: number;
      models?: string[];
      default_model?: string;
      default_effort?: string;
      read_only_args?: string[];
      resume_args?: string[];
      session_regex?: string;
      output_mode?: string;
      kind?: "cli" | "api";
      api_url?: string;
      api_model?: string;
      api_key?: string;
      delete_key?: boolean;
      set_default?: boolean;
    },
  ) => Promise<void>;
  onCreate: (input: {
    name: string;
    command: string;
    args?: string[];
    description?: string;
    timeout?: number;
    models?: string[];
    default_model?: string;
    default_effort?: string;
    read_only_args?: string[];
    resume_args?: string[];
    session_regex?: string;
    output_mode?: string;
    kind?: "cli" | "api";
    api_url?: string;
    api_model?: string;
    api_key?: string;
    delete_key?: boolean;
    set_default?: boolean;
  }) => Promise<void>;
  onCheck: (providerId: string) => Promise<void>;
  onSetDefault: (providerId: string) => Promise<void>;
  onDelete: (providerId: string) => Promise<void>;
  onOpenTask: (taskId: string) => void;
};

type Dialog =
  | { kind: "edit"; provider: ProviderInfo }
  | { kind: "create" }
  | null;

function parseArgs(text: string) {
  const matches = text.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((item) => item.replace(/^"|"$/g, ""));
}

function providerState(provider: ProviderInfo) {
  if (!provider.installed) return { label: "не найден", dot: "is-off" };
  if (!provider.enabled) return { label: "выключен", dot: "is-warn" };
  return { label: "готов", dot: "is-on" };
}

function modelProvider(model: string) {
  const index = model.indexOf("/");
  return index > 0 ? model.slice(0, index) : "other";
}

function providerLabel(id: string) {
  const known: Record<string, string> = {
    google: "Google",
    "opencode-go": "OpenCode Go",
    openai: "OpenAI",
    anthropic: "Anthropic",
    deepseek: "DeepSeek",
    xai: "xAI",
    zai: "Z.AI",
    openrouter: "OpenRouter",
    meta: "Meta",
    "opencode": "OpenCode",
  };
  if (known[id]) return known[id];
  return id
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function modelLabel(model: string) {
  const name = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (part.length <= 2 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function isFreeModel(model: string) {
  return /(^|[-_/])free([-_/]|$)/i.test(model);
}

function commandLine(provider: ProviderInfo) {
  if (provider.kind === "api") return provider.api_url || "API не настроен";
  return [provider.command, ...provider.args].filter(Boolean).join(" ");
}

function capabilitySummary(provider: ProviderInfo) {
  const capabilities = provider.capabilities;
  if (!capabilities?.checked) return "";
  const flags = [
    capabilities.supports_model ? "model" : "",
    capabilities.supports_resume ? "resume" : "",
    capabilities.supports_json ? "json" : "",
    capabilities.supports_permissions ? "permissions" : "",
  ].filter(Boolean);
  return flags.length > 0 ? flags.join(" · ") : "флаги не найдены";
}

export default function AgentsScreen({
  providers,
  onRefresh,
  onSave,
  onCreate,
  onCheck,
  onSetDefault,
  onDelete,
  onOpenTask,
}: Props) {
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [description, setDescription] = useState("");
  const [models, setModels] = useState("");
  const [readOnlyArgs, setReadOnlyArgs] = useState("");
  const [resumeArgs, setResumeArgs] = useState("");
  const [sessionRegex, setSessionRegex] = useState("");
  const [outputMode, setOutputMode] = useState("auto");
  const [kind, setKind] = useState<"cli" | "api">("cli");
  const [apiUrl, setApiUrl] = useState("");
  const [apiModel, setApiModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [deleteKey, setDeleteKey] = useState(false);
  const [timeout, setTimeoutValue] = useState(1800);
  const [enabled, setEnabled] = useState(true);
  const [setDefault, setSetDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<AiRun[]>([]);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [historyNote, setHistoryNote] = useState("");
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [slotsBusy, setSlotsBusy] = useState(false);
  const [slotsNote, setSlotsNote] = useState("");
  const [quickNote, setQuickNote] = useState("");
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  const [budgetDraft, setBudgetDraft] = useState(0);
  const [routing, setRouting] = useState<AgentRouting>({ rules: [], roles: [] });
  const [routingBusy, setRoutingBusy] = useState(false);
  const [routingNote, setRoutingNote] = useState("");
  const [ruleTag, setRuleTag] = useState("");
  const [ruleProvider, setRuleProvider] = useState("");
  const [roleName, setRoleName] = useState("");
  const [rolePrompt, setRolePrompt] = useState("");
  const [roleProvider, setRoleProvider] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState<"info" | "models" | "advanced">("info");
  const [addOpen, setAddOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogGroup[]>([]);
  const [modelDraft, setModelDraft] = useState("");
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelNote, setModelNote] = useState("");
  const [catalog, setCatalog] = useState<ProviderCatalogItem[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogNote, setCatalogNote] = useState("");
  const [apiStyle, setApiStyle] = useState<"openai" | "anthropic" | "google" | "azure" | "vertex" | "bedrock">("openai");
  const [catalogId, setCatalogId] = useState("");
  const [gcpProject, setGcpProject] = useState("");
  const [gcpRegion, setGcpRegion] = useState("us-central1");
  const [awsRegion, setAwsRegion] = useState("us-east-1");
  const autoModels = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!addOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".ag-add")) return;
      setAddOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [addOpen]);
  const [providerQuery, setProviderQuery] = useState("");
  const [onlyReady, setOnlyReady] = useState(false);
  const [runsLimit, setRunsLimit] = useState(8);

  useEffect(() => {
    if (!dialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setDialog(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, busy]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getProject(),
      getAgentUsage().catch(() => null),
      getAgentRouting().catch(() => null),
      getProviderCatalog().catch(() => null),
    ])
      .then(([data, summary, routingData, catalogData]) => {
        if (!alive) return;
        setProject(data);
        setUsage(summary);
        setBudgetDraft(data?.project.token_budget ?? 0);
        if (routingData) setRouting(routingData);
        if (catalogData) setCatalog(catalogData.providers);
      })
      .catch(() => {
        if (alive) setProject(null);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const saveIsolation = async (value: IsolationMode) => {
    setSlotsBusy(true);
    setSlotsNote("");
    try {
      const data = await updateProject({ isolation: value });
      setProject(data);
      setSlotsNote("Сохранено. Действует для новых запусков.");
    } catch (err) {
      setSlotsNote(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSlotsBusy(false);
    }
  };

  const applySafeDefaults = async () => {
    if (!project) return;
    setSlotsBusy(true);
    setQuickNote("");
    try {
      const data = await updateProject({
        isolation: project.git_repo ? "worktree" : "sandbox",
        max_parallel_runs: 1,
        token_budget: 0,
        local_only: false,
        egress_guard: true,
      });
      setProject(data);
      const installed = providers.filter((item) => item.installed && item.enabled);
      const hasDefault = installed.some((item) => item.default);
      if (!hasDefault && installed[0]) await onSetDefault(installed[0].id);
      setQuickNote(
        "Готово. Выбрана безопасная изоляция, 1 запуск, сетевой щит включён, лимит токенов без ограничения.",
      );
    } catch (err) {
      setQuickNote(err instanceof Error ? err.message : "Не удалось применить настройки");
    } finally {
      setSlotsBusy(false);
    }
  };

  const saveEgressGuard = async (value: boolean) => {
    setSlotsBusy(true);
    setSlotsNote("");
    try {
      const data = await updateProject({ egress_guard: value });
      setProject(data);
      setSlotsNote(
        value
          ? "Сетевой щит включён: CLI-агенты ходят только к доменам провайдера."
          : "Сетевой щит выключен: CLI-агенты могут обращаться в сеть напрямую.",
      );
    } catch (err) {
      setSlotsNote(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSlotsBusy(false);
    }
  };

  const saveLocalOnly = async (value: boolean) => {
    setSlotsBusy(true);
    setSlotsNote("");
    try {
      const data = await updateProject({ local_only: value });
      setProject(data);
      setSlotsNote(
        value
          ? "Локальный режим включён. Чаты и запуски через внешние провайдеры заблокированы."
          : "Локальный режим выключен. Внешние провайдеры снова доступны.",
      );
    } catch (err) {
      setSlotsNote(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSlotsBusy(false);
    }
  };

  const persistRouting = async (next: AgentRouting) => {
    setRoutingBusy(true);
    setRoutingNote("");
    try {
      setRouting(await saveAgentRouting(next));
    } catch (err) {
      setRoutingNote(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setRoutingBusy(false);
    }
  };

  const addRule = async () => {
    if (!ruleTag.trim() || !ruleProvider) return;
    await persistRouting({
      ...routing,
      rules: [...routing.rules, { id: "", tag: ruleTag.trim(), provider_id: ruleProvider }],
    });
    setRuleTag("");
  };

  const addRole = async () => {
    if (!roleName.trim()) return;
    await persistRouting({
      ...routing,
      roles: [
        ...routing.roles,
        {
          id: "",
          name: roleName.trim(),
          prompt: rolePrompt.trim(),
          provider_id: roleProvider,
        },
      ],
    });
    setRoleName("");
    setRolePrompt("");
  };

  const providerName = (providerId: string) =>
    providers.find((item) => item.id === providerId)?.name ?? providerId;

  const saveBudget = async () => {
    const value = Math.max(0, Math.min(100_000_000, Math.round(budgetDraft)));
    setSlotsBusy(true);
    setSlotsNote("");
    try {
      const data = await updateProject({ token_budget: value });
      setProject(data);
      setBudgetDraft(data.project.token_budget);
      setUsage(await getAgentUsage().catch(() => usage));
      setSlotsNote("Бюджет сохранён. Действует для новых запусков.");
    } catch (err) {
      setSlotsNote(err instanceof Error ? err.message : "Не удалось сохранить бюджет");
    } finally {
      setSlotsBusy(false);
    }
  };

  const saveSlots = async (value: number) => {
    setSlotsBusy(true);
    setSlotsNote("");
    try {
      const data = await updateProject({ max_parallel_runs: value });
      setProject(data);
      setSlotsNote("Сохранено. Действует для новых запусков.");
    } catch (err) {
      setSlotsNote(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSlotsBusy(false);
    }
  };

  useEffect(() => {
    let alive = true;
    const load = () => {
      listRecentAiRuns(runsLimit)
        .then((rows) => {
          if (!alive) return;
          setRuns(rows);
          setRunsError(null);
        })
        .catch(() => {
          if (!alive) return;
          setRunsError("История запусков недоступна");
        });
    };
    void load();
    const timer = window.setInterval(load, 10000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refreshKey, runsLimit]);

  const openEdit = (provider: ProviderInfo) => {
    setCatalogId(provider.catalog_id ?? "");
    setGcpProject(provider.gcp_project ?? "");
    setGcpRegion(provider.gcp_region || "us-central1");
    setAwsRegion(provider.aws_region || "us-east-1");
    setApiStyle((provider.api_style as "openai" | "anthropic" | "google" | "azure" | "vertex" | "bedrock") || "openai");
    setName(provider.name);
    setCommand(provider.command);
    setArgs(provider.args.join(" "));
    setDescription(provider.description);
    setModels(provider.models.join(", "));
    setReadOnlyArgs((provider.read_only_args ?? []).join(" "));
    setResumeArgs((provider.resume_args ?? []).join(" "));
    setSessionRegex(provider.session_regex ?? "");
    setOutputMode(provider.output_mode || "auto");
    setTimeoutValue(provider.timeout);
    setEnabled(provider.enabled);
    setSetDefault(provider.default);
    setError(null);
    setDialog({ kind: "edit", provider });
  };

  const openCreate = (mode: "cli" | "api" = "cli", preset?: ProviderCatalogItem) => {
    setCatalogId(preset?.id ?? "");
    setGcpProject("");
    setGcpRegion("us-central1");
    setAwsRegion("us-east-1");
    setApiStyle((preset?.style as "openai" | "anthropic" | "google" | "azure" | "vertex" | "bedrock") || "openai");
    setName(preset?.name ?? "");
    setCommand("");
    setArgs(mode === "cli" ? "{prompt}" : "");
    setKind(mode);
    setApiUrl(preset?.api_url ?? "");
    setApiModel("");
    setApiKey("");
    setDeleteKey(false);
    setDescription(preset?.description ?? "");
    setModels("");
    setReadOnlyArgs("");
    setResumeArgs("");
    setSessionRegex("");
    setOutputMode("auto");
    setTimeoutValue(1800);
    setEnabled(true);
    setSetDefault(false);
    setError(null);
    setDialog({ kind: "create" });
  };

  const submit = async () => {
    if (!dialog || busy || !name.trim() || !command.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = parseArgs(args);
      const shared = {
        name: name.trim(),
        description: description.trim(),
        timeout,
        kind,
        api_style: apiStyle,
        catalog_id: catalogId,
        gcp_project: gcpProject.trim(),
        gcp_region: gcpRegion.trim(),
        aws_region: awsRegion.trim(),
        api_url: apiUrl.trim(),
        api_model: apiModel.trim(),
        api_key: apiKey.trim(),
        delete_key: deleteKey,
        set_default: setDefault,
      };
      if (kind === "api") {
        if (dialog.kind === "edit") {
          await onSave(dialog.provider.id, { ...shared, command: "", args: [], models: [] });
        } else {
          await onCreate({ ...shared, command: "", args: [], models: [] });
        }
      } else if (dialog.kind === "edit") {
        await onSave(dialog.provider.id, {
          ...shared,
          command: command.trim(),
          args: parsed,
          enabled,
          models: models.split(",").map((item) => item.trim()).filter(Boolean),
          read_only_args: parseArgs(readOnlyArgs),
          resume_args: parseArgs(resumeArgs),
          session_regex: sessionRegex,
          output_mode: outputMode,
        });
      } else {
        await onCreate({
          ...shared,
          command: command.trim(),
          args: parsed,
          models: models.split(",").map((item) => item.trim()).filter(Boolean),
          read_only_args: parseArgs(readOnlyArgs),
          resume_args: parseArgs(resumeArgs),
          session_regex: sessionRegex,
          output_mode: outputMode,
        });
      }
      setDialog(null);
      void getProviderCatalog()
        .then((data) => setCatalog(data.providers))
        .catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить провайдера");
    } finally {
      setBusy(false);
    }
  };

  const check = async (provider: ProviderInfo) => {
    setCheckingId(provider.id);
    setError(null);
    try {
      await onCheck(provider.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Проверка не удалась");
    } finally {
      setCheckingId(null);
    }
  };

  const makeDefault = async (provider: ProviderInfo) => {
    setError(null);
    try {
      await onSetDefault(provider.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выбрать основного");
    }
  };

  const remove = async (provider: ProviderInfo) => {
    const ok = await confirm({
      title: "Удалить провайдера?",
      message: `«${provider.name}» будет удалён из Kova.`,
      details:
        provider.kind === "api"
          ? ["Сохранённый API-ключ будет удалён.", "История запусков останется."]
          : ["CLI и его логин на компьютере не затрагиваются.", "История запусков останется."],
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await onDelete(provider.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить провайдера");
    }
  };

  const cleanupHistory = async () => {
    if (cleanupBusy) return;
    const ok = await confirm({
      title: "Очистить историю?",
      message: "Старые запуски, сессии, логи, патчи и worktree будут удалены.",
      details: [
        "Останутся последние 50 запусков.",
        "Снапшоты и файлы проекта не удаляются.",
      ],
      confirmLabel: "Очистить",
      danger: true,
    });
    if (!ok) return;
    setCleanupBusy(true);
    setHistoryNote("");
    try {
      const result = await cleanupAgentHistory(50);
      setHistoryNote(
        `Удалено: запусков ${result.runs_removed}, сессий ${result.sessions_removed}, ` +
          `логов ${result.logs_removed}, патчей ${result.diffs_removed}`,
      );
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setHistoryNote(err instanceof Error ? err.message : "Не удалось очистить историю");
    } finally {
      setCleanupBusy(false);
    }
  };

  const refreshAll = () => {
    onRefresh();
    setRefreshKey((value) => value + 1);
  };

  const ready = providers.filter((provider) => provider.installed && provider.enabled);
  const defaultProvider = providers.find((provider) => provider.default) ?? null;

  const selected = providers.find((provider) => provider.id === selectedId) ?? null;

  useEffect(() => {
    if (providers.length === 0) {
      setSelectedId("");
      return;
    }
    if (!providers.some((provider) => provider.id === selectedId)) {
      setSelectedId(defaultProvider?.id ?? providers[0].id);
    }
  }, [providers, defaultProvider, selectedId]);

  const filteredProviders = providers
    .filter((provider) => {
      const haystack = `${provider.name} ${provider.command} ${provider.api_url}`.toLowerCase();
      if (providerQuery.trim() && !haystack.includes(providerQuery.trim().toLowerCase())) {
        return false;
      }
      if (onlyReady && !(provider.installed && provider.enabled)) return false;
      return true;
    })
    .sort((a, b) => Number(b.installed && b.enabled) - Number(a.installed && a.enabled));

  const setDefaultEffort = async (provider: ProviderInfo, value: string) => {
    await onSave(provider.id, { default_effort: value });
  };

  const setDefaultModel = async (provider: ProviderInfo, value: string) => {
    setError(null);
    try {
      await onSave(provider.id, { default_model: value });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить модель");
    }
  };

  const capabilityRows = (provider: ProviderInfo) => {
    const args = provider.args.join(" ").toLowerCase();
    const usageKnown =
      provider.kind === "api" ||
      ["codex-jsonl", "claude-json", "jsonl-auto"].includes(provider.output_mode);
    const resume = (provider.resume_args?.length ?? 0) > 0;
    const workspace =
      args.includes("workspace-write") || args.includes("acceptedits") || args.includes("--auto");
    return [
      { label: "Стриминг вывода", value: "Да", tone: "ok" as const },
      provider.kind === "api"
        ? { label: "Работа с файлами", value: "Нет, только текст", tone: "warn" as const }
        : {
            label: "Работа с workspace-write",
            value: workspace ? "Да" : "Флаги CLI",
            tone: workspace ? ("ok" as const) : ("unknown" as const),
          },
      {
        label: "Resume",
        value: resume
          ? "Настроен"
          : provider.capabilities?.supports_resume
            ? "Флаг есть, шаблон не задан"
            : "Unknown",
        tone: resume ? ("ok" as const) : provider.capabilities?.supports_resume ? ("warn" as const) : ("unknown" as const),
      },
      {
        label: "Usage",
        value: usageKnown ? "Из вывода" : "Unknown",
        tone: usageKnown ? ("ok" as const) : ("unknown" as const),
      },
    ];
  };

  const tabLabel: Record<typeof tab, string> = {
    info: "Информация",
    models: "Модели",
    advanced: "Дополнительно",
  };

  const openFolder = async (path: string) => {
    const folder = path.replace(/[\\/][^\\/]+$/, "");
    if (!folder) return;
    try {
      await invoke("open_project_folder", { path: folder });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось открыть папку");
    }
  };

  const loadModels = async (provider: ProviderInfo) => {
    if (modelsBusy) return;
    setModelsBusy(true);
    setModelNote("");
    try {
      const result = await discoverProviderModels(provider.id);
      await onSave(provider.id, { models: result.models });
      setModelNote(
        result.models.length > 0
          ? `Загружено моделей: ${result.models.length}`
          : "CLI вернул пустой список",
      );
    } catch (err) {
      setModelNote(err instanceof Error ? err.message : "Не удалось загрузить модели");
    } finally {
      setModelsBusy(false);
    }
  };

  useEffect(() => {
    if (tab !== "models" || !selected) return;
    if (!selected.installed || selected.models_args.length === 0) return;
    if (autoModels.current.has(selected.id)) return;
    autoModels.current.add(selected.id);
    void loadModels(selected);
  }, [tab, selected?.id, selected?.installed]);

  const addManualModel = async (provider: ProviderInfo) => {
    const value = modelDraft.trim();
    if (!value) return;
    if ((provider.models ?? []).includes(value)) {
      setModelDraft("");
      return;
    }
    await onSave(provider.id, { models: [...provider.models, value] });
    setModelDraft("");
  };

  useEffect(() => {
    let alive = true;
    if (!selected) {
      setModelCatalog([]);
      return;
    }
    getModelCatalog(selected.id)
      .then((groups) => {
        if (alive) setModelCatalog(groups);
      })
      .catch(() => {
        if (alive) setModelCatalog([]);
      });
    return () => {
      alive = false;
    };
  }, [selected?.id, selected?.models.length]);

  const catalogModelMap = new Map(
    modelCatalog.flatMap((group) => group.models).map((model) => [model.id, model]),
  );

  const modelGroups = (() => {
    if (!selected) return [] as Array<{ key: string; models: string[] }>;
    const query = modelQuery.trim().toLowerCase();
    const groups: Array<{ key: string; models: string[] }> = [];
    for (const model of selected.models) {
      if (query && !model.toLowerCase().includes(query)) continue;
      const key = modelProvider(model);
      let group = groups.find((item) => item.key === key);
      if (!group) {
        group = { key, models: [] };
        groups.push(group);
      }
      group.models.push(model);
    }
    groups.sort((a, b) => a.key.localeCompare(b.key));
    return groups;
  })();

  const builtInEdit =
    dialog?.kind === "edit" && dialog.provider.builtin && kind === "cli";

  return (
    <section className="agents-page">
      <header className="ag-head">
        <span className="ag-head-icon">
          <Bot size={30} strokeWidth={1.4} />
        </span>
        <div className="ag-head-copy">
          <h1>Агенты</h1>
          <p>Управление CLI, моделями и возможностями</p>
        </div>
        <div className="ag-head-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!project || slotsBusy}
            onClick={() => void applySafeDefaults()}
            title="Поставить безопасные настройки для этого проекта"
          >
            <Sparkles size={15} />
            Настроить за меня
          </button>
          <div className="ag-add">
            <button type="button" className="btn btn-primary" onClick={() => openCreate("cli")}>
              <Plus size={15} />
              Добавить CLI
            </button>
            <button
              type="button"
              className="btn btn-primary ag-add-toggle"
              title="Другие типы"
              aria-label="Другие типы"
              onClick={() => setAddOpen((value) => !value)}
            >
              ▾
            </button>
            {addOpen ? (
              <div className="ag-add-menu">
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    setCatalogNote("");
                    setCatalogSearch("");
                    setCatalogOpen(true);
                  }}
                >
                  <b>Из каталога</b>
                  <small>OpenAI, Anthropic, Google и другие</small>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    openCreate("cli");
                  }}
                >
                  <b>CLI-агент</b>
                  <small>Codex, Claude, OpenCode или своя команда</small>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    openCreate("api");
                  }}
                >
                  <b>API-провайдер</b>
                  <small>OpenAI-совместимый endpoint и ключ</small>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    openCreate("api");
                    setApiUrl("http://127.0.0.1:11434/v1/chat/completions");
                  }}
                >
                  <b>Локальный коннектор</b>
                  <small>Ollama / LM Studio на localhost, без ключа</small>
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-btn action-btn"
            title="Обновить провайдеров и запуски"
            onClick={refreshAll}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {quickNote ? <div className="ag-quick-note">{quickNote}</div> : null}

      <div className="ag-statusline">
        <span
          className={`ag-dot ${
            providers.length === 0 ? "is-warn" : ready.length > 0 ? "is-on" : "is-off"
          }`}
        />
        <span>
          {providers.length === 0
            ? "Загружаю провайдеров…"
            : `Готовы к запуску: ${ready.length} из ${providers.length}`}
        </span>
        {defaultProvider ? (
          <>
            <span className="ag-sep" />
            <span>Основной: <b>{defaultProvider.name}</b></span>
          </>
        ) : null}
      </div>

      {error ? <p className="agents-error">{error}</p> : null}

      <div className="ag-grid">
        <section className="ag-panel ag-providers">
          <div className="ag-panel-head">
            <h2>Провайдеры и CLI</h2>
            <span>{filteredProviders.length}</span>
          </div>
          <div className="ag-search">
            <Search size={13} />
            <input
              value={providerQuery}
              placeholder="Поиск провайдера…"
              onChange={(event) => setProviderQuery(event.target.value)}
            />
            <button
              type="button"
              className={`ag-filter${onlyReady ? " is-active" : ""}`}
              title="Только доступные"
              onClick={() => setOnlyReady((value) => !value)}
            >
              <Filter size={13} />
            </button>
          </div>
          <div className="ag-provider-list">
            {filteredProviders.length === 0 ? (
              <div className="ag-empty">
                {providers.length === 0
                  ? "Провайдеры ещё не загрузились…"
                  : "Ничего не найдено"}
              </div>
            ) : (
              filteredProviders.map((provider) => {
                const brand = providerBrand(provider.id);
                const state = providerState(provider);
                const active = selectedId === provider.id;
                return (
                  <button
                    type="button"
                    className={`ag-provider${active ? " is-selected" : ""}${
                      !provider.installed ? " is-missing" : ""
                    }`}
                    key={provider.id}
                    onClick={() => setSelectedId(provider.id)}
                  >
                    <span className="ag-provider-icon">
                      <ProviderIcon id={provider.id} brand={brand ?? undefined} size={24} />
                    </span>
                    <span className="ag-provider-main">
                      <span className="ag-provider-name">
                        {provider.name}
                        {provider.default ? <em>Основной</em> : null}
                      </span>
                      <span className="ag-provider-state">
                        <i className={`ag-dot ${state.dot}`} />
                        {provider.kind === "api"
                          ? provider.has_key
                            ? "Ключ сохранён"
                            : "Нужен ключ"
                          : provider.installed
                            ? provider.enabled
                              ? "Доступен"
                              : "Выключен"
                            : "Не найден"}
                      </span>
                      <span className="ag-provider-meta">
                        {provider.kind === "api"
                          ? provider.api_model || "модель не задана"
                          : provider.installed
                            ? provider.version || "версия неизвестна"
                            : "Проверьте установку CLI"}
                        {provider.path ? ` · ${provider.path}` : ""}
                      </span>
                    </span>
                    <ChevronRight size={14} className="ag-provider-arrow" />
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="ag-panel ag-detail">
          {selected ? (
            <>
              <div className="ag-detail-head">
                <span className="ag-detail-icon">
                  <ProviderIcon id={selected.id} brand={providerBrand(selected.id) ?? undefined} size={34} />
                </span>
                <div className="ag-detail-title">
                  <h2>{selected.name}</h2>
                  <span
                    className={`ag-pill ${
                      selected.installed && selected.enabled ? "is-on" : "is-off"
                    }`}
                  >
                    {selected.installed && selected.enabled
                      ? "Доступен"
                      : selected.installed
                        ? "Выключен"
                        : "Не найден"}
                  </span>
                </div>
                <div className="ag-detail-actions">
                  <button
                    type="button"
                    className="agent-link"
                    disabled={checkingId === selected.id}
                    onClick={() => void check(selected)}
                  >
                    <RefreshCw size={11} />
                    {checkingId === selected.id ? "Проверка…" : "Проверить"}
                  </button>
                  <button type="button" className="agent-link" onClick={() => openEdit(selected)}>
                    <Pencil size={11} />
                    Настройки
                  </button>
                  {!selected.default && selected.installed ? (
                    <button
                      type="button"
                      className="agent-link"
                      onClick={() => void makeDefault(selected)}
                    >
                      <Star size={11} />
                      Основной
                    </button>
                  ) : null}
                  {!selected.builtin ? (
                    <button
                      type="button"
                      className="agent-link is-danger"
                      onClick={() => void remove(selected)}
                    >
                      <Trash2 size={11} />
                      Удалить
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="ag-tabs">
                {(Object.keys(tabLabel) as Array<typeof tab>).map((key) => (
                  <button
                    type="button"
                    key={key}
                    className={tab === key ? "is-active" : ""}
                    onClick={() => setTab(key)}
                  >
                    {tabLabel[key]}
                  </button>
                ))}
              </div>

              <div className="ag-tab-body">
                {tab === "info" ? (
                  <div className="ag-info-grid">
                    <div className="ag-info-main">
                      <div className="ag-rows">
                        <div>
                          <span>Версия</span>
                          <b>
                            {selected.kind === "api"
                              ? "API"
                              : selected.version || "Unknown"}
                          </b>
                        </div>
                        <div>
                          <span>{selected.kind === "api" ? "Endpoint" : "Команда"}</span>
                          <b title={commandLine(selected)}>{commandLine(selected)}</b>
                        </div>
                        <div>
                          <span>{selected.kind === "api" ? "Модель API" : "Путь"}</span>
                          <b className="ag-path" title={selected.kind === "api" ? selected.api_model : selected.path}>
                            <span>
                              {selected.kind === "api"
                                ? selected.api_model || "не задана"
                                : selected.path || "не найден"}
                            </span>
                            {selected.path ? (
                              <button
                                type="button"
                                className="ag-path-open"
                                title="Открыть папку в Проводнике"
                                onClick={() => void openFolder(selected.path)}
                              >
                                <FolderOpen size={12} />
                              </button>
                            ) : null}
                          </b>
                        </div>
                        <div>
                          <span>Тип</span>
                          <b>{selected.kind === "api" ? "API" : "CLI"}</b>
                        </div>
                        <div>
                          <span>Таймаут</span>
                          <b>{selected.timeout} сек</b>
                        </div>
                        <div>
                          <span>Read-only</span>
                          <b>{selected.read_only_args.length > 0 ? "настроен" : "нет"}</b>
                        </div>
                        <div>
                          <span>Resume</span>
                          <b>{selected.resume_args.length > 0 ? "настроен" : "нет"}</b>
                        </div>
                        <div>
                          <span>Основной</span>
                          <b>
                            {selected.default ? (
                              <span className="ag-star">
                                <Star size={12} /> Да
                              </span>
                            ) : (
                              "Нет"
                            )}
                          </b>
                        </div>
                      </div>

                      <div className="ag-model-block">
                        <span>Модель</span>
                        <select
                          value={selected.default_model}
                          onChange={(event) => void setDefaultModel(selected, event.target.value)}
                        >
                          <option value="">Автоматическая / CLI default</option>
                          {(selected.models ?? []).map((model) => (
                            <option value={model} key={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                        <small>
                          {selected.models.length > 0
                            ? "Список моделей задаётся в настройках провайдера."
                            : "Список моделей пуст. Укажи модели в настройках провайдера."}
                        </small>
                      </div>

                      <div className="ag-model-block">
                        <span>Effort по умолчанию</span>
                        <select
                          value={selected.default_effort || "auto"}
                          onChange={(event) => void setDefaultEffort(selected, event.target.value)}
                        >
                          {["auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"].map(
                            (value) => (
                              <option value={value} key={value}>
                                {value === "auto" ? "Auto" : value}
                              </option>
                            ),
                          )}
                        </select>
                        <small>Применяется к новым чатам. Старые чаты не меняются.</small>
                      </div>
                    </div>

                    <div className="ag-cap-card">
                      <h3>Что умеет CLI</h3>
                      <small className="ag-cap-note">
                        Проверяется по --help и настройкам провайдера.
                      </small>
                      {capabilityRows(selected).map((row) => (
                        <div className={`ag-cap-row is-${row.tone}`} key={row.label}>
                          {row.tone === "ok" ? (
                            <CheckCircle2 size={13} />
                          ) : row.tone === "warn" ? (
                            <AlertTriangle size={13} />
                          ) : (
                            <CircleHelp size={13} />
                          )}
                          <span>{row.label}</span>
                          <b>{row.value}</b>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {tab === "models" ? (
                  <div className="ag-tab-section ag-models">
                    <div className="ag-section-head">
                      <h3>Модели провайдера</h3>
                      <span>{selected.models.length}</span>
                    </div>
                    <p>
                      {selected.models.length > 0
                        ? "Модель по умолчанию подставляется в запуск, если в аргументах есть {model}."
                        : "Список пуст. Загрузи модели из CLI/API или добавь вручную."}
                    </p>
                    <div className="ag-model-tools">
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={modelsBusy || !selected.installed}
                        onClick={() => void loadModels(selected)}
                      >
                        <RefreshCw size={12} />
                        {modelsBusy ? "Загрузка…" : "Загрузить из CLI/API"}
                      </button>
                      <input
                        value={modelQuery}
                        placeholder="Поиск модели…"
                        onChange={(event) => setModelQuery(event.target.value)}
                      />
                    </div>
                    {modelNote ? <small className="ag-muted">{modelNote}</small> : null}
                    {selected.models.length > 0 ? (
                      <div className="ag-model-scroll">
                        {modelGroups.length === 0 ? (
                          <div className="ag-empty">Ничего не найдено</div>
                        ) : (
                          modelGroups.map((group) => (
                            <div className="ag-model-group" key={group.key}>
                              <div className="ag-model-group-head">
                                <span>{providerLabel(group.key)}</span>
                                <b>{group.models.length}</b>
                              </div>
                              {group.models.map((model) => (
                                <button
                                  type="button"
                                  className={`ag-model-row${
                                    selected.default_model === model ? " is-active" : ""
                                  }`}
                                  key={model}
                                  title={model}
                                  onClick={() => void setDefaultModel(selected, model)}
                                >
                                  <span>{catalogModelMap.get(model)?.name ?? modelLabel(model)}</span>
                                  {(catalogModelMap.get(model)?.free ?? isFreeModel(model)) ? <em className="is-free">Free</em> : null}
                                  {selected.default_model === model ? (
                                    <em>по умолчанию</em>
                                  ) : null}
                                </button>
                              ))}
                            </div>
                          ))
                        )}
                      </div>
                    ) : (
                      <div className="ag-empty">Модели пока не загружены.</div>
                    )}
                    <div className="ag-model-add">
                      <input
                        value={modelDraft}
                        placeholder="Добавить модель вручную"
                        onChange={(event) => setModelDraft(event.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={!modelDraft.trim()}
                        onClick={() => void addManualModel(selected)}
                      >
                        Добавить
                      </button>
                    </div>
                    {selected.default_model ? (
                      <button
                        type="button"
                        className="agent-link"
                        onClick={() => void setDefaultModel(selected, "")}
                      >
                        Сбросить модель по умолчанию
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {tab === "advanced" ? (
                  <details className="ag-advanced-block">
                    <summary>Запуски и безопасность</summary>
                    <div className="ag-tab-section">
                    <h3>Запуски проекта</h3>
                    {project ? (
                      <div className="ag-settings-list">
                        <label>
                          <span>Параллельных запусков</span>
                          <select
                            value={project.project.max_parallel_runs}
                            disabled={slotsBusy}
                            onChange={(event) => void saveSlots(Number(event.target.value))}
                          >
                            {[1, 2, 3, 4].map((value) => (
                              <option value={value} key={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Изоляция</span>
                          <select
                            value={project.project.isolation}
                            disabled={slotsBusy}
                            onChange={(event) =>
                              void saveIsolation(event.target.value as IsolationMode)
                            }
                          >
                            <option value="direct">Прямо в проекте</option>
                            <option value="worktree" disabled={!project.git_repo}>
                              Git worktree
                            </option>
                            <option value="sandbox">Песочница (копия проекта)</option>
                          </select>
                        </label>
                        <label className="agent-check">
                          <input
                            type="checkbox"
                            checked={project.project.local_only}
                            disabled={slotsBusy}
                            onChange={(event) => void saveLocalOnly(event.target.checked)}
                          />
                          Только локальные модели
                        </label>
                        <small className="ag-muted">
                          Запрещает чат и запуски через провайдеров, которые ходят в интернет.
                          Локальные API на localhost остаются доступны.
                        </small>
                        <label className="agent-check">
                          <input
                            type="checkbox"
                            checked={project.project.egress_guard}
                            disabled={slotsBusy}
                            onChange={(event) => void saveEgressGuard(event.target.checked)}
                          />
                          Сетевой щит (allowlist доменов)
                        </label>
                        <small className="ag-muted">
                          Для CLI-чата и запусков задач: разрешены только домены выбранного провайдера,
                          остальные соединения блокируются и видны в активности.
                        </small>
                        <label>
                          <span>Лимит токенов</span>
                          <input
                            type="number"
                            min={0}
                            max={100000000}
                            value={budgetDraft}
                            disabled={slotsBusy}
                            onChange={(event) => setBudgetDraft(Number(event.target.value))}
                            onBlur={() => {
                              if (budgetDraft !== project.project.token_budget) void saveBudget();
                            }}
                          />
                        </label>
                        <small className="ag-muted">
                          {project.project.isolation === "worktree"
                            ? "Агент работает в копии HEAD, изменения применяются вручную из Review."
                            : project.project.isolation === "sandbox"
                              ? "Агент работает в отдельной копии проекта; изменения применяются вручную из Review."
                              : "Агент пишет напрямую в проект."}
                          {" "}0 токенов — без лимита.
                        </small>
                        {usage ? (
                          <small className="ag-muted">
                            Использовано: {usage.used.toLocaleString("ru-RU")}
                            {usage.budget > 0
                              ? ` из ${usage.budget.toLocaleString("ru-RU")}`
                              : ""}
                            {" · "}
                            запусков без usage: {usage.unknown_runs}
                          </small>
                        ) : null}
                        {slotsNote ? <small className="ag-muted">{slotsNote}</small> : null}
                      </div>
                    ) : (
                      <div className="ag-empty">Открой проект, чтобы настроить очередь.</div>
                    )}
                    </div>
                  </details>
                ) : null}

                {tab === "advanced" ? (
                  <details className="ag-advanced-block">
                    <summary>Маршрутизация и роли</summary>
                    <div className="ag-tab-section">
                    <div className="ag-section-head">
                      <h3>Правила маршрутизации</h3>
                      <span>{routing.rules.length}</span>
                    </div>
                    <p>Правило даёт рекомендацию в задаче по тегу. Автопереключения нет.</p>
                    {routing.rules.length === 0 ? null : (
                      <ul className="ag-rule-list">
                        {routing.rules.map((rule) => (
                          <li key={rule.id}>
                            <code>{rule.tag}</code>
                            <span>{providerName(rule.provider_id)}</span>
                            <button
                              type="button"
                              className="agent-link is-danger"
                              disabled={routingBusy}
                              onClick={() =>
                                void persistRouting({
                                  ...routing,
                                  rules: routing.rules.filter((item) => item.id !== rule.id),
                                })
                              }
                            >
                              Удалить
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="ag-form-grid">
                      <label>
                        <span>Тег задачи</span>
                        <input
                          value={ruleTag}
                          placeholder="например: backend"
                          onChange={(event) => setRuleTag(event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Провайдер</span>
                        <select
                          value={ruleProvider || providers[0]?.id || ""}
                          onChange={(event) => setRuleProvider(event.target.value)}
                        >
                          {providers.map((provider) => (
                            <option value={provider.id} key={provider.id}>
                              {provider.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={routingBusy || !ruleTag.trim()}
                        onClick={() => void addRule()}
                      >
                        Добавить правило
                      </button>
                    </div>

                    <div className="ag-section-head is-spaced">
                      <h3>Роли</h3>
                      <span>{routing.roles.length}</span>
                    </div>
                    <p>
                      Роль добавляет инструкции к промпту агента. Инструкции видны в задаче при
                      выборе роли.
                    </p>
                    {routing.roles.length === 0 ? null : (
                      <ul className="ag-role-list">
                        {routing.roles.map((role) => (
                          <li key={role.id}>
                            <div>
                              <b>{role.name}</b>
                              <small>{role.prompt || "без инструкций"}</small>
                            </div>
                            <span>{role.provider_id ? providerName(role.provider_id) : "любой CLI"}</span>
                            <button
                              type="button"
                              className="agent-link is-danger"
                              disabled={routingBusy}
                              onClick={() =>
                                void persistRouting({
                                  ...routing,
                                  roles: routing.roles.filter((item) => item.id !== role.id),
                                })
                              }
                            >
                              Удалить
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="ag-form-grid is-role">
                      <label>
                        <span>Название роли</span>
                        <input
                          value={roleName}
                          placeholder="например: Строгий ревьюер"
                          onChange={(event) => setRoleName(event.target.value)}
                        />
                      </label>
                      <label className="is-full">
                        <span>Инструкции для агента</span>
                        <textarea
                          rows={2}
                          value={rolePrompt}
                          placeholder="Что проверять, на что смотреть, в каком формате отвечать…"
                          onChange={(event) => setRolePrompt(event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Провайдер</span>
                        <select
                          value={roleProvider}
                          onChange={(event) => setRoleProvider(event.target.value)}
                        >
                          <option value="">Любой CLI</option>
                          {providers.map((provider) => (
                            <option value={provider.id} key={provider.id}>
                              {provider.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={routingBusy || !roleName.trim()}
                        onClick={() => void addRole()}
                      >
                        Добавить роль
                      </button>
                    </div>
                    {routingNote ? <small className="ag-muted">{routingNote}</small> : null}
                    </div>
                  </details>
                ) : null}

              </div>
            </>
          ) : (
            <div className="ag-empty">Выбери провайдера слева.</div>
          )}
        </section>
      </div>

      <section className="ag-panel ag-runs">
        <div className="ag-runs-head">
          <h2>
            <History size={14} />
            Последние запуски
          </h2>
          <div className="ag-runs-actions">
            <button
              type="button"
              className="agent-link"
              onClick={() => setRunsLimit(runsLimit === 8 ? 50 : 8)}
            >
              {runsLimit === 8 ? "Все запуски →" : "Свернуть"}
            </button>
            <button
              type="button"
              className="agent-link is-danger"
              title="Удалить старые запуски, логи и патчи"
              disabled={cleanupBusy}
              onClick={() => void cleanupHistory()}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
        {runsError ? (
          <div className="ag-empty">{runsError}</div>
        ) : runs.length === 0 ? (
          <div className="ag-empty">Запусков пока нет.</div>
        ) : (
          <div className="ag-run-table">
            <div className="ag-run-row is-head">
              <span>Задача</span>
              <span>Агент</span>
              <span>Модель</span>
              <span>Дата</span>
              <span>Статус</span>
              <span />
            </div>
            {runs.map((run) => (
              <button
                type="button"
                className="ag-run-row"
                key={run.id}
                onClick={() => onOpenTask(run.task_id)}
              >
                <span className="ag-run-task">{run.task_title}</span>
                <span>{run.provider_name}</span>
                <span>{run.model || "CLI default"}</span>
                <span>{formatDate(run.started_at || run.created_at)}</span>
                <span className={`ag-run-status ${RUN_DOT[run.status]}`}>
                  <i className={`ag-dot ${RUN_DOT[run.status]}`} />
                  {RUN_LABELS[run.status]}
                </span>
                <span className="ag-run-more">
                  <MoreVertical size={13} />
                </span>
              </button>
            ))}
          </div>
        )}
        {historyNote ? <small className="ag-muted">{historyNote}</small> : null}
      </section>

      <p className="ag-footnote">
        Установка и авторизация выполняются внутри CLI. Kova не хранит ключи CLI.
      </p>

      {catalogOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCatalogOpen(false);
          }}
        >
          <div className="modal catalog-modal">
            <div className="modal-header">
              <span className="modal-title">
                Подключить провайдера
                <small>Выбери сервис. Ключ хранится через Windows DPAPI.</small>
              </span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setCatalogOpen(false)}
                aria-label="Закрыть"
              >
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              <div className="catalog-toolbar">
                <div className="ag-search">
                  <Search size={13} />
                  <input
                    value={catalogSearch}
                    placeholder="Поиск провайдера…"
                    onChange={(event) => setCatalogSearch(event.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => {
                    setCatalogOpen(false);
                    openCreate("api");
                  }}
                >
                  <Plus size={12} />
                  Свой endpoint
                </button>
              </div>
              {catalogNote ? <p className="modal-error">{catalogNote}</p> : null}
              <div className="catalog-grid">
                {catalog
                  .filter((item) =>
                    `${item.name} ${item.description}`
                      .toLowerCase()
                      .includes(catalogSearch.trim().toLowerCase()),
                  )
                  .map((item) => {
                    return (
                      <article
                        className={`catalog-card${item.available ? "" : " is-disabled"}`}
                        key={item.id}
                      >
                        <div className="catalog-card-head">
                          <span className="catalog-icon">
                            <ProviderIcon id={item.id} brand={item.brand} size={24} />
                          </span>
                          <span className="catalog-name">{item.name}</span>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            disabled={!item.available}
                            onClick={() => {
                              if (item.provider_id) {
                                setSelectedId(item.provider_id);
                                setCatalogOpen(false);
                                return;
                              }
                              setCatalogNote("");
                              setCatalogOpen(false);
                              openCreate("api", item);
                            }}
                          >
                            {item.connected
                              ? "Открыть"
                              : item.configured
                                ? "Донастроить"
                                : item.available
                                  ? "Подключить"
                                  : "Позже"}
                          </button>
                        </div>
                        <p>{item.description}</p>
                        <small>
                          {item.connected
                            ? item.models_count > 0
                              ? `${item.models_count} моделей`
                              : "ключ сохранён"
                            : item.available
                              ? "модели загрузятся после ключа"
                              : "нужен отдельный адаптер"}
                        </small>
                      </article>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {dialog ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setDialog(null);
          }}
        >
          <div className="modal agent-dialog">
            <div className="modal-header">
              <span className="modal-title">
                {dialog.kind === "edit"
                  ? "Настроить провайдера"
                  : catalogId && kind === "api"
                    ? `Подключить ${name || "провайдера"}`
                    : kind === "api"
                      ? "Свой API-провайдер"
                      : "Свой CLI-агент"}
                <small>Подключение, модели и режимы запуска</small>
              </span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => !busy && setDialog(null)}
                aria-label="Закрыть"
              >
                <X size={14} />
              </button>
            </div>

            <div className="modal-body">
              {builtInEdit ? (
                <div className="agent-form-note">
                  Обычно здесь ничего менять не нужно: Kova уже знает, как безопасно
                  запускать этот CLI. Модель выбирается в «Агентах → Модели».
                </div>
              ) : null}
              <div className="agent-form-title">Основное</div>
              <div className="field">
                <label htmlFor="agent-name">Название</label>
                <input
                  id="agent-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={kind === "api" ? "Например: DeepSeek API" : "Например: DeepSeek CLI"}
                />
              </div>
              {dialog.kind === "create" && !catalogId ? (
                <div className="field">
                  <label htmlFor="agent-kind">Тип</label>
                  <select
                    id="agent-kind"
                    value={kind}
                    onChange={(event) => setKind(event.target.value as "cli" | "api")}
                  >
                    <option value="cli">CLI</option>
                    <option value="api">API</option>
                  </select>
                </div>
              ) : null}
              {kind === "api" ? (
                <>
                  {!catalogId ? (
                  <div className="field">
                    <label htmlFor="agent-api-style">Формат API</label>
                    <select
                      id="agent-api-style"
                      value={apiStyle}
                      onChange={(event) =>
                        setApiStyle(event.target.value as "openai" | "anthropic" | "google" | "azure" | "vertex" | "bedrock")
                      }
                    >
                      <option value="openai">OpenAI-совместимый</option>
                      <option value="anthropic">Anthropic Messages</option>
                      <option value="google">Google Gemini</option>
                      <option value="azure">Azure OpenAI</option>
                      <option value="vertex">Google Vertex AI</option>
                      <option value="bedrock">AWS Bedrock (Claude)</option>
                    </select>
                    <span className="field-hint">
                      Определяет тело запроса и разбор стриминга. Не угадывается по URL.
                    </span>
                  </div>
                  ) : null}
                  {apiStyle !== "vertex" && apiStyle !== "bedrock" ? (
                    <div className="field">
                      <label htmlFor="agent-api-url">Endpoint</label>
                      <input
                        id="agent-api-url"
                        value={apiUrl}
                        onChange={(event) => setApiUrl(event.target.value)}
                        placeholder={
                          apiStyle === "anthropic"
                            ? "https://api.anthropic.com/v1/messages"
                            : apiStyle === "google"
                              ? "https://generativelanguage.googleapis.com/v1beta"
                              : apiStyle === "azure"
                                ? "https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-10-21"
                                : "https://api.openai.com/v1/chat/completions"
                        }
                      />
                      <span className="field-hint">
                        {apiStyle === "anthropic"
                          ? "Полный URL Messages API. Ключ уходит в x-api-key."
                          : apiStyle === "google"
                            ? "Базовый URL API. Модель и ключ добавляются к пути автоматически."
                            : apiStyle === "azure"
                              ? "Полный URL deployment. Ключ уходит в api-key."
                              : "Полный URL chat/completions. Kova не угадывает путь."}
                      </span>
                    </div>
                  ) : null}
                  <div className="field">
                    <label htmlFor="agent-api-model">
                      {apiStyle === "azure"
                        ? "Deployment name"
                        : apiStyle === "bedrock"
                          ? "Model ID (Claude)"
                          : "Модель API"}
                    </label>
                    <input
                      id="agent-api-model"
                      value={apiModel}
                      onChange={(event) => setApiModel(event.target.value)}
                      placeholder={
                        apiStyle === "azure"
                          ? "например: gpt-4o"
                          : apiStyle === "bedrock"
                            ? "anthropic.claude-3-5-sonnet-20241022-v2:0"
                            : apiStyle === "vertex"
                              ? "например: gemini-2.5-flash"
                              : "Например: gpt-4o-mini"
                      }
                    />
                  </div>
                  {apiStyle === "vertex" ? (
                    <>
                      <div className="field">
                        <label htmlFor="agent-gcp-project">GCP project</label>
                        <input
                          id="agent-gcp-project"
                          value={gcpProject}
                          onChange={(event) => setGcpProject(event.target.value)}
                          placeholder="my-gcp-project"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="agent-gcp-region">Регион</label>
                        <input
                          id="agent-gcp-region"
                          value={gcpRegion}
                          onChange={(event) => setGcpRegion(event.target.value)}
                          placeholder="us-central1"
                        />
                        <span className="field-hint">
                          Токен берётся из GOOGLE_ACCESS_TOKEN или `gcloud auth print-access-token`.
                        </span>
                      </div>
                    </>
                  ) : null}
                  {apiStyle === "bedrock" ? (
                    <div className="field">
                      <label htmlFor="agent-aws-region">AWS region</label>
                      <input
                        id="agent-aws-region"
                        value={awsRegion}
                        onChange={(event) => setAwsRegion(event.target.value)}
                        placeholder="us-east-1"
                      />
                      <span className="field-hint">
                        Нужны AWS_ACCESS_KEY_ID и AWS_SECRET_ACCESS_KEY в окружении.
                      </span>
                    </div>
                  ) : null}
                  {apiStyle !== "bedrock" ? (
                    <div className="field">
                      <label htmlFor="agent-api-key">
                        {apiStyle === "vertex" ? "Access token (необязательно)" : "API-ключ"}
                      </label>
                      <input
                        id="agent-api-key"
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={
                          dialog.kind === "edit" && dialog.provider.has_key
                            ? "ключ сохранён — оставь пустым, чтобы не менять"
                            : apiStyle === "vertex"
                              ? "или задай GOOGLE_ACCESS_TOKEN"
                              : "sk-…"
                        }
                      />
                      <span className="field-hint">
                        Ключ шифруется Windows DPAPI и не возвращается через API.
                      </span>
                    </div>
                  ) : null}
                  {apiStyle !== "bedrock" ? (
                    <label className="agent-check">
                      <input
                        type="checkbox"
                        checked={deleteKey}
                        onChange={(event) => setDeleteKey(event.target.checked)}
                      />
                      Удалить сохранённый ключ
                    </label>
                  ) : null}
                  <span className="field-hint">
                    Инструменты: чтение и запись файлов по политике запуска. Команды — только
                    в режиме «auto». CLI остаётся для сложных сценариев.
                  </span>
                </>
              ) : (
                <>
              <details className="agent-form-advanced" open={!builtInEdit}>
                <summary>Дополнительные настройки</summary>
              <div className="field">
                <label htmlFor="agent-command">Команда запуска CLI</label>
                <input
                  id="agent-command"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="codex или полный путь к .exe/.cmd"
                />
              </div>
              <div className="field">
                <label htmlFor="agent-args">Аргументы запуска</label>
                <input
                  id="agent-args"
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  placeholder={'exec --sandbox workspace-write "{prompt}"'}
                />
                <span className="field-hint">
                  {"{prompt}"} заменяется на текст задачи. Если плейсхолдера нет, промпт
                  добавится в конец.
                </span>
              </div>
              <div className="agent-form-title">Модели и продолжение</div>
              <div className="field">
                <label htmlFor="agent-models">Модели (через запятую)</label>
                <input
                  id="agent-models"
                  value={models}
                  onChange={(event) => setModels(event.target.value)}
                  placeholder="Например: gpt-5-codex, o3"
                />
                <span className="field-hint">
                  Через запятую. Чтобы модель передавалась в CLI, добавь {"{model}"} в аргументы.
                </span>
              </div>
              <div className="agent-form-title">Ограничения и режимы</div>
              <div className="field">
                <label htmlFor="agent-readonly">Безопасный режим (только чтение)</label>
                <input
                  id="agent-readonly"
                  value={readOnlyArgs}
                  onChange={(event) => setReadOnlyArgs(event.target.value)}
                  placeholder={'--sandbox read-only "{prompt}"'}
                />
                <span className="field-hint">
                  Необязательно, но для чата обязательно: без этих аргументов безопасный
                  режим чата для CLI недоступен. Флаги задаёшь ты — Kova не угадывает их.
                </span>
              </div>
              <div className="field">
                <label htmlFor="agent-resume">Продолжение сессии</label>
                <input
                  id="agent-resume"
                  value={resumeArgs}
                  onChange={(event) => setResumeArgs(event.target.value)}
                  placeholder={'exec resume {session} "{prompt}"'}
                />
                <span className="field-hint">
                  {"{session}"} — id сессии CLI. Пусто — «Продолжить» будет передавать контекст
                  в новую сессию.
                </span>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="agent-session-regex">ID сессии (regex)</label>
                  <input
                    id="agent-session-regex"
                    value={sessionRegex}
                    onChange={(event) => setSessionRegex(event.target.value)}
                    placeholder={'"session_id"\s*:\s*"([^"]+)"'}
                  />
                </div>
                <div className="field">
                  <label htmlFor="agent-output-mode">Формат вывода</label>
                  <select
                    id="agent-output-mode"
                    value={outputMode}
                    onChange={(event) => setOutputMode(event.target.value)}
                  >
                    <option value="auto">auto</option>
                    <option value="claude-json">Claude JSON</option>
                    <option value="codex-jsonl">Codex JSONL</option>
                    <option value="jsonl-auto">JSONL auto</option>
                  </select>
                </div>
              </div>
              </details>
                </>
              )}
              <div className="field-row">
                <div className="field">
                  <label htmlFor="agent-timeout">Лимит, сек</label>
                  <input
                    id="agent-timeout"
                    type="number"
                    min={60}
                    max={7200}
                    value={timeout}
                    onChange={(event) => setTimeoutValue(Number(event.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="agent-desc">Описание</label>
                  <input
                    id="agent-desc"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Для чего этот CLI"
                  />
                </div>
              </div>
              {dialog.kind === "edit" && kind === "cli" ? (
                <div className="agent-caps-block">
                  <span>Возможности CLI</span>
                  {dialog.provider.capabilities?.checked ? (
                    <>
                      <b>{capabilitySummary(dialog.provider)}</b>
                      <small>{dialog.provider.capabilities.note}</small>
                    </>
                  ) : (
                    <small>Не проверялись. Нажми «Проверить» на странице «Агенты».</small>
                  )}
                </div>
              ) : null}
              <label className="agent-check">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                Включён
              </label>
              <label className="agent-check">
                <input
                  type="checkbox"
                  checked={setDefault}
                  onChange={(event) => setSetDefault(event.target.checked)}
                />
                Сделать основным
              </label>
              {error ? <p className="modal-error">{error}</p> : null}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                Отмена
              </button>
              <span className="modal-footer-spacer" />
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  busy ||
                  !name.trim() ||
                  (kind === "api" ? !apiUrl.trim() || !apiModel.trim() : !command.trim())
                }
                onClick={() => void submit()}
              >
                {busy ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
