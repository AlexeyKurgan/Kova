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
  if (!response.ok) throw new Error(`${pathname}: ${response.status} ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json();
}

const projectDir = path.join(temp, "opencode", "trash-menu-project");
await rm(projectDir, { recursive: true, force: true });
await mkdir(projectDir, { recursive: true });
await api("/project/open", {
  method: "POST",
  body: JSON.stringify({ path: projectDir, name: "Trash Menu", engine: "roblox" }),
});
await api("/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "Удаляемая задача",
    type: "model",
    engine: "roblox",
    goal: "Проверить меню",
  }),
});
await api("/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "Остающаяся задача",
    type: "model",
    engine: "roblox",
    goal: "Остаться",
  }),
});

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
    "--remote-debugging-port=9237",
    `--user-data-dir=${path.join(temp, "opencode", "edge-trash-menu")}`,
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);
for (let index = 0; index < 30; index += 1) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9237/json/version");
    break;
  } catch {
    // retry
  }
}

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9237",
  defaultViewport: { width: 1480, height: 960 },
});
const page = await browser.newPage();
await page.goto("http://localhost:1420", { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.setItem("kova-theme", "dark"));
await page.reload({ waitUntil: "networkidle0" });
await sleep(1400);

await page.evaluate(() => document.querySelector('.nav-item[data-section="Задачи"]')?.click());
await sleep(900);
console.log("selects:", await page.$$eval(".filter-select", (rows) => rows.length));

await page.click(".task-card2 .task-menu-wrap .icon-btn");
await sleep(250);
await page.evaluate(() => {
  const node = [...document.querySelectorAll(".task-card2 .project-menu button")].find((item) =>
    item.textContent?.includes("В корзину"),
  );
  node?.click();
});
await sleep(350);
console.log("confirm:", Boolean(await page.$(".confirm-modal")));
console.log("tasks before confirm:", await page.$$eval(".task-card2 h2", (rows) => rows.map((r) => r.textContent)));
await page.screenshot({ path: out("tasks-confirm-final.png") });

await page.evaluate(() => {
  const node = [...document.querySelectorAll(".confirm-modal .btn")].find((item) =>
    item.textContent?.includes("В корзину"),
  );
  node?.click();
});
await sleep(1300);
console.log("tasks after confirm:", await page.$$eval(".task-card2 h2", (rows) => rows.map((r) => r.textContent)));

await page.select(".filter-select", "trash");
await sleep(700);
console.log("trash tasks:", await page.$$eval(".task-card2 h2", (rows) => rows.map((r) => r.textContent)));
await page.screenshot({ path: out("tasks-trash-final.png") });

await page.click(".task-card2 .task-actions2 .btn");
await sleep(1300);
console.log("trash after restore:", await page.$$eval(".task-card2 h2", (rows) => rows.map((r) => r.textContent)));

await page.evaluate(() => document.querySelector('.nav-item[data-section="Обзор"]')?.click());
await sleep(800);
await page.evaluate(() => {
  const node = [...document.querySelectorAll(".ov-link")].find((item) =>
    item.textContent?.includes("Все события"),
  );
  node?.click();
});
await sleep(600);
console.log("activity filter select:", await page.$$eval(".activity-modal .filter-select", (rows) => rows.length));
await page.click(".activity-month-head");
await sleep(300);
console.log("activity days collapsed:", await page.$$eval(".activity-days", (rows) => rows.length));
await page.screenshot({ path: out("activity-collapse-final.png") });

await browser.close();
edge.kill();
preview.kill();

await api("/project/demo", { method: "POST" });
const projects = await api("/projects");
const tempProject = projects.projects.find((item) => item.path === projectDir);
if (tempProject) {
  await api(`/projects/${tempProject.id}?delete_files=true`, { method: "DELETE" });
}
await rm(projectDir, { recursive: true, force: true });
console.log("done");
