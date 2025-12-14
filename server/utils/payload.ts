export async function readTextWithLimit(
  req: Request,
  maxBytes: number,
): Promise<string> {
  const reader = req.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let received = 0;
  let chunks = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    received += value.byteLength;
    if (received > maxBytes) {
      throw new Error("Payload too large");
    }

    chunks += decoder.decode(value, { stream: true });
  }

  chunks += decoder.decode();
  return chunks;
}