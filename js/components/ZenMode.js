class ZenMode {
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

        const lines = text
            .split(/\r?\n/)
            .filter(l => l.trim() !== "");    // remove empty lines

        return lines;
    }

    async getRandomLine() {
        const lines = await this.loadCsv();
        const randomLine = lines[Math.floor(Math.random() * lines.length)];
        const lineAtr = randomLine.split('|');
        return lineAtr;
    }

    async showQuote () {
        const { quoteEl, authorEl } = this.getElements();
        const [quote, author] = await this.getRandomLine()
        quoteEl.innerHTML = `"${quote}"`;
        authorEl.innerHTML = author
    }

    enter () {
        const { zenMode } = this.getElements();
        zenMode.classList.remove('hidden')
        document.body.style = 'overflow: hidden;';
        this.showQuote();
    }

    leave() {
        const { zenMode } = this.getElements();
        zenMode.classList.add('hidden')
        document.body.style = '';
    }

    render () {
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