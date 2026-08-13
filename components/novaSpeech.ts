/**
 * NOVA'S VOICE — Kokoro-82M (Apache-2.0) synthesised entirely in the browser
 * via kokoro-js → transformers.js → onnxruntime-web. No API, no key, no
 * server round-trip: the q8 ONNX weights (~50-90MB) download once from the
 * Hugging Face CDN and then live in the browser's Cache API, so every later
 * visit is offline-fast.
 *
 * Load discipline: nothing in this module touches kokoro-js at import time —
 * the only reference is the dynamic import() inside load(), which webpack
 * splits into its own async chunk. A visitor who never taps VOICE downloads
 * none of it. Keep it that way: no top-level `import ... from "kokoro-js"`,
 * and no `import type` either (that's free, but it invites the value import).
 *
 * Caller contract, in order:
 *   1. unlock() — MUST run synchronously inside the tap handler. An
 *      AudioContext constructed outside a user gesture starts suspended and
 *      plays nothing, silently.
 *   2. load(onProgress) — idempotent; safe to call again after a failure
 *      (a rejected load clears the singleton so the next tap retries).
 *   3. speak(text) / speakText(text, handlers) — one synthesis at a time;
 *      a newer call invalidates the older one's audio (and cancels anyone
 *      else's in-flight synthesis) rather than queueing behind it. Both are
 *      the same streaming engine underneath — speak() is a promise-shaped
 *      wrapper kept for Nova's caption; speakText() is the callback-shaped
 *      form the approval queue's per-card LISTEN buttons use, since each
 *      card needs to track loading/generating/playing independently rather
 *      than racing a single shared promise across repeated taps.
 *   4. stop() — kills in-flight synthesis AND anything currently playing.
 *
 * Every consumer shares this one module-level singleton, so starting
 * playback anywhere (Nova's caption or any draft card) stops whatever else
 * was talking — that's the point, not a bug.
 */

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// af_heart — American female, the only preset Kokoro grades A overall (af_bella
// is the A- runner-up and a drop-in swap here). Deliberately NOT af_nova: the
// name fits, the voice doesn't — Kokoro grades it C.
const VOICE = "af_heart";

// q8 on wasm: ~4x smaller than fp32 and the only combination that is reliably
// available everywhere. WebGPU (which needs fp32) is intentionally not
// probed — the detection is easy but the failure modes on half-working
// implementations are not, and a voice that works is worth more than one
// that's occasionally faster.
const DTYPE = "q8" as const;
const DEVICE = "wasm" as const;

/** Shape of kokoro-js's RawAudio, kept structural so no type import is needed. */
interface RawAudioLike {
  audio: Float32Array;
  sampling_rate: number;
}

/**
 * Shape of kokoro-js's TextSplitterStream, kept structural like RawAudioLike
 * above. We construct and own one of these per speakText() call instead of
 * handing tts.stream() a plain string — see the comment on SplitterCtor for
 * why that distinction is load-bearing, not stylistic.
 */
interface TextSplitterStreamLike {
  push(...text: string[]): void;
  close(): void;
}

interface TtsLike {
  stream(
    input: TextSplitterStreamLike,
    options: { voice: string; speed?: number }
  ): AsyncGenerator<{ text: string; phonemes: string; audio: RawAudioLike }, void, void>;
}

let ttsPromise: Promise<TtsLike> | null = null;

// Set alongside ttsPromise inside load(). kokoro-js's own tts.stream(text)
// — when handed a plain string instead of a TextSplitterStream instance —
// builds one internally but NEVER calls .close() on it (verified against
// the vendored dist/kokoro.js). TextSplitterStream deliberately withholds
// the trailing sentence in its buffer until close()→flush() confirms no
// more text is coming (it can't otherwise tell "Mr." mid-buffer from a real
// sentence end), and its async iterator blocks forever awaiting a resolver
// that only push()/close() can trigger. Handing kokoro-js a raw string
// therefore means tts.stream() hangs after its last chunk on EVERY call,
// not just when interrupted — which then also permanently wedges our
// `chain`, since a call that never resolves blocks every later caller
// queued behind it via chain.catch().then(...). Owning the splitter
// ourselves and closing it immediately after one push (we never stream text
// incrementally — the whole draft/caption is known up front) makes
// tts.stream() terminate deterministically once every sentence has been
// synthesised and yielded.
let SplitterCtor: (new () => TextSplitterStreamLike) | null = null;
let ctx: AudioContext | null = null;

