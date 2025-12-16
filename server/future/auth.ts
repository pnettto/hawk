// deno run -A main.ts

import { Hono } from "https://deno.land/x/hono@v4.5.0/mod.ts";
import { hash, verify } from "https://deno.land/x/argon2@v0.2.0/mod.ts";

const app = new Hono();
const kv = await Deno.openKv();

// --------------------
// Helpers
// --------------------

function getCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  return cookie.match(new RegExp(`${name}=([^;]+)`))?.[1] ?? null;
}

function setSessionCookie(sessionId: string, maxAgeSeconds = 86400) {
  return [
    `session=${sessionId}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

// --------------------
// Auth middleware
// --------------------

async function auth(c, next) {
  const sessionId = getCookie(c.req.raw, "session");
  if (!sessionId) return c.text("Unauthorized", 401);

  const res = await kv.get(["session", sessionId]);
  const session = res.value as { userId: string; expiresAt: number } | null;
  if (!session) return c.text("Unauthorized", 401);

  if (session.expiresAt < Date.now()) {
    await kv.delete(["session", sessionId]);
    return c.text("Unauthorized", 401);
  }

  c.set("userId", session.userId);
  await next();
}

// --------------------
// Register
// --------------------

app.post("/register", async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) return c.text("Bad request", 400);

  const userKey = ["user", username];

  const passwordHash = await hash(password);
  const user = {
    id: crypto.randomUUID(),
    username,
    passwordHash,
    createdAt: Date.now(),
  };

  const res = await kv.atomic()
    .check({ key: userKey, versionstamp: null }) // enforce uniqueness
    .set(userKey, user)
    .commit();

  if (!res.ok) return c.text("User already exists", 409);
  return c.text("Registered");
});

// --------------------
// Login
// --------------------

app.post("/login", async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) return c.text("Bad request", 400);

  const userRes = await kv.get(["user", username]);
  const user = userRes.value as any;
  if (!user) return c.text("Unauthorized", 401);

  const ok = await verify(user.passwordHash, password);
  if (!ok) return c.text("Unauthorized", 401);

  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24; // 24h

  await kv.set(
    ["session", sessionId],
    { userId: user.id, expiresAt },
    { expireIn: 1000 * 60 * 60 * 24 }
  );

  c.header("Set-Cookie", setSessionCookie(sessionId));
  return c.text("Logged in");
});

// --------------------
// Protected route
// --------------------

app.get("/me", auth, async (c) => {
  return c.json({ userId: c.get("userId") });
});

// --------------------
// Logout
// --------------------

app.post("/logout", auth, async (c) => {
  const sessionId = getCookie(c.req.raw, "session");
  if (sessionId) await kv.delete(["session", sessionId]);

  c.header(
    "Set-Cookie",
    "session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
  );
  return c.text("Logged out");
});

// --------------------
// Start server
// --------------------

Deno.serve(app.fetch);
