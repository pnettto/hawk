import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import { style } from "./Auth.styles.js";

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
    localStorage.setItem("authTimestamp", Date.now().toString());
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

    this.shadowRoot.querySelector("form").addEventListener(
      "submit",
      (e) => this.handleSubmit(e),
    );
    this.shadowRoot.querySelector(".guest").addEventListener(
      "click",
      (e) => this.handleGuest(e),
    );
  }
}

customElements.define("auth-overlay", AuthOverlay);
