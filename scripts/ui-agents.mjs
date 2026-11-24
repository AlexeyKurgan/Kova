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

const project = path.join(temp, "opencode", "ai-ui-project");
await rm(project, { recursive: true, force: true });
await mkdir(project, { recursive: true });
await api("/project/open", {
  method: "POST",
  body: JSON.stringify({ path: project, name: "AI UI", engine: "roblox" }),
});
const task = await api("/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "Проверка AI",
    type: "code",
    engine: "roblox",
    goal: "Проверить запуск CLI-агента из Kova",
    criteria: ["Агент отвечает", "Результат попадает в Review"],
  }),
});
const echo = await api("/providers", {
  method: "POST",
  body: JSON.stringify({
    name: "Echo",
    command: process.execPath,
    args: ["-e", "console.log('hello from kova ai')"],
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
    "--remote-debugging-port=9231",
    `--user-data-dir=${path.join(temp, "opencode", "edge-agents")}`,
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);
for (let index = 0; index < 30; index += 1) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9231/json/version");
    break;
  } catch {
    // retry
  }
}

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9231",
  defaultViewport: { width: 1480, height: 960 },
});
const page = await browser.newPage();
await page.goto("http://localhost:1420", { waitUntil: "networkidle0" });
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

await nav("Агенты");
await page.screenshot({ path: out("ui-agents.png") });
console.log(
  "agents:",
  await page.$$eval(".agent-card h2", (rows) => rows.map((row) => row.textContent)),
);

await nav("Задачи");
await page.evaluate(() => document.querySelector(".task-card-open")?.click());
await sleep(900);
await page.evaluate(() => {
  const node = [...document.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("Запустить AI"),
  );
  node?.click();
});
await sleep(900);
await page.screenshot({ path: out("ui-ai-modal.png") });

await page.select("#ai-provider", echo.id);
await page.evaluate(() => {
  const node = [...document.querySelectorAll(".ai-run-modal .btn-primary")].find(
    (item) => item.textContent?.includes("Запустить"),
  );
  node?.click();
});
await sleep(3500);
await page.screenshot({ path: out("ui-ai-done.png") });
const state = await page.$eval(".ai-run-state", (node) => node.textContent ?? "").catch(() => "");
console.log("run state:", state.replace(/\s+/g, " ").slice(0, 200));

await browser.close();
edge.kill();
preview.kill();

await api("/project/demo", { method: "POST" });
await api(`/projects/${(await api("/projects")).projects.find((item) => item.path === project)?.id}?delete_files=true`, { method: "DELETE" }).catch(() => null);
await api(`/providers/${echo.id}`, { method: "DELETE" }).catch(() => null);
await rm(project, { recursive: true, force: true });
console.log("done");
