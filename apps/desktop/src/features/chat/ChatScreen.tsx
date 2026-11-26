import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Check,
  ChevronDown,
  Code2,
  CircleStop,
  Copy,
  ClipboardPaste,
  ClipboardPlus,
  Download,
  FileText,
  FolderLock,
  Globe,
  Image as ImageIcon,
  LayoutGrid,
  MessageSquare,
  Play,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  User,
  Video,
  X,
} from "lucide-react";
import BrandIcon from "../../components/BrandIcon";
import ChatActivityPanel from "../../components/ChatActivityPanel";
import KovaAvatar from "../../components/KovaAvatar";
import { useConfirm } from "../../components/ConfirmProvider";
import { engineBrand } from "../../lib/brands";
import type { ChatAttachmentInput } from "../../lib/coreClient";
import {
  cancelChat,
  chatAttachmentUrl,
  chatEventsUrl,
  createChat,
  createTask,
  decideChatAction,
  deleteChat,
  getChat,
  getModelCatalog,
  listChats,
  sendChatMessage,
  updateChat,
} from "../../lib/coreClient";
import { formatDate } from "../../lib/format";
import type { KovaAvatarState } from "../../components/KovaAvatar";
import type { ChatPreferences } from "../../lib/chatPreferences";
import type {
  ChatAction,
  ChatSession,
  ChatSummary,
  Engine,
  ModelCatalogGroup,
  ProviderInfo,
  Task,
} from "../../lib/types";

function actionLabel(action: ChatAction): string {
  if (action.type === "create_task") return "Создать задачу";
  if (action.type === "update_task") return "Обновить задачу";
  if (action.type === "update_project_settings") return "Изменить настройки проекта";
  return "Запустить агента";
}

function actionDetail(action: ChatAction): string {
  const payload = action.payload ?? {};
  if (action.type === "create_task") {
    return String(payload.title ?? "Задача из чата");
  }
  if (action.type === "update_task") {
    const parts = [String(payload.task_id ?? "")];
    if (payload.status) parts.push(`статус: ${String(payload.status)}`);
    if (payload.next_step) parts.push(`шаг: ${String(payload.next_step)}`);
    return parts.filter(Boolean).join(" · ");
  }
  if (action.type === "update_project_settings") {
    const parts: string[] = [];
    if (payload.isolation) {
      parts.push(
        payload.isolation === "worktree"
          ? "worktree"
          : payload.isolation === "sandbox"
            ? "песочница-копия"
            : "прямо в проекте",
      );
    }
    if (payload.local_only === true) parts.push("только локальные");
    if (payload.egress_guard === true) parts.push("сетевой щит");
    if (payload.max_parallel_runs) parts.push(`запусков: ${String(payload.max_parallel_runs)}`);
    if (payload.token_budget) parts.push(`лимит: ${String(payload.token_budget)}`);
    return parts.join(" · ") || "Настройки проекта";
  }
  const parts = [String(payload.task_id ?? "")];
  if (payload.provider_id) parts.push(String(payload.provider_id));
  return parts.filter(Boolean).join(" · ");
}

function actionResultTask(action: ChatAction): string {
  const value = action.result?.task_id;
  return typeof value === "string" ? value : "";
}

function effortLabel(value?: string): string {
  return value && value !== "auto" ? value : "Auto";
}

function fallbackEfforts(providerId?: string): string[] {
  if (providerId === "codex") return ["low", "medium", "high", "xhigh"];
  if (providerId === "claude") return ["low", "medium", "high", "xhigh", "max"];
  return [];
}

type PendingAttachment = {
  name: string;
  mime: string;
  size: number;
  kind: "image" | "video" | "text" | "file";
  dataUrl: string;
  data: string;
};

type ConsentRequest = {
  provider: ProviderInfo;
  message: string;
  attachments: ChatAttachmentInput[];
  pending: PendingAttachment[];
};

function attachmentKind(mime: string): PendingAttachment["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/") || mime === "application/json") return "text";
  return "file";
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}

