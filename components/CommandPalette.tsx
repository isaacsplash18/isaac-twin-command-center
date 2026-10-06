"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

/** Search and run common actions from a keyboard- and touch-friendly dialog. */
export function CommandPalette({ actions }: { actions: PaletteAction[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setQuery("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? actions.filter((action) =>
          `${action.label} ${action.keywords || ""}`.toLowerCase().includes(q),
        )
      : actions;
  }, [actions, query]);

  const runAction = (action: PaletteAction | undefined) => {
    if (!action) return;
    setOpen(false);
    action.run();
  };

  return (
    <>
      <button
        type="button"
        aria-label="Search & commands"
        className="btn btn-secondary"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true" className="text-xl sm:hidden">
          ⌕
        </span>
        <span className="hidden sm:inline">Search &amp; commands</span>{" "}
        <kbd className="ml-2 hidden text-xs opacity-65 xl:inline">
          ⌘K / Ctrl K
        </kbd>
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="command-palette-title"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) setOpen(false);
        }}
        className="m-auto w-[calc(100%_-_2rem)] max-w-[560px] overflow-hidden rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-2xl backdrop:bg-stone-950/45"
      >
        <h2 id="command-palette-title" className="sr-only">
          Search and commands
        </h2>
        <button
          type="button"
          aria-label="Close search"
          className="btn btn-quiet float-right m-2"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
        <input
          ref={inputRef}
          aria-label="Search drafts and commands"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (filtered.length)
                setCursor((value) => Math.min(value + 1, filtered.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              if (filtered.length) setCursor((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              runAction(filtered[cursor]);
            }
          }}
          placeholder="Search drafts and commands…"
          className="w-full border-0 border-b border-stone-200 bg-transparent px-5 py-4 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-0"
        />
        <p className="sr-only" aria-live="polite">
          {filtered[cursor]?.label || "No matching commands"}
        </p>
        <ul
          aria-label="Available actions"
          className="max-h-[55vh] overflow-y-auto p-2"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-4 text-sm text-stone-500">
              No matching actions.
            </li>
          ) : (
            filtered.map((action, index) => (
              <li key={action.id}>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => runAction(action)}
                  aria-current={index === cursor ? "true" : undefined}
                  className={`flex w-full items-center justify-between gap-4 rounded-lg px-3 py-3 text-left text-sm ${index === cursor ? "bg-stone-100 text-stone-900" : "text-stone-700 hover:bg-stone-50"}`}
                >
                  <span>{action.label}</span>
                  {action.hint && (
                    <span className="shrink-0 text-sm text-stone-500">
                      {action.hint}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="border-t border-stone-200 px-5 py-3 text-sm text-stone-500">
          Use ↑ and ↓ to navigate, Enter to run, and Escape to close.
        </div>
      </dialog>
    </>
  );
}