// Every AudioBufferSourceNode currently scheduled or playing for the active
// speaker — plural because streaming schedules several sentence-chunks back
// to back (see streamPlay), unlike the old one-shot generate() which only
// ever had a single node in flight.
let scheduled: AudioBufferSourceNode[] = [];

// Monotonic token: every stop() (and every speak(), which stops first) bumps
// it, so any synthesis still running against an older token discards its
// result instead of talking over the current line.
let token = 0;

// The handlers of whichever session currently owns `token`, if any. Exists
// so stop() can notify the OUTGOING session's onEnd synchronously, the
// instant it's superseded — see stop()'s comment for why that's not
// optional. Cleared (a) by stop(), right after notifying it, and (b) by the
// session itself on its own natural onEnd/onError, so a later stop() never
// double-notifies a session that already finished on its own.
let activeHandlers: SpeakHandlers | null = null;

// Synthesis is serialised through this chain — onnxruntime-web on wasm does
// not like concurrent sessions, and two overlapping lines would be wrong
// anyway. Always re-chained through .catch so one failure can't poison it.
// Note this only serialises the actual model calls, not the UI-visible
// "who's speaking" state — stop() updates that independently, and
// immediately (see stop()).
let chain: Promise<unknown> = Promise.resolve();

/**
 * Create/resume the AudioContext. Call from inside the tap handler, before
 * any await — iOS Safari in particular only unlocks audio for a context
 * touched during the gesture itself.
 */
export function unlock(): boolean {
  if (typeof window === "undefined") return false;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return false;
  try {
    if (!ctx) ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return true;
  } catch {
    return false;
  }
}

/**
 * Download + instantiate the model. `onProgress` gets an integer 0-100
 * aggregated across every file transformers.js reports; already-cached files
 * emit no progress events at all, so a warm load jumps straight to done —
 * the UI label has to tolerate that.
 */
export function load(onProgress?: (percent: number) => void): Promise<TtsLike> {
  if (ttsPromise) return ttsPromise;

  const files = new Map<string, { loaded: number; total: number }>();
  const report = (file: string, loaded: number, total: number) => {
    if (!Number.isFinite(total) || total <= 0) return;
    files.set(file, { loaded, total });
    let done = 0;
    let all = 0;
    for (const f of files.values()) {
      done += f.loaded;
      all += f.total;
    }
    if (all > 0) onProgress?.(Math.min(99, Math.floor((done / all) * 100)));
  };

  ttsPromise = (async () => {
    const { KokoroTTS, TextSplitterStream } = await import("kokoro-js");
    SplitterCtor = TextSplitterStream as unknown as new () => TextSplitterStreamLike;
    const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: DTYPE,
      device: DEVICE,
      progress_callback: (p: unknown) => {
        const e = p as { status?: string; file?: string; loaded?: number; total?: number };
        if (e?.status === "progress" && e.file) report(e.file, e.loaded ?? 0, e.total ?? 0);
      },
    });
    onProgress?.(100);
    return tts as unknown as TtsLike;
  })();

  // Clear the singleton on failure so a second tap is a real retry rather
  // than a replay of the same rejected promise.
  ttsPromise.catch(() => {
    ttsPromise = null;
  });

  return ttsPromise;
}

/** True once the model is instantiated — used to skip the LOADING label. */
export function isLoaded(): boolean {
  return ttsPromise !== null;
}

// Session-scoped "she is currently speaking aloud" flag, kept here rather
// than in component state because the toggle unmounts whenever a calibration
// card takes the stage. Restoring from it needs no new gesture and no new
// download — the AudioContext is already unlocked and the model already
// resident. Deliberately NOT persisted: a reload gets a silent Nova.
let active = false;

