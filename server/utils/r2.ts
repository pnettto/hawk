import { AwsClient } from "aws4fetch";

// File bodies live in a Cloudflare R2 bucket, reached through its
// S3-compatible API. Metadata stays in KV (see routeHandlers/files.ts).
//
// Env (all required for R2 to be enabled):
//   R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

const ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID");
const BUCKET = Deno.env.get("R2_BUCKET");
const ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID");
const SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY");

export const r2Enabled = !!(ACCOUNT_ID && BUCKET && ACCESS_KEY_ID && SECRET_ACCESS_KEY);

const client = r2Enabled
  ? new AwsClient({
    accessKeyId: ACCESS_KEY_ID!,
    secretAccessKey: SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  })
  : null;

function objectUrl(key: string) {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${path}`;
}

function r2(): AwsClient {
  if (!client) throw new Error("R2 is not configured (set R2_* env vars)");
  return client;
}

export async function putObject(key: string, body: Uint8Array<ArrayBuffer>, contentType: string) {
  const res = await r2().fetch(objectUrl(key), {
    method: "PUT",
    body,
    headers: {
      "Content-Type": contentType,
      // Skip hashing the whole body for the signature; TLS covers integrity.
      "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
    },
  });
  if (!res.ok) throw new Error(`R2 put ${key} failed: ${res.status} ${await res.text()}`);
  await res.body?.cancel();
}

// Returns null on 404 so callers can answer "Not found" themselves.
export async function getObject(key: string): Promise<Response | null> {
  const res = await r2().fetch(objectUrl(key));
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) throw new Error(`R2 get ${key} failed: ${res.status} ${await res.text()}`);
  return res;
}

export async function deleteObject(key: string) {
  const res = await r2().fetch(objectUrl(key), { method: "DELETE" });
  // S3 DELETE is idempotent: 204 whether or not the object existed.
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 delete ${key} failed: ${res.status} ${await res.text()}`);
  }
  await res.body?.cancel();
}
