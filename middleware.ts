import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/auth";

// /api/cron/ and /api/hermes/ self-authenticate (Bearer CRON_SECRET / HERMES_API_TOKEN
// respectively — see app/api/cron/publish/route.ts and lib/machine-auth.ts) and so are
// exempt from the human session check below.
const PUBLIC_PREFIXES = ["/login", "/api/auth/login", "/api/cron/", "/api/hermes/"];

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
  // icon.png / apple-icon.png / manifest.webmanifest / icons/* are fetched by
  // iOS/Android without cookies when adding to the home screen, so they must
  // stay reachable unauthenticated or home-screen icons silently 307 to /login.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|icon.png|apple-icon.png|manifest.json|manifest.webmanifest|icons/).*)",
  ],
};
