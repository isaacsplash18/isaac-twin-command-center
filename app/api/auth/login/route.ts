import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  checkPassphrase,
  createSessionToken,
  rateLimitLogin,
  sessionCookieOptions,
} from "@/lib/auth";
import { requiredEnv } from "@/lib/config";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimitLogin(ip)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }
  let passphrase = "";
  try {
    const body = await req.json();
    passphrase = String(body?.passphrase ?? "");
  } catch {
    /* fall through to failure */
  }
  const ok = passphrase && (await checkPassphrase(passphrase, requiredEnv("AUTH_SECRET")));
  if (!ok) {
    return NextResponse.json({ error: "Wrong passphrase." }, { status: 401 });
  }
  const token = await createSessionToken(requiredEnv("SESSION_SECRET"));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
