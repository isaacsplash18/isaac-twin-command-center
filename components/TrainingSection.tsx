import { ReactNode } from 'react';

/** Native disclosure keeps forms mounted when closed and supports keyboard navigation. */
export function TrainingSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <details className="group rounded-xl border border-hairline bg-white">
    <summary className="flex cursor-pointer list-none items-start justify-between gap-4 rounded-xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oxbright [&::-webkit-details-marker]:hidden">
      <span><span className="block text-base font-semibold text-ink">{title}</span><span className="mt-1 block max-w-3xl text-sm leading-relaxed text-ink-dim">{description}</span></span>
      <span aria-hidden="true" className="mt-1 shrink-0 text-ink-dim transition-transform group-open:rotate-180">⌄</span>
    </summary>
    <div className="border-t border-hairline p-2 sm:p-4">{children}</div>
  </details>;
}
