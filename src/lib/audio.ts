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

if (typeof window !== "undefined") {
  ["pointerdown", "keydown", "touchstart"].forEach((eventName) =>
    window.addEventListener(eventName, unlockAudio, { passive: true }),
  );
}

export function playOrderChime() {
  try {
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
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
