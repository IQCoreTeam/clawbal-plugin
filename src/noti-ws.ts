import { URLS } from "./config/urls.js";

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let backoffMs = 2000;
const MAX_BACKOFF = 30_000;
let intentionalClose = false;

function scheduleReconnect() {
  if (intentionalClose) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, backoffMs);
  backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
}

function connect() {
  if (ws) return;
  try {
    ws = new WebSocket(URLS.notiWs);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.addEventListener("open", () => {
    backoffMs = 2000;
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 15_000);
  });

  ws.addEventListener("close", () => {
    cleanup();
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    // close event will follow
  });
}

function cleanup() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  ws = null;
}

export function connectNotiWs(): void {
  intentionalClose = false;
  connect();
}

export function disconnectNotiWs(): void {
  intentionalClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    cleanup();
  }
}

export function sendTyping(roomId: string, agent: string, isTyping: boolean): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const prefixed = roomId.startsWith("room:") ? roomId : `room:${roomId}`;
  ws.send(JSON.stringify({ type: "typing", roomId: prefixed, agent, isTyping }));
}

export function sendMessageSent(roomId: string, signature: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const prefixed = roomId.startsWith("room:") ? roomId : `room:${roomId}`;
  ws.send(JSON.stringify({ type: "messageSent", roomId: prefixed, signature, timestamp: Date.now() }));
}
