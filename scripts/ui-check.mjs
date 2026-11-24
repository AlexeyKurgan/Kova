import { unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const temp = process.env.TEMP ?? ".";
const out = (name) => path.join(temp, "opencode", name);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

let version = null;
for (let attempt = 0; attempt < 30; attempt += 1) {
  await sleep(500);
  try {
    const response = await fetch("http://127.0.0.1:9222/json/version");
    version = await response.json();
    break;
  } catch {
    version = null;
  }
}
if (!version) {
  edge.kill();
  throw new Error("Edge debug port did not open");
}

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9222",
  defaultViewport: { width: 1280, height: 860 },
});

const page = await browser.newPage();
await page.goto("http://localhost:1420", { waitUntil: "networkidle0", timeout: 30000 });
await sleep(600);
await page.screenshot({ path: out("ui-assets.png") });

await page.evaluate(() => {
  const button = [...document.querySelectorAll(".nav-item")].find(
    (item) => item.textContent?.trim() === "Задачи",
  );
  button?.click();
});
await sleep(500);
await page.screenshot({ path: out("ui-tasks-empty.png") });

await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("Новая задача"),
  );
  button?.click();
});
await sleep(400);
await page.type("#task-title", "Сундук для стартовой локации");
await page.type("#task-goal", "Низкополигональный сундук в стиле проекта");
await page.type("#task-criteria", "≤ 800 треугольников\nПивот внизу\nКрышка отдельным объектом");
await page.screenshot({ path: out("ui-dialog.png") });

await page.evaluate(() => {
  const button = [...document.querySelectorAll(".modal-footer button")].find((item) =>
    item.textContent?.includes("Создать"),
  );
  button?.click();
});
await sleep(1200);
await page.screenshot({ path: out("ui-tasks-list.png") });

const tasks = await page.evaluate(async () => {
  const response = await fetch("http://127.0.0.1:8765/tasks");
  return response.json();
});
console.log("tasks:", JSON.stringify(tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, criteria: t.criteria.length }))));

for (const task of tasks) {
  if (task.title === "Сундук для стартовой локации") {
    const file = path.join(
      process.env.APPDATA ?? "",
      "KovaHub",
      "projects",
      "Blade Evolve",
      ".hub",
      "tasks",
      "active",
      `${task.id}.json`,
    );
    await unlink(file);
    console.log("removed test task:", task.id);
  }
}

const stats = await page.evaluate(async () => {
  const response = await fetch("http://127.0.0.1:8765/stats");
  return response.json();
});
console.log("stats after cleanup:", JSON.stringify(stats));

await browser.close();
edge.kill();
