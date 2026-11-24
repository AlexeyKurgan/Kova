import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = "C:\\work\\KovaHub";
const source = path.join(root, "apps", "desktop", "src", "lib", "editorExtensions.ts");
const publicDir = path.join(root, "apps", "desktop", "public", "ext-icons");
const output = path.join(root, "apps", "desktop", "src", "lib", "editorIcons.ts");

await mkdir(publicDir, { recursive: true });

const text = await readFile(source, "utf-8");
const ids = [...text.matchAll(/id: "([^"]+)"/g)].map((match) => match[1]);
const icons = {};

for (const id of ids) {
  const [namespace, name] = id.split(".");
  try {
    const response = await fetch(
      `https://open-vsx.org/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/latest`,
    );
    if (!response.ok) {
      console.log("miss", id, response.status);
      continue;
    }
    const data = await response.json();
    const iconUrl = data?.files?.icon;
    if (!iconUrl) {
      console.log("no icon", id);
      continue;
    }
    const image = await fetch(iconUrl);
    if (!image.ok) {
      console.log("icon miss", id, image.status);
      continue;
    }
    const buffer = Buffer.from(await image.arrayBuffer());
    const ext = iconUrl.split(".").pop()?.split("?")[0]?.toLowerCase() ?? "png";
    const file = `${id}.${ext}`;
    await writeFile(path.join(publicDir, file), buffer);
    icons[id] = `/ext-icons/${file}`;
    console.log("ok", id, ext, `${(buffer.length / 1024).toFixed(1)} KiB`);
  } catch (error) {
    console.log("error", id, String(error));
  }
}

const lines = [
  "export const EXTENSION_ICONS: Record<string, string> = {",
  ...Object.entries(icons).map(([id, url]) => `  "${id}": "${url}",`),
  "};",
  "",
];
await writeFile(output, lines.join("\n"), "utf-8");
console.log(`saved ${Object.keys(icons).length}/${ids.length} icons`);
