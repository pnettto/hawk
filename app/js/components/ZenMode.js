class ZenMode {
    constructor () {
        this.quoteLines = [];
    }
    getElements () {
        const zenMode = document.getElementById('zenMode');
        return {
            zenMode,
            quoteEl: zenMode.querySelector('.quote'),
            authorEl: zenMode.querySelector('.author')
        }
    }

    setupListeners () {
        if (this.listenersInitiated) return;
        const { zenMode } = this.getElements();

        document.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            const isTyping = active.tagName === "INPUT" ||
                        active.tagName === "TEXTAREA" ||
                        active.isContentEditable;
            if (isTyping) return;

            if (e.key.toLowerCase() === 'z') {
                if (zenMode.classList.contains('hidden')) {
                    this.enter();
                } else {
                    this.leave()
                }
            }
        });

        this.listenersInitiated = true;
    }

    async loadCsv() {
        const res = await fetch('/data/quotes.csv');
        const text = await res.text();
        const lines = text.split(/\r?\n/)
        return lines;
    }

    async getRandomLine() {
        let quoteLines;
        if (this.quoteLines.length > 0) {
            quoteLines = this.quoteLines;
        } else {
            quoteLines = await this.loadCsv();
            this.quoteLines = quoteLines;
        }
        const randomLine = this.quoteLines[Math.floor(Math.random() * this.quoteLines.length)];
        const lineAtr = randomLine.split('|');
        return lineAtr;
    }

    async showNewQuote () {
        const { quoteEl, authorEl } = this.getElements();
        const [quote, author] = await this.getRandomLine()
        quoteEl.innerHTML = `"${quote}"`;
        authorEl.innerHTML = author
    }

    enter () {
        const { zenMode } = this.getElements();
        zenMode.classList.remove('hidden')
        document.body.style = 'overflow: hidden; height: 100vw;';
        this.showNewQuote();
    }

    leave() {
        const { zenMode } = this.getElements();
        zenMode.classList.add('hidden')
        document.body.style = '';
    }

    render () {
        this.leave();
        this.setupListeners();
    }
}

const zen = new ZenMode()

export function init() {
    zen.render();
}

export function enter  () {
    zen.enter();
}