import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const temp = process.env.TEMP ?? ".";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const edge = spawn(
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  [
    "--headless=new",
    "--remote-debugging-port=9321",
    `--user-data-dir=${path.join(temp, "opencode", "edge-webm")}`,
    "--no-first-run",
    "about:blank",
  ],
  { stdio: "ignore" },
);
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try {
    await fetch("http://127.0.0.1:9321/json/version");
    break;
  } catch {}
}
const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9321",
  protocolTimeout: 120000,
  defaultViewport: { width: 640, height: 360 },
});
const page = await browser.newPage();
await page.goto("about:blank");
const base64 = await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 270;
  document.body.append(canvas);
  const context = canvas.getContext("2d");
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  let frame = 0;
  const timer = setInterval(() => {
    context.fillStyle = "#101418";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#e8b45a";
    context.beginPath();
    context.arc(80 + (frame % 320), 135, 42, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = "24px sans-serif";
    context.fillText(`frame ${frame}`, 24, 32);
    frame += 1;
  }, 33);
  recorder.start();
  await new Promise((resolve) => setTimeout(resolve, 2200));
  clearInterval(timer);
  recorder.stop();
  await stopped;
  const buffer = await new Blob(chunks, { type: "video/webm" }).arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
});
const target = path.join(temp, "opencode", "kova-review-clip.webm");
fs.writeFileSync(target, Buffer.from(base64, "base64"));
console.log(target, fs.statSync(target).size);
await browser.close();
edge.kill();
