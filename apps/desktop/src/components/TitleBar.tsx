import { Minus, Square, X } from "lucide-react";
import KovaLogo from "./KovaLogo";
import {
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
} from "../lib/windowControls";

export default function TitleBar() {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <KovaLogo size={15} />
        <span>Kova Hub</span>
      </div>
      <div className="window-controls">
        <button
          type="button"
          className="window-control"
          onClick={() => void minimizeWindow()}
          aria-label="Свернуть"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="window-control"
          onClick={() => void toggleMaximizeWindow()}
          aria-label="Развернуть"
        >
          <Square size={11} />
        </button>
        <button
          type="button"
          className="window-control is-close"
          onClick={() => void closeWindow()}
          aria-label="Закрыть"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
