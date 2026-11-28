import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const temp = process.env.TEMP ?? ".";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const edge = spawn(
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9324",
    `--user-data-dir=${path.join(temp, "opencode", "edge-anim-pins")}`,
    "--no-first-run",
    "about:blank",
  ],
  { stdio: "ignore" },
);
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9324/json/version");
    break;
  } catch {}
}
const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9324",
  protocolTimeout: 120000,
  defaultViewport: { width: 1440, height: 1100 },
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
await page.evaluate(() => {
  const close = document.querySelector(".onboarding-modal .icon-btn");
  if (close instanceof HTMLElement) close.click();
});
await sleep(500);
await page.evaluate(() => {
  document.querySelector('.nav-item[data-section="Review"]')?.click();
});
await sleep(4000);
console.log(
  "frame stage:",
  await page.evaluate(() => ({
    timelines: document.querySelectorAll(".review-frame-timeline").length,
    range: document.querySelector(".review-frame-track input")?.value ?? "",
    label: document.querySelector(".review-frame-head")?.textContent ?? "",
    image: document.querySelector(".review-stage-image")?.getAttribute("src") ?? "",
    pinButton: [...document.querySelectorAll(".review-stage-toggle")].map((node) => node.textContent),
  })),
);
await page.evaluate(() => {
  const input = document.querySelector(".review-frame-track input");
  if (input instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, "3");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
await sleep(1200);
console.log(
  "after slider:",
  await page.evaluate(() => ({
    label: document.querySelector(".review-frame-head")?.textContent ?? "",
    image: document.querySelector(".review-stage-image")?.getAttribute("src") ?? "",
  })),
);
await page.evaluate(() => {
  const button = [...document.querySelectorAll(".review-stage-toggle")].find((node) =>
    node.textContent?.includes("Пин на кадре"),
  );
  if (button instanceof HTMLElement) button.click();
});
await sleep(500);
await page.type(".review-pin-form textarea", "Поправить замах на 12 кадре");
await page.evaluate(() => {
  const button = [...document.querySelectorAll(".review-pin-form-actions button")].find(
    (node) => node.textContent?.includes("Добавить пин"),
  );
  if (button instanceof HTMLElement) button.click();
});
await sleep(2000);
console.log(
  "pins:",
  await page.evaluate(() => ({
    markers: document.querySelectorAll(".review-frame-marker").length,
    pins: document.querySelectorAll(".review-pin").length,
    comments: [...document.querySelectorAll(".review-comment-copy p")].map(
      (node) => node.textContent,
    ),
    times: [...document.querySelectorAll(".review-comment-copy small")].map(
      (node) => node.textContent,
    ),
    form: Boolean(document.querySelector(".review-pin-form")),
  })),
);
const block = await page.$(".review-stage-block");
await block?.screenshot({ path: path.join(temp, "opencode", "review-animation.png") });
await browser.close();
edge.kill();
