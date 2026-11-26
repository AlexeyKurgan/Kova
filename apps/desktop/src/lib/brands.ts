import type { BrandName } from "../components/brandPaths";
import type { Engine } from "./types";

export const ENGINE_BRAND: Partial<Record<Engine, BrandName>> = {
  roblox: "roblox",
  blender: "blender",
  godot: "godot",
  unity: "unity",
  unreal: "unreal",
};

export const PROVIDER_BRAND: Record<string, BrandName | undefined> = {
  openai: "openai",
  google: "gemini",
  claude: "claude",
  codex: "openai",
  gemini: "gemini",
  opencode: "opencode",
  deepseek: "deepseek",
};

export function engineBrand(engine: Engine): BrandName | null {
  return ENGINE_BRAND[engine] ?? null;
}

export function providerBrand(providerId: string): BrandName | null {
  return PROVIDER_BRAND[providerId] ?? null;
}
