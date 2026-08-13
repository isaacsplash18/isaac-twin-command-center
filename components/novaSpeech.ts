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
 *   3. speak(text) — one synthesis at a time; a newer call invalidates the
 *      older one's audio rather than queueing it up behind it.
 *   4. stop() — kills in-flight synthesis AND anything currently playing.
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

interface TtsLike {
  generate(text: string, options: { voice: string; speed?: number }): Promise<RawAudioLike>;
}

let ttsPromise: Promise<TtsLike> | null = null;
let ctx: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;

// Monotonic token: every stop() (and every speak(), which stops first) bumps
// it, so any synthesis still running against an older token discards its
// result instead of talking over the current line.
let token = 0;

// Synthesis is serialised through this chain — onnxruntime-web on wasm does
// not like concurrent sessions, and two overlapping lines would be wrong
// anyway. Always re-chained through .catch so one failure can't poison it.
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
    const { KokoroTTS } = await import("kokoro-js");
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

/**
 * Speak `text` once. Supersedes anything in flight. Resolves when playback
 * has *started* (not finished) or when the request was superseded; rejects
 * only if synthesis itself failed, so the caller can surface UNAVAILABLE.
 */
export function speak(text: string): Promise<void> {
  const line = text.trim();
  stop();
  if (!line) return Promise.resolve();

  const mine = token;
  const next = chain.catch(() => {}).then(async () => {
    // Two gates, not one: the first catches a toggle-off while the previous
    // synthesis was still running, the second catches a line change during
    // our own synthesis.
    if (mine !== token) return;
    const tts = await load();
    if (mine !== token) return;
    const audio = await tts.generate(line, { voice: VOICE });
    if (mine !== token) return;
    play(audio);
  });
  chain = next;
  return next;
}

/** Stop playback and invalidate any synthesis still running. */
export function stop(): void {
  token += 1;
  const src = playing;
  playing = null;
  if (!src) return;
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

function play(raw: RawAudioLike): void {
  const c = ctx;
  if (!c || !raw?.audio?.length) return;
  // Backgrounding a tab can re-suspend an already-unlocked context; resuming
  // is allowed here because the original unlock came from a real gesture.
  if (c.state === "suspended") void c.resume();
  // Kokoro emits 24kHz mono; createBuffer accepts the odd rate and the
  // browser resamples to the context rate on playback.
  const buffer = c.createBuffer(1, raw.audio.length, raw.sampling_rate);
  buffer.getChannelData(0).set(raw.audio);
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.connect(c.destination);
  src.onended = () => {
    if (playing === src) playing = null;
  };
  playing = src;
  src.start();
}
