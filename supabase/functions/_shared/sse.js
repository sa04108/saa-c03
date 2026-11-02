// Shared by the Edge Function and browser: network chunks are not SSE events.
export async function* readSSE(body, signal) {
  if (!body) throw new Error("Missing event stream");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", event = "message", data = [], size = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      let match;
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        // A CR at a chunk boundary might be the first half of CRLF.
        if (!done && match[0] === "\r" && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        size += line.length;
        if (size > 262144) throw new Error("Event stream frame too large");
        if (!line) {
          if (data.length) yield { event, data: data.join("\n") };
          event = "message"; data = []; size = 0;
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          let value = colon < 0 ? "" : line.slice(colon + 1);
          if (value.startsWith(" ")) value = value.slice(1);
          if (field === "data") data.push(value);
          else if (field === "event") event = value || "message";
        }
      }
      if (size + buffer.length > 262144) throw new Error("Event stream frame too large");
      // An unterminated event is incomplete and must not be accepted as success.
      if (done) break;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
