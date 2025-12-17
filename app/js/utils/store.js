import { loadLogs } from "./load.js";

export class Store extends EventTarget {
  #state;

  constructor() {
    super();
    this.#state = {};
  }

  getState() {
    return this.#state;
  }

  setState(partial) {
    this.#state = { ...this.#state, ...partial };
    this.dispatchEvent(new Event("change"));
  }
}

// Specialization that always writes into `app`
export class AppStore extends Store {
  constructor () {
    super();
    this.setState({});
  }

  setState(partial) {
    const prevApp = this.getState().app ?? {};
    super.setState({ app: { ...prevApp, ...partial } });
  }
}

export const appStore = new AppStore();

const loadAppData = async () => {
  const logs = await loadLogs();
  appStore.setState({ logs });
};
loadAppData();