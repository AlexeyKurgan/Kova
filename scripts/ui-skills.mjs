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

const project = path.join(temp, "opencode", "skills-ui-project");
await rm(project, { recursive: true, force: true });
await mkdir(project, { recursive: true });
await api("/project/open", {
  method: "POST",
  body: JSON.stringify({ path: project, name: "Skills UI", engine: "roblox" }),
});
await api("/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "Клинок стража",
    type: "model",
    engine: "roblox",
    goal: "Стилизованный клинок для стартовой локации",
    criteria: ["≤ 800 треугольников"],
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
    "--remote-debugging-port=9228",
    `--user-data-dir=${path.join(temp, "opencode", "edge-skills-ui")}`,
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
    await fetch("http://127.0.0.1:9228/json/version");
    up = true;
    break;
  } catch {
    up = false;
  }
}
if (!up) throw new Error("no edge");

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9228",
  defaultViewport: { width: 1440, height: 920 },
});
const page = await browser.newPage();
await page.goto("http://localhost:1420", { waitUntil: "networkidle0", timeout: 30000 });
await page.evaluate(() => localStorage.setItem("kova-theme", "dark"));
await page.reload({ waitUntil: "networkidle0" });
await sleep(1200);

await page.evaluate(() => {
  const node = [...document.querySelectorAll(".nav-item")].find(
    (item) => item.textContent?.trim() === "Задачи",
  );
  node?.click();
});
await sleep(900);
await page.click(".task-card.is-clickable");
await sleep(900);

await page.evaluate(() => {
  const node = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.includes("Выбрать скиллы"),
  );
  node?.click();
});
await sleep(900);
await page.screenshot({ path: out("skills-picker.png") });

const labels = await page.$$eval(".skill-option", (rows) =>
  rows.map((row) => row.textContent?.trim() ?? ""),
);
console.log("skill options:", labels.length);

for (const name of ["core", "stylized-npr"]) {
  await page.evaluate((target) => {
    const row = [...document.querySelectorAll(".skill-option")].find((item) =>
      item.textContent?.trim().startsWith(target),
    );
    row?.click();
  }, name);
}
await page.evaluate(() => {
  const node = [...document.querySelectorAll(".skill-picker button")].find(
    (item) => item.textContent?.trim() === "Сохранить",
  );
  node?.click();
});
await sleep(1200);
await page.screenshot({ path: out("skills-task.png") });

const saved = await page.evaluate(() =>
  [...document.querySelectorAll(".task-skills .blender-chip")].map((item) =>
    item.textContent?.trim(),
  ),
);
console.log("saved skills:", saved);

await page.click(".conn-row.is-action");
await sleep(1200);
await page.evaluate(() => {
  const node = [...document.querySelectorAll(".blender-link")].find(
    (item) => item.textContent?.includes("Показать все"),
  );
  node?.click();
});
await sleep(300);
await page.evaluate(() => {
  const node = [...document.querySelectorAll(".blender-chip.is-clickable")].find(
    (item) => item.textContent?.trim() === "weather-fx",
  );
  node?.click();
});
await sleep(900);
const detail = await page.$eval(".skill-md", (node) => node.textContent ?? "").catch(() => "");
console.log("skill content:", detail.slice(0, 40).replace(/\n/g, " "));
await page.screenshot({ path: out("skills-viewer.png") });

await browser.close();
edge.kill();
preview.kill();
await api("/project/demo", { method: "POST" });
await rm(project, { recursive: true, force: true });
console.log("done");
