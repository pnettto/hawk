import { formatDate } from "./date.js";

export class Store extends EventTarget {
  #state;

  constructor(initialState = {}) {
    super();
    this.#state = initialState;
  }

  getState() {
    return this.#state;
  }

  setState(partial) {
    this.#state = { ...this.#state, ...partial };
    this.dispatchEvent(new Event("change"));
  }
}

export class AppStore extends Store {
  constructor() {
    const apiKey = localStorage.getItem("apiKey");
    const guest = localStorage.getItem("guest") === "true";
    let isAuth = false;

    if (guest) {
      isAuth = true;
    } else if (apiKey) {
      const authTimestamp = localStorage.getItem("authTimestamp");
      if (!authTimestamp) {
        isAuth = true;
      } else {
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        if (now - parseInt(authTimestamp) > thirtyDays) {
          localStorage.removeItem("apiKey");
          localStorage.removeItem("authTimestamp");
          isAuth = false;
        } else {
          isAuth = true;
        }
      }
    }

    super({
      selectedDate: new Date(),
      logs: {},
      currentPage: "app", // 'app' or 'report' etc.
      journalTab: "tasks", // 'tasks' or 'notes'
      isAuth,
    });
  }

  setJournalTab(tab) {
    this.setState({ journalTab: tab });
  }

  async setSelectedDate(date) {
    this.setState({ selectedDate: date });
    const dateStr = formatDate(date);

    // Force fresh fetch when user changes date (bypassing preload cache)
    await this.refreshDay(dateStr, true);
    import("./storage.js").then((m) => m.prefetchSurrounding(date));
  }

  async refreshDay(dateStr, force = false) {
    const { loadForDate } = await import("./storage.js");
    const data = await loadForDate(dateStr, force);
    if (data) {
      this.updateLogForDate(dateStr, data);
    }
  }

  async refreshRange(start, end) {
    const { loadForRange } = await import("./storage.js");
    const data = await loadForRange(start, end);
    if (data) {
      const currentState = this.getState();
      const newLogs = { ...currentState.logs, ...data };
      this.setState({ logs: newLogs });
    }
  }

  setLogs(logs) {
    this.setState({ logs });
  }

  updateLogForDate(dateStr, data) {
    const currentState = this.getState();
    const newLogs = { ...currentState.logs, [dateStr]: data };
    this.setState({ logs: newLogs });
  }

  setCurrentPage(page) {
    this.setState({ currentPage: page });
  }

  setAuth(isAuth) {
    this.setState({ isAuth });
  }
}

export const appStore = new AppStore();

// Initial load for current date, then load all in background for reports
const initStore = async () => {
  const dateStr = formatDate(appStore.getState().selectedDate);
  await appStore.refreshDay(dateStr);

  // Pre-fetch surrounding days immediately
  import("./storage.js").then((m) =>
    m.prefetchSurrounding(appStore.getState().selectedDate)
  );
};

initStore();

// Refresh on window focus
globalThis.addEventListener("focus", () => {
  const dateStr = formatDate(appStore.getState().selectedDate);
  appStore.refreshDay(dateStr, true);
});