export function isActive(): boolean {
  return active;
}

export function setActive(value: boolean): void {
  active = value;
}

export interface SpeakHandlers {
  /** Fires once the first chunk of audio actually begins playing. */
  onStart?: () => void;
  /**
   * Fires when playback finishes naturally, OR when this call was
   * invalidated by a newer stop()/speak()/speakText() before or while it
   * played. Callers that track "am I still the active speaker" should treat
   * either case the same way: you're done, go idle — that's what makes the
   * "one speaker at a time" rule visible in the UI (e.g. card A's LISTEN
   * button reverting the instant card B starts).
   */
  onEnd?: () => void;
  /** Fires only on a genuine synthesis failure — never on being superseded. */
  onError?: (err: unknown) => void;
}

/**
 * Speak `text` once, streaming sentence-by-sentence via kokoro-js's own
 * splitter (tts.stream) rather than one generate() call for the whole
 * string. For a short caption line that's a wash — one sentence, one chunk
 * — but for a long draft body it's the difference between talking almost
 * immediately and sitting silent for the seconds it takes to synthesise an
 * entire LinkedIn post. Chunks are scheduled back-to-back on the shared
 * AudioContext as they arrive, so playback of chunk N and synthesis of
 * chunk N+1 overlap instead of serialising.
 *
 * Supersedes anything in flight, including Nova's caption — see stop().
 * Callback-driven rather than promise-driven: see speak() below for the
 * promise-shaped wrapper.
 */
export function speakText(text: string, handlers?: SpeakHandlers): void {
  const line = text.trim();
  stop(); // synchronously notifies whoever we're superseding — see stop()
  if (!line) {
    handlers?.onEnd?.();
    return;
  }

  const mine = token;
  // We're the active session now — stop() (ours or a later call's) is what
  // notifies us going forward, synchronously, whenever we stop being it.
  activeHandlers = handlers ?? null;
  const next = chain.catch(() => {}).then(async () => {
    // If we've since been superseded (another call landed while we were
    // still queued behind a prior synthesis), that supersede's stop() has
    // already notified us via activeHandlers — don't notify twice, just
    // stop quietly. Mirrors the two-gate check the old single-shot speak()
    // used, minus the now-redundant onEnd calls.
    if (mine !== token) return;
    let tts: TtsLike;
    try {
      tts = await load();
    } catch (err) {
      if (mine === token) {
        activeHandlers = null;
        handlers?.onError?.(err);
      }
      return;
    }
    if (mine !== token) return;
    await streamPlay(tts, line, mine, handlers);
  });
  chain = next;
}

/**
 * Speak `text` once via the same streaming engine, promise-shaped for
 * Nova's caption (which only ever does `.catch()` on it — see Nova.tsx).
 * Resolves as soon as playback starts, or immediately if the line was empty
 * or the call was superseded before it got that far; rejects only on a
 * genuine synthesis failure, so the caller can surface UNAVAILABLE.
 */
export function speak(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    speakText(text, { onStart: resolve, onEnd: resolve, onError: reject });
  });
}

/**
 * Stop playback, invalidate any synthesis still running, AND notify the
 * outgoing session's onEnd synchronously, right now — rather than leaving it
 * to its own streamPlay loop, which only gets to check the token between
 * sentence-chunks. On slow hardware (or mid a long sentence) that check can
 * be seconds away, which would otherwise leave a just-superseded card
 * showing PLAYING long after it's actually gone silent (its audio nodes
 * below stop immediately either way — this is what keeps the UI honest
 * about it). The old synthesis itself is deliberately left running in the
 * background to complete or fail on its own rather than force-cancelled:
 * kokoro-js/onnxruntime-web has no mid-inference cancellation hook, and
 * tearing down shared state mid-run risks corrupting the one wasm session
 * (see `chain`'s comment) far more than a wasted sentence of CPU does. Its
 * loop still checks `mine !== token` before scheduling any further audio,
 * so none of that background work is ever heard.
 */
