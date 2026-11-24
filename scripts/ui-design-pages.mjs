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

const projectDir = path.join(temp, "opencode", "design-ui-project");
await rm(projectDir, { recursive: true, force: true });
await mkdir(projectDir, { recursive: true });
await api("/project/open", {
  method: "POST",
  body: JSON.stringify({ path: projectDir, name: "Design UI", engine: "roblox" }),
});

const blend = await api("/assets/import", {
  method: "POST",
  body: JSON.stringify({
    path: path.join(temp, "opencode", "blender-cube.blend"),
    engine: "roblox",
    license: "CC0",
  }),
});
console.log("inspect", (await api(`/assets/${blend.id}/blender`, { method: "POST" })).asset.metrics);
const texture = await api("/assets/import", {
  method: "POST",
  body: JSON.stringify({
    path: path.join(temp, "opencode", "chest-lit.png"),
    engine: "roblox",
    license: "CC0",
  }),
});
await api(`/assets/${texture.id}`, {
  method: "PATCH",
  body: JSON.stringify({ description: "Текстура для тестового превью." }),
});

const first = await api("/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "Добавить систему жизни",
    type: "model",
    engine: "roblox",
    goal: "Реализовать систему жизни игрока с UI и восстановлением.",
    criteria: ["Полоса HP", "Урон", "Восстановление", "Проверка"],
  }),
});
await api(`/tasks/${first.id}`, {
  method: "PATCH",
  body: JSON.stringify({ status: "working", asset_ids: [blend.id] }),
});
await api(`/assets/${blend.id}`, {
  method: "PATCH",
  body: JSON.stringify({ task_ids: [first.id] }),
});
const second = await api("/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "Ящик с припасами",
    type: "model",
    engine: "roblox",
    goal: "Модульный ящик для стартовой зоны.",
    criteria: ["≤ 600 треугольников"],
  }),
});
await api(`/assets/${blend.id}`, {
  method: "PATCH",
  body: JSON.stringify({ task_ids: [first.id, second.id] }),
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
    "--remote-debugging-port=9236",
    `--user-data-dir=${path.join(temp, "opencode", "edge-design-pages")}`,
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);
for (let index = 0; index < 30; index += 1) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9236/json/version");
    break;
  } catch {
    // retry
  }
}

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9236",
  defaultViewport: { width: 1480, height: 960 },
});
const page = await browser.newPage();
await page.goto("http://localhost:1420", { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.setItem("kova-theme", "dark"));
await page.reload({ waitUntil: "networkidle0" });
await sleep(1500);

async function nav(label) {
  await page.evaluate((target) => {
    document.querySelector(`.nav-item[data-section="${target}"]`)?.click();
  }, label);
  await sleep(900);
}

await nav("Проекты");
console.log("projects selects:", await page.$$eval(".filter-select", (rows) => rows.length));
await page.screenshot({ path: out("design-projects.png") });

await nav("Задачи");
console.log("tasks selects:", await page.$$eval(".filter-select", (rows) => rows.length));
await page.screenshot({ path: out("design-tasks.png") });

await nav("Ассеты");
console.log("assets selects:", await page.$$eval(".filter-select", (rows) => rows.length));
await page.screenshot({ path: out("design-assets.png") });
await page.evaluate(() => document.querySelector(".asset-card2")?.click());
await sleep(1000);
await page.screenshot({ path: out("design-asset-detail.png") });

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
