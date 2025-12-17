// base-component.js
export class Component extends HTMLElement {
    constructor(options = {}) {
        super();
        this.attachShadow({ mode: "open" });
        this.onChange = () => this.render();
        this.stores = [];
        this.options = options;
    }

    connectedCallback() {
        if (this.options.style) {
            const styleEl = document.createElement("style");
            styleEl.textContent = this.options.style;
            this.shadowRoot.appendChild(styleEl);
        }

        this.render();
    }

    disconnectedCallback() {
        this.stores.forEach((store) =>
            store.removeEventListener("change", this.onChange)
        );
    }

    addStore(store) {
        if (store && !this.stores.includes(store)) {
            this.stores.push(store);
            store.addEventListener("change", this.onChange);
        }
    }

    getState() {
        // merge all store states; later stores override earlier
        return Object.assign({}, ...this.stores.map((s) => s.getState()));
    }

    display(content) {
        // Remove all children except the style
        Array.from(this.shadowRoot.children)
            .filter(el => el.tagName.toLowerCase() !== 'style') 
            .forEach(el => this.shadowRoot.removeChild(el));

        const container = document.createElement("div");
        container.innerHTML = content;
        this.shadowRoot.appendChild(container.firstElementChild);
    }

    render() {
        this.shadowRoot.innerHTML = "";
    }
}
