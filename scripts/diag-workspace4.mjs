import { mkdir, rm, writeFile, cp } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const temp = process.env.TEMP ?? ".";
const base = path.join(temp, "opencode", "diag-workspace4");
const project = "C:\\work\\KovaHub";
const server = path.join(
  process.env.LOCALAPPDATA ?? "",
  "KovaHub",
  "editor",
  "code-server-4.146.0-windows-amd64",
  "bin",
  "code-server.cmd",
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await rm(base, { recursive: true, force: true });
await mkdir(base, { recursive: true });
const workspaceFile = path.join(base, "kova.code-workspace");
await writeFile(
  workspaceFile,
  JSON.stringify(
    {
      folders: [{ path: "C:/work/KovaHub", name: "KovaHub" }],
      settings: { "window.menuBarVisibility": "classic" },
    },
    null,
    2,
  ),
  "utf-8",
);

async function start(port, args, cwd) {
  const dir = path.join(base, `run-${port}`);
  const userData = path.join(dir, "user-data");
  const extensions = path.join(dir, "extensions");
  const config = path.join(dir, "config.yaml");
  await mkdir(path.join(userData, "User"), { recursive: true });
  await mkdir(extensions, { recursive: true });
  await cp(
    path.join(project, "apps", "desktop", "src-tauri", "resources", "kova-theme"),
    path.join(extensions, "kova.kova-theme-0.2.0"),
    { recursive: true },
  );
  await writeFile(config, `bind-addr: 127.0.0.1:${port}\nauth: none\ncert: false\n`, "utf-8");
  await writeFile(
    path.join(userData, "User", "settings.json"),
    JSON.stringify(
      {
        "workbench.colorTheme": "Kova Dark",
        "workbench.startupEditor": "none",
        "window.menuBarVisibility": "classic",
        "explorer.compactFolders": false,
      },
      null,
      2,
    ),
    "utf-8",
  );
  const child = spawn(
    "cmd.exe",
    [
      "/C",
      server,
      "--bind-addr",
      `127.0.0.1:${port}`,
      "--auth",
      "none",
      "--config",
      config,
      "--user-data-dir",
      userData,
      "--extensions-dir",
      extensions,
      "--disable-telemetry",
      "--disable-update-check",
      "--disable-workspace-trust",
      ...args,
    ],
    { stdio: "ignore", windowsHide: true, cwd },
  );
  await sleep(12000);
  return child;
}

const a = await start(8773, [workspaceFile], project);
const b = await start(8774, ["."], project);

const edge = spawn(
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9222",
    `--user-data-dir=${path.join(temp, "opencode", "edge-debug-profile")}`,
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);
let up = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9222/json/version");
    up = true;
    break;
  } catch {
    up = false;
  }
}
if (!up) throw new Error("no edge");

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9222",
  defaultViewport: { width: 1440, height: 900 },
});

async function inspect(port, shot) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0", timeout: 60000 });
  await sleep(5000);
  const info = await page.evaluate(() => ({
    href: location.href,
    title: document.title,
    tree: [...document.querySelectorAll('[role="treeitem"]')]
      .slice(0, 15)
      .map((node) => node.getAttribute("aria-label")),
    body: document.body.innerText.slice(0, 350),
  }));
  console.log(`PORT ${port}:`, JSON.stringify(info, null, 2));
  await page.screenshot({ path: path.join(temp, "opencode", shot) });
  await page.close();
}

await inspect(8773, "diag4-workspace.png");
await inspect(8774, "diag4-relative.png");

await browser.close();
edge.kill();
for (const child of [a, b]) {
  spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
}
