import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const file = path.join("C:\\work\\KovaHub", "apps", "desktop", "src", "styles", "global.css");
let text = await readFile(file, "utf-8");

const map = {
  "#151a20": "var(--bg-raised)",
  "#9aa4b2": "var(--text-secondary)",
  "#262d36": "var(--border)",
  "#2a323c": "var(--border-strong)",
  "#222831": "var(--border)",
  "#8b96a4": "var(--text-muted)",
  "#232a33": "var(--border)",
  "#1a1f26": "var(--border)",
  "#c7d0db": "var(--text-secondary)",
  "#5a6572": "var(--text-muted)",
  "#333c48": "var(--border-strong)",
  "#1a2027": "var(--border)",
  "#171c23": "var(--border)",
  "#b9c3cf": "var(--text-secondary)",
  "#7d8896": "var(--text-muted)",
  "#5f6a78": "var(--text-muted)",
  "#4f5a67": "var(--text-muted)",
  "#4c5866": "var(--text-muted)",
  "#2d3540": "var(--border-strong)",
  "#1d232b": "var(--border)",
  "#181e25": "var(--bg-card-hover)",
  "#0b0d10": "var(--bg-app)",
  "#f0d7a8": "var(--accent-strong)",
  "#e7b25a": "var(--accent)",
  "#f0bd68": "var(--accent-strong)",
  "#e3aa50": "var(--accent)",
  "#d99f45": "var(--accent)",
  "#cfd7e1": "var(--text-secondary)",
  "#cbb489": "var(--text-secondary)",
  "#313a46": "var(--border-strong)",
  "#2c3540": "var(--border-strong)",
  "#1f252d": "var(--bg-raised)",
  "#1c222a": "var(--bg-raised)",
  "#141920": "var(--bg-inset)",
  "#14181e": "var(--bg-card)",
  "#12161b": "var(--bg-card)",
  "#101419": "var(--bg-inset)",
  "#0f1318": "var(--bg-inset)",
  "#090b0e": "var(--bg-app)",
  "#9fd9c4": "var(--success-text)",
  "#a8c8f5": "var(--info-text)",
  "#e29a9a": "var(--danger-text)",
  "#e08d8d": "var(--danger-text)",
};

for (const [from, to] of Object.entries(map)) {
  text = text.split(from).join(to);
}
text = text.replaceAll("rgba(224, 169, 79,", "rgba(var(--accent-rgb),");
await writeFile(file, text, "utf-8");
console.log("hub colors mapped");
