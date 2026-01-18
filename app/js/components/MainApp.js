import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";

const style = /* css */ `
:host {
    display: block;
    width: 100%;
    margin: 0 auto;
    padding: 2rem;
    box-sizing: border-box;
}

.container {
    display: flex;
    flex-direction: column;
    max-width: 800px;
    margin: 0 auto;
    width: 100%;
    position: relative;
}


.app-header {
    margin-bottom: 2rem;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    border-bottom: 1px solid var(--line);
    padding-bottom: 0.5rem;
}

.header-left {
    display: flex;
    align-items: center;
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

.journal-tabs {
    display: flex;
    gap: 1.5rem;
}

.journal-tabs button {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.8rem;
    padding: 0;
    text-transform: uppercase;
    letter-spacing: 0.05rem;
}

.journal-tabs button.active {
    color: var(--accent);
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

    // 3. Journal tab change
    const { journalTab } = this.getState();
    if (this._lastTab !== journalTab) {
      this._lastTab = journalTab;
      this.updateJournalTabs(journalTab);
      this.updatePageVisibility(currentPage);
    }
  }

  updateJournalTabs(journalTab) {
    const tabTasks = this.shadowRoot.getElementById("tab-tasks");
    const tabNotes = this.shadowRoot.getElementById("tab-notes");
    if (tabTasks) tabTasks.classList.toggle("active", journalTab === "tasks");
    if (tabNotes) tabNotes.classList.toggle("active", journalTab === "notes");
  }

  updateNav(currentPage) {
    const navApp = this.shadowRoot.getElementById("nav-app");
    const navReport = this.shadowRoot.getElementById("nav-report");
    const navNotes = this.shadowRoot.getElementById("nav-notes");
    if (navApp) navApp.classList.toggle("active", currentPage === "app");
    if (navReport) {
      navReport.classList.toggle("active", currentPage === "report");
    }
    if (navNotes) navNotes.classList.toggle("active", currentPage === "notes");
  }

  updatePageVisibility(currentPage) {
    const journalPage = this.shadowRoot.getElementById("journal-page");
    const reportPage = this.shadowRoot.getElementById("report-page");
    const notesPage = this.shadowRoot.getElementById("notes-page");
    const container = this.shadowRoot.querySelector(".container");
    if (container) {
      // No longer using .wide
    }
    if (journalPage) {
      journalPage.classList.toggle("hidden", currentPage !== "app");

      const { journalTab } = this.getState();
      const dailyLog = this.shadowRoot.querySelector("daily-log");
      const notesInput = this.shadowRoot.querySelector("notes-input");
      if (dailyLog) dailyLog.classList.toggle("hidden", journalTab !== "tasks");
      if (notesInput) {
        notesInput.classList.toggle("hidden", journalTab !== "notes");
      }
    }
    if (reportPage) {
      reportPage.classList.toggle("hidden", currentPage !== "report");
    }
    if (notesPage) {
      notesPage.classList.toggle("hidden", currentPage !== "notes");
    }
  }

  fullRender(isAuth, currentPage) {
    const { journalTab } = this.getState();
    const content = `
      <div class="container ${!isAuth ? "hidden" : ""}">
        <nav>
            <button class="${
      currentPage === "app" ? "active" : ""
    }" id="nav-app">Journal</button>
            <button class="${
      currentPage === "report" ? "active" : ""
    }" id="nav-report">Report</button>
            <button class="${
      currentPage === "notes" ? "active" : ""
    }" id="nav-notes">Notes</button>
        </nav>

        <main id="journal-page" class="page-content ${
      currentPage === "app" ? "" : "hidden"
    }">
            <header class="app-header">
                <div class="header-left">
                    <mood-tracker></mood-tracker>
                    <date-picker></date-picker>
                </div>

                <div class="journal-tabs">
                    <button class="${
      journalTab === "notes" ? "active" : ""
    }" id="tab-notes">Day Notes</button>
                    <button class="${
      journalTab === "tasks" ? "active" : ""
    }" id="tab-tasks">Tasks</button>
                </div>
            </header>
            
            <daily-log class="${
      journalTab === "tasks" ? "" : "hidden"
    }"></daily-log>
            <notes-input class="${
      journalTab === "notes" ? "" : "hidden"
    }"></notes-input>
        </main>

        <main id="notes-page" class="page-content ${
      currentPage === "notes" ? "" : "hidden"
    }">
            <notes-app></notes-app>
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
      this.shadowRoot.getElementById("nav-notes").onclick = () =>
        appStore.setCurrentPage("notes");
      this.shadowRoot.getElementById("nav-report").onclick = () =>
        appStore.setCurrentPage("report");

      this.shadowRoot.getElementById("tab-tasks").onclick = () =>
        appStore.setJournalTab("tasks");
      this.shadowRoot.getElementById("tab-notes").onclick = () =>
        appStore.setJournalTab("notes");
    }
  }
}

customElements.define("main-app", MainApp);
