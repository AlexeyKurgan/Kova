import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const temp = process.env.TEMP ?? ".";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const edge = spawn(
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9322",
    `--user-data-dir=${path.join(temp, "opencode", "edge-video")}`,
    "--no-first-run",
    "--autoplay-policy=no-user-gesture-required",
    "about:blank",
  ],
  { stdio: "ignore" },
);
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9322/json/version");
    break;
  } catch {}
}
const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9322",
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
await sleep(3000);

const card = await page.evaluateHandle(() => {
  return [...document.querySelectorAll(".review-card")].find((node) =>
    node.textContent?.includes("Проверка видео-пинов"),
  );
});
if (!card.asElement()) {
  console.log("review card not found");
  await page.screenshot({ path: path.join(temp, "opencode", "review-missing.png") });
  await browser.close();
  edge.kill();
  process.exit(1);
}
await card.asElement().scrollIntoView();
await sleep(2500);
console.log(
  "video:",
  await page.evaluate(() => {
    const video = document.querySelector(".review-stage-video");
    if (!(video instanceof HTMLVideoElement)) return null;
    return {
      src: video.currentSrc,
      readyState: video.readyState,
      duration: video.duration,
      width: video.clientWidth,
    };
  }),
);
await page.evaluate(() => {
  const video = document.querySelector(".review-stage-video");
  if (video instanceof HTMLVideoElement) {
    video.currentTime = 1.2;
    video.dispatchEvent(new Event("timeupdate"));
  }
});
await sleep(800);
await page.evaluate(() => {
  const button = [...document.querySelectorAll(".review-stage-toggle")].find((node) =>
    node.textContent?.includes("Пин на"),
  );
  if (button instanceof HTMLElement) button.click();
});
await sleep(500);
await page.type(".review-pin-form textarea", "Поправить кадр на первой секунде");
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
    markers: document.querySelectorAll(".review-video-marker").length,
    pinButtons: document.querySelectorAll(".review-pin").length,
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
await block?.screenshot({ path: path.join(temp, "opencode", "review-video.png") });
await browser.close();
edge.kill();
