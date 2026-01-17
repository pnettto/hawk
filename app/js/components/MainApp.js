import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";

const style = /* css */ `
:host {
    display: block;
    width: 100%;
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
}

.container {
    display: flex;
    flex-direction: column;
}

.app-header {
    margin-bottom: 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.page-content {
    animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}

.hidden {
    display: none !important;
}

nav {
    display: flex;
    gap: 1rem;
    margin-bottom: 2rem;
    opacity: 0.3;
    transition: opacity 0.3s;
}

nav:hover {
    opacity: 1;
}

nav button {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.8rem;
    padding: 0.5rem;
}

nav button.active {
    color: var(--accent);
    font-weight: bold;
}
`;

class MainApp extends Component {
  constructor() {
    super({ style });
    this.addStore(appStore);
  }

  render() {
    const { currentPage, isAuth } = this.getState();

    // 1. Initial full render or auth change
    if (this._lastAuth !== isAuth) {
      this._lastAuth = isAuth;
      this._lastPage = currentPage;
      this.fullRender(isAuth, currentPage);
      return;
    }

    // 2. Page change only
    if (this._lastPage !== currentPage) {
      this._lastPage = currentPage;
      this.updatePageVisibility(currentPage);
      this.updateNav(currentPage);
    }
  }

  updateNav(currentPage) {
    const navApp = this.shadowRoot.getElementById("nav-app");
    const navReport = this.shadowRoot.getElementById("nav-report");
    if (navApp) navApp.classList.toggle("active", currentPage === "app");
    if (navReport) {
      navReport.classList.toggle("active", currentPage === "report");
    }
  }

  updatePageVisibility(currentPage) {
    const journalPage = this.shadowRoot.getElementById("journal-page");
    const reportPage = this.shadowRoot.getElementById("report-page");
    if (journalPage) {
      journalPage.classList.toggle("hidden", currentPage !== "app");
    }
    if (reportPage) {
      reportPage.classList.toggle("hidden", currentPage !== "report");
    }
  }

  fullRender(isAuth, currentPage) {
    const content = `
      <div class="container ${!isAuth ? "hidden" : ""}">
        <nav>
            <button class="${
      currentPage === "app" ? "active" : ""
    }" id="nav-app">Journal</button>
            <button class="${
      currentPage === "report" ? "active" : ""
    }" id="nav-report">Report</button>
        </nav>

        <main id="journal-page" class="page-content ${
      currentPage === "app" ? "" : "hidden"
    }">
            <header class="app-header">
                <mood-tracker></mood-tracker>
                <date-picker></date-picker>
            </header>
            
            <daily-log></daily-log>
            <notes-input></notes-input>
        </main>

        <main id="report-page" class="page-content ${
      currentPage === "report" ? "" : "hidden"
    }">
            <report-maker></report-maker>
        </main>

        <shortcuts-modal></shortcuts-modal>
        <mirror-mode></mirror-mode>
        <zen-mode></zen-mode>
        <backup-toast></backup-toast>
      </div>
      <auth-overlay></auth-overlay>
    `;

    this.display(content);

    if (isAuth) {
      this.shadowRoot.getElementById("nav-app").onclick = () =>
        appStore.setCurrentPage("app");
      this.shadowRoot.getElementById("nav-report").onclick = () =>
        appStore.setCurrentPage("report");
    }
  }
}

customElements.define("main-app", MainApp);
