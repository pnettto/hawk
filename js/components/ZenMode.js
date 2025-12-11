class ZenMode {
    getElements () {
        return {
            zenMode: document.getElementById('zenMode'),
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
                    zenMode.classList.remove('hidden')
                    document.body.style = 'overflow: hidden;';
                } else {
                    zenMode.classList.add('hidden')
                    document.body.style = '';
                }
            }
        });

        this.listenersInitiated = true;
    }


    render (date) {
        this.setupListeners();
    }
}

const zen = new ZenMode()

export function init() {
    zen.render();
}