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
    if (this.options.style) {
      const styleEl = document.createElement("style");
      styleEl.textContent = this.options.style;
      this.shadowRoot.appendChild(styleEl);
    }

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

  render() {
    this.shadowRoot.innerHTML = "";
  }
}
