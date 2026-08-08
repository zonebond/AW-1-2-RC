/**
 * Small synthesis toolkit. Every sound in the game is built from these three
 * primitives at run time — there are no audio files anywhere in the project.
 *
 * Each helper takes the context explicitly so the same code can run against a
 * live AudioContext during play and against an OfflineAudioContext in the
 * tests, where the output can actually be measured.
 */

export type Ctx = BaseAudioContext;

let noiseCache: WeakMap<BaseAudioContext, AudioBuffer> = new WeakMap();

/** One second of white noise, reused by every noise-based sound. */
export function noiseBuffer(ctx: Ctx): AudioBuffer {
  const hit = noiseCache.get(ctx);
  if (hit !== undefined) return hit;

  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // A fixed sequence rather than Math.random: identical every run, so the
  // offline test measures the same waveform the player hears.
  let seed = 0x2f6e2b1;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x3fffffff - 1) * 0.9;
  }
  noiseCache.set(ctx, buffer);
  return buffer;
}

export function resetNoiseCache(): void {
  noiseCache = new WeakMap();
}

export interface ToneOptions {
  freq: number;
  /** Sweep target; omitted means a steady pitch. */
  toFreq?: number;
  type?: OscillatorType;
  duration: number;
  gain: number;
  /** Fraction of the duration spent rising to full volume. */
  attack?: number;
  /** Detune in cents, for thickening a note with a second voice. */
  detune?: number;
}

/** A single pitched voice with a percussive envelope. */
export function tone(ctx: Ctx, dest: AudioNode, at: number, options: ToneOptions): void {
  const {
    freq,
    toFreq,
    type = "square",
    duration,
    gain,
    attack = 0.06,
    detune = 0,
  } = options;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, at);
  if (toFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), at + duration);
  }

  const envelope = ctx.createGain();
  const peakAt = at + Math.max(0.004, duration * attack);
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(gain, peakAt);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  osc.connect(envelope).connect(dest);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

export interface NoiseOptions {
  duration: number;
  gain: number;
  /** Band centre, or cutoff for lowpass/highpass. */
  freq: number;
  toFreq?: number;
  type?: BiquadFilterType;
  q?: number;
  attack?: number;
}

/** A filtered burst of noise: the backbone of every gun and explosion here. */
export function noise(ctx: Ctx, dest: AudioNode, at: number, options: NoiseOptions): void {
  const { duration, gain, freq, toFreq, type = "lowpass", q = 1, attack = 0.02 } = options;

  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  // Start at a different offset each time so repeated bursts do not phase
  // into an obviously identical texture.
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = 1;

  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, at);
  if (toFreq !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, toFreq), at + duration);
  }

  const envelope = ctx.createGain();
  const peakAt = at + Math.max(0.003, duration * attack);
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(gain, peakAt);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  source.connect(filter).connect(envelope).connect(dest);
  source.start(at, (at * 7.3) % 0.9);
  source.stop(at + duration + 0.02);
}

/** Equal-tempered pitch from a semitone offset relative to A4. */
export function pitch(semitonesFromA4: number): number {
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}
