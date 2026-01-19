import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import { style } from "./Auth.styles.js";
import { API_URL } from "../global.js";

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

    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        appStore.setState({ isAuth: true, isGuest: false });
      } else {
        console.warn("Invalid password, logging in as guest...");
        this.handleGuest(e);
      }
    } catch (e) {
      console.error("Login failed:", e);
      this.handleGuest(e);
    }
  }

  handleGuest(e) {
    if (e) e.preventDefault();
    // Transient guest mode - not saved to localStorage
    appStore.setState({ isAuth: true, isGuest: true });
  }

  render() {
    const { isAuth, isCheckingAuth } = this.getState();
    if (isCheckingAuth || isAuth) {
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
          <a href="#" class="guest">Let me test it</a>
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
