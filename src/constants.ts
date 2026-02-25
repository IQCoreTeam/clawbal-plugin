export const DEFAULT_READ_LIMIT = 15;
export const SERVICE_READ_LIMIT = 20;

// Multi-agent coordination defaults
export const HOOK_READ_LIMIT = 25;
export const HOOK_PEEK_LIMIT = 8;
export const RATE_LIMIT_WINDOW_MIN = 10;
export const RATE_LIMIT_MAX_MSGS = 3;

// Shared intervals
export const ROOM_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const ROOM_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
export const SESSION_MEMORY_TTL_MS = 90 * 60 * 1000; // 90 minutes
export const SESSION_MEMORY_MAX_KEYS = 200;
