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
    super({
      selectedDate: new Date(),
      logs: {},
      currentPage: "app", // 'app' or 'report' etc.
      journalTab: "tasks", // 'tasks' or 'notes'
      isAuth: false,
      isGuest: false,
      isCheckingAuth: true,
    });
  }

  async checkSession() {
    const { authCheck } = await import("./storage.js");
    const isAuth = await authCheck();
    if (isAuth) {
      this.setState({ isAuth: true, isGuest: false, isCheckingAuth: false });
    } else {
      this.setState({ isAuth: false, isGuest: false, isCheckingAuth: false });
    }
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
    this.setState({ isAuth, isGuest: false });
  }

  async logout() {
    const { logout: storageLogout } = await import("./storage.js");
    await storageLogout();
    localStorage.removeItem("guest");
    this.setState({ isAuth: false, isGuest: false });
  }
}

export const appStore = new AppStore();

// Initial load for current date, then load all in background for reports
const initStore = async () => {
  await appStore.checkSession();
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
