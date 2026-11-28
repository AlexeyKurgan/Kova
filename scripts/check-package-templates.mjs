import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const temp = process.env.TEMP ?? ".";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const edge = spawn(
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9323",
    `--user-data-dir=${path.join(temp, "opencode", "edge-templates")}`,
    "--no-first-run",
    "about:blank",
  ],
  { stdio: "ignore" },
);
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9323/json/version");
    break;
  } catch {}
}
const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9323",
  protocolTimeout: 120000,
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
page.on("console", (message) => console.log("console:", message.text()));
await page.goto("http://localhost:1420", { waitUntil: "networkidle0", timeout: 120000 });
await page.evaluate(() => localStorage.setItem("kova-theme", "dark"));
await page.reload({ waitUntil: "networkidle0" });
await sleep(2500);
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
  const button = [...document.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Шаблоны"),
  );
  button?.click();
});
await sleep(4000);
console.log(
  "library:",
  await page.evaluate(() => ({
    cards: document.querySelectorAll(".template-card").length,
    packageCards: [...document.querySelectorAll(".template-card")].filter((node) =>
      node.textContent?.includes("из пакета"),
    ).length,
    labels: [...document.querySelectorAll(".template-card b")].map((node) => node.textContent),
  })),
);
await page.screenshot({ path: path.join(temp, "opencode", "task-library.png") });
await page.evaluate(() => {
  const card = [...document.querySelectorAll(".template-card")].find((node) =>
    node.textContent?.includes("Проверка по чек-листу"),
  );
  const button = card?.querySelector("button");
  if (button instanceof HTMLElement) button.click();
});
await sleep(1500);
console.log(
  "dialog:",
  await page.evaluate(() => ({
    title: document.querySelector("#task-title")?.value ?? "",
    goal: document.querySelector("#task-goal")?.value ?? "",
    criteria: document.querySelector("#task-criteria")?.value ?? "",
    activeChip: document.querySelector(".task-template-chip.is-active")?.textContent ?? "",
  })),
);
await page.screenshot({ path: path.join(temp, "opencode", "task-template-dialog.png") });
await browser.close();
edge.kill();
