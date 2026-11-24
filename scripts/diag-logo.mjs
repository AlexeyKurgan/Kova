import { mkdir, rm, writeFile, cp } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const temp = process.env.TEMP ?? ".";
const base = path.join(temp, "opencode", "diag-logo");
const userData = path.join(base, "user-data");
const extensions = path.join(base, "extensions");
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
await mkdir(extensions, { recursive: true });
await cp(
  path.join("C:\\work\\KovaHub", "apps", "desktop", "src-tauri", "resources", "kova-theme"),
  path.join(extensions, "kova.kova-theme-0.2.0"),
  { recursive: true },
);
await writeFile(config, "bind-addr: 127.0.0.1:8778\nauth: none\ncert: false\n", "utf-8");
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
    "127.0.0.1:8778",
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
const folder = "/C:/work/KovaHub";
await page.goto(`http://127.0.0.1:8778/?folder=${encodeURIComponent(folder)}`, {
  waitUntil: "networkidle0",
  timeout: 60000,
});
await sleep(5000);

const info = await page.evaluate(() => {
  const describe = (node) => {
    if (!(node instanceof HTMLElement)) return null;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      tag: node.tagName,
      className: node.className,
      aria: node.getAttribute("aria-label"),
      text: node.textContent?.slice(0, 60),
      backgroundImage: style.backgroundImage,
      backgroundColor: style.backgroundColor,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      html: node.outerHTML.slice(0, 400),
    };
  };
  const candidates = [...document.querySelectorAll("div, a, img, span")]
    .map(describe)
    .filter((item) => item && item.x < 80 && item.y < 80 && item.w > 8 && item.h > 8)
    .slice(0, 20);
  const active = document.querySelector(".activitybar .action-item.checked, .activitybar .action-item.active");
  return {
    candidates,
    active: active
      ? {
          className: active.className,
          html: active.outerHTML.slice(0, 500),
          bg: getComputedStyle(active).backgroundColor,
          border: getComputedStyle(active).borderLeftColor,
        }
      : null,
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: path.join(temp, "opencode", "diag-logo.png") });

await browser.close();
edge.kill();
spawn("taskkill", ["/T", "/F", "/PID", String(cs.pid)], { stdio: "ignore" });
