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

const project = path.join(temp, "opencode", "blender-ui-project");
await rm(project, { recursive: true, force: true });
await mkdir(project, { recursive: true });
await api("/project/open", {
  method: "POST",
  body: JSON.stringify({ path: project, name: "Blender UI", engine: "blender" }),
});
const asset = await api("/assets/import", {
  method: "POST",
  body: JSON.stringify({
    path: path.join(temp, "opencode", "blender-cube.blend"),
    engine: "blender",
  }),
});
console.log("running blender...");
const result = await api(`/assets/${asset.id}/blender`, { method: "POST" });
console.log("metrics", JSON.stringify(result.asset.metrics), "preview", result.asset.preview);

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
    "--remote-debugging-port=9226",
    `--user-data-dir=${path.join(temp, "opencode", "edge-blender-ui")}`,
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
    await fetch("http://127.0.0.1:9226/json/version");
    up = true;
    break;
  } catch {
    up = false;
  }
}
if (!up) throw new Error("no edge");

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9226",
  defaultViewport: { width: 1280, height: 860 },
});
const page = await browser.newPage();
await page.goto("http://localhost:1420", { waitUntil: "networkidle0", timeout: 30000 });
await sleep(1200);
await page.evaluate(() => {
  const node = [...document.querySelectorAll(".nav-item")].find(
    (item) => item.textContent?.trim() === "Ассеты",
  );
  node?.click();
});
await sleep(800);
await page.click(".asset-card.is-clickable");
await sleep(1200);
await page.screenshot({ path: out("blender-passport.png") });

await browser.close();
edge.kill();
preview.kill();
await api("/project/demo", { method: "POST" });
await rm(project, { recursive: true, force: true });
console.log("done");
