type DialogResult = string | string[] | null;

type DialogModule = {
  open: (options: Record<string, unknown>) => Promise<DialogResult>;
  save?: (options: Record<string, unknown>) => Promise<string | null>;
};

async function loadDialog(): Promise<DialogModule | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  try {
    return (await import("@tauri-apps/plugin-dialog")) as DialogModule;
  } catch {
    return null;
  }
}

export async function pickFolder(title = "Выбрать папку"): Promise<string | null> {
  const dialog = await loadDialog();
  if (!dialog) return null;
  const selected = await dialog.open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}

export async function pickFile(
  title: string,
  extensions: string[],
): Promise<string | null> {
  const dialog = await loadDialog();
  if (!dialog) return null;
  const selected = await dialog.open({
    directory: false,
    multiple: false,
    title,
    filters: [{ name: "Файлы", extensions }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickImage(title = "Выбрать обложку"): Promise<string | null> {
  const dialog = await loadDialog();
  if (!dialog) return null;
  const selected = await dialog.open({
    directory: false,
    multiple: false,
    title,
    filters: [{ name: "Изображения", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  return typeof selected === "string" ? selected : null;
}


export async function pickSaveFile(
  title: string,
  defaultName: string,
  extensions: string[],
): Promise<string | null> {
  const dialog = await loadDialog();
  if (!dialog?.save) return null;
  const selected = await dialog.save({
    title,
    defaultPath: defaultName,
    filters: [{ name: "Kova", extensions }],
  });
  return typeof selected === "string" ? selected : null;
}
