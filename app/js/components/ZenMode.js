import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";

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
    }

    keydownHandler = (e) => {
        const active = document.activeElement;
        if (
            active.tagName === "INPUT" || active.tagName === "TEXTAREA" ||
            active.isContentEditable
        ) return;
        if (e.key.toLowerCase() === "z") {
            this.hidden ? this.enter() : this.leave();
        }
    };

    async connectedCallback() {
        super.connectedCallback();

        this.addEventListener("click", this.leave);
        document.addEventListener("keydown", this.keydownHandler);

        this.render();
        
        // Load quotes and show one
        this.quoteLines = await loadQuotes();
        this.updateQuote();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener("keydown", this.keydownHandler);
    }

    updateQuote() {
        if (this.quoteLines.length == 0) return;
        const randomLine =
            this.quoteLines[Math.floor(Math.random() * this.quoteLines.length)];
        this.quote = randomLine.split("|");
    }

    enter() {
        if (!this.hidden) return;
        this.updateQuote();
        this.hidden = false;
        this.render();
    }

    leave() {
        if (this.hidden) return;
        this.hidden = true;
        this.render();
    }

    render() {
        const { app } = this.getState();
        const { quote } = this;

        if (!app?.selectedDate) return;
        
        // Auto-hide
        const h = app.selectedDate.getHours();
        const shouldHideByTime = (h >= 8 && h <= 18);
        const isHidden = this.hidden || shouldHideByTime;
        if (isHidden) return;

        const content = `
            <div class="zen-mode ">
                <div class="quote-wrapper">
                ${
                    quote
                        ? `<div class="quote">${quote[0]}</div>
                           <div class="author">${quote[1]}</div>`
                        : ""
                }
                </div>
            </div>
        `;

        this.display(content);
    }
}

customElements.define("zen-mode", ZenMode);
