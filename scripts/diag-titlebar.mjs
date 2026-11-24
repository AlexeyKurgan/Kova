import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const temp = process.env.TEMP ?? ".";
const base = path.join(temp, "opencode", "diag-titlebar");
const userData = path.join(base, "user-data");
const config = path.join(base, "config.yaml");
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
await writeFile(config, "bind-addr: 127.0.0.1:8781\nauth: none\ncert: false\n", "utf-8");
await writeFile(
  path.join(userData, "User", "settings.json"),
  JSON.stringify(
    {
      "workbench.colorTheme": "Kova Dark",
      "workbench.startupEditor": "none",
      "window.menuBarVisibility": "classic",
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
    "127.0.0.1:8781",
    "--auth",
    "none",
    "--config",
    config,
    "--user-data-dir",
    userData,
    "--extensions-dir",
    path.join(base, "extensions"),
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
    `--user-data-dir=${path.join(temp, "opencode", "edge-debug-profile2")}`,
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
await page.goto(
  "http://127.0.0.1:8781/?folder=" + encodeURIComponent("/C:/work/KovaHub"),
  { waitUntil: "networkidle0", timeout: 60000 },
);
await sleep(5000);
const info = await page.evaluate(() => {
  const container = document.querySelector(".titlebar-container");
  return {
    hasContainer: Boolean(container),
    hasRight: Boolean(document.querySelector(".titlebar-right")),
    hasDrag: Boolean(document.querySelector(".titlebar-drag-region")),
    classes: container
      ? [...container.children].map((node) => node.className)
      : [],
    rightHtml: document.querySelector(".titlebar-right")?.outerHTML.slice(0, 800) ?? "",
    all: [...document.querySelectorAll(".titlebar-container > *")].map((node) => node.className),
  };
});
console.log(JSON.stringify(info, null, 2));

await browser.close();
edge.kill();
spawn("taskkill", ["/T", "/F", "/PID", String(cs.pid)], { stdio: "ignore" });
