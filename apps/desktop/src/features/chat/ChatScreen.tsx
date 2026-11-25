import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  CircleStop,
  ClipboardPlus,
  Download,
  FileText,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useConfirm } from "../../components/ConfirmProvider";
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
  listChats,
  sendChatMessage,
  updateChat,
} from "../../lib/coreClient";
import { formatDate } from "../../lib/format";
import type {
  ChatAction,
  ChatSession,
  ChatSummary,
  Engine,
  ProviderInfo,
  Task,
} from "../../lib/types";

function actionLabel(action: ChatAction): string {
  if (action.type === "create_task") return "Создать задачу";
  if (action.type === "update_task") return "Обновить задачу";
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
  const parts = [String(payload.task_id ?? "")];
  if (payload.provider_id) parts.push(String(payload.provider_id));
  return parts.filter(Boolean).join(" · ");
}

function actionResultTask(action: ChatAction): string {
  const value = action.result?.task_id;
  return typeof value === "string" ? value : "";
}

type PendingAttachment = {
  name: string;
  mime: string;
  size: number;
  kind: "image" | "video" | "text" | "file";
  dataUrl: string;
  data: string;
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
  const lines = value.split(NL);
  const out: string[] = [];
  let code: string[] = [];
  let inCode = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trimStart().startsWith(TICK.repeat(3))) {
      if (inCode) {
        out.push(`<pre class="chat-code"><code>${escape(code.join(NL))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      out.push("");
      continue;
    }
    let html = escape(line);
    html = html
      .split(TICK)
      .map((part, index) => (index % 2 === 1 ? `<code class="chat-inline">${part}</code>` : part))
      .join("");
    html = html.replace(/[*][*]([^*]+)[*][*]/g, "<strong>$1</strong>");
    if (/^### /.test(html)) out.push(`<h3>${html.slice(4)}</h3>`);
    else if (/^## /.test(html)) out.push(`<h2>${html.slice(3)}</h2>`);
    else if (/^# /.test(html)) out.push(`<h1>${html.slice(2)}</h1>`);
    else if (/^[-*] /.test(html)) out.push(`<div class="chat-li">• ${html.slice(2)}</div>`);
    else out.push(html);
  }
  if (inCode && code.length) {
    out.push(`<pre class="chat-code"><code>${escape(code.join(NL))}</code></pre>`);
  }
  return out.join("<br/>");
}

function KovaCat() {
  return (
    <svg className="kova-cat" viewBox="0 0 120 112" role="img" aria-label="Кот Kova">
      <g className="kova-cat-tail">
        <path d="M86 94c16 2 24-7 22-18-2-9-9-13-15-11" />
      </g>
      <ellipse cx="58" cy="84" rx="31" ry="23" fill="currentColor" opacity="0.1" />
      <circle cx="52" cy="50" r="24" fill="currentColor" opacity="0.1" />
      <path d="M31 39 28 20l17 12M73 39l3-19-17 12" fill="currentColor" opacity="0.1" />
      <g className="kova-cat-eyes">
        <path d="M40 49c2.5 2.6 5.2 2.6 7.8 0M56 49c2.5 2.6 5.2 2.6 7.8 0" />
      </g>
      <path d="M52 57l-2 2h4Z" fill="currentColor" />
      <path d="M52 59c-1.5 2.5-4 3-6 3M52 59c1.5 2.5 4 3 6 3" />
      <path d="M31 55l-10-1M31 60l-10 2M73 55l10-1M73 60l10 2" />
      <path d="M37 67c9 4 21 4 30 0" />
      <ellipse cx="44" cy="102" rx="7" ry="3.5" fill="currentColor" opacity="0.14" />
      <ellipse cx="70" cy="102" rx="7" ry="3.5" fill="currentColor" opacity="0.14" />
    </svg>
  );
}

type Props = {
  providers: ProviderInfo[];
  defaultProvider: string;
  tasks: Task[];
  engine: Engine;
  onOpenTask: (taskId: string) => void;
  onTasksChanged: () => void;
};

export default function ChatScreen({
  providers,
  defaultProvider,
  tasks,
  engine,
  onOpenTask,
  onTasksChanged,
}: Props) {
  const confirm = useConfirm();
  const available = useMemo(
    () => providers.filter((provider) => provider.installed && provider.enabled),
    [providers],
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
  const threadRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const provider =
    providers.find((item) => item.id === chat?.provider_id) ??
    providers.find((item) => item.id === defaultProvider) ??
    available[0] ??
    null;
  const models = provider?.models ?? [];
  const task = tasks.find((item) => item.id === chat?.task_id) ?? null;

  useEffect(() => {
    listChats()
      .then(setChats)
      .catch(() => setChats([]));
  }, []);

  useEffect(() => {
    const source = new EventSource(chatEventsUrl());
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string; chats?: ChatSummary[] };
        if (payload.type === "chats" && payload.chats) setChats(payload.chats);
      } catch {
        // ignore malformed events
      }
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    if (!chat) return;
    const source = new EventSource(chatEventsUrl(chat.id));
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
    return () => source.close();
  }, [chat?.id]);

  useEffect(() => {
    const node = threadRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat?.messages.length, chat?.streaming_output]);

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
  }) => {
    if (!chat) return;
    try {
      const next = await updateChat(chat.id, input);
      setChat(next);
      setChats(await listChats());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить настройки чата");
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

  const handleAction = async (actionId: string, decision: "approve" | "reject") => {
    if (!chat) return;
    setDeciding(actionId);
    setError(null);
    try {
      const next = await decideChatAction(chat.id, actionId, decision);
      setChat(next);
      if (decision === "approve") onTasksChanged();
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
              <KovaCat />
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
              {task ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => onOpenTask(task.id)}
                >
                  Открыть задачу
                </button>
              ) : null}
              <div className="chat-controls">
                <select
                  value={chat.scope}
                  onChange={(event) => {
                    const scope = event.target.value as "project" | "task";
                    void updateSettings({
                      scope,
                      task_id: scope === "task" ? tasks[0]?.id ?? "" : "",
                    });
                  }}
                >
                  <option value="project">Проект</option>
                  <option value="task">Задача</option>
                </select>
                {chat.scope === "task" ? (
                  <select
                    value={chat.task_id}
                    onChange={(event) => void updateSettings({ task_id: event.target.value })}
                  >
                    {tasks.length === 0 ? <option value="">Нет задач</option> : null}
                    {tasks.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                ) : null}
                <select
                  value={chat.provider_id}
                  onChange={(event) => {
                    const next = providers.find((item) => item.id === event.target.value);
                    void updateSettings({
                      provider_id: event.target.value,
                      model: next?.default_model || next?.models[0] || "",
                    });
                  }}
                >
                  {available.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                {models.length > 0 ? (
                  <select
                    value={chat.model}
                    onChange={(event) => void updateSettings({ model: event.target.value })}
                  >
                    {models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </header>

            <div className="chat-thread" ref={threadRef}>
              {chat.messages.length === 0 && chat.status !== "running" ? (
                <div className="chat-hint">
                  <KovaCat />
                  <div className="chat-hint-copy">
                    <b>Мяу, я Kova</b>
                    <span>Напиши первый вопрос. Контекст проекта уже передан агенту.</span>
                  </div>
                </div>
              ) : null}
              {chat.messages.map((message) => (
                <article className={`chat-message is-${message.role}`} key={message.id}>
                  <span className="chat-avatar">
                    {message.role === "user" ? <User size={14} /> : <Bot size={14} />}
                  </span>
                  <div className="chat-bubble">
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
                                    onClick={() => void handleAction(action.id, "approve")}
                                  >
                                    <Check size={11} />
                                    {action.type === "start_agent_run" ? "Запустить" : "Подтвердить"}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-small"
                                    disabled={deciding === action.id}
                                    onClick={() => void handleAction(action.id, "reject")}
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
                      <small>{formatDate(message.created_at)}</small>
                      {message.role === "assistant" && !message.actions?.length ? (
                        <button
                          type="button"
                          className="agent-link"
                          onClick={() => void makeTask(message.content)}
                        >
                          <ClipboardPlus size={11} />
                          Создать задачу
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
              {chat.status === "running" ? (
                <article className="chat-message is-assistant">
                  <span className="chat-avatar">
                    <Bot size={14} />
                  </span>
                  <div className="chat-bubble">
                    <div className="chat-bubble-text is-streaming">
                      {chat.streaming_output || "Агент думает…"}
                    </div>
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

            <div className="chat-composer">
              <textarea
                rows={2}
                value={text}
                placeholder="Спроси про проект, задачу, ассет или следующий шаг…"
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <input
                ref={fileRef}
                type="file"
                className="chat-file-input"
                multiple
                accept="image/*,video/*,.txt,.md,.json,.yaml,.yml,.toml,.ini,.cfg,.csv,.cs,.lua,.py,.ts,.tsx,.js,.jsx,.html,.css,.glsl,.hlsl,.shader,.xml"
                onChange={(event) => {
                  void handleFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-small"
                title="Прикрепить файл"
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip size={14} />
                Вложить
              </button>
              {chat.status === "running" ? (
                <button type="button" className="btn btn-secondary btn-small" onClick={() => void stop()}>
                  <CircleStop size={13} />
                  Остановить
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={busy || !text.trim()}
                  onClick={() => void send()}
                >
                  <Send size={13} />
                  Отправить
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
