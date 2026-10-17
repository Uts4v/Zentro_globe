let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  try {
    if (!sharedContext) {
      sharedContext = new AudioContext();
    }
    return sharedContext;
  } catch {
    return null;
  }
}

function unlockAudio(): void {
  const ctx = getContext();
  if (ctx && ctx.state === "suspended") {
    void ctx.resume();
  }
}

// ── Sample playback (mp3) ───────────────────────────────────────────────────
// Merchant POS alerts use recorded sounds rather than synthesized beeps. Each
// file is wrapped in a single cached <audio> so repeat alerts reuse the same
// decoder, and the element is "primed" on the first user gesture so the
// browser autoplay policy lets later programmatic play() calls through.
export const WAITER_SOUND = "/sounds/waiter.mp3";
export const ORDER_NOTIFICATION_SOUND = "/sounds/order-notification.mp3";

const mediaElements = new Map<string, HTMLAudioElement>();
let mediaPrimed = false;

function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume));
}

function getMediaElement(src: string): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;
  let el = mediaElements.get(src);
  if (!el) {
    try {
      el = new Audio(src);
      el.preload = "auto";
      mediaElements.set(src, el);
    } catch {
      return null;
    }
  }
  return el;
}

function primeMedia(): void {
  if (mediaPrimed) return;
  mediaPrimed = true;
  mediaElements.forEach((el) => {
    const previous = el.volume;
    el.volume = 0;
    const played = el.play();
    if (played && typeof played.then === "function") {
      played
        .then(() => {
          el.pause();
          el.currentTime = 0;
          el.volume = previous;
        })
        .catch(() => {
          el.volume = previous;
        });
    }
  });
}

function playSample(src: string, volume: number): void {
  try {
    const el = getMediaElement(src);
    if (!el) return;
    el.volume = clampVolume(volume);
    el.currentTime = 0;
    const played = el.play();
    if (played && typeof played.catch === "function") {
      played.catch(() => {
        // Autoplay blocked before any user gesture — ignore.
      });
    }
  } catch {
    // Audio not available — ignore
  }
}

// A waiter call warrants a clearly distinct ringtone from ordinary order
// notifications, so the two use different samples.
export function playWaiterCallSound(volume = 0.7): void {
  playSample(WAITER_SOUND, volume);
}

export function playOrderNotificationSound(volume = 0.6): void {
  playSample(ORDER_NOTIFICATION_SOUND, volume);
}

if (typeof window !== "undefined") {
  // Pre-create the elements so they download ahead of the first alert.
  getMediaElement(WAITER_SOUND);
  getMediaElement(ORDER_NOTIFICATION_SOUND);
  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    window.addEventListener(eventName, unlockAudio, { passive: true });
    window.addEventListener(eventName, primeMedia, { passive: true });
  });
}

export function playOrderChime(volume = 0.3) {
  try {
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const level = Math.min(1, Math.max(0, volume));
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(level, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);
  } catch {
    // Audio not available — ignore
  }
}

export function playWaiterCallChime() {
  try {
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;

    [660, 880, 660].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + index * 0.16;

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.28, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.13);
      oscillator.start(start);
      oscillator.stop(start + 0.13);
    });
  } catch {
    // Audio not available or blocked — ignore
  }
}
