import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const temp = process.env.TEMP ?? ".";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const edge = spawn(
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9320",
    `--user-data-dir=${path.join(temp, "opencode", "edge-marketplace")}`,
    "--no-first-run",
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: "ignore" },
);
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9320/json/version");
    break;
  } catch {}
}
const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9320",
  protocolTimeout: 120000,
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
page.on("console", (message) => console.log("console:", message.text()));
await page.goto("http://localhost:1420", { waitUntil: "networkidle0", timeout: 120000 });
await page.evaluate(() => {
  localStorage.setItem("kova-theme", "dark");
  localStorage.setItem("kova-app-preferences", JSON.stringify({ language: "ru" }));
});
await page.reload({ waitUntil: "networkidle0" });
await sleep(2500);

const closeOnboarding = await page.evaluate(() => {
  const button = document.querySelector(".onboarding-modal .icon-btn, .onboarding-modal .modal-close");
  if (button instanceof HTMLElement) {
    button.click();
    return true;
  }
  return false;
});
console.log("onboarding closed:", closeOnboarding);

await page.evaluate(() => {
  document.querySelector('.nav-item[data-section="Пакеты"]')?.click();
});
await sleep(1500);
await page.evaluate(() => {
  const tab = [...document.querySelectorAll(".pkg-tab")].find((node) =>
    node.textContent?.includes("Маркетплейс"),
  );
  tab?.click();
});
await sleep(5000);
console.log(
  "market:",
  await page.evaluate(() => ({
    cards: document.querySelectorAll(".pkg-market .pkg-card").length,
    error: document.querySelector(".pkg-market .resource-error")?.textContent ?? "",
    note: document.querySelector(".pkg-market-note")?.textContent ?? "",
    first: document.querySelector(".pkg-market .pkg-title b")?.textContent ?? "",
    trust: document.querySelector(".pkg-market .pkg-trust")?.textContent ?? "",
  })),
);
await page.screenshot({ path: path.join(temp, "opencode", "marketplace.png") });

await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find(
    (node) => node.getAttribute("aria-label") === "Настройки",
  );
  button?.click();
});
await sleep(1200);
await page.evaluate(() => {
  const select = [...document.querySelectorAll(".settings-screen select")].find((node) =>
    [...node.options].some((option) => option.value === "en"),
  );
  if (select instanceof HTMLSelectElement) {
    select.value = "en";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
await sleep(1200);
console.log(
  "english:",
  await page.evaluate(() => ({
    nav: [...document.querySelectorAll(".nav-label")].slice(0, 8).map((node) => node.textContent),
    title: document.querySelector(".settings-screen h1")?.textContent ?? "",
    lang: document.documentElement.lang,
    languageSelect: [...document.querySelectorAll(".settings-screen select")].find((node) =>
      [...node.options].some((option) => option.value === "en"),
    )?.value,
  })),
);
await page.screenshot({ path: path.join(temp, "opencode", "settings-en.png") });

await browser.close();
edge.kill();
