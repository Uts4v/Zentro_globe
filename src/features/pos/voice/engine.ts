/**
 * A serial speech queue: one announcement at a time, chime then speech.
 *
 * Every browser API here is wrapped and every failure path calls `done()`, so a
 * blocked or missing speech engine can only ever silence an announcement — it
 * can never stall the queue or bubble an error into the order/payment flow that
 * triggered it.
 */

import { playOrderChime } from "@/lib/audio";

export interface VoiceJob {
  text: string;
  /** Play the incoming-order chime before speaking. */
  chime: boolean;
  /** 0..1. */
  volume: number;
  /** speechSynthesis voiceURI; "" for the device default. */
  voiceURI: string;
}

/** Let the ~0.4s chime finish before the voice starts. */
const CHIME_LEAD_MS = 450;

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0.8;
  return Math.min(1, Math.max(0, volume));
}

export class VoiceEngine {
  private queue: VoiceJob[] = [];
  private busy = false;

  enqueue(job: VoiceJob): void {
    this.queue.push(job);
    this.drain();
  }

  /** Speak a one-off line (the settings "Test voice" button). */
  speakNow(text: string, volume: number, voiceURI: string): void {
    this.enqueue({ text, chime: false, volume, voiceURI });
  }

  cancel(): void {
    this.queue = [];
    try {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    } catch {
      // ignore
    }
  }

  private drain(): void {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    const finish = () => {
      this.busy = false;
      this.drain();
    };

    if (job.chime) playOrderChime(job.volume);
    const delay = job.chime ? CHIME_LEAD_MS : 0;

    setTimeout(() => {
      if (!job.text) {
        finish();
        return;
      }
      this.speak(job.text, job.volume, job.voiceURI, finish);
    }, delay);
  }

  private speak(text: string, volume: number, voiceURI: string, done: () => void): void {
    try {
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      const Utterance = typeof window !== "undefined" ? window.SpeechSynthesisUtterance : undefined;
      if (!synth || !Utterance) {
        done();
        return;
      }
      const utterance = new Utterance(text);
      utterance.volume = clampVolume(volume);
      if (voiceURI) {
        const voice = synth.getVoices().find((v) => v.voiceURI === voiceURI);
        if (voice) utterance.voice = voice;
      }
      utterance.onend = () => done();
      utterance.onerror = () => done();
      synth.speak(utterance);
    } catch {
      done();
    }
  }
}
