// Lightweight global toast — call showToast(message, { action, onAction, duration }).
// Action toasts allow undo flows: the onAction callback fires when the user
// clicks the action button, and resolveOnAction (default true) prevents the
// passed promise's `then` from running.

const STYLE_ID = "hawk-toast-style";
const HOST_ID = "hawk-toast-host";

const css = `
.hawk-toast-host {
  position: fixed;
  left: 50%;
  bottom: 1.5rem;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  z-index: 10000;
  pointer-events: none;
}
.hawk-toast {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.9rem;
  background: var(--panel, #272b31);
  color: var(--text, #dfe1e5);
  border: 1px solid var(--line, #2f3339);
  border-radius: 6px;
  font-family: "code-saver", ui-monospace, monospace;
  font-size: 0.85rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 180ms var(--ease-out, cubic-bezier(0.2,0,0,1)),
              transform 180ms var(--ease-out, cubic-bezier(0.2,0,0,1));
}
.hawk-toast.visible {
  opacity: 1;
  transform: translateY(0);
}
.hawk-toast .hawk-toast-action {
  background: none;
  border: none;
  color: var(--accent, #e6b84d);
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
}
.hawk-toast .hawk-toast-action:hover { background: rgba(255,255,255,0.06); }
.hawk-toast.error { border-color: #ff6b6b; }
.hawk-toast.error::before { content: "!"; color: #ff6b6b; font-weight: bold; }
`;

function ensureHost() {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.className = "hawk-toast-host";
    document.body.appendChild(host);
  }
  return host;
}

export function showToast(message, opts = {}) {
  const { action, onAction, duration = 4000, type = "info" } = opts;
  const host = ensureHost();
  const el = document.createElement("div");
  el.className = `hawk-toast ${type === "error" ? "error" : ""}`;
  el.setAttribute("role", "status");

  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.classList.remove("visible");
    setTimeout(() => el.remove(), 200);
  };

  if (action) {
    const btn = document.createElement("button");
    btn.className = "hawk-toast-action";
    btn.type = "button";
    btn.textContent = action;
    btn.addEventListener("click", () => {
      try {
        onAction && onAction();
      } finally {
        dismiss();
      }
    });
    el.appendChild(btn);
  }

  host.appendChild(el);
  // double-rAF to ensure transition fires
  requestAnimationFrame(() =>
    requestAnimationFrame(() => el.classList.add("visible"))
  );

  const timer = setTimeout(dismiss, duration);
  return () => {
    clearTimeout(timer);
    dismiss();
  };
}

export function showError(message, opts = {}) {
  return showToast(message, {
    ...opts,
    type: "error",
    duration: opts.duration ?? 5000,
  });
}
