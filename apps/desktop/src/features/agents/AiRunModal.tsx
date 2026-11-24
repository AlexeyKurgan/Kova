import { useEffect, useMemo, useState } from "react";
import { Bot, Check, CircleStop, RefreshCw, Sparkles, X } from "lucide-react";
import { cancelAiRun, getAiRun, startAiRun } from "../../lib/coreClient";
import type { AiRun, ProviderInfo, Task } from "../../lib/types";

type Props = {
  task: Task;
  providers: ProviderInfo[];
  defaultProvider: string;
  onClose: () => void;
  onOpenAgents: () => void;
  onOpenReview: () => void;
  onFinished: () => void;
  onRunningChange: (running: boolean) => void;
};

function cleanOutput(text: string) {
  return text
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .trim();
}

function statusText(run: AiRun) {
  if (run.status === "queued") return "В очереди";
  if (run.status === "running") return "Работает";
  if (run.status === "succeeded") return "Готово";
  if (run.status === "cancelled") return "Отменено";
  if (run.status === "interrupted") return "Прервано";
  return "Ошибка";
}

export default function AiRunModal({
  task,
  providers,
  defaultProvider,
  onClose,
  onOpenAgents,
  onOpenReview,
  onFinished,
  onRunningChange,
}: Props) {
  const available = useMemo(
    () => providers.filter((provider) => provider.installed && provider.enabled),
    [providers],
  );
  const [providerId, setProviderId] = useState(
    available.find((provider) => provider.id === defaultProvider)?.id ??
      available[0]?.id ??
      "",
  );
  const [snapshot, setSnapshot] = useState(true);
  const [run, setRun] = useState<AiRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const running = run?.status === "queued" || run?.status === "running";
  const canClose = !running && !busy;
  const provider = providers.find((item) => item.id === providerId) ?? null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && canClose) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canClose, onClose]);

  useEffect(() => {
    if (!run || !running) return;
    let alive = true;
    const timer = window.setInterval(() => {
      getAiRun(run.id)
        .then((next) => {
          if (!alive) return;
          setRun(next);
          if (next.status !== "queued" && next.status !== "running") {
            onRunningChange(false);
            onFinished();
          }
        })
        .catch(() => undefined);
    }, 1500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [onFinished, onRunningChange, run, running]);

  useEffect(() => {
    if (!running) return;
    const started = run?.started_at ? new Date(run.started_at).getTime() : Date.now();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - started) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [run?.started_at, running]);

  const start = async () => {
    if (!providerId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await startAiRun({
        task_id: task.id,
        provider: providerId,
        snapshot,
      });
      setRun(result);
      if (result.status === "queued" || result.status === "running") {
        onRunningChange(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запустить AI");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!run) return;
    setBusy(true);
    try {
      const next = await cancelAiRun(run.id);
      setRun(next);
      if (next.status !== "queued" && next.status !== "running") {
        onRunningChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отменить запуск");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && canClose) onClose();
      }}
    >
      <div className="modal ai-run-modal">
        <div className="modal-header">
          <span className="modal-title">
            <Sparkles size={16} className="ai-title-icon" />
            Запустить AI
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Закрыть"
            disabled={!canClose}
          >
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="ai-task-line">
            <span>Задача</span>
            <b>{task.title}</b>
          </div>

          {available.length === 0 ? (
            <div className="ai-empty">
              <Bot size={26} />
              <h3>Нет установленных CLI-агентов</h3>
              <p>
                Установи Claude Code, Codex CLI, Gemini CLI или OpenCode. Kova найдёт их
                автоматически.
              </p>
              <button type="button" className="btn btn-primary" onClick={onOpenAgents}>
                Открыть «Агенты»
              </button>
            </div>
          ) : (
            <>
              <div className="ai-controls">
                <div className="field">
                  <label htmlFor="ai-provider">Провайдер</label>
                  <select
                    id="ai-provider"
                    value={providerId}
                    disabled={running || busy}
                    onChange={(event) => setProviderId(event.target.value)}
                  >
                    {available.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.default ? " · основной" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="ai-snapshot">
                  <input
                    type="checkbox"
                    checked={snapshot}
                    disabled={running || busy}
                    onChange={(event) => setSnapshot(event.target.checked)}
                  />
                  Снапшот перед запуском
                </label>
              </div>

              {provider ? (
                <div className="ai-provider-line">
                  <span className={`dot ${provider.installed ? "is-on" : "is-off"}`} />
                  <span>{provider.name}</span>
                  <code>{provider.version || provider.path}</code>
                  <span className="ai-provider-note">
                    CLI сам управляет логином и ключами
                  </span>
                </div>
              ) : null}

              {run ? (
                <div className={`ai-run-state is-${run.status}`}>
                  <div className="ai-run-head">
                    <span className="ai-run-status">
                      {running ? <RefreshCw size={14} className="is-spinning" /> : null}
                      {run.status === "succeeded" ? <Check size={14} /> : null}
                      {statusText(run)}
                    </span>
                    <span className="ai-run-time">
                      {running ? `${elapsed} сек` : run.finished_at ? "завершено" : ""}
                    </span>
                    {running ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={busy}
                        onClick={() => void cancel()}
                      >
                        <CircleStop size={13} />
                        Остановить
                      </button>
                    ) : null}
                  </div>
                  {run.snapshot_id ? (
                    <div className="ai-run-note">Снапшот: {run.snapshot_id}</div>
                  ) : null}
                  {run.snapshot_error ? (
                    <div className="ai-run-note is-warn">
                      Снапшот не создан: {run.snapshot_error}
                    </div>
                  ) : null}
                  {run.error ? <div className="modal-error">{run.error}</div> : null}
                  {run.interrupted_reason ? (
                    <div className="ai-run-note is-warn">{run.interrupted_reason}</div>
                  ) : null}
                  {run.output ? (
                    <pre className="ai-output">{cleanOutput(run.output)}</pre>
                  ) : running ? (
                    <p className="ai-run-note">
                      Агент работает в папке проекта. Вывод появится здесь, когда CLI завершится.
                    </p>
                  ) : null}
                  {run.status === "succeeded" ? (
                    <div className="ai-success">
                      <Check size={15} />
                      Результат сохранён в артефакты и отправлен в Review.
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="ai-hint">
                  Kova передаст агенту задачу, критерии, ограничения и выбранные скиллы.
                  Агент будет работать в папке проекта и сможет менять файлы. Если CLI
                  вернул 401 или ошибку квоты — залогинься в нём или укажи модель в
                  аргументах провайдера.
                </p>
              )}

              {error ? <p className="modal-error">{error}</p> : null}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" disabled={!canClose} onClick={onClose}>
            Закрыть
          </button>
          <span className="modal-footer-spacer" />
          {run?.status === "succeeded" ? (
            <button type="button" className="btn btn-primary" onClick={onOpenReview}>
              Перейти в Review
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!providerId || busy || running}
              onClick={() => void start()}
            >
              <Sparkles size={15} />
              {busy ? "Запуск…" : running ? "AI работает…" : "Запустить"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
