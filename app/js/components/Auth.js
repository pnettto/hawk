import * as DailyLog from './DailyLog.js';

async function createHash(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

class Auth {
    getElements () {
        const authContainer = document.getElementById('authContainer')
        return {
            authContainer,
            form: authContainer.querySelector('.auth-form'),
            guest: authContainer.querySelector('.guest'),
        }
    }

    setupListeners () {
        if (this.listenersInitiated) return;
        const { form, guest } = this.getElements();

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const password = formData.get('password').trim();
            
            if (password == '') return;

            const key = await createHash(password);
            
            localStorage.setItem('apiKey', key);
            this.close();

            DailyLog.init();
        });

        guest.addEventListener('click', (e) => {
            e.preventDefault();
            this.close();
        });

        this.listenersInitiated = true;
    }


    open() {
        const { authContainer } = this.getElements();
        authContainer.classList.remove('hidden')
        document.body.style = 'overflow: hidden; height: 100vw;';
    }

    close() {
        const { authContainer } = this.getElements();
        authContainer.classList.add('hidden')
        document.body.style = '';
    }

    render () {
        const apiKey = localStorage.getItem('apiKey');
        if (!apiKey) {
            this.open();
            this.setupListeners();
        };

        
    }
}

const auth = new Auth()

export function init() {
    auth.render();
}

export function enter  () {
    auth.enter();
}