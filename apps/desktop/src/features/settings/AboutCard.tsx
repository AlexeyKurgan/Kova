import { useState } from "react";
import { Download, Info, RefreshCw } from "lucide-react";
import { checkForUpdates, downloadUpdate } from "../../lib/coreClient";

type UpdateInfo = Awaited<ReturnType<typeof checkForUpdates>>;

export default function AboutCard() {
  const [result, setResult] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");
  const [installer, setInstaller] = useState<{ path: string; name: string } | null>(null);
  const [installerError, setInstallerError] = useState("");

  const check = async () => {
    setBusy(true);
    setError("");
    try {
      setResult(await checkForUpdates());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось проверить обновления");
    } finally {
      setBusy(false);
    }
  };

  const download = async (url: string, name: string) => {
    setDownloading(name);
    setError("");
    setInstaller(null);
    setInstallerError("");
    try {
      const result = await downloadUpdate(url);
      setInstaller({ path: result.path, name: result.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось скачать обновление");
    } finally {
      setDownloading("");
    }
  };

  const installDownloaded = async () => {
    if (!installer) return;
    setInstallerError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("install_update", { path: installer.path });
    } catch (err) {
      setInstallerError(
        err instanceof Error ? err.message : "Не удалось запустить установку",
      );
    }
  };

  const openInstaller = async () => {
    if (!installer) return;
    setInstallerError("");
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(installer.path);
    } catch (err) {
      setInstallerError(
        err instanceof Error
          ? err.message
          : `Не удалось открыть установщик: ${installer.path}`,
      );
    }
  };

  const openRelease = async () => {
    if (!result?.url) return;
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(result.url);
    } catch {
      window.open(result.url, "_blank");
    }
  };

  return (
    <article className="settings-card is-wide about-card">
      <div className="settings-card-head">
        <span className="settings-icon">
          <Info size={16} />
        </span>
        <div>
          <b>О программе</b>
          <small>Версия, канал обновлений и диагностика релиза</small>
        </div>
      </div>
      <div className="about-grid">
        <div><span>Приложение</span><b>Kova Hub</b></div>
        <div><span>Версия</span><b>{result?.current ?? "0.4.3"}</b></div>
        <div><span>Платформа</span><b>Windows x64</b></div>
        <div><span>Канал</span><b>GitHub Releases</b></div>
      </div>
      <div className="about-update">
        <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => void check()}>
          <RefreshCw size={13} />
          {busy ? "Проверяю…" : "Проверить обновления"}
        </button>
        {result?.error ? <p className="about-message is-warn">{result.error}</p> : null}
        {error ? <p className="about-message is-warn">{error}</p> : null}
        {result && !result.error ? (
          result.update_available ? (
            <div className="about-release">
              <b>Доступна версия {result.latest}</b>
              <small>{result.published_at ? `Опубликована ${result.published_at}` : ""}</small>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => void openRelease()}>
                <Download size={13} />
                Открыть релиз
              </button>
              {result.assets.map((asset) => (
                <button
                  type="button"
                  key={asset.url}
                  className="btn btn-secondary btn-small"
                  disabled={Boolean(downloading)}
                  onClick={() => void download(asset.url, asset.name)}
                >
                  <Download size={13} />
                  {downloading === asset.name ? "Скачивание…" : asset.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="about-message">Обновлений нет — установлена последняя версия.</p>
          )
        ) : null}
        {installer ? (
          <div className="about-installer">
            <span>Скачано: <code>{installer.path}</code></span>
            <button type="button" className="btn btn-primary btn-small" onClick={() => void installDownloaded()}>
              <Download size={13} />
              Установить и закрыть Kova
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void openInstaller()}>
              Открыть вручную
            </button>
            {installerError ? <p className="about-message is-warn">{installerError}</p> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
