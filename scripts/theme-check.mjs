import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const root = "C:\\work\\KovaHub";
const temp = process.env.TEMP ?? ".";
const base = path.join(temp, "opencode", "theme-test");
const project = path.join(base, "project");
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

async function startServer(port, theme) {
  const dir = path.join(base, theme.toLowerCase().replace(" ", "-"));
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
        "window.title": `Kova — \${rootName}`,
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
      project,
    ],
    { stdio: "ignore", windowsHide: true },
  );
  await sleep(12000);
  return child;
}

const dark = await startServer(8768, "Kova Dark");
const light = await startServer(8769, "Kova Light");

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
if (!up) {
  edge.kill();
  throw new Error("Edge debug port did not open");
}

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9222",
  defaultViewport: { width: 1440, height: 900 },
});

async function shoot(port, file) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0", timeout: 60000 });
  await sleep(4000);
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
  await sleep(800);
  await page.screenshot({ path: path.join(temp, "opencode", file) });
  await page.close();
}

await shoot(8768, "theme-dark.png");
await shoot(8769, "theme-light.png");

await browser.close();
edge.kill();
for (const child of [dark, light]) {
  spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
}
console.log("theme screenshots ready");
