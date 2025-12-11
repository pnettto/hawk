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
                    this.enter();
                } else {
                    this.leave()
                }
            }
        });

        this.listenersInitiated = true;
    }

    enter () {
        const { zenMode } = this.getElements();
        zenMode.classList.remove('hidden')
        document.body.style = 'overflow: hidden;';
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