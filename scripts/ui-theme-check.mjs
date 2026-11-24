import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const root = "C:\\work\\KovaHub";
const temp = process.env.TEMP ?? ".";
const out = (name) => path.join(temp, "opencode", name);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
if (!up) throw new Error("no edge");

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9222",
  defaultViewport: { width: 1280, height: 860 },
});
const page = await browser.newPage();
await page.goto("http://localhost:1420", { waitUntil: "networkidle0", timeout: 30000 });
await sleep(700);
await page.evaluate(() => localStorage.setItem("kova-theme", "dark"));
await page.reload({ waitUntil: "networkidle0" });
await sleep(700);
await page.screenshot({ path: out("hub-dark.png") });

await page.evaluate(() => localStorage.setItem("kova-theme", "light"));
await page.reload({ waitUntil: "networkidle0" });
await sleep(700);
await page.screenshot({ path: out("hub-light.png") });

await page.evaluate(() => {
  const node = [...document.querySelectorAll(".nav-item")].find(
    (item) => item.textContent?.trim() === "Редактор",
  );
  node?.click();
});
await sleep(500);
await page.screenshot({ path: out("hub-light-editor.png") });

await browser.close();
edge.kill();
preview.kill();
