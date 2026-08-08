import { SOUNDS, type SoundId } from "./sounds";
import { LOOP_SECONDS, scheduleLoop } from "./music";

/**
 * Audio front end: one context, two buses, and a scheduler that keeps the
 * music loop topped up.
 *
 * Browsers refuse to start audio before the user has interacted with the
 * page, so the context is created lazily on the first click or key press and
 * everything before that is silently dropped.
 */

const STORAGE_KEY = "aw:audio";

interface Settings {
  muted: boolean;
  music: boolean;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) return { muted: false, music: true, ...JSON.parse(raw) };
  } catch {
    // A blocked or corrupt localStorage is not a reason to run without sound.
  }
  return { muted: false, music: true };
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  private settings = loadSettings();
  private musicUntil = 0;
  private musicTimer: number | null = null;
  /** Guards against a burst of identical sounds stacking into a click. */
  private readonly lastPlayed = new Map<SoundId, number>();

  get muted(): boolean {
    return this.settings.muted;
  }

  get musicEnabled(): boolean {
    return this.settings.music;
  }

  /**
   * Bring the context up. Safe to call on every gesture; only the first one
   * does anything.
   */
  unlock(): void {
    if (this.ctx === null) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor === undefined) return;
      this.ctx = new Ctor();

      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 1;
      this.sfxBus.connect(this.master);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.settings.music ? 1 : 0;
      this.musicBus.connect(this.master);

      this.pumpMusic();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  play(id: SoundId, options: { minGap?: number } = {}): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (ctx === null || bus === null || this.settings.muted) return;

    // Repeated cursor blips inside one frame would sum into a spike, so a
    // sound can refuse to retrigger too soon after itself.
    const gap = options.minGap ?? 0.03;
    const previous = this.lastPlayed.get(id) ?? -Infinity;
    if (ctx.currentTime - previous < gap) return;
    this.lastPlayed.set(id, ctx.currentTime);

    SOUNDS[id](ctx, bus, ctx.currentTime + 0.01);
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    this.persist();
    if (this.master !== null && this.ctx !== null) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
  }

  setMusic(enabled: boolean): void {
    this.settings.music = enabled;
    this.persist();
    if (this.musicBus !== null && this.ctx !== null) {
      this.musicBus.gain.setTargetAtTime(enabled ? 1 : 0, this.ctx.currentTime, 0.15);
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Not being able to remember the preference is harmless.
    }
  }

  /**
   * Keep roughly one loop of music queued ahead of the playhead. Scheduling
   * the whole thing up front would make a mute or a tab switch take a full
   * loop to take effect.
   */
  private pumpMusic(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (ctx === null || bus === null) return;

    if (this.musicUntil < ctx.currentTime + 0.5) {
      this.musicUntil = Math.max(this.musicUntil, ctx.currentTime + 0.15);
    }
    while (this.musicUntil < ctx.currentTime + LOOP_SECONDS) {
      this.musicUntil = scheduleLoop(ctx, bus, this.musicUntil);
    }

    this.musicTimer = window.setTimeout(() => this.pumpMusic(), (LOOP_SECONDS * 1000) / 2);
  }

  dispose(): void {
    if (this.musicTimer !== null) window.clearTimeout(this.musicTimer);
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** Shared instance; the game only ever needs one. */
export const audio = new Audio();
