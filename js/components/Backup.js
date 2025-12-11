import { backup as storageBackup } from '../utils/storage.js';

class Backup {
    setupListeners () {
        if (this.listenersInitiated) return;

        document.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            const isTyping = active.tagName === "INPUT" ||
                        active.tagName === "TEXTAREA" ||
                        active.isContentEditable;
            if (isTyping) return;

            if (e.key.toLowerCase() === 'b') {
                storageBackup();
            }
        })

        this.listenersInitiated = true;
    }


    render (date) {
        this.setupListeners();
    }
}

const backup = new Backup()

export function init() {
    backup.render();
}