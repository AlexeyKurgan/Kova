import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const root = "C:\\work\\KovaHub";
const temp = process.env.TEMP ?? ".";
const out = (name) => path.join(temp, "opencode", name);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CORE = "http://127.0.0.1:8765";

async function api(pathname, init = {}) {
  const response = await fetch(`${CORE}${pathname}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${pathname}: ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

const project = path.join(temp, "opencode", "blender-ui-project");
await rm(project, { recursive: true, force: true });
await mkdir(project, { recursive: true });
await api("/project/open", {
  method: "POST",
  body: JSON.stringify({ path: project, name: "Blender UI", engine: "roblox" }),
});
await api("/blender/workspace", { method: "POST" });
await api("/blender/models", { method: "POST", body: JSON.stringify({ name: "Crate" }) });

const preview = spawn(
  process.execPath,
  [
    path.join(root, "node_modules", "vite", "bin", "vite.js"),
    "preview",
    "--port",
    "1420",
    "--strictPort",
  ],
  { cwd: path.join(root, "apps", "desktop"), stdio: "ignore" },
);
await sleep(2500);

const edge = spawn(
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9227",
    `--user-data-dir=${path.join(temp, "opencode", "edge-blender-modal")}`,
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
    await fetch("http://127.0.0.1:9227/json/version");
    up = true;
    break;
  } catch {
    up = false;
  }
}
if (!up) throw new Error("no edge");

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9227",
  defaultViewport: { width: 1440, height: 920 },
});
const page = await browser.newPage();

async function load(theme) {
  await page.goto("http://localhost:1420", { waitUntil: "networkidle0", timeout: 30000 });
  await page.evaluate((value) => localStorage.setItem("kova-theme", value), theme);
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(1200);
}

await load("dark");
const labels = await page.$$eval(".conn-row.is-action", (rows) =>
  rows.map((row) => row.textContent?.trim() ?? ""),
);
console.log("conn rows:", labels);

await page.click(".conn-row.is-action");
await sleep(1500);
await page.screenshot({ path: out("blender-modal-dark.png") });

const modalText = await page.$eval(".blender-modal", (node) => node.textContent ?? "");
console.log("modal connected:", modalText.includes("47832"));
console.log("modal workspace:", modalText.includes("Скриптов: 1"));
console.log("modal skills:", modalText.includes("Скиллы Blender"));

const shot = await page.$(".blender-modal .btn-primary");
if (shot) {
  await shot.click();
  await sleep(3500);
}
await page.screenshot({ path: out("blender-modal-shot.png") });

await load("light");
await page.click(".conn-row.is-action");
await sleep(1500);
await page.screenshot({ path: out("blender-modal-light.png") });

await browser.close();
edge.kill();
preview.kill();
await api("/project/demo", { method: "POST" });
await rm(project, { recursive: true, force: true });
console.log("done");
