import { mkdir, rm, writeFile, cp, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const temp = process.env.TEMP ?? ".";
const base = path.join(temp, "opencode", "diag-workspace2");
const userData = path.join(base, "user-data");
const extensions = path.join(base, "extensions");
const config = path.join(base, "config.yaml");
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
await mkdir(path.join(userData, "User"), { recursive: true });
await mkdir(extensions, { recursive: true });
await cp(
  path.join("C:\\work\\KovaHub", "apps", "desktop", "src-tauri", "resources", "kova-theme"),
  path.join(extensions, "kova.kova-theme-0.2.0"),
  { recursive: true },
);
await writeFile(config, "bind-addr: 127.0.0.1:8771\nauth: none\ncert: false\n", "utf-8");
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

const cs = spawn(
  "cmd.exe",
  [
    "/C",
    server,
    "--bind-addr",
    "127.0.0.1:8771",
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
const page = await browser.newPage();
const folder = encodeURIComponent("file:///C:/work/KovaHub");
await page.goto(`http://127.0.0.1:8771/?folder=${folder}`, {
  waitUntil: "networkidle0",
  timeout: 60000,
});
await sleep(6000);

const info = await page.evaluate(() => ({
  href: location.href,
  title: document.title,
  tree: [...document.querySelectorAll('[role="treeitem"]')]
    .slice(0, 30)
    .map((node) => node.getAttribute("aria-label")),
  body: document.body.innerText.slice(0, 600),
}));
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: path.join(temp, "opencode", "diag2.png") });

const newFileButton = await page.$('[aria-label="New File..."]');
console.log("new file button:", Boolean(newFileButton));
if (newFileButton) {
  await newFileButton.click();
  await sleep(800);
  await page.keyboard.type("kova-diag.txt");
  await page.keyboard.press("Enter");
  await sleep(1200);
}
const created = await stat(path.join(project, "kova-diag.txt"))
  .then(() => true)
  .catch(() => false);
console.log("file created:", created);
await rm(path.join(project, "kova-diag.txt"), { force: true });

await browser.close();
edge.kill();
spawn("taskkill", ["/T", "/F", "/PID", String(cs.pid)], { stdio: "ignore" });
