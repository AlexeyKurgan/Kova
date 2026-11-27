import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  ListChecks,
  Moon,
  Play,
  RefreshCw,
  Square,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import {
  getNightShift,
  startNightShift,
  stopNightShift,
  updateNightShift,
} from "../../lib/coreClient";
import { formatDate, plural } from "../../lib/format";
import { TASK_STATUS_LABELS } from "../../lib/labels";
import type { NightShiftState, ProviderInfo, Task } from "../../lib/types";

type Props = {
  tasks: Task[];
  providers: ProviderInfo[];
  onOpenTask: (taskId: string) => void;
};

const STATUS_LABELS: Record<string, string> = {
  queued: "В очереди",
  running: "Работает",
  done: "Завершена",
  failed: "Ошибка",
  stopped: "Остановлена",
  succeeded: "Готово",
  cancelled: "Отменено",
  interrupted: "Прервано",
  skipped: "Пропущено",
};

function statusTone(status: string) {
  if (status === "succeeded" || status === "done") return "is-done";
  if (status === "failed" || status === "cancelled" || status === "interrupted") return "is-blocked";
  if (status === "running" || status === "queued") return "is-review";
  return "is-draft";
}

export default function NightShiftScreen({ tasks, providers, onOpenTask }: Props) {
  const [state, setState] = useState<NightShiftState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [startAt, setStartAt] = useState("23:00");
  const [providerId, setProviderId] = useState("");
  const [maxTasks, setMaxTasks] = useState(5);
  const [stopOnError, setStopOnError] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const applyConfig = (value: NightShiftState) => {
    setState(value);
    setEnabled(value.config.enabled);
    setStartAt(value.config.start_at);
    setProviderId(value.config.provider_id);
    setMaxTasks(value.config.max_tasks);
    setStopOnError(value.config.stop_on_error);
    setSelected(value.config.task_ids);
  };

  useEffect(() => {
    let alive = true;
    getNightShift()
      .then((value) => {
        if (alive) applyConfig(value);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Не удалось загрузить смену");
      })
      .finally(() => undefined);
    const timer = window.setInterval(() => {
      getNightShift()
        .then((value) => {
          if (alive) setState(value);
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const selectableTasks = useMemo(
    () =>
      tasks.filter(
        (task) => task.status !== "done" && task.status !== "archived",
      ),
    [tasks],
  );
  const installedProviders = providers.filter((provider) => provider.installed);
  const run = state?.run ?? null;
  const running = Boolean(run && (run.status === "queued" || run.status === "running"));
  const canStart = selected.length > 0 && installedProviders.length > 0 && !running && !busy;

  const toggleTask = (taskId: string) => {
    setSelected((current) =>
      current.includes(taskId)
        ? current.filter((item) => item !== taskId)
        : [...current, taskId],
    );
    setNote("");
  };

  const save = async () => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const value = await updateNightShift({
        enabled,
        start_at: startAt,
        provider_id: providerId,
        task_ids: selected,
        max_tasks: maxTasks,
        stop_on_error: stopOnError,
      });
      applyConfig(value);
      setNote("Расписание сохранено");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить расписание");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const value = await startNightShift({
        provider_id: providerId,
        task_ids: selected,
      });
      setState(value);
      setNote("Смена запущена");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запустить смену");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError("");
    try {
      setState(await stopNightShift());
      setNote("Останавливаю смену…");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось остановить смену");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="assets-screen night-screen">
      <div className="night-hero">
        <div className="night-hero-copy">
          <span className="night-kicker">
            <Moon size={13} />
            автономная очередь
          </span>
          <h1>Ночная смена</h1>
          <p>
            Поставь задачи в очередь и дай агенту поработать, пока Kova открыта.
            Утром проверь отчёт и Review — без авто-применения изменений.
          </p>
        </div>
        <div className={`night-status ${running ? "is-running" : ""}`}>
          <span />
          {running ? "Смена идёт" : "Ожидает запуска"}
        </div>
      </div>

      {error ? <p className="modal-error resource-error">{error}</p> : null}
      {note ? <p className="night-note">{note}</p> : null}

      <div className="night-layout">
        <article className="night-card">
          <div className="night-card-head">
            <h2><Clock3 size={14} /> Расписание</h2>
            <label className="night-switch">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              Включена
            </label>
          </div>
          <div className="night-form">
            <label>
              <span>Время старта</span>
              <input
                type="time"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
              />
            </label>
            <label>
              <span>Провайдер</span>
              <select
                value={providerId}
                onChange={(event) => setProviderId(event.target.value)}
              >
                <option value="">По умолчанию</option>
                {installedProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Максимум задач</span>
              <input
                type="number"
                min={1}
                max={20}
                value={maxTasks}
                onChange={(event) => setMaxTasks(Number(event.target.value) || 1)}
              />
            </label>
            <label className="night-check">
              <input
                type="checkbox"
                checked={stopOnError}
                onChange={(event) => setStopOnError(event.target.checked)}
              />
              Останавливаться при ошибке
            </label>
          </div>
          {installedProviders.length === 0 ? (
            <p className="night-empty">
              <TriangleAlert size={12} /> Нужен установленный AI-провайдер в разделе «Агенты».
            </p>
          ) : null}
          <div className="night-actions">
            <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => void save()}>
              Сохранить расписание
            </button>
            <button type="button" className="btn btn-primary btn-small" disabled={!canStart} onClick={() => void start()}>
              <Play size={13} />
              Запустить сейчас
            </button>
            {running ? (
              <button type="button" className="btn btn-danger btn-small" disabled={busy} onClick={() => void stop()}>
                <Square size={12} />
                Остановить
              </button>
            ) : null}
          </div>
          {enabled ? (
            <p className="night-hint">
              Автозапуск сработает, пока Kova открыта. Если приложение закрыто, смена
              останется в очереди.
            </p>
          ) : null}
        </article>

        <article className="night-card">
          <div className="night-card-head">
            <h2><ListChecks size={14} /> Очередь</h2>
            <span>{selected.length} выбрано</span>
          </div>
          {selectableTasks.length === 0 ? (
            <p className="night-empty">Нет активных задач. Создай задачу в разделе «Задачи».</p>
          ) : (
            <div className="night-task-list">
              {selectableTasks.map((task) => (
                <label className={`night-task${selected.includes(task.id) ? " is-selected" : ""}`} key={task.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(task.id)}
                    onChange={() => toggleTask(task.id)}
                  />
                  <span>
                    <b>{task.title}</b>
                    <small>{TASK_STATUS_LABELS[task.status]}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
          <p className="night-hint">
            Kova выполнит задачи по одной, создаст снапшот перед запуском и оставит
            результат в Review. Авто-применение выключено.
          </p>
        </article>
      </div>

      <article className="night-card night-report">
        <div className="night-card-head">
          <h2><RefreshCw size={14} /> Отчёт смены</h2>
          {run ? (
            <span className={`task-status ${statusTone(run.status)}`}>
              {STATUS_LABELS[run.status] ?? run.status}
            </span>
          ) : (
            <span>Запусков ещё не было</span>
          )}
        </div>
        {!run ? (
          <p className="night-empty">
            Выбери задачи и нажми «Запустить сейчас» или задай время — отчёт появится здесь.
          </p>
        ) : (
          <>
            <div className="night-run-meta">
              <span>Старт: {run.started_at ? formatDate(run.started_at) : "—"}</span>
              <span>Финиш: {run.finished_at ? formatDate(run.finished_at) : "в процессе"}</span>
              <span>
                {run.entries.length} {plural(run.entries.length, ["задача", "задачи", "задач"])}
              </span>
            </div>
            <div className="night-entries">
              {run.entries.map((entry, index) => (
                <div className="night-entry" key={`${entry.task_id}-${index}`}>
                  <span className={`night-entry-icon ${statusTone(entry.status)}`}>
                    {entry.status === "succeeded" ? (
                      <CheckCircle2 size={13} />
                    ) : entry.status === "failed" ? (
                      <XCircle size={13} />
                    ) : (
                      <Clock3 size={13} />
                    )}
                  </span>
                  <div>
                    <b>{entry.task_title}</b>
                    <small>
                      {STATUS_LABELS[entry.status] ?? entry.status}
                      {entry.message ? ` · ${entry.message}` : ""}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="agent-link"
                    onClick={() => onOpenTask(entry.task_id)}
                  >
                    Открыть
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </article>
    </section>
  );
}
