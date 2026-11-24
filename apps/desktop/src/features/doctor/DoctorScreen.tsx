import { RefreshCw, Stethoscope } from "lucide-react";
import type { CheckResult, CheckStatus } from "../../lib/types";

type Props = {
  checks: CheckResult[];
  onRefresh: () => void;
};

const STATUS_LABELS: Record<CheckStatus, string> = {
  passed: "Пройдено",
  warning: "Внимание",
  failed: "Ошибка",
  error: "Ошибка",
  pending: "Ожидает",
  skipped: "Пропущено",
};

const STATUS_CLASSES: Record<CheckStatus, string> = {
  passed: "is-done",
  warning: "is-review",
  failed: "is-blocked",
  error: "is-blocked",
  pending: "is-draft",
  skipped: "is-draft",
};

export default function DoctorScreen({ checks, onRefresh }: Props) {
  return (
    <section className="assets-screen">
      <div className="assets-heading">
        <Stethoscope size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>Doctor</h1>
          <p className="subtitle">
            Здоровье проекта и окружения: .hub, Git, Blender, движок, диск.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={onRefresh}>
            <RefreshCw size={15} />
            Проверить снова
          </button>
        </div>
      </div>

      <div className="task-list">
        {checks.map((check) => (
          <article className="task-card" key={check.id}>
            <div className="task-card-main">
              <span className={`task-status ${STATUS_CLASSES[check.status]}`}>
                {STATUS_LABELS[check.status]}
              </span>
              <h2>{check.name}</h2>
              <p className="task-goal">{check.message}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
