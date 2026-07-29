"use client";

/** Mono-caps status text with a 6px dot; the dot pulses only for QUEUED (PRD §5.2). */
export function StatusPill({ status }: { status: string | null }) {
  const s = (status ?? "UNKNOWN").toUpperCase();
  const color =
    s === "POSTED"
      ? "bg-phosphor"
      : s === "QUEUED"
        ? "bg-oxbright"
        : s === "REJECTED"
          ? "bg-slate/60"
          : s === "APPROVED"
            ? "bg-ink/70"
            : "bg-slate";
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.1em] text-ink-dim">
      <span className={`h-[6px] w-[6px] rounded-full ${color} ${s === "QUEUED" ? "dot-pulse" : ""}`} />
      {s}
    </span>
  );
}
