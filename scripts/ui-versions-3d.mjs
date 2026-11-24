import { mkdir, rm } from "node:fs/promises";
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
  if (!response.ok) throw new Error(`${pathname}: ${response.status} ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json();
}

const projectDir = path.join(temp, "opencode", "versions-3d-project");
let preview;
let edge;
let browser;
const results = [];

try {
  await rm(projectDir, { recursive: true, force: true });
  await mkdir(projectDir, { recursive: true });
  await api("/project/open", {
    method: "POST",
    body: JSON.stringify({ path: projectDir, name: "Versions 3D", engine: "generic" }),
  });
  const asset = await api("/assets/import", {
    method: "POST",
    body: JSON.stringify({
      path: path.join(temp, "opencode", "kova-cube.glb"),
      engine: "generic",
      license: "CC0",
    }),
  });
  const firstCheck = await api(`/assets/${asset.id}/blender`, { method: "POST" });
  results.push(["v1 preview", Boolean(firstCheck.asset.preview)]);
  results.push(["v1 triangles", firstCheck.asset.metrics.triangles]);
  results.push(["v1 checks", firstCheck.checks.length]);

  const withVersion = await api(`/assets/${asset.id}/versions`, {
    method: "POST",
    body: JSON.stringify({
      path: path.join(temp, "opencode", "blender-cube.blend"),
      reason: "Вторая версия из .blend",
      make_current: true,
    }),
  });
  results.push(["versions", withVersion.versions.map((item) => item.label).join(",")]);
  results.push(["v2 checks", (await api(`/assets/${asset.id}/checks`)).length]);
  results.push([
    "v1 checks by id",
    (await api(`/assets/${asset.id}/checks?version_id=${asset.versions[0].id}`)).length,
  ]);

  preview = spawn(
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

  edge = spawn(
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    [
      "--headless=new",
      "--remote-debugging-port=9238",
      `--user-data-dir=${path.join(temp, "opencode", "edge-versions-3d")}`,
      "--no-first-run",
      "--enable-webgl",
      "--use-gl=angle",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  for (let index = 0; index < 30; index += 1) {
    await sleep(500);
    try {
      await fetch("http://127.0.0.1:9238/json/version");
      break;
    } catch {
      // retry
    }
  }

  browser = await puppeteer.connect({
    browserURL: "http://127.0.0.1:9238",
    defaultViewport: { width: 1480, height: 980 },
  });
  const page = await browser.newPage();
  await page.goto("http://localhost:1420", { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.setItem("kova-theme", "dark"));
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(1400);

  await page.evaluate(() => document.querySelector('.nav-item[data-section="Ассеты"]')?.click());
  await sleep(800);
  await page.evaluate(() => document.querySelector(".asset-card2")?.click());
  await sleep(1200);
  const viewerReady = await page
    .waitForFunction(
      () => {
        const note = document.querySelector(".asset-viewer3d-note");
        return note ? /ЛКМ|Не удалось/.test(note.textContent ?? "") : false;
      },
      { timeout: 120000 },
    )
    .then(() => true)
    .catch(() => false);
  results.push(["v2 viewer ready", viewerReady]);
  results.push([
    "v2 viewer note",
    await page.$eval(".asset-viewer3d-note", (node) => node.textContent).catch(() => ""),
  ]);
  results.push(["v2 canvas", Boolean(await page.$(".asset-viewer3d canvas"))]);
  results.push(["current tag", await page.$eval(".asset-current-tag", (node) => node.textContent)]);
  await page.screenshot({ path: out("version-2-current.png") });

  await page.select(".asset-version-control select", asset.versions[0].id);
  await sleep(1200);
  results.push(["note", (await page.$(".asset-version-note")) !== null]);
  results.push([
    "header while browsing",
    await page.$eval(".task-summary-id", (node) => node.textContent),
  ]);
  results.push([
    "activate button",
    (await page.$(".asset-version-control .btn")) !== null,
  ]);
  results.push([
    "buttons disabled",
    await page.$$eval(".header-actions .btn", (nodes) =>
      nodes.slice(0, 2).every((node) => node.disabled),
    ),
  ]);
  results.push(["v1 triangles", await page.$eval(".asset-metrics b", (node) => node.textContent)]);
  results.push([
    "checks count",
    await page.$$eval(".check-row", (nodes) => nodes.length),
  ]);
  const renderTab = await page.$$eval(".asset-preview-modes button", (nodes) =>
    nodes.map((node) => node.textContent),
  );
  results.push(["tabs", renderTab.join(",")]);
  const renderButton = await page.$(".asset-preview-modes button:nth-child(2)");
  if (renderButton) {
    await renderButton.click();
    await sleep(700);
  }
  results.push([
    "preview src",
    await page.$eval(".asset-preview2", (node) => node.getAttribute("src") ?? ""),
  ]);
  await page.screenshot({ path: out("version-1-browse.png") });

  const activate = await page.$(".asset-version-control .btn");
  if (activate) {
    await activate.click();
    await sleep(2500);
  }
  results.push([
    "select after activate",
    await page.$eval(".asset-version-control select", (node) => node.value),
  ]);
  results.push(["v1 is first", await page.$eval(".asset-version-control select", (node) => node.options[0].value)]);
  results.push(["header label", await page.$eval(".task-summary-id", (node) => node.textContent)]);
  await page.screenshot({ path: out("version-1-current.png") });

  for (const [name, value] of results) console.log(`${name}: ${value}`);
} finally {
  await browser?.close().catch(() => undefined);
  edge?.kill();
  preview?.kill();
  await api("/project/demo", { method: "POST" }).catch(() => undefined);
  const projects = await api("/projects").catch(() => ({ projects: [] }));
  const tempProject = projects.projects.find((item) => item.path === projectDir);
  if (tempProject) {
    await api(`/projects/${tempProject.id}?delete_files=true`, { method: "DELETE" }).catch(
      () => undefined,
    );
  }
  await rm(projectDir, { recursive: true, force: true });
  console.log("done");
}
