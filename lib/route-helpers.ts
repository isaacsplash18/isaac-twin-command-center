import { NextResponse } from "next/server";
import { ActionError } from "./actions";

export type RouteParams = { params: Promise<{ pageId: string }> };

export async function handleAction<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn());
  } catch (err) {
    if (err instanceof ActionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Action failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Action failed" }, { status: 500 });
  }
}