export function stop(): void {
  token += 1;
  const outgoing = activeHandlers;
  activeHandlers = null;
  outgoing?.onEnd?.();
  const sources = scheduled;
  scheduled = [];
  for (const src of sources) {
    try {
      src.onended = null;
      src.stop();
    } catch {
      /* already ended — stop() on a finished source throws in some engines */
    }
    try {
      src.disconnect();
    } catch {
      /* nothing connected */
    }
  }
}

/**
 * Pull chunks off tts.stream() and schedule each one to start exactly when
 * the previous one ends (or immediately, if synthesis is running behind
 * realtime and there's nothing left playing) — a manually-managed gapless
 * queue, since Web Audio has no built-in notion of "play these buffers back
 * to back as they show up."
 */
async function streamPlay(tts: TtsLike, text: string, mine: number, handlers?: SpeakHandlers): Promise<void> {
  const c = ctx;
  if (!c) {
    activeHandlers = null; // no await has happened yet — mine === token is guaranteed here
    handlers?.onError?.(new Error("no audio context"));
    return;
  }
  if (!SplitterCtor) {
    // Can't happen in practice — load() always sets this before resolving —
    // but guard rather than hand kokoro-js's stream() a bare string, which
    // is exactly the path that hangs forever (see SplitterCtor's comment).
    activeHandlers = null;
    handlers?.onError?.(new Error("speech splitter not ready"));
    return;
  }
  // Own the splitter and close it immediately: we always hand over the
  // whole text up front (never incrementally), so there's nothing to wait
  // for. Closing now — rather than leaving kokoro-js to build-and-never-
  // close its own internal one — is the actual fix for the hang described
  // on SplitterCtor above: it lets the async iterator below terminate once
  // every sentence has been synthesised, instead of blocking forever after
  // the last one.
  const splitter = new SplitterCtor();
  splitter.push(text);
  splitter.close();

  // Backgrounding a tab can re-suspend an already-unlocked context; resuming
  // is allowed here because the original unlock came from a real gesture.
  if (c.state === "suspended") void c.resume();

  let cursor = c.currentTime;
  let started = false;
  let pending = 0; // chunks scheduled or playing, not yet ended
  let generatorDone = false;

  const maybeEnd = () => {
    if (generatorDone && pending === 0 && mine === token) {
      activeHandlers = null;
      handlers?.onEnd?.();
    }
  };

  try {
    for await (const chunk of tts.stream(splitter, { voice: VOICE })) {
      // Already superseded — stop()'s synchronous notification already told
      // the caller we're done (see stop()); just stop scheduling audio and
      // let this loop (and the background synthesis feeding it) run out
      // quietly rather than notify a second time.
      if (mine !== token) return;
      const raw = chunk.audio;
      if (!raw?.audio?.length) continue;
      // Kokoro emits 24kHz mono; createBuffer accepts the odd rate and the
      // browser resamples to the context rate on playback.
      const buffer = c.createBuffer(1, raw.audio.length, raw.sampling_rate);
      buffer.getChannelData(0).set(raw.audio);
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(c.destination);
      const startAt = Math.max(cursor, c.currentTime);
      src.start(startAt);
      cursor = startAt + buffer.duration;
      scheduled.push(src);
      pending += 1;
      src.onended = () => {
        const i = scheduled.indexOf(src);
        if (i !== -1) scheduled.splice(i, 1);
        pending -= 1;
        maybeEnd();
      };
      if (!started) {
        started = true;
        handlers?.onStart?.();
      }
    }
  } catch (err) {
    // If we'd already been superseded when the stream threw, that's not our
    // failure to report, and stop() already notified the caller — nothing
    // left to do. Otherwise stop() first so a mid-stream failure (some
    // chunks already scheduled and audibly playing) doesn't keep talking
    // underneath an UNAVAILABLE label.
    if (mine === token) {
      activeHandlers = null;
      stop();
      handlers?.onError?.(err);
    }
    return;
  }
  generatorDone = true;
  maybeEnd(); // covers both "already all ended" and "zero playable chunks"
}
