import { mkdir, rm, writeFile } from "node:fs/promises";
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

const projectDir = path.join(temp, "opencode", "overview-ui-project");
await rm(projectDir, { recursive: true, force: true });
await mkdir(projectDir, { recursive: true });
const project = await api("/project/open", {
  method: "POST",
  body: JSON.stringify({ path: projectDir, name: "Blade Evolve", engine: "roblox" }),
});
const cards = await api("/projects");
const card = cards.projects.find((item) => item.path === projectDir);
const cover = path.join(temp, "opencode", "chest-lit.png");
await api(`/projects/${card.id}/cover`, {
  method: "POST",
  body: JSON.stringify({ path: cover }),
}).catch(() => null);

const working = await api("/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "Добавить систему жизни",
    type: "model",
    engine: "roblox",
    goal: "Полоса здоровья над персонажем и реакция на урон",
    criteria: ["Полоса HP", "Анимация урона", "Проверка в игре", "Экспорт в Roblox"],
  }),
});
await api(`/tasks/${working.id}`, {
  method: "PATCH",
  body: JSON.stringify({
    status: "working",
    skills: ["blender-core", "blender-hardsurface-modeling"],
  }),
});
await api("/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "Ящик с припасами",
    type: "model",
    engine: "roblox",
    goal: "Модульный ящик для стартовой зоны",
    criteria: ["≤ 600 треугольников"],
  }),
});
const reviewTask = await api("/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "Клинок стража",
    type: "model",
    engine: "roblox",
    goal: "Стилизованный клинок",
    criteria: ["≤ 800 треугольников"],
  }),
});
await api(`/tasks/${reviewTask.id}/response`, {
  method: "POST",
  body: JSON.stringify({ text: "Готовый клинок: 640 треугольников, 2 материала." }),
});
const glb = path.join(temp, "opencode", "chest-ui.glb");
await writeFile(glb, Buffer.from("glb-ui-test"));
await api("/assets/import", {
  method: "POST",
  body: JSON.stringify({ path: glb, engine: "roblox" }),
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
    "--remote-debugging-port=9233",
    `--user-data-dir=${path.join(temp, "opencode", "edge-overview-new")}`,
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);
for (let index = 0; index < 30; index += 1) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9233/json/version");
    break;
  } catch {
    // retry
  }
}

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9233",
  defaultViewport: { width: 1480, height: 960 },
});
const page = await browser.newPage();
await page.goto("http://localhost:1420", { waitUntil: "networkidle0" });
await page.evaluate(() => {
  localStorage.setItem("kova-theme", "dark");
  localStorage.removeItem("kova-sidebar-collapsed");
  localStorage.removeItem("kova-sidebar-groups");
});
await page.reload({ waitUntil: "networkidle0" });
await sleep(1500);
const activeNav = await page.$eval(".nav-item.is-active", (node) => node.textContent);
console.log("active nav:", activeNav);
console.log("hero:", await page.$eval(".ov-hero-copy h1", (node) => node.textContent));
console.log("bell:", await page.$eval(".topbar-badge", (node) => node.textContent).catch(() => "none"));
await page.screenshot({ path: out("overview-new-dark.png") });

await page.evaluate(() => localStorage.setItem("kova-theme", "light"));
await page.reload({ waitUntil: "networkidle0" });
await sleep(1400);
await page.screenshot({ path: out("overview-new-light.png") });

await browser.close();
edge.kill();
preview.kill();

await api("/project/demo", { method: "POST" });
const current = await api("/projects");
const tempProject = current.projects.find((item) => item.path === projectDir);
if (tempProject) {
  await api(`/projects/${tempProject.id}?delete_files=true`, { method: "DELETE" });
}
await rm(projectDir, { recursive: true, force: true });
await rm(glb, { force: true });
console.log("done");
