
class Mirror {
    constructor () {
        this.currentStream = null;
    }

    getElements () {
        return {
            mirror: document.getElementById('mirror'),
        }
    }

    setupListeners () {
        if (this.listenersInitiated) return;
        const { mirror } = this.getElements();

        document.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            const isTyping = active.tagName === "INPUT" ||
                        active.tagName === "TEXTAREA" ||
                        active.isContentEditable;
            if (isTyping) return;

            if (e.key.toLowerCase() === 'm') {
                if (mirror.classList.contains('hidden')) {
                    mirror.classList.remove('hidden')
                    document.body.style = 'overflow: hidden;';

                    const video = document.querySelector('video');

                    navigator.mediaDevices.getUserMedia({ video: true })
                    .then(stream => {
                        this.currentStream = stream;
                        video.srcObject = stream;
                    })
                    .catch(err => {
                        console.error('Error accessing webcam:', err);
                    });
                } else {
                    if (this.currentStream) {
                        this.currentStream.getTracks().forEach(track => track.stop());
                        this.currentStream = null;
                    }
                    mirror.classList.add('hidden')
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

const mirror = new Mirror()

export function init() {
    mirror.render(window.selectedDate);
}