import { createClient } from "@supabase/supabase-js";
import { backendConfig as config } from "./config";
import { getAccount } from "./account";
let guestClient, guestSignIn;
async function accessToken() {
  const signedIn = await getAccount().getAccessToken();
  if (signedIn) return signedIn;
  if (!config.supabaseUrl || !config.supabasePublishableKey)
    throw new Error("not_configured");
  if (!guestClient)
    guestClient = createClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
      {
        auth: {
          storageKey: "saa-c03-ai-guest-auth",
          detectSessionInUrl: false,
          persistSession: true,
        },
        global: {
          fetch: (url, options = {}) =>
            fetch(url, {
              ...options,
              signal: options.signal || AbortSignal.timeout(12000),
            }),
        },
      },
    );
  let { data, error } = await guestClient.auth.getSession();
  if (error) throw new Error("auth_unavailable");
  if (data.session && data.session.expires_at * 1000 < Date.now() + 60000)
    ({ data, error } = await guestClient.auth.refreshSession());
  if (error) throw new Error("auth_unavailable");
  if (data.session) return data.session.access_token;
  if (!guestSignIn)
    guestSignIn = guestClient.auth.signInAnonymously().finally(() => {
      guestSignIn = null;
    });
  const result = await guestSignIn;
  if (result.error || !result.data.session)
    throw new Error(
      result.error?.code === "anonymous_provider_disabled"
        ? "guest_disabled"
        : "auth_unavailable",
    );
  return result.data.session.access_token;
}
export async function callAssistant(payload, task) {
  const token = await accessToken();
  task.controller.signal.throwIfAborted();
  const response = await fetch(
    new URL("/functions/v1/study-assistant", config.supabaseUrl),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.supabasePublishableKey,
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(payload),
      signal: task.controller.signal,
    },
  );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(response.status === 404 ? "not_ready" : "connection");
  }
  if (!response.ok) {
    const error = new Error(
      data.error || (response.status === 404 ? "not_ready" : "connection"),
    );
    error.retryAfter = Number(data.retryAfter) || 0;
    throw error;
  }
  return data;
}

export async function historyApi(path, options = {}) {
  const { accountId, ...requestOptions } = options;
  await getAccount()?.ready;
  if (!getAccount()?.user || getAccount().user.is_anonymous === true)
    throw new Error("unauthenticated");
  const owner = accountId || getAccount().user.id;
  if (getAccount().user.id !== owner) throw new Error("unauthenticated");
  const token = await getAccount().getAccessToken();
  if (!token || getAccount()?.user?.id !== owner)
    throw new Error("unauthenticated");
  const response = await fetch(
    new URL("/rest/v1/" + path, config.supabaseUrl),
    {
      ...requestOptions,
      headers: {
        apikey: config.supabasePublishableKey,
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000),
    },
  );
  if (getAccount()?.user?.id !== owner) throw new Error("unauthenticated");
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      error?.code === "P0002" ? "conversation_deleted" : "history_unavailable",
    );
  }
  return response.json();
}

export async function listConversations(cursor, signal) {
  await getAccount().ready;
  const query = new URLSearchParams({
    select:
      "id,title,updated_at,kind:context->>kind,context_title:context->>title",
    user_id: "eq." + getAccount().user?.id,
    order: "updated_at.desc,id.desc",
    limit: "21",
  });
  if (cursor)
    query.set(
      "or",
      `(updated_at.lt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},id.lt.${cursor.id}))`,
    );
  return historyApi("ai_conversations?" + query, { signal });
}
export function listTurns(id, before, signal) {
  const query = new URLSearchParams({
    conversation_id: "eq." + id,
    select: "id,created_at,question,answer",
    order: "created_at.desc,id.desc",
    limit: "21",
  });
  if (before)
    query.set(
      "or",
      `(created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id}))`,
    );
  return historyApi("ai_chat_turns?" + query, { signal });
}
export async function loadConversation(id, signal) {
  const query = new URLSearchParams({
    id: "eq." + id,
    select: "id,context",
    limit: "1",
  });
  return Promise.all([
    historyApi("ai_conversations?" + query, { signal }),
    listTurns(id, null, signal),
  ]);
}
export function listConversationSelection(accountId, signal) {
  return historyApi("rpc/list_ai_conversation_selection", {
    method: "POST",
    body: "{}",
    accountId,
    signal,
  });
}
export function deleteConversations(ids, accountId) {
  return historyApi("rpc/delete_ai_conversations", {
    method: "POST",
    body: JSON.stringify({ p_ids: ids }),
    accountId,
  });
}
export function saveTurn(turn) {
  return historyApi("rpc/save_ai_chat_turn", {
    method: "POST",
    body: JSON.stringify({
      p_conversation_id: turn.conversationId,
      p_turn_id: turn.turnId,
      p_context: turn.context,
      p_question: turn.question,
      p_answer: turn.answer,
      p_created_at: turn.createdAt,
    }),
  });
}
