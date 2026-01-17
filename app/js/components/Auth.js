import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";

async function createHash(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return hashHex;
}

const style = /* css */ `
.auth-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: var(--bg);
    z-index: 2000;
}

.auth-form {
    width: min(15rem, 90vw);
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
}

.auth-form .logo {
    width: 3rem;
    margin-bottom: 2rem;
}

.auth-form > * {
    display: block;
    border: 0;
    margin-bottom: 1rem;
    padding: 0.5rem;
    width: 100%;
    color: inherit;
}

.auth-form input, 
.auth-form button {
    border-radius: 10px;
    background: var(--glass-dark);
}

.auth-form button {
    background: var(--accent);
    color: #000;
    cursor: pointer;
    font-weight: bold;
}

.guest {
    color: var(--accent);
    text-decoration: none;
    font-size: 0.8rem;
}

p {
    font-size: 0.8rem;
    opacity: 0.6;
}

.hidden {
    display: none !important;
}
`;

class AuthOverlay extends Component {
  constructor() {
    super({ style });
    this.addStore(appStore);
  }

  async handleSubmit(e) {
    e.preventDefault();
    const password = this.shadowRoot.querySelector('input[name="password"]')
      .value.trim();
    if (!password) return;

    const key = await createHash(password);
    localStorage.setItem("apiKey", key);
    appStore.setAuth(true);
  }

  handleGuest(e) {
    e.preventDefault();
    localStorage.setItem("guest", "true");
    appStore.setAuth(true);
  }

  render() {
    const { isAuth } = this.getState();
    if (isAuth) {
      this.display("");
      return;
    }

    const content = `
      <div class="auth-container">
        <form class="auth-form">
          <div>
            <img src="images/logo.svg" class="logo" />
          </div>
          <input name="password" placeholder="Type in the password" type="password" required />
          <button type="submit">Log in</button>
          <p>
            The correct password is needed to save the information, but you can go in and test it out.
          </p>
          <a href="#" class="guest">I want to test it!</a>
          <p>Author: <a href="https://pnetto.com" style="color: inherit;">Pedro Netto</a></p>
        </form>
      </div>
    `;

    this.display(content);

    this.shadowRoot.querySelector("form").onsubmit = (e) =>
      this.handleSubmit(e);
    this.shadowRoot.querySelector(".guest").onclick = (e) =>
      this.handleGuest(e);
  }
}

customElements.define("auth-overlay", AuthOverlay);
