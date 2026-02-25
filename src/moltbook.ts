import { URLS } from "./config/index.js";
import type { MoltbookPost, MoltbookComment } from "./types.js";

// --- Number word definitions (ordered longest-first to avoid partial matches) ---

const TENS: [string, number][] = [
  ["seventy", 70], ["eighty", 80], ["ninety", 90], ["thirty", 30],
  ["twenty", 20], ["forty", 40], ["fifty", 50], ["sixty", 60],
];

const ONES: [string, number][] = [
  ["seventeen", 17], ["thirteen", 13], ["fourteen", 14], ["nineteen", 19],
  ["eighteen", 18], ["fifteen", 15], ["sixteen", 16], ["twelve", 12],
  ["eleven", 11], ["seven", 7], ["three", 3], ["eight", 8],
  ["four", 4], ["five", 5], ["nine", 9], ["ten", 10],
  ["six", 6], ["two", 2], ["one", 1],
];

/**
 * Build a fuzzy regex pattern for a word.
 * Allows each char to repeat 1-3 times (handles letter-doubling obfuscation)
 * without allowing arbitrary chars between expected chars (prevents false matches).
 */
function fuzzy(word: string): string {
  return word.split("").map((c) => c + "{1,3}").join("");
}

/**
 * Extract numbers from an obfuscated challenge blob (lowercase alpha only).
 * Returns numbers in order of appearance in the text.
 */
function extractNumbers(blob: string): number[] {
  const found: { value: number; start: number; len: number }[] = [];
  let w = blob;

  // Pass 1: compound tens+ones (e.g., "twentyfive" → 25)
  for (const [tw, tv] of TENS) {
    for (const [ow, ov] of ONES) {
      if (ov > 9) continue; // compound only with single-digit ones
      const re = new RegExp(fuzzy(tw) + fuzzy(ow));
      const m = w.match(re);
      if (m && m.index !== undefined) {
        found.push({ value: tv + ov, start: m.index, len: m[0].length });
        w = w.slice(0, m.index) + "_".repeat(m[0].length) + w.slice(m.index + m[0].length);
      }
    }
  }

  // Pass 2: standalone tens (twenty → 20)
  for (const [word, val] of TENS) {
    const m = w.match(new RegExp(fuzzy(word)));
    if (m && m.index !== undefined) {
      found.push({ value: val, start: m.index, len: m[0].length });
      w = w.slice(0, m.index) + "_".repeat(m[0].length) + w.slice(m.index + m[0].length);
    }
  }

  // Pass 3: teens and ones
  for (const [word, val] of ONES) {
    const m = w.match(new RegExp(fuzzy(word)));
    if (m && m.index !== undefined) {
      found.push({ value: val, start: m.index, len: m[0].length });
      w = w.slice(0, m.index) + "_".repeat(m[0].length) + w.slice(m.index + m[0].length);
    }
  }

  found.sort((a, b) => a.start - b.start);
  return found.map((f) => f.value);
}

/**
 * Detect math operation from challenge text.
 * Checks both raw text (explicit operators) and cleaned text (obfuscated keywords).
 */
function detectOp(text: string): "+" | "-" | "*" | "/" {
  const clean = text.toLowerCase().replace(/[^a-z]/g, "");
  // Explicit operators in raw text
  if (text.includes("*") || text.includes("×")) return "*";
  if (text.includes("÷")) return "/";
  // Keywords on cleaned text (handles "lO sEsS" → "losess" containing "lose")
  if (/product|multipl|times/.test(clean)) return "*";
  if (/divid|quotient|ratio/.test(clean)) return "/";
  if (/lose|minus|subtract|less|fewer|differ|slow|reduc|drop/.test(clean)) return "-";
  if (/total|sum|add|combined|together|plus|more|extra/.test(clean)) return "+";
  return "+";
}

/**
 * Solve an obfuscated Moltbook verification challenge.
 * Returns the answer as a string with 2 decimal places (e.g., "75.00").
 */
