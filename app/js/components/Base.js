// base-component.js
export class Component extends HTMLElement {
  static isTyping() {
    const active = document.activeElement;
    if (!active) return false;

    // Check main document
    const isMainTyping = active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.isContentEditable;

    if (isMainTyping) return true;

    // Check shadow DOMs
    let curr = active;
    while (curr.shadowRoot && curr.shadowRoot.activeElement) {
      const subActive = curr.shadowRoot.activeElement;
      if (
        subActive.tagName === "INPUT" ||
        subActive.tagName === "TEXTAREA" ||
        subActive.isContentEditable
      ) {
        return true;
      }
      curr = subActive;
    }

    return false;
  }

  constructor(options = {}) {
    super();
    this.attachShadow({ mode: "open" });
    this.onChange = () => this.render();
    this.stores = [];
    this.options = options;
  }

  connectedCallback() {
    // 1. Inject Component-specific style
    if (this.options.style) {
      const styleEl = document.createElement("style");
      styleEl.textContent = this.options.style;
      this.shadowRoot.appendChild(styleEl);
    }

    // 2. Inject Base shared style (Spinner, etc.)
    const baseStyleEl = document.createElement("style");
    baseStyleEl.textContent = Component.spinnerCSS;
    this.shadowRoot.appendChild(baseStyleEl);

    this.render();
  }

  disconnectedCallback() {
    this.stores.forEach((store) =>
      store.removeEventListener("change", this.onChange)
    );
  }

  addStore(store) {
    if (store && !this.stores.includes(store)) {
      this.stores.push(store);
      store.addEventListener("change", this.onChange);
    }
  }

  getState() {
    // merge all store states; later stores override earlier
    return Object.assign({}, ...this.stores.map((s) => s.getState()));
  }

  display(content) {
    // 1. Save focus and selection
    const activeEl = this.shadowRoot.activeElement;
    let selector = null;
    let start = 0, end = 0;
    let isContentEditable = false;

    if (
      activeEl &&
      (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" ||
        activeEl.isContentEditable)
    ) {
      // Create a simple selector based on class and data attributes
      selector = activeEl.tagName.toLowerCase();
      if (activeEl.className) {
        selector += "." + activeEl.className.split(" ").join(".");
      }
      if (activeEl.hasAttribute("data-hour")) {
        selector += `[data-hour="${activeEl.getAttribute("data-hour")}"]`;
      }

      // If it's a child of a row, try to be more specific
      const row = activeEl.closest(".hour-row");
      if (row && row.dataset.hour) {
        selector =
          `.hour-row[data-hour="${row.dataset.hour}"] ${activeEl.tagName.toLowerCase()}.${
            activeEl.className.split(" ").join(".")
          }`;
      }

      if (activeEl.isContentEditable) {
        const selection = this.shadowRoot.getSelection
          ? this.shadowRoot.getSelection()
          : globalThis.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const preRange = range.cloneRange();
          preRange.selectNodeContents(activeEl);
          preRange.setEnd(range.startContainer, range.startOffset);
          start = preRange.toString().length;
          preRange.setEnd(range.endContainer, range.endOffset);
          end = preRange.toString().length;
          isContentEditable = true;
        }
      } else {
        try {
          start = activeEl.selectionStart;
          end = activeEl.selectionEnd;
        } catch (_e) {
          // some input types don't support selectionStart
        }
      }
    }

    // 2. Clear current content (except style)
    Array.from(this.shadowRoot.children)
      .filter((el) => el.tagName.toLowerCase() !== "style")
      .forEach((el) => this.shadowRoot.removeChild(el));

    if (!content || !content.trim()) return;

    // 3. Render new content
    const container = document.createElement("div");
    container.innerHTML = content;

    while (container.firstChild) {
      this.shadowRoot.appendChild(container.firstChild);
    }

