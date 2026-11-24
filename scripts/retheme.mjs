import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = "C:\\work\\KovaHub";
const files = {
  dark: path.join(root, "apps", "desktop", "src-tauri", "resources", "kova-theme", "themes", "kova-dark.json"),
  light: path.join(root, "apps", "desktop", "src-tauri", "resources", "kova-theme", "themes", "kova-light.json"),
};

const dark = {
  "#262520": "#111720",
  "#2b2923": "#171D26",
  "#23211c": "#10141B",
  "#3c3830": "#283342",
  "#e9e2d6": "#E7EDF4",
  "#a79d8e": "#A1ADBC",
  "#d8d0c3": "#C9D3DF",
  "#cfc6b8": "#A1ADBC",
  "#8d8578": "#748195",
  "#6f675b": "#5C6773",
  "#7c7466": "#5C6773",
  "#b8ae9e": "#A1ADBC",
  "#e2a94e": "#D8A657",
  "#edbb63": "#E7BC75",
  "#241d10": "#10141B",
  "#1f1d18": "#10141B",
  "#4a443a": "#34445A",
  "#4a2424": "#3A2228",
  "#4a3924": "#3A2E1E",
  "#5a5346": "#34445A",
  "#5a534633": "#A1ADBC33",
  "#6b625244": "#A1ADBC44",
  "#e2a94e55": "#D8A65755",
  "#e2a94e88": "#D8A65788",
  "#e2a94e33": "#D8A65733",
  "#4a4335": "#223042",
  "#37322a": "#1D2634",
  "#34302a": "#1D2634",
  "#3a352c": "#1D2634",
  "#474033": "#26313F",
  "#4b4232": "#223042",
  "#3a352b": "#1D2634",
  "#2e2b25": "#151C26",
  "#4b423266": "#22304266",
  "#4b423255": "#22304255",
  "#4b423288": "#D8A65744",
  "#6b5420aa": "#D8A65755",
  "#6b542066": "#D8A65733",
  "#3a352d": "#1D2634",
  "#6b4a20": "#2A3B52",
  "#1d1414": "#2A1A1A",
  "#d98fb0": "#C792EA",
  "#a9c78a": "#9ECE6A",
  "#e5a45a": "#F78C6C",
  "#e6c07b": "#82AAFF",
  "#8fc1b5": "#7FDBCA",
  "#c9beb0": "#89DDFF",
  "#d8b892": "#E0AF68",
  "#e26d6d": "#F07178",
  "#ef8a8a": "#FF8A8A",
  "#bdd79f": "#B9E88A",
  "#f0d39a": "#FFD39A",
  "#a8c8f5": "#A8C8FF",
  "#e8aec9": "#E8AEC9",
  "#a9d6cc": "#A9D6CC",
  "#f7f0e4": "#F5F8FC",
  "#8fb4d9": "#82AAFF",
  "#3c383000": "#00000000",
  "#00000066": "#00000066",
  "#00000000": "#00000000",
};

const light = {
  "#faf6ef": "#FFFFFF",
  "#f3ede2": "#FFFFFF",
  "#efe8dc": "#F4F6F9",
  "#d8cdbb": "#DCE2EA",
  "#312a20": "#202A38",
  "#7d7364": "#748195",
  "#6b6154": "#5A6678",
  "#8b8172": "#748195",
  "#9b9182": "#9AA4B2",
  "#c8b99f": "#C9D3DF",
  "#e7dcc9": "#E7EDF4",
  "#b47a1f": "#D69A3F",
  "#fffaf0": "#FFFFFF",
  "#c98a25": "#E0A94F",
  "#e9dfcf": "#EEF2F7",
  "#dfd2bc": "#E2E8F0",
  "#fffdf8": "#FFFFFF",
  "#cdbfa9": "#C9D3DF",
  "#f1e9db": "#F4F6F9",
  "#e9dcc4": "#F3E4C8",
  "#241f18": "#202A38",
  "#eee4d4": "#F7F3E8",
  "#eee6d8": "#F7F9FC",
  "#f6f0e5": "#F7F9FC",
  "#e0d2bb": "#E2E8F0",
  "#e8d3ae": "#EADFC8",
  "#f7e3e0": "#FBE9E9",
  "#f7ecd9": "#FBF3E2",
  "#f0d08a": "#F6E0B0",
  "#5f7f3f": "#4E7D3A",
  "#b5651d": "#B5651D",
  "#9a4f7a": "#8A4FA3",
  "#5e5547": "#5A6472",
  "#2f7d6f": "#2F7D6F",
  "#a35f14": "#A35F14",
  "#8c8273": "#8A93A3",
  "#7a5a2a": "#7A5A2A",
  "#2f6f9f": "#2F6F9F",
  "#3d86bd": "#3D86BD",
  "#b94a4a": "#C94F4F",
  "#cf5a5a": "#D95C5C",
  "#6f9448": "#6F9448",
  "#a8741f": "#B7791F",
  "#b36192": "#B36192",
  "#3a9684": "#3A9684",
  "#8a6318": "#2F6F9F",
  "#8a7a5a22": "#9AA4B222",
  "#8a7a5a00": "#9AA4B200",
  "#b9a98c33": "#9AA4B233",
  "#a8987b44": "#8A96A844",
  "#b47a1f55": "#D69A3F55",
  "#b47a1f88": "#D69A3F88",
  "#b47a1f22": "#D69A3F22",
  "#00000000": "#00000000",
};

for (const [theme, map] of [["dark", dark], ["light", light]]) {
  const file = files[theme];
  let text = await readFile(file, "utf-8");
  const used = new Set();
  text = text.replace(/#[0-9a-fA-F]{6,8}/g, (match) => {
    const key = match.toLowerCase();
    if (map[key]) {
      used.add(key);
      return map[key];
    }
    return match;
  });
  await writeFile(file, text, "utf-8");
  console.log(theme, "replaced", used.size, "colors");
}
