function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function currentWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export async function minimizeWindow(): Promise<void> {
  if (!inTauri()) return;
  const appWindow = await currentWindow();
  await appWindow.minimize();
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (!inTauri()) return;
  const appWindow = await currentWindow();
  await appWindow.toggleMaximize();
}

export async function closeWindow(): Promise<void> {
  if (!inTauri()) return;
  const appWindow = await currentWindow();
  await appWindow.close();
}
