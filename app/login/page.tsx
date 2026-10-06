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
      <form
        onSubmit={submit}
        className="instrument-card w-full max-w-sm rounded-2xl border border-hairline bg-white p-8"
      >
        <h1 className="font-mono text-xs tracking-[0.15em] text-oxblood">
          ISAAC TWIN
        </h1>
        <p className="mt-3 font-sans text-2xl font-semibold tracking-tight text-ink">
          Command Center
        </p>
        <p className="mt-2 text-sm text-ink-dim">Your voice. Your control.</p>
        <label
          htmlFor="passphrase"
          className="mt-6 block text-sm font-semibold"
        >
          Passphrase
        </label>
        <input
          id="passphrase"
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          autoFocus
          autoComplete="current-password"
          className="mt-2 w-full rounded-lg border border-hairline bg-ground px-3 py-3 text-base text-ink"
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-oxbright">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !passphrase}
          className="btn btn-primary mt-5 w-full"
        >
          {busy ? "Verifying…" : "Enter command center"}
        </button>
      </form>
    </main>
  );
}
