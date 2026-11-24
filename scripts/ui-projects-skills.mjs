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

const parent = path.join(temp, "opencode", "multi-ui");
await rm(parent, { recursive: true, force: true });
await mkdir(parent, { recursive: true });

const aurora = await api("/projects", {
  method: "POST",
  body: JSON.stringify({ name: "Aurora", engine: "godot", parent }),
});
const neon = await api("/projects", {
  method: "POST",
  body: JSON.stringify({ name: "Neon Drift", engine: "unity", parent }),
});
const first = await api("/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "Маяк на скале",
    type: "model",
    engine: "unity",
    goal: "Низкополигональный маяк с освещением для ночной локации",
    criteria: ["≤ 1200 треугольников", "Отдельный материал стекла", "Рендер для review"],
  }),
});
await api(`/tasks/${first.id}`, {
  method: "PATCH",
  body: JSON.stringify({ skills: ["blender-core", "blender-hardsurface-modeling", "blender-asset-qa"] }),
});
const second = await api("/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "Ящик с припасами",
    type: "model",
    engine: "unity",
    goal: "Модульный ящик для стартовой зоны",
    criteria: ["≤ 600 треугольников"],
  }),
});
await api(`/tasks/${second.id}`, {
  method: "PATCH",
  body: JSON.stringify({ status: "archived" }),
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
    "--remote-debugging-port=9229",
    `--user-data-dir=${path.join(temp, "opencode", "edge-multi-ui")}`,
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
    await fetch("http://127.0.0.1:9229/json/version");
    up = true;
    break;
  } catch {
    up = false;
  }
}
if (!up) throw new Error("no edge");

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9229",
  defaultViewport: { width: 1480, height: 960 },
});
const page = await browser.newPage();
await page.goto("http://localhost:1420", { waitUntil: "networkidle0", timeout: 30000 });
await page.evaluate(() => localStorage.setItem("kova-theme", "dark"));
await page.reload({ waitUntil: "networkidle0" });
await sleep(1400);

async function nav(label) {
  await page.evaluate((target) => {
    const node = [...document.querySelectorAll(".nav-item")].find(
      (item) => item.textContent?.trim() === target,
    );
    node?.click();
  }, label);
  await sleep(900);
}

await nav("Проекты");
await page.screenshot({ path: out("ui-projects.png") });
console.log("projects:", await page.$$eval(".project-tile h2", (rows) => rows.map((r) => r.textContent)));

await page.evaluate(() => {
  const node = [...document.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("Новый проект"),
  );
  node?.click();
});
await sleep(500);
await page.screenshot({ path: out("ui-project-create.png") });
await page.keyboard.press("Escape");
await sleep(400);

await nav("Скиллы");
await page.screenshot({ path: out("ui-skills.png") });
await page.evaluate(() => {
  const node = [...document.querySelectorAll(".skill-card")].find((item) =>
    item.textContent?.includes("Asset Qa"),
  );
  node?.click();
});
await sleep(900);
await page.screenshot({ path: out("ui-skill-detail.png") });

await nav("Задачи");
await page.screenshot({ path: out("ui-tasks.png") });
await page.evaluate(() => {
  const node = document.querySelector(".task-card-open");
  node?.click();
});
await sleep(900);
await page.screenshot({ path: out("ui-task-detail.png") });

await page.evaluate(() => {
  const node = [...document.querySelectorAll(".activity-open")].find(Boolean);
  node?.click();
});
await sleep(700);
await page.screenshot({ path: out("ui-activity.png") });

await browser.close();
edge.kill();
preview.kill();

await api("/project/demo", { method: "POST" });
const projects = await api("/projects");
for (const project of projects.projects) {
  if (project.path.startsWith(parent)) {
    await api(`/projects/${project.id}?delete_files=true`, { method: "DELETE" });
  }
}
await rm(parent, { recursive: true, force: true });
console.log("done");
