import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/auth";

// Cron and Agent API routes authenticate their own bearer tokens.
const PUBLIC_PREFIXES = ["/login", "/api/auth/login", "/api/cron/", "/api/agent/"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }
  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = secret ? await verifySessionToken(token, secret) : false;
  if (ok) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  // icon.svg / apple-icon.png / manifest.webmanifest / icons/* are fetched by
  // browsers and by iOS/Android without cookies (tab favicon, add-to-home-
  // screen), so they must stay reachable unauthenticated or they silently 307
  // to /login. favicon.ico stays listed even though the file is gone (the
  // favicon is now app/icon.svg): browsers request /favicon.ico unprompted, and
  // a clean 404 beats a login redirect. icon.png was removed with the file.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.json|manifest.webmanifest|icons/).*)",
  ],
};
