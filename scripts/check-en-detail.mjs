import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const temp = process.env.TEMP ?? ".";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const edge = spawn(
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9326",
    `--user-data-dir=${path.join(temp, "opencode", "edge-en-detail")}`,
    "--no-first-run",
    "about:blank",
  ],
  { stdio: "ignore" },
);
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9326/json/version");
    break;
  } catch {}
}
const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9326",
  protocolTimeout: 120000,
  defaultViewport: { width: 1440, height: 1100 },
});
const page = await browser.newPage();
await page.goto("http://localhost:1420", { waitUntil: "networkidle0", timeout: 120000 });
await page.evaluate(() => {
  localStorage.setItem("kova-theme", "dark");
  localStorage.setItem("kova-app-preferences", JSON.stringify({ language: "en" }));
});
await page.reload({ waitUntil: "networkidle0" });
await sleep(3000);
await page.evaluate(() => {
  const close = document.querySelector(".onboarding-modal .icon-btn");
  if (close instanceof HTMLElement) close.click();
});
await sleep(500);
await page.evaluate(() => {
  document.querySelector('.nav-item[data-section="Задачи"]')?.click();
});
await sleep(1500);
await page.evaluate(() => {
  document.querySelector(".tk-row:not(.is-head)")?.click();
});
await sleep(2000);
console.log(
  "task:",
  await page.evaluate(() => ({
    head: document.querySelector(".task-detail h1, .td-head h1, h1")?.textContent ?? "",
    body: document.body.innerText.slice(0, 1200),
  })),
);
await page.screenshot({ path: path.join(temp, "opencode", "en-task-detail.png") });

await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find(
    (node) => node.getAttribute("aria-label") === "Close" || node.textContent === "×",
  );
  button?.click();
});
await sleep(800);
await page.evaluate(() => {
  document.querySelector('.nav-item[data-section="Ассеты"]')?.click();
});
await sleep(1500);
await page.evaluate(() => {
  document.querySelector(".asset-table-row:not(.is-head)")?.click();
});
await sleep(2000);
console.log(
  "asset:",
  await page.evaluate(() => ({
    head: document.querySelector("h1")?.textContent ?? "",
    body: document.body.innerText.slice(0, 1400),
  })),
);
await page.screenshot({ path: path.join(temp, "opencode", "en-asset-passport.png") });
await browser.close();
edge.kill();
