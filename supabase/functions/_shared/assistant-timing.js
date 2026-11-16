// Five candidates start 5s apart: the last can finish after 20s + 110s.
// Keep authentication/storage headroom within Supabase Free's 150s worker limit.
export const MODEL_RESPONSE_TIMEOUT_MS = 110_000;
export const ASSISTANT_SERVER_TIMEOUT_MS = 140_000;
// The browser also waits for authentication and network transit around the server.
export const ASSISTANT_CLIENT_TIMEOUT_MS = 180_000;
