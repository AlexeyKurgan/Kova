import { useEffect, useState } from "react";
import {
  Brain,
  ChevronDown,
  FilePenLine,
  FileSearch,
  Globe,
  Loader2,
  ShieldAlert,
  Terminal,
  Upload,
  Wrench,
} from "lucide-react";
import type { ChatActivity, ChatEgress } from "../lib/types";

function formatDuration(value: number): string {
  if (!value) return "";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`;
}

const FLAG_LABELS: Record<string, string> = {
  external: "вне проекта",
  sensitive: "секрет",
  network: "сеть",
};

function ActivityIcon({ activity }: { activity: ChatActivity }) {
  if (activity.kind === "thought") return <Brain size={13} />;
  if (activity.kind === "command") return <Terminal size={13} />;
  if (activity.kind === "file") return <FilePenLine size={13} />;
  if (activity.kind === "network") return <Globe size={13} />;
  if (activity.label.toLowerCase().includes("read")) return <FileSearch size={13} />;
  return <Wrench size={13} />;
}

function formatBytes(value: number): string {
  if (!value) return "0 Б";
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / (1024 * 1024)).toFixed(2)} МБ`;
}

function EgressBlock({ egress }: { egress: ChatEgress }) {
  const network = egress.network ?? [];
  if (!egress.files.length && !egress.attachments && !network.length) return null;
  return (
    <div className="chat-egress">
      <div className="chat-egress-head">
        <Upload size={12} />
        <span>
          {egress.files.length || egress.attachments
            ? `${egress.remote ? "Отправлено модели" : "Локально прочитано"}:`
            : "Сеть:"}
          {egress.files.length
            ? ` ${egress.files.length} файлов · ${formatBytes(egress.file_bytes)}`
            : ""}
          {egress.attachments
            ? ` · ${egress.attachments} вложений · ${formatBytes(egress.attachment_bytes)}`
            : ""}
          {!egress.files.length && !egress.attachments
            ? ` ${network.length} домен(ов)`
            : ""}
        </span>
        <span className="chat-egress-provider">{egress.provider_name}</span>
      </div>
      {egress.files.length ? (
        <details className="chat-egress-files">
          <summary>Файлы</summary>
          <ul>
            {egress.files.map((file) => (
              <li key={file.path}>
                <span>{file.path}</span>
                <small>{formatBytes(file.bytes)}</small>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {network.length ? (
        <details className="chat-egress-files">
          <summary>Сеть</summary>
          <ul>
            {network.map((item) => (
              <li key={item.host}>
                <span>{item.host}</span>
                <small>{item.allowed ? `${item.count}×` : "заблокировано"}</small>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

type Props = {
  activity: ChatActivity[];
  egress?: ChatEgress;
  running?: boolean;
};

export default function ChatActivityPanel({
  activity,
  egress,
  running = false,
}: Props) {
  const [open, setOpen] = useState(running);

  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);

  if (!activity.length) {
    if (!running)
      return egress ? (
        <div className="chat-activity is-egress">
          <EgressBlock egress={egress} />
        </div>
      ) : null;
    return (
      <div className="chat-activity is-running">
        <div className="chat-activity-head">
          <Loader2 size={14} className="chat-activity-spin" />
          <span>Kova работает</span>
          <span className="chat-activity-dots">
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    );
  }

  const flagged = activity.filter((item) => item.flags?.length).length;
  const external = activity.filter((item) => item.flags?.includes("external")).length;

  return (
    <div className={`chat-activity${running ? " is-running" : ""}`}>
      <button
        type="button"
        className="chat-activity-head"
        onClick={() => setOpen((value) => !value)}
      >
        {running ? (
          <Loader2 size={14} className="chat-activity-spin" />
        ) : (
          <Wrench size={13} />
        )}
        <span>{running ? "Kova работает" : `Действия (${activity.length})`}</span>
        {flagged ? (
          <span className={`chat-activity-warning${flagged ? " is-visible" : ""}`}>
            <ShieldAlert size={11} />
            {external ? `${external} вне проекта` : `${flagged} требует внимания`}
          </span>
        ) : null}
        {running ? (
          <span className="chat-activity-dots">
            <i />
            <i />
            <i />
          </span>
        ) : null}
        <ChevronDown
          size={14}
          className={`chat-activity-chevron${open ? " is-open" : ""}`}
        />
      </button>
      {egress ? <EgressBlock egress={egress} /> : null}
      {open ? (
        <div className="chat-activity-list">
          {activity.map((item) => (
            <details className={`chat-activity-row is-${item.status}`} key={item.id}>
              <summary>
                <span className="chat-activity-icon">
                  <ActivityIcon activity={item} />
                </span>
                <span className="chat-activity-copy">
                  <b>
                    {item.label}
                    {item.flags?.map((flag) => (
                      <span className={`chat-activity-flag is-${flag}`} key={flag}>
                        {FLAG_LABELS[flag] || flag}
                      </span>
                    ))}
                  </b>
                  {item.detail ? <small>{item.detail}</small> : null}
                </span>
                {item.duration_ms ? (
                  <span className="chat-activity-time">
                    {formatDuration(item.duration_ms)}
                  </span>
                ) : null}
                {item.output ? <ChevronDown size={12} /> : <span />}
              </summary>
              {item.output ? <pre>{item.output}</pre> : null}
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}
