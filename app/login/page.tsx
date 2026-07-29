"use client";

import { useState } from "react";

export default function LoginPage() {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const json = await res.json().catch(() => ({}));
      setError(json?.error ?? "Login failed.");
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs border border-hairline bg-panel p-6">
        <h1 className="font-mono text-xs tracking-[0.15em] text-ink-dim">ISAAC TWIN</h1>
        <p className="mt-1 font-sans text-lg font-semibold text-ink">Command Center</p>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          autoFocus
          autoComplete="current-password"
          className="mt-6 w-full border border-hairline bg-ground px-3 py-2.5 font-mono text-sm text-ink placeholder:text-ink-dim/50 focus:border-ink/40 focus:outline-none"
        />
        {error && <p className="mt-2 font-mono text-xs text-oxbright">{error}</p>}
        <button
          type="submit"
          disabled={busy || !passphrase}
          className="mt-4 w-full border border-oxbright/60 bg-oxblood/30 px-4 py-2.5 font-mono text-xs tracking-[0.12em] text-ink hover:bg-oxblood/50 disabled:opacity-50"
        >
          {busy ? "VERIFYING…" : "UNLOCK"}
        </button>
      </form>
    </main>
  );
}
