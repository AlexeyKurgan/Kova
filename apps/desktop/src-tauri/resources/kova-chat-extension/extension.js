const vscode = require("vscode");
const http = require("http");
const fs = require("fs");
const path = require("path");

const API = "http://127.0.0.1:8765";
const CHAT_VIEW = "kova.chatView";

let lastEditor = null;
let runPanel = null;

function request(route, method = "GET", body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      `${API}${route}`,
      {
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": payload.length }
          : {},
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            let detail = data || `HTTP ${res.statusCode}`;
            try {
              const parsed = JSON.parse(data);
              if (parsed && parsed.detail) detail = parsed.detail;
            } catch {
              // keep the raw response
            }
            reject(new Error(detail));
            return;
          }
          if (!data) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function loadHtml(name, replacements) {
  let html = fs.readFileSync(path.join(__dirname, name), "utf8");
  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }
  return html;
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function attachmentFromEditor() {
  const editor =
    vscode.window.activeTextEditor ||
    lastEditor ||
    vscode.window.visibleTextEditors[0] ||
    null;
  if (!editor) return null;
  const document = editor.document;
  const selection = editor.selection;
  const hasSelection = !selection.isEmpty;
  const raw = hasSelection ? document.getText(selection) : document.getText();
  const text = raw.slice(0, 12000);
  return {
    type: "attachment",
    path: vscode.workspace.asRelativePath(document.uri, false),
    language: document.languageId,
    start: hasSelection ? selection.start.line + 1 : 1,
    end: hasSelection ? selection.end.line + 1 : document.lineCount,
    text,
    truncated: raw.length > text.length,
  };
}

async function focusChatView() {
  try {
    await vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
  } catch {
    // the auxiliary bar may already be focused
  }
  try {
    await vscode.commands.executeCommand("kova.chatView.focus");
  } catch {
    // older VS Code builds use a different command
  }
}

class ChatViewProvider {
  constructor(context) {
    this.context = context;
    this.view = null;
    this.chatId = context.workspaceState.get("kova.chatId") || "";
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = loadHtml("chat.html", {
      __INITIAL_CHAT__: JSON.stringify(this.chatId || ""),
    });
    view.webview.onDidReceiveMessage(async (message) => {
      if (!message) return;
      if (message.type === "attach") {
        const attachment = attachmentFromEditor();
        if (!attachment) {
          view.webview.postMessage({
            type: "error",
            message: "Открой файл или выдели текст в редакторе",
          });
          return;
        }
        view.webview.postMessage(attachment);
      } else if (message.type === "chatChanged") {
        this.chatId = String(message.chatId || "");
        await this.context.workspaceState.update("kova.chatId", this.chatId);
      } else if (message.type === "openTask") {
        void openTaskChat(this, String(message.taskId || ""));
      } else if (message.type === "openRun") {
        void openRunPanel(this.context, String(message.taskId || ""));
      } else if (message.type === "refreshTrees") {
        this.refresh();
      }
    });
    view.onDidDispose(() => {
      this.view = null;
    });
  }

  open(chatId) {
    this.chatId = chatId;
    void this.context.workspaceState.update("kova.chatId", chatId);
    void focusChatView();
    if (this.view) this.view.webview.postMessage({ type: "openChat", chatId });
  }

  refresh() {
    if (this.view) this.view.webview.postMessage({ type: "reload" });
  }

  async currentTaskId() {
    if (!this.chatId) return "";
    try {
      const chat = await request(`/chats/${encodeURIComponent(this.chatId)}`);
      return String((chat && chat.task_id) || "");
    } catch {
      return "";
    }
  }
}

async function firstProvider() {
  const payload = await request("/providers");
  const providers = (payload && payload.providers) || [];
  const defaultId = payload && payload.default_provider;
  return (
    providers.find((item) => item.id === defaultId && item.installed && item.enabled) ||
    providers.find((item) => item.installed && item.enabled) ||
    null
  );
}

async function openTaskChat(provider, taskId) {
  if (!taskId) return;
  try {
    const providerInfo = await firstProvider();
    const chats = await request("/chats");
    const existing = chats.find((item) => item.scope === "task" && item.task_id === taskId);
    if (existing) {
      provider.open(existing.id);
      return;
    }
    const task = (await request("/tasks")).find((item) => item.id === taskId);
    if (!providerInfo) {
      vscode.window.showErrorMessage("Kova: нет доступных провайдеров");
      return;
    }
    const chat = await request("/chats", "POST", {
      title: (task && task.title) || "Задача",
      scope: "task",
      task_id: taskId,
      provider_id: providerInfo.id,
      model: providerInfo.default_model || (providerInfo.models && providerInfo.models[0]) || "",
      effort: providerInfo.default_effort || "auto",
    });
    provider.open(chat.id);
  } catch (error) {
    vscode.window.showErrorMessage(`Kova: ${error.message || error}`);
  }
}

async function openRunPanel(context, taskId) {
  try {
    const query = taskId
      ? `/ai/runs?task_id=${encodeURIComponent(taskId)}&limit=1`
      : "/ai/runs?limit=1";
    const runs = await request(query);
    const run = Array.isArray(runs) && runs.length ? runs[0] : null;
    const html = loadHtml("run.html", { __RUN__: safeJson(run) });
    if (runPanel) {
      runPanel.webview.html = html;
      runPanel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    runPanel = vscode.window.createWebviewPanel(
      "kova.run",
      "Kova — Результат",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    runPanel.webview.html = html;
    runPanel.onDidDispose(() => {
      runPanel = null;
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Kova: ${error.message || error}`);
  }
}

function activate(context) {
  lastEditor = vscode.window.activeTextEditor;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) lastEditor = editor;
    }),
  );

  const chatView = new ChatViewProvider(context);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  status.text = "$(comment-discussion) Kova";
  status.tooltip = "Открыть Kova Chat";
  status.command = "kova.openChatView";
  status.show();
  context.subscriptions.push(
    status,
    vscode.window.registerWebviewViewProvider(CHAT_VIEW, chatView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kova.openChatView", () => {
      void focusChatView();
      if (!chatView.chatId) {
        void vscode.commands.executeCommand("kova.newChat");
      }
    }),
    vscode.commands.registerCommand("kova.refresh", () => chatView.refresh()),
    vscode.commands.registerCommand("kova.newChat", async () => {
      try {
        const provider = await firstProvider();
        if (!provider) {
          vscode.window.showErrorMessage("Kova: нет доступных провайдеров");
          return;
        }
        const chat = await request("/chats", "POST", {
          title: "Новый чат",
          scope: "project",
          provider_id: provider.id,
          model: provider.default_model || (provider.models && provider.models[0]) || "",
          effort: provider.default_effort || "auto",
        });
        chatView.open(chat.id);
      } catch (error) {
        vscode.window.showErrorMessage(`Kova: ${error.message || error}`);
      }
    }),
    vscode.commands.registerCommand("kova.showRun", async () => {
      const taskId = await chatView.currentTaskId();
      void openRunPanel(context, taskId);
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
