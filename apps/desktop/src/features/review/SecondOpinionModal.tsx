import { useEffect, useState } from "react";
import { Check, ClipboardCopy, Users, X } from "lucide-react";
import { copyText } from "../../lib/clipboard";

type Props = {
  text: string;
  onClose: () => void;
};

export default function SecondOpinionModal({ text, onClose }: Props) {
  const [copied, setCopied] = useState<boolean | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    void copyText(text).then((ok) => {
      if (alive) setCopied(ok);
    });
    return () => {
      alive = false;
    };
  }, [text]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal modal-wide">
        <div className="modal-header">
          <span className="modal-title">
            <Users size={15} />
            Второе мнение
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          <p className="detail-muted">
            Промпт для независимого критика. Открой любой AI-чат, вставь текст и
            сравни его вывод с решением задачи.
          </p>
          <pre className="capsule-pre">{text}</pre>
          {copied === true ? (
            <p className="modal-ok">Промпт уже в буфере обмена.</p>
          ) : null}
          {copied === false ? (
            <p className="modal-error">
              Не удалось скопировать автоматически: выдели текст и скопируй вручную.
            </p>
          ) : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Закрыть
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void copyText(text)}>
            {copied === true ? <Check size={15} /> : <ClipboardCopy size={15} />}
            {copied === true ? "Скопировано" : "Скопировать"}
          </button>
        </div>
      </div>
    </div>
  );
}
