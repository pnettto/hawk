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
| w                | Move hours up                  |
| s                | Move hours down                |
| a                | Show all hours in day          |
| Arrow Left       | Move to previous day           |
| Arrow Right      | Move to next day               |
| Cmd/Ctrl + S     | Save notes (while editing)     |
| ?                | Show shortcuts                 |
`
    }

    getElements () {
        this.shortcutsModal = document.getElementById('shortcutsModal');
        this.modalOverlay = document.getElementById('modalOverlay');
        this.shortcutsTrigger = document.getElementById('shortcutsTrigger');

        return { 
            shortcutsModal: this.shortcutsModal, 
            modalOverlay: this.modalOverlay,
            shortcutsTrigger: this.shortcutsTrigger,
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

        window.addEventListener("keydown", (event) => {
             const active = document.activeElement;

            const isSomeInputInFocus =
                active.classList.contains("hour-input") ||
                active.closest(".notes-input") !== null;

            if (isSomeInputInFocus) return;

            if (event.key === "?") {
                this.toggleVisibility();
            }
        });
        
        window.addEventListener("keydown", (event) => {
            if (!this.isVisible) return;

            if (event.key.toLocaleLowerCase() === "escape") {
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