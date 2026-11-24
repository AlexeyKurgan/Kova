import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Play, Plus, Trash2, X } from "lucide-react";
import {
  addValidationCommand,
  deleteValidationCommand,
  getValidationSuggestions,
  listValidationResults,
  runTaskValidation,
  updateTask,
} from "../../lib/coreClient";
import { formatDate } from "../../lib/format";
import type {
  Task,
  ValidationMode,
  ValidationResult,
  ValidationSuggestion,
} from "../../lib/types";

type Props = {
  task: Task;
  onTaskChanged: () => void;
  refreshKey?: number;
  onNotify: (text: string, tone?: "error" | "warning") => void;
};

const STATUS_LABELS: Record<ValidationResult["status"], string> = {
  passed: "Пройдено",
  failed: "Ошибка",
  timeout: "Таймаут",
  error: "Не запустилось",
};

const STATUS_CLASS: Record<ValidationResult["status"], string> = {
  passed: "is-passed",
  failed: "is-failed",
  timeout: "is-timeout",
  error: "is-error",
};

function duration(ms: number) {
  if (ms < 1000) return `${ms} мс`;
  return `${(ms / 1000).toFixed(1)} с`;
}

export default function TaskValidationPanel({
  task,
  onTaskChanged,
  refreshKey = 0,
  onNotify,
}: Props) {
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [suggestions, setSuggestions] = useState<ValidationSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const [timeout, setTimeoutValue] = useState(300);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      listValidationResults(task.id).catch(() => []),
      getValidationSuggestions(task.id).catch(() => []),
    ]).then(([rows, found]) => {
      if (!alive) return;
      setResults(rows);
      setSuggestions(found);
    });
    return () => {
      alive = false;
    };
  }, [refreshKey, task.id]);

  const availableSuggestions = useMemo(
    () =>
      suggestions.filter(
        (suggestion) =>
          !task.validation.some((command) => command.command === suggestion.command),
      ),
    [suggestions, task.validation],
  );

  const latest = useMemo(() => {
    const map = new Map<string, ValidationResult>();
    for (const result of results) map.set(result.command_id, result);
    return map;
  }, [results]);

  const run = async (commandId?: string) => {
    if (busy || runningAll) return;
    if (commandId) setBusy(commandId);
    else setRunningAll(true);
    setError(null);
    try {
      const rows = await runTaskValidation(task.id, commandId);
      setResults((current) => [...current, ...rows]);
      for (const row of rows) setExpanded(row.id);
      onTaskChanged();
      const failed = rows.filter((row) => row.status !== "passed").length;
      if (failed > 0) {
        onNotify(`Проверки: ${failed} с ошибками`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить проверку");
    } finally {
      setBusy(null);
      setRunningAll(false);
    }
  };

  const openAdd = () => {
    setLabel("");
    setCommand("");
    setTimeoutValue(300);
    setError(null);
    setDialog(true);
  };

  const fillSuggestion = (suggestion: ValidationSuggestion) => {
    setLabel(suggestion.label);
    setCommand(suggestion.command);
  };

  const addSuggestion = async (suggestion: ValidationSuggestion) => {
    setSaving(true);
    setError(null);
    try {
      await addValidationCommand(task.id, {
        label: suggestion.label,
        command: suggestion.command,
      });
      onTaskChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить проверку");
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!label.trim() || !command.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await addValidationCommand(task.id, {
        label: label.trim(),
        command: command.trim(),
        timeout,
      });
      setDialog(false);
      onTaskChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить проверку");
    } finally {
      setSaving(false);
    }
  };

  const saveMode = async (mode: ValidationMode) => {
    setError(null);
    try {
      await updateTask(task.id, { validation_mode: mode });
      onTaskChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить режим проверок");
    }
  };

  const remove = async (commandId: string, name: string) => {
    if (!window.confirm(`Удалить проверку «${name}»?`)) return;
    setError(null);
    try {
      await deleteValidationCommand(task.id, commandId);
      onTaskChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить проверку");
    }
  };

  return (
    <section className="task-validation">
      <div className="task-validation-head">
        <div className="task-validation-title">
          <h2>Проверки</h2>
          <span>Команды выполняются в папке проекта.</span>
        </div>
        <div className="task-validation-actions">
          <label className="validation-mode" title="Что делать после завершения агента">
            <span>После агента</span>
            <select
              value={task.validation_mode}
              onChange={(event) => void saveMode(event.target.value as ValidationMode)}
            >
              <option value="ask">Спрашивать</option>
              <option value="always">Запускать сразу</option>
              <option value="never">Не предлагать</option>
            </select>
          </label>
          <button
            type="button"
            className="agent-link"
            disabled={task.validation.length === 0 || runningAll}
            onClick={() => void run()}
          >
            <Play size={11} />
            {runningAll ? "Проверка…" : "Запустить все"}
          </button>
          <button type="button" className="agent-link" onClick={openAdd}>
            <Plus size={11} />
            Добавить
          </button>
        </div>
      </div>

      {error ? <div className="task-validation-error">{error}</div> : null}

      {task.validation.length === 0 ? (
        <div className="task-validation-empty">
          <b>Проверок пока нет</b>
          {availableSuggestions.length > 0 ? (
            <>
              <span>Нашёл в проекте — можно добавить одной кнопкой:</span>
              <div className="validation-suggestions">
                {availableSuggestions.map((suggestion) => (
                  <div className="validation-suggestion" key={suggestion.command}>
                    <span>
                      <b>{suggestion.label}</b>
                      <code>{suggestion.command}</code>
                      <small>{suggestion.source}</small>
                    </span>
                    <button
                      type="button"
                      className="agent-link"
                      disabled={saving}
                      onClick={() => void addSuggestion(suggestion)}
                    >
                      <Plus size={11} />
                      Добавить
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <span>
              Добавь команду вроде <code>pytest -q</code>, <code>npm test</code> или{" "}
              <code>dotnet build</code>. Kova сохранит вывод и статус.
            </span>
          )}
        </div>
      ) : (
        <div className="task-validation-list">
          {task.validation.map((item) => {
            const result = latest.get(item.id);
            const isBusy = busy === item.id;
            const open = result ? expanded === result.id : false;
            return (
              <div className="task-validation-item" key={item.id}>
                <div className="task-validation-row">
                  <span
                    className={`validation-dot ${
                      result ? STATUS_CLASS[result.status] : "is-idle"
                    }`}
                  />
                  <div className="task-validation-main">
                    <b>{item.label}</b>
                    <code>{item.command}</code>
                    <small>
                      {result
                        ? `${STATUS_LABELS[result.status]} · ${duration(
                            result.duration_ms,
                          )} · ${formatDate(result.created_at)}`
                        : `лимит ${item.timeout} сек`}
                    </small>
                  </div>
                  <div className="task-validation-buttons">
                    <button
                      type="button"
                      className="agent-link"
                      disabled={isBusy || runningAll}
                      onClick={() => void run(item.id)}
                    >
                      <Play size={11} />
                      {isBusy ? "…" : "Запустить"}
                    </button>
                    <button
                      type="button"
                      className="agent-link is-danger"
                      title="Удалить проверку"
                      aria-label="Удалить проверку"
                      onClick={() => void remove(item.id, item.label)}
                    >
                      <Trash2 size={12} />
                    </button>
                    {result ? (
                      <button
                        type="button"
                        className="agent-link"
                        title="Показать вывод"
                        aria-label="Показать вывод"
                        onClick={() => setExpanded(open ? null : result.id)}
                      >
                        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    ) : null}
                  </div>
                </div>
                {open && result ? (
                  <div className="task-validation-output">
                    {result.error ? (
                      <div className="task-validation-error">{result.error}</div>
                    ) : null}
                    {result.output ? (
                      <pre>{result.output}</pre>
                    ) : (
                      <span className="detail-muted">Вывод пустой.</span>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {dialog ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setDialog(false);
          }}
        >
          <div className="modal agent-dialog">
            <div className="modal-header">
              <span className="modal-title">Новая проверка</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => !saving && setDialog(false)}
                aria-label="Закрыть"
              >
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              {availableSuggestions.length > 0 ? (
                <div className="validation-suggestions">
                  <span className="validation-suggestions-label">Из проекта</span>
                  {availableSuggestions.map((suggestion) => (
                    <button
                      type="button"
                      className="validation-chip"
                      key={suggestion.command}
                      title={`${suggestion.command} · ${suggestion.source}`}
                      onClick={() => fillSuggestion(suggestion)}
                    >
                      {suggestion.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="field">
                <label htmlFor="validation-label">Название</label>
                <input
                  id="validation-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Например: тесты"
                />
              </div>
              <div className="field">
                <label htmlFor="validation-command">Команда</label>
                <input
                  id="validation-command"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="pytest -q"
                />
                <span className="field-hint">
                  Выполняется в папке проекта от твоего имени. Не добавляй команды, которым не
                  доверяешь.
                </span>
              </div>
              <div className="field">
                <label htmlFor="validation-timeout">Лимит, сек</label>
                <input
                  id="validation-timeout"
                  type="number"
                  min={30}
                  max={7200}
                  value={timeout}
                  onChange={(event) => setTimeoutValue(Number(event.target.value))}
                />
              </div>
              {error ? <p className="modal-error">{error}</p> : null}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => setDialog(false)}
              >
                Отмена
              </button>
              <span className="modal-footer-spacer" />
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || !label.trim() || !command.trim()}
                onClick={() => void submit()}
              >
                {saving ? "Сохранение…" : "Добавить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
