import { backup as storageBackup } from '../utils/storage.js';

class Backup {
    getElements () {
        return {
            backupSaved: document.getElementById('backupSaved')
        }
    }

    setupListeners () {
        if (this.listenersInitiated) return;
        const { main } = this.getElements();

        document.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            const isTyping = active.tagName === "INPUT" ||
                        active.tagName === "TEXTAREA" ||
                        active.isContentEditable;
            if (isTyping) return;

            if (e.key.toLowerCase() === 'b') {
                storageBackup();
                backupSaved.classList.remove('hidden');
                setTimeout(() => {
                    backupSaved.classList.add('hidden');
                }, 500);
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