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

const project = path.join(temp, "opencode", "sidebar-ui-project");
await rm(project, { recursive: true, force: true });
await mkdir(project, { recursive: true });
await api("/project/open", {
  method: "POST",
  body: JSON.stringify({ path: project, name: "Sidebar UI", engine: "roblox" }),
});
const first = await api("/tasks", {
  method: "POST",
  body: JSON.stringify({ title: "Маяк", type: "model", engine: "roblox", goal: "Модель" }),
});
await api("/tasks", {
  method: "POST",
  body: JSON.stringify({ title: "Ящик", type: "model", engine: "roblox", goal: "Модель" }),
});
const third = await api("/tasks", {
  method: "POST",
  body: JSON.stringify({ title: "Клинок", type: "model", engine: "roblox", goal: "Модель" }),
});
await api(`/tasks/${third.id}/response`, {
  method: "POST",
  body: JSON.stringify({ text: "Готовый результат для review" }),
});
void first;

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
    "--remote-debugging-port=9232",
    `--user-data-dir=${path.join(temp, "opencode", "edge-sidebar")}`,
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);
for (let index = 0; index < 30; index += 1) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9232/json/version");
    break;
  } catch {
    // retry
  }
}

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9232",
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
await sleep(1400);

const width = await page.$eval(".sidebar", (node) => Math.round(node.getBoundingClientRect().width));
const labels = await page.$$eval(".nav-label", (rows) =>
  rows.map((row) => row.textContent).filter(Boolean),
);
const counters = await page.$$eval(".nav-count", (rows) => rows.map((row) => row.textContent));
console.log("expanded width:", width);
console.log("labels:", labels);
console.log("counters:", counters);
await page.screenshot({ path: out("sidebar-expanded-dark.png") });

await page.evaluate(() => {
  const heading = [...document.querySelectorAll(".nav-group-head")].find((node) =>
    node.textContent?.includes("Создание"),
  );
  heading?.click();
});
await sleep(400);
await page.screenshot({ path: out("sidebar-group-collapsed.png") });
const visibleAssets = await page.$$eval(".nav-label", (rows) =>
  rows.some((row) => row.textContent === "Ассеты"),
);
console.log("assets visible after group collapse:", visibleAssets);
await page.reload({ waitUntil: "networkidle0" });
await sleep(1200);
const persisted = await page.$$eval(".nav-label", (rows) =>
  rows.some((row) => row.textContent === "Ассеты"),
);
console.log("group collapse persisted:", !persisted);

await page.evaluate(() => {
  const heading = [...document.querySelectorAll(".nav-group-head")].find((node) =>
    node.textContent?.includes("Создание"),
  );
  heading?.click();
});
await sleep(300);
await page.click(".sidebar-collapse");
await sleep(500);
const collapsedWidth = await page.$eval(".sidebar", (node) =>
  Math.round(node.getBoundingClientRect().width),
);
const titles = await page.$$eval(".nav-item", (rows) =>
  rows.slice(0, 4).map((row) => row.getAttribute("title")),
);
console.log("collapsed width:", collapsedWidth);
console.log("titles:", titles);
const bodyClass = await page.$eval(".app-body", (node) => node.className);
console.log("body class:", bodyClass);
await page.screenshot({ path: out("sidebar-collapsed-dark.png") });

const collapsedStored = await page.evaluate(() =>
  localStorage.getItem("kova-sidebar-collapsed"),
);
console.log("collapsed stored:", collapsedStored);
await page.reload({ waitUntil: "networkidle0" });
await sleep(1200);
console.log(
  "collapsed persisted width:",
  await page.$eval(".sidebar", (node) => Math.round(node.getBoundingClientRect().width)),
);

await page.evaluate(() => localStorage.setItem("kova-theme", "light"));
await page.reload({ waitUntil: "networkidle0" });
await sleep(1200);
await page.screenshot({ path: out("sidebar-collapsed-light.png") });

await page.click(".sidebar-collapse");
await sleep(400);
await page.screenshot({ path: out("sidebar-expanded-light.png") });

await browser.close();
edge.kill();
preview.kill();

await api("/project/demo", { method: "POST" });
const projects = await api("/projects");
const tempProject = projects.projects.find((item) => item.path === project);
if (tempProject) {
  await api(`/projects/${tempProject.id}?delete_files=true`, { method: "DELETE" });
}
await rm(project, { recursive: true, force: true });
console.log("done");
