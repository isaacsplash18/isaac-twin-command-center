"use client";

import { useEffect, useRef, useState } from "react";
import { isActive, isLoaded, load, setActive, speak, stop, unlock } from "./novaSpeech";

/**
 * NOVA — the twin's face: a holographic video (public/nova-hologram.mp4) of
 * her floating in a dark command center. The clip's own background is
 * opaque and dark, but the page ground is light, so the wrapper carries a
 * feathered mask (a tall, figure-biased radial ellipse + a heavier bottom
 * fade) that dissolves her edges into the ground on every side — no card,
 * no frame, no visible rectangle — same trick the old alpha-cutout portrait
 * used, just driven by a mask gradient instead of the PNG's own alpha
 * channel. She breathes gently, blooms oxblood on Approve and shudders red
 * on failure. Pure CSS/DOM — no canvas, no deps, no video processing (the
 * clip itself stays fully opaque and untouched).
 *
 * Playback: on every fresh page load the clip plays through once in full,
 * then settles into a short idle loop over just its final TAIL_SECONDS —
 * her "breathing" end state — for as long as the page stays open. See the
 * playback effect below for the intro→tail state machine.
 */

const OXBRIGHT = "166,27,28";

// One-number tweak for how much of the tail end-state loops after the
// intro playthrough finishes. Kept at a couple of seconds rather than a
// fraction of one — a sub-second tail means the decoder re-seeks twice a
// second, which stutters on mobile.
const TAIL_SECONDS = 2;

export type NovaMood = "praise" | "sass" | "neutral";

