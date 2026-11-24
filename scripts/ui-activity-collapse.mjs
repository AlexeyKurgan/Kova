import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const root = "C:\\work\\KovaHub";
const temp = process.env.TEMP ?? ".";
const out = (name) => path.join(temp, "opencode", name);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    "--remote-debugging-port=9235",
    `--user-data-dir=${path.join(temp, "opencode", "edge-activity-collapse")}`,
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);
for (let index = 0; index < 30; index += 1) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9235/json/version");
    break;
  } catch {
    // retry
  }
}

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9235",
  defaultViewport: { width: 1480, height: 960 },
});
const page = await browser.newPage();
await page.goto("http://localhost:1420", { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.setItem("kova-theme", "dark"));
await page.reload({ waitUntil: "networkidle0" });
await sleep(1400);

await page.evaluate(() => {
  const node = [...document.querySelectorAll(".ov-link")].find((item) =>
    item.textContent?.includes("Все события"),
  );
  node?.click();
});
await sleep(700);
const modal = await page.$(".activity-modal");
console.log("modal:", Boolean(modal));
const months = await page.$$eval(".activity-month-head", (rows) => rows.length);
console.log("months:", months);
const before = await page.$$eval(".activity-days", (rows) => rows.length);
await page.click(".activity-month-head");
await sleep(300);
const collapsed = await page.$$eval(".activity-days", (rows) => rows.length);
const headStill = await page.$$eval(".activity-month-head", (rows) => rows.length);
console.log("days before/collapsed/head:", before, collapsed, headStill);
await page.screenshot({ path: out("activity-collapsed-new.png") });
await page.click(".activity-month-head");
await sleep(300);
console.log(
  "days reopened:",
  await page.$$eval(".activity-days", (rows) => rows.length),
);
await page.evaluate(() => document.querySelector(".activity-modal .icon-btn")?.click());
await sleep(300);

async function nav(label) {
  await page.evaluate((target) => {
    document.querySelector(`.nav-item[data-section="${target}"]`)?.click();
  }, label);
  await sleep(900);
}

await nav("Агенты");
await page.screenshot({ path: out("agents-brand-new.png") });
await nav("Проекты");
await page.screenshot({ path: out("projects-brand-new.png") });
await nav("Снапшоты");
await page.screenshot({ path: out("snapshots-icons-new.png") });

await browser.close();
edge.kill();
preview.kill();
console.log("done");
