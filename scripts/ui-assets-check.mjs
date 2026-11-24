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
  if (!response.ok) throw new Error(`${pathname}: ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

const project = path.join(temp, "opencode", "asset-project");
await rm(project, { recursive: true, force: true });
await mkdir(project, { recursive: true });
const source = path.join(temp, "opencode", "chest.glb");
await writeFile(source, Buffer.from("glTF-test-chest-".repeat(64)), "utf-8");

await api("/project/open", {
  method: "POST",
  body: JSON.stringify({ path: project, name: "Asset Check", engine: "roblox" }),
});
const asset = await api("/assets/import", {
  method: "POST",
  body: JSON.stringify({
    path: source,
    engine: "roblox",
    license: "CC0",
  }),
});
console.log("imported", asset.id, asset.path, asset.file_size);

const preview = spawn(
  process.execPath,
  [path.join(root, "node_modules", "vite", "bin", "vite.js"), "preview", "--port", "1420", "--strictPort"],
  { cwd: path.join(root, "apps", "desktop"), stdio: "ignore" },
);
await sleep(2500);

const editor = spawn(
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9224",
    `--user-data-dir=${path.join(temp, "opencode", "edge-assets-profile")}`,
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);
let browserUrl = null;
for (let attempt = 0; attempt < 30; attempt += 1) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9224/json/version");
    browserUrl = "http://127.0.0.1:9224";
    break;
  } catch {
    browserUrl = null;
  }
}
if (!browserUrl) throw new Error("no edge");

const browser = await puppeteer.connect({
  browserURL: browserUrl,
  defaultViewport: { width: 1280, height: 860 },
});
const page = await browser.newPage();
await page.goto("http://localhost:1420", { waitUntil: "networkidle0", timeout: 30000 });
await sleep(1200);

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

await clickByText(".nav-item", "Ассеты");
await sleep(800);
await page.screenshot({ path: out("assets-imported.png") });

await page.click(".asset-card.is-clickable");
await sleep(800);
await page.screenshot({ path: out("asset-passport.png") });

await clickByText("button", "Проверить");
await sleep(1200);
await page.screenshot({ path: out("asset-checks.png") });

await browser.close();
editor.kill();
preview.kill();
await api("/project/demo", { method: "POST" });
await rm(project, { recursive: true, force: true });
console.log("done");