export function Nova({ mood, line, onToast }: { mood: NovaMood; line: string; onToast?: (message: string) => void }) {
  const [reduced, setReduced] = useState(false);
  const figureRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mql.matches);
  }, []);

  // Reduced motion: hold on a single frame instead of autoplaying — never
  // blank, just static. Seek to the tail end-state (where the animated
  // version comes to rest) rather than the opening frame, so both modes
  // agree on what "settled" looks like. Guard duration — it's NaN until
  // metadata loads.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !reduced) return;
    v.pause();
    const onMeta = () => {
      v.currentTime = Number.isFinite(v.duration) && v.duration > 0 ? Math.max(0, v.duration - 0.05) : 0.1;
    };
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [reduced]);

  // Intro-then-tail playback: play the full clip once on load, then loop
  // only its final TAIL_SECONDS forever. `loop` is intentionally not set on
  // the <video> — looping is entirely hand-rolled below so the intro plays
  // exactly once per mount (i.e. per page load — not gated behind
  // sessionStorage). Skipped under reduced motion, which has its own static
  // effect above.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || reduced) return;

    let tailing = false;
    let rvfcHandle: number | null = null;

    // Feature-check via typeof rather than a bare truthiness check —
    // `requestVideoFrameCallback`/`fastSeek` are typed as always-present on
    // HTMLVideoElement in this lib snapshot, but real-world support (older
    // Safari, some WebViews) still varies.
    const supportsRVFC = typeof v.requestVideoFrameCallback === "function";
    const supportsFastSeek = typeof v.fastSeek === "function";

    const seek = (t: number) => {
      if (supportsFastSeek) v.fastSeek(t);
      else v.currentTime = t;
    };

    const tailStart = () => (Number.isFinite(v.duration) && v.duration > 0 ? Math.max(0, v.duration - TAIL_SECONDS) : null);

    // Seek back once we're within EPSILON of the end rather than waiting on
    // another `ended` — `ended` only fires after the last frame has already
    // sat on screen, which would visibly stall the loop.
    const EPSILON = 0.03;
    const maybeLoopTail = () => {
      const start = tailStart();
      if (start === null) return;
      if (v.currentTime >= v.duration - EPSILON) seek(start);
    };

    const onTimeUpdate = () => {
      if (tailing) maybeLoopTail();
    };

    const scheduleFrame = () => {
      if (!tailing || !supportsRVFC) return;
      rvfcHandle = v.requestVideoFrameCallback(() => {
        maybeLoopTail();
        scheduleFrame();
      });
    };

    const enterTail = () => {
      tailing = true;
      const start = tailStart();
      if (start !== null) seek(start);
      v.play().catch(() => {
        /* autoplay blocked — element still holds the seeked-to frame */
      });
      if (supportsRVFC) scheduleFrame();
    };

    v.addEventListener("ended", enterTail);
    // Both loop-back drivers are attached unconditionally (not either/or):
    // rVFC is the precise one — tight, frame-accurate seek-back — but it can
    // go quiet in some real environments (background tabs, some WebViews,
    // headless/preview contexts that suspend video) without any error, which
    // would otherwise leave the clip frozen on its last frame forever.
    // `timeupdate` is a coarser (~4/sec) backstop that still catches the
    // seek-back within one epsilon-sized window. Both funnel through the same
    // `maybeLoopTail` guard, and the guard is idempotent: once the seek-back
    // fires, `currentTime` drops below `duration - EPSILON`, so whichever
    // handler fires second on the same frame is a no-op.
    v.addEventListener("timeupdate", onTimeUpdate);
    v.play().catch(() => {
      /* autoplay blocked — element still shows a decoded frame, not blank */
    });

    return () => {
      v.removeEventListener("ended", enterTail);
      v.removeEventListener("timeupdate", onTimeUpdate);
      if (rvfcHandle !== null && supportsRVFC) v.cancelVideoFrameCallback(rvfcHandle);
    };
  }, [reduced]);

  // Base holographic glow by mood; pulses layer on top. Kept restrained — a
  // rim halo, not a red field (oxblood is the scarcity accent).
  const baseGlow = mood === "praise" ? 0.22 : mood === "sass" ? 0.04 : 0.08;

  useEffect(() => {
    const fig = figureRef.current;
    if (!fig) return;

    let glow = baseGlow;
    let glowTarget = baseGlow;
    let redUntil = 0;
    let shudderUntil = 0;
    let raf = 0;

    const onPulse = (e: Event) => {
      const kind = (e as CustomEvent).detail;
      const now = performance.now();
      if (kind === "approve") glowTarget = 1;
      else if (kind === "error") {
        redUntil = now + 800;
        shudderUntil = now + 600;
        glowTarget = 1;
      }
    };
    window.addEventListener("twin-pulse", onPulse);

    // No cursor-driven tilt here — just the mood glow and the error shudder.
    // A perspective/rotateY transform was removed on purpose: it made the
    // whole figure read as a rigid slab tilting toward the pointer (the
    // "plate" look), which fought the feathered, edgeless framing below.
    const apply = (glowV: number, red: boolean, shudder: number) => {
      const rgb = red ? "220,40,40" : OXBRIGHT;
      fig.style.filter = `drop-shadow(0 0 ${10 + 20 * glowV}px rgba(${rgb},${0.1 + 0.35 * glowV}))`;
      fig.style.transform = `translateX(${shudder}px)`;
    };

    const tick = (t: number) => {
      glowTarget += (baseGlow - glowTarget) * 0.04;
      glow += (glowTarget - glow) * 0.12;
      const red = t < redUntil;
      const shudder = t < shudderUntil ? (Math.random() - 0.5) * 5 : 0;
      apply(glow, red, shudder);
      raf = requestAnimationFrame(tick);
    };
    if (reduced) apply(baseGlow, false, 0);
    else raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("twin-pulse", onPulse);
    };
  }, [baseGlow, reduced]);

  // Feathered mask: a tall, figure-biased radial ellipse centered on her
  // upper body reaches full transparency well before the frame edges, so no
  // straight edge or corner ever shows — she dissolves into the ground
  // instead of sitting inside a frame. Intersected with a top-to-bottom
  // gradient whose fade starts around the midpoint, giving the bottom a
  // heavier melt so the calibration card in NovaStage overlaps a soft
  // dissolve rather than a video edge. Cropped loosely enough that her head
  // and shoulders are never clipped — only the empty dark margins vanish.
  const featherMask =
    "linear-gradient(to bottom, transparent 0%, black 12%, black 46%, transparent 86%)," +
    "radial-gradient(ellipse 70% 84% at 50% 40%, black 52%, transparent 96%)";

  return (
    <div className="flex w-full flex-col items-center">
      <div
        ref={figureRef}
        className="relative w-full"
        style={{
          // Fluid width — fills whatever box she's given (full-bleed on
          // mobile, the centre grid column on desktop) instead of a capped
          // pixel size. Height rides the clip's portrait crop via
          // aspect-ratio — 1:0.92, i.e. the original 1:1.15 box shrunk 20%
          // shorter so the bottom fifth of the clip's content is cropped off
          // (see the <video> below for how — a naive box shrink alone would
          // just crop the sides, since cover here is height-driven). The
          // feather mask is percentage-based and scales with the box, so it
          // needs no retuning. Capped at 90vh so a very wide desktop column
          // doesn't produce an absurdly tall figure; object-fit:cover on the
          // video means the cap never distorts or letterboxes her.
          aspectRatio: "1 / 0.92",
          maxHeight: "90vh",
          willChange: "transform, filter",
        }}
      >
        <div
          className="h-full w-full"
          style={reduced ? undefined : { animation: "nova-breathe 6s ease-in-out infinite" }}
        >
          <div
            className="relative h-full w-full overflow-hidden"
            style={{
              WebkitMaskImage: featherMask,
              maskImage: featherMask,
              WebkitMaskComposite: "source-in",
              maskComposite: "intersect",
            }}
          >
            <video
              ref={videoRef}
              // Sized to 125% of the (now 20%-shorter) box height, not
              // inset-0/h-full: at 125% of a 0.92-ratio box this element is
              // exactly the same height cover would have rendered against
              // the old 1.15-ratio box (1.25 × 0.92 = 1.15), so cover's
              // framing inside the element is pixel-identical to before —
              // nothing re-crops the sides. Pinned to the wrapper's top edge
              // with overflow-hidden on the wrapper clipping the rest: that
              // clips exactly the bottom 20% of this element, i.e. the
              // bottom fifth of the previously-visible content, off the
              // bottom. object-position stays centered — the element itself
              // holds the old framing, so no repositioning is needed inside
              // it.
              className="absolute left-0 top-0 w-full"
              style={{ height: "125%", objectFit: "cover", objectPosition: "center" }}
              src="/nova-hologram.mp4"
              muted
              playsInline
              autoPlay={!reduced}
              preload="auto"
              aria-label="Nova — the twin's holographic presence"
            />
            {/* deepen into the ground at the very bottom — matches the page
                ground token so she fades into the actual surface, not a
                hardcoded dark patch (breaks if the theme's ground colour
                changes); layers under the mask's own fade for a longer melt
                where the calibration card overlaps. */}
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(to bottom, transparent 55%, var(--color-ground) 96%)" }}
            />
            {/* faint oxblood rim light, restrained so it reads as a glow
                accent over the hologram's own cyan/teal shading */}
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(105deg, rgba(${OXBRIGHT},0.1) 0%, rgba(${OXBRIGHT},0) 26%)`,
                mixBlendMode: "screen",
              }}
            />
          </div>
        </div>

        {/* speaking overlay — sits above the video, outside the feather
            mask, so the caption stays crisp as she "speaks" it. Hidden
            entirely while a calibration question card is up (line is blank
            then; the card is her voice at that point), which also parks the
            VOICE toggle: it would otherwise sit under the card, and there is
            nothing to speak anyway. Column anchored by its BOTTOM edge, so
            the caption rides up above the toggle rather than the toggle
            drifting down into the fade. */}
        {line.trim() !== "" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[9%] z-10 flex flex-col items-center gap-1.5 px-6">
            <NovaCaption line={line} />
            <NovaVoiceToggle line={line} onToast={onToast} />
          </div>
        )}
      </div>

      <style>{`@keyframes nova-breathe {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
      }`}</style>
    </div>
  );
}

/**
 * Typed speech line, overlaid directly on the lower video — like she's
 * speaking it, not a caption underneath the image. A dark scrim keeps the
 * mono text legible over her. Only mounted when there IS a line — the
 * calibration card takes over as her voice while a question is up.
 */
function NovaCaption({ line }: { line: string }) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(line);
      return;
    }
    setTyped("");
    let i = 0;
    const id = setInterval(() => {
      i += 2;
      setTyped(line.slice(0, i));
      if (i >= line.length) clearInterval(id);
    }, 18);
    return () => clearInterval(id);
  }, [line]);

  return (
    /* A self-contained caption chip, not a scrim bleeding across the box —
       she's a floating hologram now (feathered edges), so anything wider
       than the text itself would show as a stray rectangle rather than
       blending into the video edge. Colour pinned to Splash "clay"
       regardless of the page theme, since this chip is deliberately dark
       — she's a lit screen, like captions on a video. */
    <p
      className="relative max-w-[88%] rounded px-3 py-1.5 text-center font-mono text-[11px] leading-relaxed tracking-wider text-[#e8e8e3]"
      style={{ background: "rgba(6,7,8,0.82)" }}
    >
      <span className="text-oxbright">NOVA //</span> {typed}
      <span className="animate-pulse text-oxbright">▍</span>
    </p>
  );
}

const VOICE_PREF_KEY = "nova-voice";

type VoiceState = "off" | "loading" | "on" | "error";

/**
 * VOICE toggle — opt-in, never automatic. Kokoro-82M is a ~50-90MB download
 * and browsers block un-gestured audio anyway, so the only way she ever
 * speaks is a deliberate tap.
 *
 * The preference is remembered, but a remembered preference does NOT
 * auto-resume on load: it only changes the resting label from VOICE to
 * VOICE · MUTED. Auto-resuming would mean either an unprompted 50MB fetch or
 * an AudioContext created outside a gesture that plays nothing — both worse
 * than one extra tap.
 */
function NovaVoiceToggle({ line, onToast }: { line: string; onToast?: (message: string) => void }) {
  // Lazy initial state, not a plain "off": this component unmounts every time
  // a calibration card takes the stage, and coming back muted after the card
  // clears would read as a bug. Safe for hydration — `active` is false on the
  // server and on the first client render alike; it can only be true on a
  // re-mount, which is client-only by then.
  const [state, setState] = useState<VoiceState>(() => (isActive() && isLoaded() ? "on" : "off"));
  const [percent, setPercent] = useState(0);
  const [remembered, setRemembered] = useState(false);
  // Guards a load() that resolves after the user has already tapped off —
  // without it, a slow download would switch her on minutes later.
  const attempt = useRef(0);

  useEffect(() => {
    try {
      setRemembered(window.localStorage.getItem(VOICE_PREF_KEY) === "1");
    } catch {
      /* private mode / storage disabled — just don't remember */
    }
  }, []);

  // Speak the full prop line, not the typewriter's partial text, and once per
  // line — not per keystroke. Cleanup runs before the next line and on
  // unmount (i.e. when a calibration card takes over), cutting audio dead.
  useEffect(() => {
    if (state !== "on") return;
    if (!line.trim()) return;
    let live = true;
    speak(line).catch(() => {
      if (!live) return;
      setActive(false);
      setState("error");
      onToast?.("VOICE FAILED — SYNTHESIS ERROR ON THIS DEVICE");
    });
    return () => {
      live = false;
      stop();
    };
  }, [state, line, onToast]);

  const remember = (wants: boolean) => {
    try {
      window.localStorage.setItem(VOICE_PREF_KEY, wants ? "1" : "0");
    } catch {
      /* storage unavailable — the toggle still works for this session */
    }
    setRemembered(wants);
  };

  const toggle = () => {
    if (state === "on" || state === "loading") {
      attempt.current += 1; // cancels an in-flight load
      stop();
      setActive(false);
      setState("off");
      remember(false);
      return;
    }

    // Synchronous, before any await: iOS only unlocks a context touched
    // during the gesture itself. No Web Audio at all means no voice — say so
    // rather than sitting on a cheerful ON that never makes a sound.
    if (!unlock()) {
      setActive(false);
      setState("error");
      onToast?.("VOICE UNAVAILABLE — NO AUDIO SUPPORT IN THIS BROWSER");
      return;
    }
    remember(true);
    const mine = (attempt.current += 1);

    // A warm cache (model already instantiated this session) skips the
    // LOADING label entirely rather than flashing 0% for a frame.
    if (!isLoaded()) {
      setPercent(0);
      setState("loading");
    }
    load(setPercent)
      .then(() => {
        if (attempt.current !== mine) return;
        setActive(true);
        setState("on");
      })
      .catch(() => {
        if (attempt.current !== mine) return;
        setActive(false);
        setState("error");
        onToast?.("VOICE UNAVAILABLE — MODEL COULD NOT LOAD ON THIS DEVICE");
      });
  };

  const label =
    state === "loading"
      ? `VOICE · LOADING ${percent}%`
      : state === "on"
        ? "VOICE · ON"
        : state === "error"
          ? "VOICE · UNAVAILABLE"
          : remembered
            ? "VOICE · MUTED"
            : "VOICE";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={state === "on"}
      aria-label={state === "on" ? "Mute Nova's voice" : "Give Nova a voice"}
      // pointer-events-auto: the overlay column above is pointer-events-none
      // so the caption never eats taps meant for the hologram.
      className={`pointer-events-auto flex min-h-11 items-center px-2 font-mono text-[11px] tracking-[0.1em] transition-colors sm:min-h-0 sm:py-1 ${
        state === "on" ? "text-oxbright" : state === "error" ? "text-ink-dim/60" : "text-ink-dim hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
