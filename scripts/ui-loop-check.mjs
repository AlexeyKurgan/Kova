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

const preview = spawn(
  process.execPath,
  [path.join(root, "node_modules", "vite", "bin", "vite.js"), "preview", "--port", "1420", "--strictPort"],
  { cwd: path.join(root, "apps", "desktop"), stdio: "ignore" },
);
await sleep(2500);

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
if (!up) {
  edge.kill();
  preview.kill();
  throw new Error("Edge debug port did not open");
}

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9222",
  defaultViewport: { width: 1280, height: 860 },
});
const page = await browser.newPage();

const original = await api("/project");
const loopProject = path.join(temp, "opencode", "loop-project");
await mkdir(loopProject, { recursive: true });
await api("/project/open", {
  method: "POST",
  body: JSON.stringify({ path: loopProject, name: "Loop Check" }),
});

const clickByText = (selector, text) =>
  page.evaluate(
    (sel, value) => {
      const node = [...document.querySelectorAll(sel)].find((item) =>
        item.textContent?.includes(value),
      );
      node?.click();
      return Boolean(node);
    },
    selector,
    text,
  );

await page.goto("http://localhost:1420", { waitUntil: "networkidle0", timeout: 30000 });
await sleep(800);

await clickByText(".nav-item", "Задачи");
await sleep(400);
await clickByText("button", "Новая задача");
await sleep(400);
await page.type("#task-title", "Проверка цикла");
await page.type("#task-criteria", "≤ 800 треугольников");
await clickByText(".modal-footer button", "Создать");
await sleep(900);
console.log("tasks after create:", JSON.stringify(await api("/tasks")));
await page.screenshot({ path: out("ui-debug-after-create.png") });

await page.click(".task-card.is-clickable");
await sleep(500);
await page.screenshot({ path: out("ui-detail.png") });

await clickByText("button", "Подготовить капсулу");
await sleep(700);
await page.screenshot({ path: out("ui-capsule.png") });
await clickByText(".modal-footer button", "Закрыть");
await sleep(300);

await clickByText("button", "Вставить ответ");
await sleep(400);
await page.type("#response-text", "Готово: chest.blend\n- 700 треугольников\n- пивот внизу");
await clickByText(".modal-footer button", "В Review");
await sleep(900);

await clickByText(".nav-item", "Review");
await sleep(600);
await page.screenshot({ path: out("ui-review.png") });

await clickByText("button", "Принять");
await sleep(900);
await page.screenshot({ path: out("ui-after-accept.png") });

const tasks = await api("/tasks");
const review = await api("/review");
console.log("task status:", tasks[0]?.status, "| review queue:", review.length);

if (original.path.includes("loop-project")) {
  await api("/project/demo", { method: "POST" });
} else {
  await api("/project/open", {
    method: "POST",
    body: JSON.stringify({ path: original.path }),
  });
}
await rm(loopProject, { recursive: true, force: true });
console.log("restored project:", original.path);

await browser.close();
edge.kill();
preview.kill();
