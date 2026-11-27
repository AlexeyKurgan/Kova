import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { getSandboxStatus } from "../../lib/coreClient";
import type { SandboxStatus } from "../../lib/types";

export default function SandboxCard() {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setBusy(true);
    setError("");
    getSandboxStatus()
      .then(setStatus)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Не удалось проверить sandbox"),
      )
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <article className="settings-card is-wide sandbox-card">
      <div className="settings-card-head">
        <span className="settings-icon">
          <ShieldCheck size={16} />
        </span>
        <div>
          <b>Песочница</b>
          <small>OS sandbox или безопасный fallback для агентов</small>
        </div>
        <button type="button" className="icon-btn" disabled={busy} onClick={load} aria-label="Проверить снова">
          <RefreshCw size={14} />
        </button>
      </div>
      {status ? (
        <>
          <div className="sandbox-grid">
            {status.backends.map((backend) => (
              <div className={`sandbox-backend${backend.available ? " is-ready" : ""}`} key={backend.id}>
                <i />
                <b>{backend.label}</b>
                <small title={backend.detail}>
                  {backend.available ? "доступен" : backend.detail}
                </small>
              </div>
            ))}
          </div>
          <p className={`sandbox-message${status.default === "copy" ? " is-warn" : ""}`}>
            {status.message}
          </p>
          <p className="sandbox-fallback">
            Fallback: <b>{status.fallback}</b>
          </p>
        </>
      ) : (
        <p className="sandbox-message">{error || "Проверяю sandbox…"}</p>
      )}
    </article>
  );
}
