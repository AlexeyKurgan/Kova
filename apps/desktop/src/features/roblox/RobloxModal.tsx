import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Download,
  Hammer,
  Plug,
  RefreshCw,
  Wand2,
  X,
} from "lucide-react";
import {
  buildRobloxPlace,
  executeRobloxCommand,
  getRobloxStatus,
  installRobloxPlugin,
} from "../../lib/coreClient";
import type { RobloxStatus } from "../../lib/types";

type Props = {
  initialStatus: RobloxStatus | null;
  projectPath: string | null;
  onClose: () => void;
};

const KOVA_WORKS_SOURCE = String.raw`local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

local function makeGui(player)
	local gui = player:WaitForChild("PlayerGui"):FindFirstChild("KovaStatus")
	if gui then gui:Destroy() end
	gui = Instance.new("ScreenGui")
	gui.Name = "KovaStatus"
	gui.ResetOnSpawn = false
	gui.Parent = player:WaitForChild("PlayerGui")
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromOffset(320, 56)
	label.Position = UDim2.new(0.5, -160, 0, 18)
	label.BackgroundColor3 = Color3.fromRGB(23, 28, 37)
	label.TextColor3 = Color3.fromRGB(226, 174, 78)
	label.Font = Enum.Font.GothamBold
	label.TextSize = 20
	label.Text = "Кова работает"
	label.Parent = gui
end

Players.PlayerAdded:Connect(makeGui)
for _, player in Players:GetPlayers() do makeGui(player) end

if not Workspace:FindFirstChild("KovaWorksSign") then
	local part = Instance.new("Part")
	part.Name = "KovaWorksSign"
	part.Anchored = true
	part.CanCollide = false
	part.Size = Vector3.new(16, 5, 0.5)
	part.Position = Vector3.new(0, 8, -18)
	part.Color = Color3.fromRGB(23, 28, 37)
	part.Parent = Workspace
	local surface = Instance.new("SurfaceGui")
	surface.Face = Enum.NormalId.Front
	surface.Parent = part
	local text = Instance.new("TextLabel")
	text.Size = UDim2.fromScale(1, 1)
	text.BackgroundTransparency = 1
	text.TextColor3 = Color3.fromRGB(226, 174, 78)
	text.Font = Enum.Font.GothamBold
	text.TextScaled = true
	text.Text = "Кова работает"
	text.Parent = surface
end

print("[Kova] Кова работает")
`;

export default function RobloxModal({ initialStatus, projectPath, onClose }: Props) {
  const [status, setStatus] = useState<RobloxStatus | null>(initialStatus);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      setStatus(await getRobloxStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось получить статус");
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, []);

  const install = async () => {
    setBusy("install");
    setError("");
    try {
      const data = await installRobloxPlugin();
      setMessage(`${data.message} ${data.path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось установить плагин");
    } finally {
      setBusy("");
    }
  };

  const buildPlace = async () => {
    if (!projectPath) {
      setError("Сначала открой проект Uncharted 3D.");
      return;
    }
    setBusy("build");
    setError("");
    setMessage("");
    try {
      const data = await buildRobloxPlace(projectPath, true);
      setMessage(
        `Место собрано: ${data.path} (${Math.round(data.bytes / 1024)} КБ)` +
          (data.asset_id ? ` · mesh ${data.asset_id}` : ""),
      );
      window.setTimeout(() => void refresh(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось собрать место");
    } finally {
      setBusy("");
    }
  };

  const ping = async () => {
    setBusy("ping");
    setError("");
    try {
      await executeRobloxCommand({ type: "ping" });
      setMessage("Ping отправлен. Если Studio подключён, статус обновится.");
      window.setTimeout(() => void refresh(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Мост недоступен");
    } finally {
      setBusy("");
    }
  };

  const createKovaWorks = async () => {
    setBusy("works");
    setError("");
    try {
      await executeRobloxCommand({
        type: "create_script",
        service: "ServerScriptService",
        path: "",
        name: "KovaBootstrap",
        script_type: "Script",
        source: KOVA_WORKS_SOURCE,
      });
      await executeRobloxCommand({
        type: "create_part",
        parent: "Workspace",
        name: "KovaWorksSign",
        size_x: 16,
        size_y: 5,
        size_z: 0.5,
        x: 0,
        y: 8,
        z: -18,
        r: 23,
        g: 28,
        b: 37,
      });
      setMessage("Команды Kova works отправлены в Studio.");
      window.setTimeout(() => void refresh(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить команды");
    } finally {
      setBusy("");
    }
  };

  const connected = Boolean(status?.connected);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal roblox-dialog">
        <div className="modal-header">
          <span className="modal-title">
            Roblox Studio
            <small>Локальный мост Kova, без Rojo</small>
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className={`roblox-status-card${connected ? " is-on" : ""}`}>
            <span className="roblox-status-icon">
              {connected ? <CheckCircle2 size={18} /> : <Plug size={18} />}
            </span>
            <div>
              <b>{connected ? "Studio подключён" : "Studio не подключён"}</b>
              <small>
                {connected
                  ? `Плагин ${status?.plugin_version || "Kova"} · очередь ${status?.pending ?? 0}`
                  : status?.studio_installed
                    ? "Studio найден. Установи плагин и перезапусти Studio."
                    : "Roblox Studio не найден на этом компьютере."}
              </small>
            </div>
            <button
              type="button"
              className="icon-btn"
              title="Обновить статус"
              onClick={() => void refresh()}
            >
              <RefreshCw size={14} />
            </button>
          </div>

          <div className="roblox-steps">
            <span>1</span>
            <p>Установи плагин в папку Roblox Plugins.</p>
            <span>2</span>
            <p>Перезапусти Studio и открой Plugins → Kova Bridge.</p>
            <span>3</span>
            <p>Включи HTTP-запросы в Game Settings → Security.</p>
          </div>

          <div className="roblox-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={Boolean(busy)}
              onClick={() => void install()}
            >
              <Download size={14} />
              {busy === "install" ? "Установка…" : "Установить плагин"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={Boolean(busy) || !projectPath}
              onClick={() => void buildPlace()}
              title={projectPath ? "Собрать .rbxlx и открыть в Studio" : "Открой проект"}
            >
              <Hammer size={14} />
              {busy === "build" ? "Сборка…" : "Собрать и открыть"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={Boolean(busy)}
              onClick={() => void ping()}
            >
              <Plug size={14} />
              {busy === "ping" ? "Проверка…" : "Проверить связь"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={Boolean(busy)}
              onClick={() => void createKovaWorks()}
            >
              <Wand2 size={14} />
              {busy === "works" ? "Отправка…" : "Создать Kova works"}
            </button>
          </div>

          {message ? <p className="roblox-message">{message}</p> : null}
          {error ? <p className="modal-error">{error}</p> : null}
          {status?.last_error ? (
            <p className="roblox-error">Последняя ошибка: {status.last_error}</p>
          ) : null}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