function renderMarkdown(value: string): string {
  const NL = String.fromCharCode(10);
  const TICK = String.fromCharCode(96);
  const escape = (line: string) =>
    line
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const inline = (line: string): string => {
    let html = escape(line);
    html = html
      .split(TICK)
      .map((part, index) =>
        index % 2 === 1 ? `<code class="chat-inline">${part}</code>` : part,
      )
      .join("");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    );
    return html;
  };
  const isSeparator = (line: string): boolean =>
    line.includes("-") && /^\s*\|?[\s:|-]+\|?\s*$/.test(line);
  const cells = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const lines = value.split(NL);
  const out: string[] = [];
  let paragraph: string[] = [];
  let code: string[] = [];
  let inCode = false;
  let index = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.join("<br/>")}</p>`);
    paragraph = [];
  };

  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trimEnd();
    if (line.trimStart().startsWith(TICK.repeat(3))) {
      flushParagraph();
      if (inCode) {
        out.push(`<pre class="chat-code"><code>${escape(code.join(NL))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        inCode = true;
      }
      index += 1;
      continue;
    }
    if (inCode) {
      code.push(raw);
      index += 1;
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph();
      out.push("<hr/>");
      index += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (
      line.includes("|") &&
      index + 1 < lines.length &&
      isSeparator(lines[index + 1])
    ) {
      flushParagraph();
      const header = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(cells(lines[index]));
        index += 1;
      }
      out.push(
        `<table class="chat-table"><thead><tr>${header
          .map((cell) => `<th>${inline(cell)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table>`,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushParagraph();
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      const joined = quote.join("<br/>");
      const lower = joined.toLowerCase();
      const tone = /важно|внимание|warning|осторожно/.test(lower)
        ? " is-warning"
        : /нельзя|ошибка|опасн|запрещ|error/.test(lower)
          ? " is-danger"
          : "";
      out.push(
        `<blockquote class="chat-callout${tone}"><p>${inline(joined)}</p></blockquote>`,
      );
      continue;
    }
    const unordered = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const orderedList = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const match = orderedList
          ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[index])
          : /^\s*[-*]\s+(.*)$/.exec(lines[index]);
        if (!match) break;
        items.push(`<li>${inline(match[1])}</li>`);
        index += 1;
      }
      out.push(
        orderedList ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`,
      );
      continue;
    }
    paragraph.push(inline(line));
    index += 1;
  }
  flushParagraph();
  if (inCode && code.length) {
    out.push(`<pre class="chat-code"><code>${escape(code.join(NL))}</code></pre>`);
  }
  return out.join("");
}

function chatSafety(
  provider: ProviderInfo | null,
  externalCount = 0,
  localOnly = false,
): { label: string; title: string } {
  if (!provider) {
    return {
      label: localOnly ? "Локально" : "Без изменений",
      title: localOnly
        ? "Включён режим только локальных моделей. Внешние провайдеры заблокированы."
        : "Чат не меняет файлы проекта.",
    };
  }
  const remote = provider.kind === "api" ? !provider.local_api : true;
  if (localOnly && remote) {
    return {
      label: "Заблокировано",
      title:
        "Включён режим только локальных моделей. Этот провайдер отправляет данные в интернет, поэтому отправка заблокирована.",
    };
  }
  if (localOnly && !remote) {
    return {
      label: "Локально",
      title:
        "Локальный API: данные не уходят за пределы этой машины. Чат только читает проект.",
    };
  }
  if (provider.kind === "api") {
    return {
      label: "Без инструментов",
      title:
        "API-чат отвечает текстом и не получает доступ к файлам, командам или сети проекта.",
    };
  }
  if (provider.id === "opencode") {
    return {
      label: externalCount ? "Читает + папки" : "Читает проект",
      title: externalCount
        ? `OpenCode читает проект и ${externalCount} явно разрешённых внешних папок. Изменения, команды, сеть и MCP заблокированы.`
        : "OpenCode в чате читает только папку проекта. Внешние пути, изменения файлов, команды, сеть и MCP заблокированы.",
    };
  }
  if (provider.chat_args?.length || provider.read_only_args?.length) {
    return {
      label: externalCount ? "Без изменений + папки" : "Без изменений",
      title:
        externalCount
          ? `Чат работает без правок и команд; разрешено чтение проекта и ${externalCount} внешних папок.`
          : "Чат работает без правок файлов и без команд. Внешние пути контролируются возможностями CLI.",
    };
  }
  return {
    label: "Не настроен",
    title:
      "Для этого CLI не заданы безопасные аргументы чата. Добавь аргументы «только чтение» в настройках провайдера.",
  };
}

function activityAvatarState(
  activity: Parameters<typeof ChatActivityPanel>[0]["activity"],
  running: boolean,
  failed = false,
): KovaAvatarState {
  if (failed) return "error";
  if (!running) return activity.length ? "success" : "idle";
  const last = [...activity].reverse().find((item) => item.status === "running") ?? activity[activity.length - 1];
  if (!last) return "thinking";
  if (last.kind === "command") return "running";
  if (last.kind === "file") return "editing";
  if (last.kind === "thought") return "thinking";
  const label = last.label.toLowerCase();
  if (label.includes("read")) return "reading";
  if (label.includes("explor") || label.includes("search")) return "searching";
  if (label.includes("edit")) return "editing";
  if (label.includes("command")) return "running";
  return "thinking";
}

function TaskTypeIcon({ type }: { type: string }) {
  if (type === "model") return <Box size={12} />;
  if (type === "animation") return <Play size={12} />;
  if (type === "texture") return <ImageIcon size={12} />;
  if (type === "level") return <LayoutGrid size={12} />;
  if (type === "effect") return <Sparkles size={12} />;
  if (type === "export") return <Upload size={12} />;
  return <Code2 size={12} />;
}

function EngineIcon({ engine }: { engine: string }) {
  const brand = engineBrand(engine as never);
  return brand ? <BrandIcon name={brand} size={13} /> : <Globe size={13} />;
}

type Props = {
  providers: ProviderInfo[];
  defaultProvider: string;
  tasks: Task[];
  engine: Engine;
  localOnly: boolean;
  remoteConsents: string[];
  onGrantConsent: (providerId: string) => Promise<void>;
  onProjectChanged: () => void;
  chatPreferences: ChatPreferences;
  seed?: { text: string; key: number } | null;
  onOpenTask: (taskId: string) => void;
  onTasksChanged: () => void;
};

