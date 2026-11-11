// Worker bindings and secrets, set once by the Durable Object constructor so
// helpers outside a request context (auth, R2) can reach them.
export interface Env {
  HAWK: DurableObjectNamespace;
  ASSETS: Fetcher;
  FILES: R2Bucket;
  API_KEY?: string;
}

let current: Env | null = null;

export function setEnv(env: Env) {
  current = env;
}

export function env(): Env {
  if (!current) throw new Error("Env not initialised");
  return current;
}
