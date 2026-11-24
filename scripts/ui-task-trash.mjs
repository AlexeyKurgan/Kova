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

const projectDir = path.join(temp, "opencode", "trash-ui-project");
await rm(projectDir, { recursive: true, force: true });
await mkdir(projectDir, { recursive: true });
await api("/project/open", {
  method: "POST",
  body: JSON.stringify({ path: projectDir, name: "Trash UI", engine: "roblox" }),
});
await api("/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "Задача на удаление",
    type: "model",
    engine: "roblox",
    goal: "Проверить корзину и восстановление",
    criteria: ["Попасть в корзину", "Восстановиться"],
  }),
});
await api("/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "Вторая задача",
    type: "model",
    engine: "roblox",
    goal: "Остаться на месте",
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
    "--remote-debugging-port=9234",
    `--user-data-dir=${path.join(temp, "opencode", "edge-trash")}`,
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);
for (let index = 0; index < 30; index += 1) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9234/json/version");
    break;
  } catch {
    // retry
  }
}

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9234",
  defaultViewport: { width: 1480, height: 960 },
});
const page = await browser.newPage();
await page.goto("http://localhost:1420", { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.setItem("kova-theme", "dark"));
await page.reload({ waitUntil: "networkidle0" });
await sleep(1400);

async function nav(label) {
  await page.evaluate((target) => {
    const node = document.querySelector(`.nav-item[data-section="${target}"]`);
    node?.click();
  }, label);
  await sleep(900);
}

await nav("Задачи");
await page.screenshot({ path: out("trash-tasks-before.png") });
console.log("tasks before:", await page.$$eval(".task-card h2", (rows) => rows.map((r) => r.textContent)));

await page.click(".task-card .icon-btn.is-danger");
await sleep(400);
const confirmVisible = await page.$(".confirm-modal");
const confirmText = confirmVisible
  ? await page.$eval(".confirm-modal", (node) => node.textContent)
  : "";
console.log("confirm modal:", Boolean(confirmVisible), confirmText?.includes("в корзину"));
console.log(
  "tasks still present:",
  await page.$$eval(".task-card h2", (rows) => rows.map((r) => r.textContent)),
);
await page.screenshot({ path: out("trash-confirm.png") });

await page.evaluate(() => {
  const node = [...document.querySelectorAll(".confirm-modal .btn")].find((item) =>
    item.textContent?.includes("В корзину"),
  );
  node?.click();
});
await sleep(1400);
console.log(
  "tasks after delete:",
  await page.$$eval(".task-card h2", (rows) => rows.map((r) => r.textContent)),
);

await page.evaluate(() => {
  const node = [...document.querySelectorAll(".filter-chip")].find((item) =>
    item.textContent?.includes("Корзина"),
  );
  node?.click();
});
await sleep(700);
console.log(
  "trash cards:",
  await page.$$eval(".task-card h2", (rows) => rows.map((r) => r.textContent)),
);
await page.screenshot({ path: out("trash-view.png") });

await page.click(".task-card .icon-btn[title='Восстановить задачу']");
await sleep(1300);
console.log(
  "trash after restore:",
  await page.$$eval(".task-card h2", (rows) => rows.map((r) => r.textContent)),
);

await page.evaluate(() => {
  const node = [...document.querySelectorAll(".filter-chip")].find((item) =>
    item.textContent?.includes("Активные"),
  );
  node?.click();
});
await sleep(500);
console.log(
  "active after restore:",
  await page.$$eval(".task-card h2", (rows) => rows.map((r) => r.textContent)),
);

await page.evaluate(() => document.querySelector(".activity-open")?.click());
await sleep(700);
const monthHead = await page.$(".activity-month-head");
if (monthHead) {
  await monthHead.click();
  await sleep(300);
}
console.log(
  "activity days after collapse:",
  await page.$$eval(".activity-days", (rows) => rows.length),
);
const monthBefore = await page.$eval(".activity-month-head", (node) => node.textContent);
console.log("month still visible:", monthBefore);
await page.screenshot({ path: out("activity-collapsed.png") });
await page.evaluate(() => document.querySelector(".activity-modal .icon-btn")?.click());
await sleep(300);

await nav("Агенты");
await page.screenshot({ path: out("agents-brand-icons.png") });
await nav("Проекты");
await page.screenshot({ path: out("projects-brand-icons.png") });

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