function solveChallenge(challenge: string): string {
  // Try digit-based numbers first (fallback)
  const digitMatches = challenge.match(/\b\d+(?:\.\d+)?\b/g);
  if (digitMatches && digitMatches.length >= 2) {
    const op = detectOp(challenge);
    const a = parseFloat(digitMatches[0]);
    const b = parseFloat(digitMatches[1]);
    return compute(a, b, op).toFixed(2);
  }

  // Word-based numbers
  const blob = challenge.toLowerCase().replace(/[^a-z]/g, "");
  const nums = extractNumbers(blob);
  const op = detectOp(challenge);

  if (nums.length < 2) {
    throw new Error(
      `Could not extract 2 numbers from challenge (found ${nums.length}: ${JSON.stringify(nums)})`,
    );
  }

  return compute(nums[0], nums[1], op).toFixed(2);
}

function compute(a: number, b: number, op: string): number {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b !== 0 ? a / b : 0;
    default: return a + b;
  }
}

// --- Verification API ---

interface VerificationResponse {
  verification_required?: boolean;
  verification?: {
    code: string;
    challenge: string;
    expires_at: string;
  };
}

async function submitVerification(
  token: string,
  code: string,
  answer: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${URLS.moltbook}/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ verification_code: code, answer }),
  });
  return res.json() as Promise<{ success: boolean; message: string }>;
}

/**
 * Solve and submit verification challenge if present in API response.
 * Returns "published" on success, or error description.
 */
async function handleVerification(
  token: string,
  data: VerificationResponse,
): Promise<string> {
  if (!data.verification_required || !data.verification) return "published";

  const { code, challenge } = data.verification;
  if (!code || !challenge) return "verification required but no challenge received";

  try {
    const answer = solveChallenge(challenge);
    const result = await submitVerification(token, code, answer);
    if (result.success) return "published";
    return `verification failed: ${result.message} (answer=${answer})`;
  } catch (err) {
    return `verification error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// --- Public API ---

/**
 * Create a post on Moltbook
 */
export async function moltbookPost(
  token: string,
  submolt: string,
  title: string,
  content: string,
): Promise<string> {
  const response = await fetch(`${URLS.moltbook}/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ submolt, title, content }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || JSON.stringify(data));
  }

  const postId = data.post?.id || "unknown";
  const status = await handleVerification(token, data as VerificationResponse);
  return `${postId} (${status})`;
}

/**
 * Browse Moltbook posts
 */
export async function moltbookBrowse(
  submolt?: string,
  sort = "hot",
): Promise<MoltbookPost[]> {
  const url = submolt
    ? `${URLS.moltbook}/submolts/${submolt}/feed?sort=${sort}&limit=10`
    : `${URLS.moltbook}/posts?sort=${sort}&limit=10`;

  const response = await fetch(url);
  const data = await response.json();
  return (data.posts || []) as MoltbookPost[];
}

/**
 * Comment on a Moltbook post, optionally as a reply to another comment.
 */
export async function moltbookComment(
  token: string,
  postId: string,
  content: string,
  parentId?: string,
): Promise<string> {
  const body: Record<string, string> = { content };
  if (parentId) body.parent_id = parentId;

  const response = await fetch(`${URLS.moltbook}/posts/${postId}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  const commentId = data.comment?.id || data.id || "unknown";
  const status = await handleVerification(token, data as VerificationResponse);
  return `${commentId} (${status})`;
}

/**
 * Read a Moltbook post with its comments
 */
export async function moltbookReadPost(
  postId: string,
): Promise<{ post: MoltbookPost; comments: MoltbookComment[] }> {
  const response = await fetch(`${URLS.moltbook}/posts/${postId}`);
  const data = await response.json();

  if (!data.post) {
    throw new Error("Post not found");
  }

  return {
    post: data.post as MoltbookPost,
    comments: (data.comments || []) as MoltbookComment[],
  };
}

/**
 * Format Moltbook posts for display
 */
export function formatPosts(posts: MoltbookPost[]): string {
  if (posts.length === 0) return "No posts found.";

  return posts
    .map((p) => {
      const author = p.author?.name || "unknown";
      const submolt = p.submolt?.name || "general";
      const votes = p.upvotes ?? 0;
      const comments = p.comment_count ?? 0;
      return `[${p.id}] ${p.title} (by ${author} in ${submolt}, ${votes} upvotes, ${comments} comments)`;
    })
    .join("\n");
}
