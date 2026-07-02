/**
 * Single-user session auth. Web Crypto only, so it runs in both the Node.js
 * runtime (API routes) and the Edge runtime (middleware).
 *
 * Session token: base64url(JSON{exp}) + "." + base64url(HMAC-SHA256(payload, SESSION_SECRET))
 */

export const SESSION_COOKIE = "twin_session";
const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionToken(secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySessionToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  try {
    const sigBytes = Uint8Array.from(b64urlDecode(sigPart), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sigBytes, enc.encode(payload));
    if (!ok) return false;
    const { exp } = JSON.parse(b64urlDecode(payload));
    return typeof exp === "number" && exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Compare a submitted passphrase against AUTH_SECRET (sha256 hex of the passphrase). */
export async function checkPassphrase(passphrase: string, authSecret: string): Promise<boolean> {
  const hash = await sha256Hex(passphrase);
  return timingSafeEqualStr(hash, authSecret.toLowerCase().trim());
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_S,
  };
}

// ---- Login rate limiting (best-effort in-memory; per serverless instance) ----
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function rateLimitLogin(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_ATTEMPTS;
}
