import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import { formatDate } from "../utils/date.js";
import { style } from "./ZenMode.styles.js";

let quotesCache = null;

async function loadQuotes() {
  if (quotesCache) return quotesCache;
  try {
    const res = await fetch("/data/quotes.csv");
    const text = await res.text();
    quotesCache = text.split(/\r?\n/).filter((line) => line.trim());
    return quotesCache;
  } catch (e) {
    console.error("Failed to load quotes:", e);
    return [];
  }
}

class ZenMode extends Component {
  constructor() {
    super({ style });
    this.addStore(appStore);

    this.quoteLines = [];
    this.quote = null;
    // Decide visibility synchronously so the first render paints zen before
    // the underlying app flashes through.
    const currentHour = new Date().getHours();
    const isEveningOrNight = currentHour >= 18 || currentHour < 8;
    this.hidden = !isEveningOrNight;
    this.forceShow = false;

    // Bind handlers to preserve `this`
    this.enter = this.enter.bind(this);
    this.leave = this.leave.bind(this);
  }

  async connectedCallback() {
    super.connectedCallback();

    this.addEventListener("click", this.leave);

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
    const { selectedDate } = this.getState();
    if (!selectedDate) return true;

    const todayStr = formatDate(new Date());
    const selectedDateStr = formatDate(selectedDate);
    const selectedIsToday = todayStr === selectedDateStr;
    const h = selectedDate.getHours();

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
