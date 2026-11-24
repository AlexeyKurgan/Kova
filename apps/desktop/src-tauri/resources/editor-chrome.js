(function () {
  if (window.__kovaEditorChrome) return;
  window.__kovaEditorChrome = true;

  const label = "editor";
  const invoke = (command, args) => {
    const internals = window.__TAURI_INTERNALS__;
    if (internals && internals.invoke) return internals.invoke(command, args);
    return Promise.reject(new Error("ipc unavailable"));
  };

  const style = document.createElement("style");
  style.textContent = `
    .kova-win-controls {
      display: flex;
      align-items: stretch;
      height: 100%;
      position: relative;
      z-index: 60;
    }
    .kova-win-controls button {
      display: grid;
      width: 48px;
      height: 100%;
      padding: 0;
      place-items: center;
      border: 0;
      background: transparent;
      color: var(--vscode-titleBar-activeForeground, #e7edf4);
      cursor: default;
    }
    .kova-win-controls button:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.18));
    }
    .kova-win-controls button.kova-close:hover {
      background: #c42b1c;
      color: #ffffff;
    }
    .kova-win-controls svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.15;
    }
  `;
  const mountStyle = () => {
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.head) mountStyle();
  else window.addEventListener("DOMContentLoaded", mountStyle);

  const icons = {
    min: '<svg viewBox="0 0 14 14"><path d="M3 7h8" /></svg>',
    max: '<svg viewBox="0 0 14 14"><rect x="3.5" y="3.5" width="7" height="7" /></svg>',
    restore:
      '<svg viewBox="0 0 14 14"><rect x="3" y="4.5" width="6.5" height="6.5" /><path d="M5 4.5V3h6.5v6.5H10" /></svg>',
    close: '<svg viewBox="0 0 14 14"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" /></svg>',
  };

  function createControls() {
    const box = document.createElement("div");
    box.className = "kova-win-controls";
    box.innerHTML = `
      <button type="button" data-kova="min" aria-label="Свернуть" title="Свернуть">${icons.min}</button>
      <button type="button" data-kova="max" aria-label="Развернуть" title="Развернуть">${icons.max}</button>
      <button type="button" data-kova="close" class="kova-close" aria-label="Закрыть" title="Закрыть">${icons.close}</button>
    `;

    const maxButton = box.querySelector('[data-kova="max"]');

    const updateMaxIcon = async () => {
      try {
        const maximized = await invoke("plugin:window|is_maximized", { label });
        maxButton.innerHTML = maximized ? icons.restore : icons.max;
        maxButton.title = maximized ? "Восстановить" : "Развернуть";
        maxButton.setAttribute("aria-label", maxButton.title);
      } catch (error) {}
    };

    box.querySelector('[data-kova="min"]').addEventListener("click", () => {
      void invoke("plugin:window|minimize", { label });
    });
    maxButton.addEventListener("click", () => {
      void invoke("plugin:window|toggle_maximize", { label });
      window.setTimeout(updateMaxIcon, 200);
    });
    box.querySelector('[data-kova="close"]').addEventListener("click", () => {
      void invoke("plugin:window|close", { label });
    });

    window.addEventListener("resize", updateMaxIcon);
    void updateMaxIcon();
    return box;
  }

  function ensure() {
    if (document.querySelector(".kova-win-controls")) return;
    const target =
      document.querySelector(".titlebar-right") ||
      document.querySelector(".window-controls-container");
    if (!target) return;
    target.appendChild(createControls());
  }

  document.addEventListener(
    "mousedown",
    (event) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".kova-win-controls")) return;
      if (!target.closest(".titlebar-drag-region")) return;
      void invoke("plugin:window|start_dragging", { label });
    },
    true,
  );

  document.addEventListener(
    "dblclick",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".titlebar-drag-region")) return;
      void invoke("plugin:window|toggle_maximize", { label });
    },
    true,
  );

  window.setInterval(ensure, 800);
  window.addEventListener("DOMContentLoaded", ensure);
  try {
    const observer = new MutationObserver(ensure);
    const root = document.documentElement || document;
    observer.observe(root, { childList: true, subtree: true });
  } catch (error) {}
  ensure();
})();