export default function ChatScreen({
  providers,
  defaultProvider,
  tasks,
  engine,
  localOnly,
  remoteConsents,
  onGrantConsent,
  onProjectChanged,
  chatPreferences,
  seed,
  onOpenTask,
  onTasksChanged,
}: Props) {
  const confirm = useConfirm();
  const available = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.installed &&
          provider.enabled &&
          (!localOnly || (provider.kind === "api" && provider.local_api)),
      ),
    [providers, localOnly],
  );
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chat, setChat] = useState<ChatSession | null>(null);
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdTask, setCreatedTask] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [catalog, setCatalog] = useState<ModelCatalogGroup[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState("");
  const [taskSelection, setTaskSelection] = useState<string[]>([]);
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [pathsDraft, setPathsDraft] = useState("");
  const [consentRequest, setConsentRequest] = useState<ConsentRequest | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!seed) return;
    setText((current) => (current.trim() ? `${current}
${seed.text}` : seed.text));
    composerRef.current?.focus();
  }, [seed?.key]);


  const task = tasks.find((item) => item.id === chat?.task_id) ?? null;

  useEffect(() => {
    listChats()
      .then(setChats)
      .catch(() => setChats([]));
  }, []);

  useEffect(() => {
    let alive = true;
    let source: EventSource | null = null;
    void chatEventsUrl().then((url) => {
      if (!alive) return;
      source = new EventSource(url);
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type?: string; chats?: ChatSummary[] };
          if (payload.type === "chats" && payload.chats) setChats(payload.chats);
        } catch {
          // ignore malformed events
        }
      };
    });
    return () => {
      alive = false;
      source?.close();
    };
  }, []);

  useEffect(() => {
    const chatId = chat?.id;
    if (!chatId) return;
    let alive = true;
    let source: EventSource | null = null;
    void chatEventsUrl(chatId).then((url) => {
      if (!alive) return;
      source = new EventSource(url);
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as {
            type?: string;
            chat?: ChatSession;
          };
          if (payload.type === "deleted") {
            setChat(null);
            return;
          }
          if (payload.chat) setChat(payload.chat);
        } catch {
          // ignore malformed events
        }
      };
    });
    return () => {
      alive = false;
      source?.close();
    };
  }, [chat?.id]);

  useEffect(() => {
    if (!chat?.provider_id) {
      setCatalog([]);
      return;
    }
    let alive = true;
    setCatalogLoading(true);
    getModelCatalog(chat.provider_id)
      .then((groups) => {
        if (alive) setCatalog(groups);
      })
      .catch(() => {
        if (alive) setCatalog([]);
      })
      .finally(() => {
        if (alive) setCatalogLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [chat?.provider_id]);

  useEffect(() => {
    const node = threadRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat?.messages.length, chat?.streaming_output]);

  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "auto";
    const max = Math.min(300, Math.round(window.innerHeight * 0.42));
    node.style.height = `${Math.min(node.scrollHeight, max)}px`;
    node.style.overflowY = node.scrollHeight > max ? "auto" : "hidden";
  }, [text]);

  const catalogModels = catalog.flatMap((group) => group.models);
  const filteredCatalog = catalog
    .map((group) => ({
      ...group,
      models: group.models.filter((model) =>
        `${model.name} ${model.id}`.toLowerCase().includes(modelQuery.trim().toLowerCase()),
      ),
    }))
    .filter((group) => group.models.length > 0);
  const catalogModel = catalogModels.find((item) => item.id === chat?.model) ?? null;
  const effortOptions = [
    "auto",
    ...(catalogModel?.efforts?.length
      ? catalogModel.efforts
      : fallbackEfforts(chat?.provider_id)),
  ];
  const currentProvider = providers.find((item) => item.id === chat?.provider_id) ?? null;
  const safety = chatSafety(
    currentProvider,
    chat?.external_paths?.length ?? 0,
    localOnly,
  );
  const currentModelName = catalogModel?.name ?? (chat?.model ? chat.model.split("/").pop() : "по умолчанию");
  const activeTaskIds = chat
    ? chat.task_ids?.length
      ? chat.task_ids
      : chat.task_id
        ? [chat.task_id]
        : []
    : [];
  const shownTaskIds = taskPickerOpen ? taskSelection : activeTaskIds;
  const shownTasks = tasks.filter((item) => shownTaskIds.includes(item.id));
  const contextText =
    shownTasks.length === 0
      ? "Весь проект"
      : shownTasks.length === 1
        ? shownTasks[0].title
        : `${shownTasks.length} ${shownTasks.length < 5 ? "задачи" : "задач"}`;

  const filtered = chats.filter((item) =>
    `${item.title} ${item.last_message}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const openChat = async (chatId: string) => {
    setBusy(true);
    setError(null);
    setCreatedTask(null);
    try {
      setChat(await getChat(chatId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось открыть чат");
    } finally {
      setBusy(false);
    }
  };

  const newChat = async () => {
    if (available.length === 0) {
      setError("Нет доступных провайдеров. Настрой CLI или API-провайдера в разделе «Агенты».");
      return;
    }
    const first = available.find((item) => item.id === defaultProvider) ?? available[0];
    const model = first.default_model || first.models[0] || "";
    setBusy(true);
    setError(null);
    setCreatedTask(null);
    try {
      const created = await createChat({
        title: "Новый чат",
        scope: "project",
        provider_id: first.id,
        model,
        effort: first.default_effort || "auto",
      });
      setChat(created);
      setChats(await listChats());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать чат");
    } finally {
      setBusy(false);
    }
  };

  const removeChat = async (item: ChatSummary) => {
    const ok = await confirm({
      title: "Удалить чат?",
      message: `Чат «${item.title}» будет удалён.`,
      details: ["История сообщений этого чата удалится.", "Задачи и файлы не затрагиваются."],
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    await deleteChat(item.id);
    if (chat?.id === item.id) setChat(null);
    setChats(await listChats());
  };

  const updateSettings = async (input: {
    provider_id?: string;
    model?: string;
    scope?: "project" | "task";
    task_id?: string;
    effort?: string;
    task_ids?: string[];
    external_paths?: string[];
  }) => {
    if (!chat) return null;
    try {
      const next = await updateChat(chat.id, input);
      setChat(next);
      setChats(await listChats());
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить настройки чата");
      return null;
    }
  };

  const saveExternalPaths = async () => {
    if (!chat) return;
    const paths = pathsDraft
      .split(String.fromCharCode(10))
      .map((item) => item.trim())
      .filter(Boolean);
    const next = await updateSettings({ external_paths: paths });
    if (next && (next.external_paths?.length ?? 0) !== paths.length) {
      setError("Некоторые пути пропущены: нужны существующие абсолютные папки.");
    }
    setAccessOpen(false);
  };

  const copyMessage = async (messageId: string, content: string) => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(content);
      copied = true;
    } catch {
      const area = document.createElement("textarea");
      area.value = content;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        copied = document.execCommand("copy");
      } finally {
        area.remove();
      }
    }
    if (!copied) {
      setError("Не удалось скопировать ответ в буфер обмена.");
      return;
    }
    setCopiedMessage(messageId);
    window.setTimeout(() => setCopiedMessage(null), 1600);
  };

  const applyTaskSelection = (next: string[]) => {
    setTaskSelection(next);
    void updateSettings({
      scope: next.length ? "task" : "project",
      task_id: next[0] ?? "",
      task_ids: next,
    });
  };

  useEffect(() => {
    if (!taskPickerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTaskPickerOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".chat-task-menu") && !target.closest(".chat-context-trigger")) {
        setTaskPickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [taskPickerOpen]);

  const providerHost = (provider: ProviderInfo): string => {
    if (provider.kind !== "api") return "внешний CLI-провайдер";
    if (provider.api_url) {
      try {
        return new URL(provider.api_url).host;
      } catch {
        return provider.api_url;
      }
    }
    return provider.name;
  };

  const providerIsRemote = (provider: ProviderInfo): boolean =>
    provider.kind === "api" ? !provider.local_api : true;

  const dispatchMessage = async (
    message: string,
    attachments: ChatAttachmentInput[],
  ) => {
    if (!chat) return;
    setText("");
    setBusy(true);
    setError(null);
    setCreatedTask(null);
    try {
      const next = await sendChatMessage(chat.id, message, attachments);
      setChat(next);
      setPending([]);
      setChats(await listChats());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить сообщение");
      setText(message);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!chat || chat.status === "running") return;
    const message = text.trim();
    if (!message && pending.length === 0) return;
    const attachments: ChatAttachmentInput[] = pending.map((item) => ({
      name: item.name,
      mime: item.mime,
      data: item.data,
    }));
    const provider =
      providers.find((item) => item.id === chat.provider_id) ?? currentProvider;
    if (provider && localOnly && providerIsRemote(provider)) {
      setError(
        "Включён режим только локальных моделей. Выбери локальный API в настройках провайдера.",
      );
      return;
    }
    if (
      provider &&
      !localOnly &&
      providerIsRemote(provider) &&
      !remoteConsents.includes(provider.id)
    ) {
      setConsentRequest({ provider, message, attachments, pending });
      return;
    }
    await dispatchMessage(message, attachments);
  };

  const confirmConsent = async () => {
    const request = consentRequest;
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      await onGrantConsent(request.provider.id);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Не удалось сохранить согласие");
      return;
    }
    setConsentRequest(null);
    await dispatchMessage(request.message, request.attachments);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = 4 - pending.length;
    if (room <= 0) {
      setError("Можно прикрепить не больше 4 файлов к одному сообщению.");
      return;
    }
    const rows: PendingAttachment[] = [];
    for (const file of Array.from(files).slice(0, room)) {
      if (file.size > 12_000_000) {
        setError(`${file.name}: файл больше 12 МБ.`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => resolve("");
        reader.readAsDataURL(file);
      });
      if (!dataUrl) continue;
      rows.push({
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        kind: attachmentKind(file.type),
        dataUrl,
        data: dataUrl.split(",")[1] || "",
      });
    }
    if (rows.length) setPending((prev) => [...prev, ...rows].slice(0, 4));
    setError(null);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPickerOpen(false);
        setAttachOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files;
      if (files?.length) {
        event.preventDefault();
        void handleFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pending]);

  const handleAction = async (action: ChatAction, decision: "approve" | "reject") => {
    if (!chat) return;
    setDeciding(action.id);
    setError(null);
    try {
      const next = await decideChatAction(chat.id, action.id, decision);
      setChat(next);
      if (decision === "approve") {
        onTasksChanged();
        if (action.type === "update_project_settings") onProjectChanged();
      }
      setChats(await listChats());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить действие");
    } finally {
      setDeciding(null);
    }
  };

  const stop = async () => {
    if (!chat) return;
    try {
      setChat(await cancelChat(chat.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось остановить ответ");
    }
  };

  const makeTask = async (content: string) => {
    const title =
      content
        .split("\n")
        .map((line) => line.replace(/^#+\s*/, "").trim())
        .find(Boolean)
        ?.slice(0, 80) || "Задача из чата";
    setBusy(true);
    try {
      const task = await createTask({
        title,
        type: "code",
        engine,
        goal: content,
        criteria: [],
      });
      setCreatedTask(task.id);
      onTasksChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать задачу");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat-page">
      <aside className="chat-sidebar">
        <div className="chat-side-head">
          <div>
            <h1>Чат</h1>
            <p>Проект, задачи и агенты</p>
          </div>
          <button type="button" className="btn btn-primary btn-small" onClick={() => void newChat()}>
            <Plus size={13} />
            Новый
          </button>
        </div>
        <label className="resource-search chat-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск чатов…"
          />
        </label>
        <div className="chat-list">
          {filtered.length === 0 ? (
            <div className="chat-list-empty">
              <MessageSquare size={18} />
              <span>Чатов пока нет</span>
            </div>
          ) : (
            filtered.map((item) => (
              <div
                className={`chat-list-item${chat?.id === item.id ? " is-active" : ""}`}
                key={item.id}
                onClick={() => void openChat(item.id)}
              >
                <span className="chat-list-icon">
                  {item.scope === "task" ? <ClipboardPlus size={14} /> : <MessageSquare size={14} />}
                </span>
                <span className="chat-list-copy">
                  <b>{item.title}</b>
                  <small>{item.last_message || "Пустой чат"}</small>
                </span>
                <span className="chat-list-meta">
                  {item.status === "running" ? <i className="chat-live-dot" /> : null}
                  <button
                    type="button"
                    className="tk-icon-btn"
                    title="Удалить чат"
                    onClick={(event) => {
                      event.stopPropagation();
                      void removeChat(item);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="chat-main">
        {!chat ? (
          <div className="chat-empty">
            <span className="chat-empty-icon">
              <KovaAvatar size={104} />
            </span>
            <h2>Мяу, я Kova</h2>
            <p>
              Спроси про проект, задачи, ассеты или следующий шаг. Контекст проекта уже со
              мной.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => void newChat()}>
              <Plus size={14} />
              Начать чат
            </button>
          </div>
        ) : (
          <>
            <header className="chat-head">
              <div className="chat-title">
                <b>{chat.title}</b>
                <span>{task ? task.title : "Весь проект"}</span>
              </div>
              <button
                type="button"
                className="chat-safety-badge"
                title={`${safety.title} Нажми, чтобы настроить внешние папки.`}
                onClick={() => {
                  setPathsDraft((chat.external_paths ?? []).join("\n"));
                  setAccessOpen((value) => !value);
                }}
              >
                <ShieldCheck size={12} />
                {safety.label}
                <ChevronDown size={11} />
              </button>
              {task ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => onOpenTask(task.id)}
                >
                  Открыть задачу
                </button>
              ) : null}
            </header>

            {accessOpen ? (
              <div className="chat-access-panel">
                <div className="chat-access-head">
                  <b>
                    <FolderLock size={13} />
                    Внешние папки
                  </b>
                  <button
                    type="button"
                    className="tk-icon-btn"
                    title="Закрыть"
                    onClick={() => setAccessOpen(false)}
                  >
                    <X size={13} />
                  </button>
                </div>
                <p>
                  Разрешить чтение вне проекта для этого чата. Изменения файлов,
                  команды и сеть остаются заблокированы.
                </p>
                <textarea
                  value={pathsDraft}
                  onChange={(event) => setPathsDraft(event.target.value)}
                  placeholder={["C:/work/shared", "D:/assets"].join(
                    String.fromCharCode(10),
                  )}
                  rows={3}
                />
                <div className="chat-access-actions">
                  <small>По одной абсолютной папке на строку</small>
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    onClick={() => void saveExternalPaths()}
                  >
                    Сохранить
                  </button>
                </div>
              </div>
            ) : null}

            {consentRequest ? (
              <div className="chat-consent-overlay" role="dialog" aria-modal="true">
                <div className="chat-consent-card">
                  <b>Отправить данные провайдеру?</b>
                  <p>
                    Kova отправит текст запроса и файлы, которые прочитает агент,
                    в этот сервис. Без этого он не сможет ответить.
                  </p>
                  <div className="chat-consent-target">
                    <strong>{consentRequest.provider.name}</strong>
                    <span>{providerHost(consentRequest.provider)}</span>
                  </div>
                  <small>
                    {consentRequest.pending.length
                      ? `Вложений: ${consentRequest.pending.length}. `
                      : ""}
                    Согласие запоминается для проекта и провайдера — повторно спрашивать
                    не будем.
                  </small>
                  <div className="chat-consent-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => setConsentRequest(null)}
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      disabled={busy}
                      onClick={() => void confirmConsent()}
                    >
                      Разрешить и отправить
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="chat-thread" ref={threadRef}>
              {chat.messages.length === 0 && chat.status !== "running" ? (
                <div className="chat-hint">
                  <KovaAvatar size={84} />
                  <div className="chat-hint-copy">
                    <b>Мяу, я Kova</b>
                    <span>Напиши первый вопрос. Контекст проекта уже передан; чат только читает и не меняет файлы.</span>
                    <button
                      type="button"
                      className="chat-hint-action"
                      onClick={() => {
                        setText(
                          "Расскажи, что умеет Kova: какие разделы есть, какие настройки важны и с чего начать работу.",
                        );
                        composerRef.current?.focus();
                      }}
                    >
                      Что умеет Kova?
                    </button>
                  </div>
                </div>
              ) : null}
              {chat.messages.map((message) => (
                <article className={`chat-message is-${message.role}`} key={message.id}>
                  <span className="chat-avatar">
                    {message.role === "user" ? (
                      <User size={14} />
                    ) : (
                      <KovaAvatar
                        state={activityAvatarState(message.activity ?? [], false, message.content.startsWith("Ошибка"))}
                        size={24}
                      />
                    )}
                  </span>
                  <div className="chat-bubble">
                    {message.role === "assistant" &&
                    (message.activity?.length || message.egress) ? (
                      <ChatActivityPanel
                        activity={message.activity ?? []}
                        egress={message.egress}
                      />
                    ) : null}
                    <div
                      className="chat-bubble-text"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                    />
                    {message.attachments?.length ? (
                      <div className="chat-media">
                        {message.attachments.map((item) => {
                          const url = chatAttachmentUrl(chat.id, item.id);
                          if (item.kind === "image") {
                            return (
                              <a
                                className="chat-media-image"
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                key={item.id}
                                title={item.name}
                              >
                                <img src={url} alt={item.name} />
                              </a>
                            );
                          }
                          if (item.kind === "video") {
                            return (
                              <video
                                className="chat-media-video"
                                controls
                                preload="metadata"
                                src={url}
                                key={item.id}
                              />
                            );
                          }
                          return (
                            <a
                              className="chat-file-card"
                              href={url}
                              download={item.name}
                              key={item.id}
                            >
                              <FileText size={16} />
                              <span>
                                <b>{item.name}</b>
                                <small>{formatBytes(item.size)}</small>
                              </span>
                              <Download size={14} />
                            </a>
                          );
                        })}
                      </div>
                    ) : null}
                    {message.actions?.length ? (
                      <div className="chat-actions">
                        {message.actions.map((action) => {
                          const resultTask = actionResultTask(action);
                          return (
                            <div className={`chat-action is-${action.status}`} key={action.id}>
                              <div className="chat-action-head">
                                <span className="chat-action-icon">
                                  <ClipboardPlus size={12} />
                                </span>
                                <span className="chat-action-copy">
                                  <b>{actionLabel(action)}</b>
                                  <small>{actionDetail(action)}</small>
                                </span>
                              </div>
                              {action.status === "pending" ? (
                                <div className="chat-action-buttons">
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-small"
                                    disabled={deciding === action.id}
                                    onClick={() => void handleAction(action, "approve")}
                                  >
                                    <Check size={11} />
                                    {action.type === "start_agent_run" ? "Запустить" : "Подтвердить"}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-small"
                                    disabled={deciding === action.id}
                                    onClick={() => void handleAction(action, "reject")}
                                  >
                                    <X size={11} />
                                    Отклонить
                                  </button>
                                </div>
                              ) : (
                                <small className={`chat-action-state is-${action.status}`}>
                                  {action.status === "approved"
                                    ? "Выполнено"
                                    : action.status === "rejected"
                                      ? "Отклонено"
                                      : "Ошибка"}
                                </small>
                              )}
                              {action.error ? (
                                <small className="chat-action-error">{action.error}</small>
                              ) : null}
                              {resultTask ? (
                                <button
                                  type="button"
                                  className="agent-link"
                                  onClick={() => onOpenTask(resultTask)}
                                >
                                  Открыть задачу →
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    <div className="chat-bubble-foot">
                      {chatPreferences.showTimestamps ? (
                        <small>{formatDate(message.created_at)}</small>
                      ) : (
                        <span />
                      )}
                      {message.role === "assistant" ? (
                        <span className="chat-message-actions">
                          <button
                            type="button"
                            className={`agent-link${copiedMessage === message.id ? " is-copied" : ""}`}
                            onClick={() => void copyMessage(message.id, message.content)}
                          >
                            <Copy size={11} />
                            {copiedMessage === message.id ? "Скопировано" : "Копировать"}
                          </button>
                          {!message.actions?.length ? (
                            <button
                              type="button"
                              className="agent-link"
                              onClick={() => void makeTask(message.content)}
                            >
                              <ClipboardPlus size={11} />
                              Создать задачу
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
              {chat.status === "running" ? (
                <article className="chat-message is-assistant">
                  <span className="chat-avatar">
                    <KovaAvatar
                      state={activityAvatarState(chat.activity ?? [], true)}
                      size={24}
                    />
                  </span>
                  <div className="chat-bubble chat-bubble-activity">
                    <ChatActivityPanel activity={chat.activity ?? []} running />
                  </div>
                </article>
              ) : null}
              {createdTask ? (
                <button
                  type="button"
                  className="chat-task-link"
                  onClick={() => onOpenTask(createdTask)}
                >
                  Задача создана. Открыть →
                </button>
              ) : null}
            </div>

            {error ? <div className="chat-error">{error}</div> : null}

            {pending.length ? (
              <div className="chat-pending">
                {pending.map((item, index) => (
                  <div className="chat-pending-item" key={`${item.name}-${index}`}>
                    {item.kind === "image" ? (
                      <img src={item.dataUrl} alt={item.name} />
                    ) : item.kind === "video" ? (
                      <video src={item.dataUrl} muted preload="metadata" />
                    ) : (
                      <FileText size={16} />
                    )}
                    <span>
                      <b>{item.name}</b>
                      <small>{formatBytes(item.size)}</small>
                    </span>
                    <button
                      type="button"
                      title="Убрать файл"
                      onClick={() =>
                        setPending((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="chat-composer-wrap">
              {attachOpen ? (
                <div className="chat-attach-menu">
                  <button type="button" onClick={() => fileRef.current?.click()}>
                    <FileText size={15} />
                    Загрузить файлы
                  </button>
                  <button type="button" onClick={() => fileRef.current?.click()}>
                    <ImageIcon size={15} />
                    Изображение или скриншот
                  </button>
                  <button type="button" onClick={() => fileRef.current?.click()}>
                    <Video size={15} />
                    Видео
                  </button>
                  <div className="chat-attach-hint">
                    <ClipboardPaste size={14} />
                    Ctrl+V — вставить скриншот из буфера
                  </div>
                </div>
              ) : null}

              {pickerOpen ? (
                <div className="chat-picker">
                  <div className="chat-picker-head">
                    <b>Модель и рассуждение</b>
                    <button type="button" onClick={() => setPickerOpen(false)} title="Закрыть">
                      <X size={15} />
                    </button>
                  </div>
                  <label className="chat-picker-label">
                    Провайдер
                    <select
                      value={chat.provider_id}
                      onChange={(event) => {
                        const next = providers.find((item) => item.id === event.target.value);
                        void updateSettings({
                          provider_id: event.target.value,
                          model: next?.default_model || next?.models[0] || "",
                        });
                        setModelQuery("");
                      }}
                    >
                      {available.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="chat-picker-label">
                    Модель
                    <input
                      type="search"
                      value={modelQuery}
                      placeholder="Поиск модели…"
                      onChange={(event) => setModelQuery(event.target.value)}
                    />
                  </label>
                  <div className="chat-model-list">
                    {catalogLoading ? <small>Загрузка моделей…</small> : null}
                    {!catalogLoading &&
                      filteredCatalog.map((group) => (
                        <div className="chat-model-group" key={group.id}>
                          <div className="chat-model-group-head">
                            <span>{group.label}</span>
                            <b>{group.models.length}</b>
                          </div>
                          {group.models.map((model) => (
                            <button
                              type="button"
                              key={model.id}
                              className={model.id === chat.model ? "is-active" : ""}
                              onClick={() => {
                                const keepEffort =
                                  (chat.effort ?? "auto") === "auto" ||
                                  model.efforts.includes(chat.effort ?? "");
                                void updateSettings({
                                  model: model.id,
                                  effort: keepEffort ? chat.effort ?? "auto" : "auto",
                                });
                                setPickerOpen(false);
                              }}
                            >
                              <span>{model.name}</span>
                              {model.free ? <em>Free</em> : null}
                              {model.id === chat.model ? <Check size={13} /> : null}
                            </button>
                          ))}
                        </div>
                      ))}
                    {!catalogLoading && filteredCatalog.length === 0 ? (
                      <small>
                        {catalog.length === 0
                          ? "У провайдера нет списка моделей — используется модель по умолчанию."
                          : "Ничего не найдено."}
                      </small>
                    ) : null}
                  </div>
                  <div className="chat-effort">
                    <small>Effort</small>
                    {effortOptions.length > 1 ? (
                      <div className="chat-effort-buttons">
                        {effortOptions.map((item) => (
                          <button
                            type="button"
                            key={item}
                            className={(chat.effort ?? "auto") === item ? "is-active" : ""}
                            onClick={() => void updateSettings({ effort: item })}
                          >
                            {effortLabel(item)}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <small className="chat-effort-note">
                        У этой модели нет отдельных уровней effort — используется Auto.
                      </small>
                    )}
                  </div>
                  <button
                    type="button"
                    className="chat-reset-defaults"
                    onClick={() => {
                      const globalDefault =
                        available.find((item) => item.id === defaultProvider) ?? available[0];
                      if (!globalDefault) return;
                      void updateSettings({
                        provider_id: globalDefault.id,
                        model: globalDefault.default_model || globalDefault.models[0] || "",
                        effort: globalDefault.default_effort || "auto",
                      });
                      setPickerOpen(false);
                    }}
                  >
                    Сбросить к настройкам по умолчанию
                  </button>
                </div>
              ) : null}

              {taskPickerOpen ? (
                <div className="chat-task-menu">
                  <input
                    type="search"
                    value={taskQuery}
                    placeholder="Поиск задач…"
                    onChange={(event) => setTaskQuery(event.target.value)}
                    autoFocus
                  />
                  <div className="chat-task-menu-list">
                    <button
                      type="button"
                      className={`chat-task-option${taskSelection.length === 0 ? " is-active" : ""}`}
                      onClick={() => applyTaskSelection([])}
                    >
                      <span className="chat-task-check">{taskSelection.length === 0 ? "✓" : ""}</span>
                      <span className="chat-task-copy">
                        <b>Весь проект</b>
                        <small>Общий контекст проекта</small>
                      </span>
                    </button>
                    {tasks
                      .filter((item) =>
                        `${item.title} ${item.goal}`
                          .toLowerCase()
                          .includes(taskQuery.trim().toLowerCase()),
                      )
                      .map((item) => {
                        const active = taskSelection.includes(item.id);
                        return (
                          <button
                            type="button"
                            className={`chat-task-option${active ? " is-active" : ""}`}
                            key={item.id}
                            onClick={() =>
                              applyTaskSelection(
                                active
                                  ? taskSelection.filter((id) => id !== item.id)
                                  : [...taskSelection, item.id],
                              )
                            }
                          >
                            <span className="chat-task-check">{active ? "✓" : ""}</span>
                            <span className="chat-task-copy">
                              <b>{item.title}</b>
                              <small>
                                <span className="chat-task-kind">
                                  <TaskTypeIcon type={item.type} />
                                  {item.type}
                                </span>
                                <span className="chat-task-engine">
                                  <EngineIcon engine={item.engine} />
                                </span>
                                <span>{item.status}</span>
                              </small>
                            </span>
                          </button>
                        );
                      })}
                    {tasks.length === 0 ? <small className="chat-task-empty">Задач пока нет</small> : null}
                  </div>
                </div>
              ) : null}

              <div className="chat-context-row">
                <button
                  type="button"
                  className="chat-context-trigger"
                  onClick={() => {
                    setTaskSelection(activeTaskIds);
                    setTaskQuery("");
                    setTaskPickerOpen((value) => !value);
                  }}
                >
                  <span className="chat-context-check">{shownTasks.length ? "✓" : "▦"}</span>
                  <span>{contextText}</span>
                  <ChevronDown size={13} />
                </button>
              </div>

              <div className="chat-composer-pill">
                <button
                  type="button"
                  className="chat-plus"
                  title="Добавить файл"
                  onClick={() => {
                    setAttachOpen((value) => !value);
                    setPickerOpen(false);
                  }}
                >
                  <Plus size={17} />
                </button>
                <textarea
                  ref={composerRef}
                  rows={1}
                  value={text}
                  placeholder="Спроси про проект, задачу или следующий шаг…"
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    const sendKey =
                      event.key === "Enter" &&
                      ((chatPreferences.enterToSend && !event.shiftKey) ||
                        (!chatPreferences.enterToSend &&
                          (event.ctrlKey || event.metaKey)));
                    if (sendKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  type="button"
                  className="chat-model-pill"
                  onClick={() => {
                    setPickerOpen((value) => !value);
                    setAttachOpen(false);
                  }}
                >
                  <span>{currentProvider?.name ?? "Модель"}</span>
                  <small>
                    {currentModelName} · {effortLabel(chat.effort)}
                  </small>
                  <ChevronDown size={14} />
                </button>
                {chat.status === "running" ? (
                  <button
                    type="button"
                    className="chat-stop-button"
                    title="Остановить ответ"
                    onClick={() => void stop()}
                  >
                    <CircleStop size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="chat-send-button"
                    disabled={busy || (!text.trim() && pending.length === 0)}
                    title="Отправить"
                    onClick={() => void send()}
                  >
                    <Send size={16} />
                  </button>
                )}
              </div>
              <div className="chat-composer-hint">
                {chatPreferences.enterToSend
                  ? "Enter — отправить · Shift+Enter — новая строка"
                  : "Ctrl+Enter — отправить · Enter — новая строка"}
              </div>
              <input
                ref={fileRef}
                type="file"
                className="chat-file-input"
                multiple
                accept="image/*,video/*,.txt,.md,.json,.yaml,.yml,.toml,.ini,.cfg,.csv,.cs,.lua,.py,.ts,.tsx,.js,.jsx,.html,.css,.glsl,.hlsl,.shader,.xml"
                onChange={(event) => {
                  void handleFiles(event.target.files);
                  event.target.value = "";
                  setAttachOpen(false);
                }}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
