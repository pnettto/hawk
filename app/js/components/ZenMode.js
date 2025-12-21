import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import { formatDate } from "../utils/date.js";

const style = /* css */ `
.zen-mode {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: var(--bg);
    z-index: 1000;
}

.quote-wrapper {
    position: absolute;
    right: 2rem;
    bottom: 2rem;
    text-align: right;
    width: 20rem;
}

.quote {
    font-size: 0.8rem;
    color: var(--glass);
    margin-bottom: 0.5rem;
}
.author {
    font-size: 0.7rem;
    color: var(--glass);
}
`;

async function loadQuotes() {
  const res = await fetch("/data/quotes.csv");
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  return lines;
}

class ZenMode extends Component {
  constructor() {
    super({ style });
    this.addStore(appStore);

    this.quoteLines = [];
    this.quote = null;
    this.hidden = true; // start hidden
    this.forceShow = false; // user override to bypass auto-hide

    // Bind handlers to preserve `this`
    this.enter = this.enter.bind(this);
    this.leave = this.leave.bind(this);
    this.keydownHandler = this.keydownHandler.bind(this);
  }

  keydownHandler = (e) => {
    const active = document.activeElement;
    const isTyping = active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.isContentEditable;
    if (isTyping) return;

    if (e.key.toLowerCase() === "z") {
      this.hidden ? this.enter() : this.leave();
    }

    if (e.key === "Escape") this.leave();
  };

  async connectedCallback() {
    super.connectedCallback();

    // Attach to both window and document to avoid focus/propagation issues
    this.addEventListener("click", this.leave);
    document.addEventListener("keydown", this.keydownHandler, {
      capture: true,
    });

    try {
      this.quoteLines = await loadQuotes();
      this.updateQuote();
    } catch {
      this.quoteLines = [];
      this.quote = null;
    }

    this.render();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this.keydownHandler, {
      capture: true,
    });
    this.removeEventListener("click", this.leave);
  }

  updateQuote() {
    if (!this.quoteLines.length) {
      this.quote = null;
      return;
    }
    const randomLine =
      this.quoteLines[Math.floor(Math.random() * this.quoteLines.length)];
    this.quote = randomLine.split("|");
  }

  enter() {
    if (!this.hidden) return;
    this.hidden = false;

    this.forceShow = true;

    this.updateQuote();
    this.render();
  }

  leave() {
    if (this.hidden) return;
    this.hidden = true;

    this.forceShow = false;

    this.render();
  }

  computeShouldHideByTime() {
    const { app } = this.getState();
    if (!app?.selectedDate) return true;

    const todayStr = formatDate(new Date());
    const selectedDateStr = formatDate(app.selectedDate);
    const selectedIsToday = todayStr === selectedDateStr;
    const h = app.selectedDate.getHours();

    // Hide between today's 08:00 and 18:00
    return selectedIsToday && (h >= 8 && h <= 18);
  }

  render() {
    const shouldHideByTime = this.computeShouldHideByTime();
    const isVisible = !this.hidden && (!shouldHideByTime || this.forceShow);

    if (!isVisible) {
      this.display("");
      return;
    }

    const content = `
            <div class="zen-mode">
                <div class="quote-wrapper">
                ${
      this.quote
        ? `<div class="quote">${this.quote[0]}</div>
                           <div class="author">${this.quote[1]}</div>`
        : ""
    }
                </div>
            </div>
        `;

    this.display(content);
  }
}

customElements.define("zen-mode", ZenMode);
