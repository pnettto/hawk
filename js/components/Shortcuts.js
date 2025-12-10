class Shortcuts {
    constructor () {
        this.shortcutsModal = undefined;
        this.modalOverlay = undefined;
        this.listenersInitialized = false;
        this.isVisible = false;
    }

    getContent () {
        return `
| Shortcut         | Action                         |
|------------------|--------------------------------|
| t                | Show today                     |
| space            | Show today                     |
| w / Arrow up     | Move hours up                  |
| s / Arrow down   | Move hours down                |
| a / Arrow left   | Move to previous day           |
| d / Arrow right  | Move to next day               |
| f                | Show full day                  |
| c                | Open calendar                  |
| Cmd/Ctrl + S     | Save notes (while editing)     |
| z                | Enter Zen Mode                 |
| m                | Enter Mirror Mode 😍           |
| ?                | Show shortcuts                 |
`
    }

    getElements () {
        return { 
            shortcutsModal: document.getElementById('shortcutsModal'), 
            modalOverlay: document.getElementById('shortcutsModalOverlay'),
            shortcutsTrigger: document.getElementById('shortcutsTrigger'),
        }
    }

    toggleVisibility () {
        const { shortcutsModal, modalOverlay } = this.getElements();

        this.isVisible = !this.isVisible;
        shortcutsModal.classList.toggle('hidden')
        modalOverlay.classList.toggle('hidden')
    }

    setupListeners() {
        if (this.listenersInitialized) return;

        const { shortcutsModal, modalOverlay, shortcutsTrigger } = this.getElements();

        document.addEventListener("keydown", (event) => {
            const active = document.activeElement;

            const isSomeInputInFocus =
                active.classList.contains("hour-input") ||
                active.closest(".notes-input") !== null;

            if (isSomeInputInFocus) return;

            if (event.key === "?") {
                this.toggleVisibility();
            }
        });
        
        document.addEventListener("DOMContentLoaded", () => {
            const content = this.getContent();
            shortcutsModal.innerHTML = marked.parse(content);
        });

        modalOverlay.addEventListener('click', () => {
            this.toggleVisibility();
        });

        document.addEventListener("keydown", (event) => {
            if (!this.isVisible) return;

            if (event.key.toLocaleLowerCase() === "escape") {
                this.toggleVisibility();
            }
        });

        shortcutsTrigger.addEventListener('click', () => {
            this.toggleVisibility();
        });

        this.listenersInitialized = true;
    }

     init () {
        this.setupListeners()
    }
}

const shortcuts = new Shortcuts();

export function init() {
    shortcuts.init();
}