export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return fallbackCopy(text);
  }
  return fallbackCopy(text);
}

function fallbackCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export async function readText(): Promise<string | null> {
  try {
    if (navigator.clipboard?.readText) {
      const value = await navigator.clipboard.readText();
      return value ?? "";
    }
  } catch {
    return null;
  }
  return null;
}