    // 4. Restore focus and selection
    if (selector) {
      const newActive = this.shadowRoot.querySelector(selector);
      if (newActive) {
        newActive.focus();
        try {
          if (isContentEditable) {
            const selection = this.shadowRoot.getSelection
              ? this.shadowRoot.getSelection()
              : globalThis.getSelection();
            const range = document.createRange();
            let charCount = 0;
            const nodeStack = [newActive];
            let startNode, startOffset, endNode, endOffset;

            while (nodeStack.length > 0) {
              const node = nodeStack.pop();
              if (node.nodeType === 3) {
                const nextCharCount = charCount + node.length;
                if (
                  !startNode && start >= charCount && start <= nextCharCount
                ) {
                  startNode = node;
                  startOffset = start - charCount;
                }
                if (!endNode && end >= charCount && end <= nextCharCount) {
                  endNode = node;
                  endOffset = end - charCount;
                }
                charCount = nextCharCount;
              } else {
                for (let i = node.childNodes.length - 1; i >= 0; i--) {
                  nodeStack.push(node.childNodes[i]);
                }
              }
            }

            if (startNode && endNode) {
              range.setStart(startNode, startOffset);
              range.setEnd(endNode, endOffset);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          } else if (start !== undefined) {
            newActive.setSelectionRange(start, end);
          }
        } catch (_e) {
          // ignore selection errors
        }
      }
    }
  }

  // Saving Indicator & Debounce
  static get spinnerCSS() {
    return /* css */ `
    /* Saving Indicator */
    .saving-indicator {
        position: absolute;
        top: 2rem;
        right: 2rem;
        font-size: 0.8rem;
        color: var(--muted);
        opacity: 0;
        transition: opacity 0.3s;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        z-index: 1000;
    }

    .saving-indicator.visible {
        opacity: 1;
    }

    .spinner {
        width: 6px;
        height: 6px;
        background: var(--muted);
        border-radius: 50%;
        animation: pulse 1s infinite ease-in-out;
    }

    @keyframes pulse {
        0% { transform: scale(0.8); opacity: 0.5; }
        50% { transform: scale(1.2); opacity: 1; }
        100% { transform: scale(0.8); opacity: 0.5; }
    }
    `;
  }

  get savingIndicatorHTML() {
    // return this.isSaving ? ... but CSS controls opacity anyway
    return `
      <div class="saving-indicator ${this.isSaving ? "visible" : ""}">
        <div class="spinner"></div>
      </div>
    `;
  }

  initSavingState() {
    this.isSaving = false;
    this.handleBeforeUnload = (e) => {
      if (this.isSaving) {
        e.preventDefault();
        e.returnValue =
          "Your work is still saving. Are you sure you want to leave?";
        return e.returnValue;
      }
    };
    globalThis.addEventListener("beforeunload", this.handleBeforeUnload);
  }

  teardownSavingState() {
    globalThis.removeEventListener("beforeunload", this.handleBeforeUnload);
  }

  setSaving(saving) {
    this.isSaving = saving;
    const indicators = this.shadowRoot.querySelectorAll(".saving-indicator");
    indicators.forEach((el) => {
      if (saving) el.classList.add("visible");
      else el.classList.remove("visible");
    });
  }

  debounce(func, wait) {
    let timeout;
    return (...args) => {
      const later = () => {
        clearTimeout(timeout);
        func.apply(this, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  wrapDebouncedSave(savePromiseFactory, wait = 500) {
    return this.debounce(async (...args) => {
      this.setSaving(true);
      const minTime = new Promise((resolve) => setTimeout(resolve, 800));
      try {
        await Promise.all([savePromiseFactory(...args), minTime]);
        // console.log("Saved (debounced)");
      } catch (err) {
        console.error("Save failed", err);
        alert("Failed to save. check console.");
      } finally {
        this.setSaving(false);
      }
    }, wait);
  }

  render() {
    this.shadowRoot.innerHTML = "";
  }
}
