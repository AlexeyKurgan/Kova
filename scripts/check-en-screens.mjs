import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const temp = process.env.TEMP ?? ".";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const edge = spawn(
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9325",
    `--user-data-dir=${path.join(temp, "opencode", "edge-en-full2")}`,
    "--no-first-run",
    "about:blank",
  ],
  { stdio: "ignore" },
);
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9325/json/version");
    break;
  } catch {}
}
const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9325",
  protocolTimeout: 120000,
  defaultViewport: { width: 1440, height: 1100 },
});
const page = await browser.newPage();
page.on("console", (message) => console.log("console:", message.text()));
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
await sleep(800);

const report = {};
for (const [key, section] of [
  ["overview", "Обзор"],
  ["tasks", "Задачи"],
  ["assets", "Ассеты"],
  ["review", "Review"],
]) {
  await page.evaluate((value) => {
    document.querySelector(`.nav-item[data-section="${value}"]`)?.click();
  }, section);
  await sleep(2200);
  report[key] = await page.evaluate(() => ({
    heading: document.querySelector("h1")?.textContent ?? "",
    buttons: [...document.querySelectorAll("button")].slice(0, 12).map((node) =>
      node.textContent?.trim(),
    ),
    body: document.body.innerText.slice(0, 700),
  }));
  await page.screenshot({
    path: path.join(temp, "opencode", `en-${key}.png`),
    fullPage: false,
  });
}
console.log(JSON.stringify(report, null, 2));
await browser.close();
edge.kill();
