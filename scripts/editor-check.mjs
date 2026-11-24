import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const root = "C:\\work\\KovaHub";
const temp = process.env.TEMP ?? ".";
const base = path.join(temp, "opencode", "editor-check");
const project = path.join(base, "Blade Evolve");
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
await mkdir(path.join(project, "src", "server"), { recursive: true });
await writeFile(
  path.join(project, "src", "server", "init.lua"),
  `local Players = game:GetService("Players")\nlocal ReplicatedStorage = game:GetService("ReplicatedStorage")\n\nlocal function initialize()\n\tprint("Kova Hub is working!")\n\tfor _, player in ipairs(Players:GetPlayers()) do\n\t\t-- Инициализация для игрока\n\tend\nend\n\ninitialize()\n`,
  "utf-8",
);
await writeFile(
  path.join(project, "README.md"),
  "# Blade Evolve\n\nДемо-проект для проверки темы Kova.\n",
  "utf-8",
);

const folder = "/" + project.replaceAll("\\", "/");

async function startServer(port, theme) {
  const dir = path.join(base, `run-${port}`);
  const userData = path.join(dir, "user-data");
  const extensions = path.join(dir, "extensions");
  const config = path.join(dir, "config.yaml");
  await mkdir(path.join(userData, "User"), { recursive: true });
  await mkdir(extensions, { recursive: true });
  await cp(
    path.join(root, "apps", "desktop", "src-tauri", "resources", "kova-theme"),
    path.join(extensions, "kova.kova-theme-0.2.0"),
    { recursive: true },
  );
  await writeFile(config, `bind-addr: 127.0.0.1:${port}\nauth: none\ncert: false\n`, "utf-8");
  await writeFile(
    path.join(userData, "User", "settings.json"),
    JSON.stringify(
      {
        "workbench.colorTheme": theme,
        "workbench.startupEditor": "none",
        "window.menuBarVisibility": "classic",
        "explorer.compactFolders": false,
        "workbench.tree.indent": 16,
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
    ],
    { stdio: "ignore", windowsHide: true },
  );
  await sleep(12000);
  return child;
}

const dark = await startServer(8776, "Kova Dark");
const light = await startServer(8777, "Kova Light");

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

async function shoot(port, file, createFile) {
  const page = await browser.newPage();
  await page.goto(
    `http://127.0.0.1:${port}/?folder=${encodeURIComponent(folder)}`,
    { waitUntil: "networkidle0", timeout: 60000 },
  );
  await sleep(5000);
  const info = await page.evaluate(() => ({
    title: document.title,
    tree: [...document.querySelectorAll('[role="treeitem"]')]
      .slice(0, 12)
      .map((node) => node.getAttribute("aria-label")),
    menu: [...document.querySelectorAll(".menubar-menu-button")].map((node) => node.textContent),
  }));
  console.log(port, JSON.stringify(info));

  await page.mouse.click(700, 300);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyP");
  await page.keyboard.up("Control");
  await sleep(500);
  await page.keyboard.type("init.lua");
  await sleep(700);
  await page.keyboard.press("Enter");
  await sleep(1500);
  await page.keyboard.press("Escape");
  await sleep(500);

  if (createFile) {
    const clicked = await page.evaluate(() => {
      const node = document.querySelector('[aria-label="New File..."]');
      if (node instanceof HTMLElement) {
        node.click();
        return true;
      }
      return false;
    });
    if (clicked) {
      await sleep(700);
      await page.keyboard.type("created-by-kova.txt");
      await page.keyboard.press("Enter");
      await sleep(1200);
    }
  }

  await page.screenshot({ path: path.join(temp, "opencode", file) });
  await page.close();
}

await shoot(8776, "editor-dark.png", true);
console.log(
  "file created:",
  await stat(path.join(project, "created-by-kova.txt"))
    .then(() => true)
    .catch(() => false),
);
await shoot(8777, "editor-light.png", false);

await browser.close();
edge.kill();
for (const child of [dark, light]) {
  spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
}
