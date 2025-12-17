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

  async asyncSetState(promise) {
    if (typeof promise === "function") {
      const newState = await promise();
      this.setState({ app: newState });
    }
  }
}

const loadState = async () => {
  return await loadLogs();
}

export const appStore = new Store();
appStore.asyncSetState(loadState);