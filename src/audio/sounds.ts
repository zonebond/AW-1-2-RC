import { noise, pitch, tone, type Ctx } from "./synth";

/**
 * The sound library. Each entry writes its voices into `dest` starting at
 * `at`, and returns how long it will ring for so callers can schedule around
 * it. Nothing here loads a file; it is all oscillators and filtered noise.
 */

export type SoundId =
  | "cursor"
  | "select"
  | "cancel"
  | "menu"
  | "moveFoot"
  | "moveTread"
  | "moveTire"
  | "machineGun"
  | "cannon"
  | "rocket"
  | "impact"
  | "destroy"
  | "captureTick"
  | "captureDone"
  | "build"
  | "turnPlayer"
  | "turnEnemy"
  | "victory"
  | "defeat";

type Voice = (ctx: Ctx, dest: AudioNode, at: number) => number;

/** Short, dry, and quiet: this fires on every tile the pointer crosses. */
const cursor: Voice = (ctx, dest, at) => {
  tone(ctx, dest, at, { freq: 1180, toFreq: 1400, duration: 0.035, gain: 0.045, type: "square" });
  return 0.05;
};

const select: Voice = (ctx, dest, at) => {
  tone(ctx, dest, at, { freq: pitch(4), duration: 0.06, gain: 0.14, type: "square" });
  tone(ctx, dest, at + 0.05, { freq: pitch(11), duration: 0.09, gain: 0.12, type: "square" });
  return 0.15;
};

const cancel: Voice = (ctx, dest, at) => {
  tone(ctx, dest, at, { freq: pitch(7), duration: 0.06, gain: 0.12, type: "square" });
  tone(ctx, dest, at + 0.05, { freq: pitch(0), duration: 0.09, gain: 0.11, type: "square" });
  return 0.15;
};

const menu: Voice = (ctx, dest, at) => {
  tone(ctx, dest, at, { freq: 780, toFreq: 980, duration: 0.05, gain: 0.09, type: "triangle" });
  return 0.06;
};

/**
 * Boots on soil: two soft, damped thuds. The scuff is filtered noise and the
 * weight underneath it is a short sine drop — noise alone, once the lowpass
 * has done its work, is far too thin to sit beside the vehicle sounds.
 */
const moveFoot: Voice = (ctx, dest, at) => {
  for (let i = 0; i < 2; i++) {
    const t = at + i * 0.11;
    noise(ctx, dest, t, { duration: 0.09, gain: 0.3, freq: 1500, toFreq: 320, type: "lowpass" });
    tone(ctx, dest, t, { freq: 190, toFreq: 90, duration: 0.07, gain: 0.06, type: "sine" });
  }
  return 0.24;
};

/** Tracks: a low diesel rumble with the clatter of the belts over it. */
const moveTread: Voice = (ctx, dest, at) => {
  tone(ctx, dest, at, { freq: 72, toFreq: 58, duration: 0.42, gain: 0.16, type: "sawtooth", attack: 0.12 });
  noise(ctx, dest, at, {
    duration: 0.42,
    gain: 0.075,
    freq: 420,
    toFreq: 220,
    type: "bandpass",
    q: 1.4,
    attack: 0.1,
  });
  return 0.45;
};

/** Tyres: higher and smoother than tracks, with a little whine. */
const moveTire: Voice = (ctx, dest, at) => {
  tone(ctx, dest, at, { freq: 150, toFreq: 210, duration: 0.34, gain: 0.1, type: "triangle", attack: 0.15 });
  noise(ctx, dest, at, {
    duration: 0.34,
    gain: 0.06,
    freq: 1100,
    toFreq: 700,
    type: "bandpass",
    q: 2,
    attack: 0.12,
  });
  return 0.36;
};

/** A short burst, not a single shot: five rounds forty milliseconds apart. */
const machineGun: Voice = (ctx, dest, at) => {
  for (let i = 0; i < 5; i++) {
    const t = at + i * 0.042;
    noise(ctx, dest, t, { duration: 0.05, gain: 0.16, freq: 3200, toFreq: 900, type: "highpass" });
    tone(ctx, dest, t, { freq: 240, toFreq: 90, duration: 0.05, gain: 0.07, type: "square" });
  }
  return 0.26;
};

/** Tank gun: a crack over a body of low noise, with a sub thump underneath. */
const cannon: Voice = (ctx, dest, at) => {
  noise(ctx, dest, at, { duration: 0.09, gain: 0.3, freq: 5000, toFreq: 1400, type: "highpass" });
  noise(ctx, dest, at, { duration: 0.4, gain: 0.26, freq: 900, toFreq: 130, type: "lowpass" });
  tone(ctx, dest, at, { freq: 130, toFreq: 44, duration: 0.34, gain: 0.24, type: "sine", attack: 0.02 });
  return 0.42;
};

/** Launch: the roar builds instead of cracking, and rides away from you. */
const rocket: Voice = (ctx, dest, at) => {
  noise(ctx, dest, at, {
    duration: 0.55,
    gain: 0.22,
    freq: 500,
    toFreq: 2600,
    type: "bandpass",
    q: 0.9,
    attack: 0.3,
  });
  tone(ctx, dest, at, { freq: 190, toFreq: 520, duration: 0.5, gain: 0.09, type: "sawtooth", attack: 0.35 });
  return 0.56;
};

const impact: Voice = (ctx, dest, at) => {
  noise(ctx, dest, at, { duration: 0.5, gain: 0.3, freq: 1600, toFreq: 90, type: "lowpass" });
  tone(ctx, dest, at, { freq: 110, toFreq: 36, duration: 0.44, gain: 0.26, type: "sine", attack: 0.015 });
  // A little metallic ring so a hit does not sound like a bag of sand.
  tone(ctx, dest, at + 0.01, { freq: 640, toFreq: 300, duration: 0.16, gain: 0.08, type: "square" });
  return 0.52;
};

/** Heavier than an impact, and it falls away in pitch as the hull goes up. */
const destroy: Voice = (ctx, dest, at) => {
  noise(ctx, dest, at, { duration: 0.85, gain: 0.34, freq: 2200, toFreq: 70, type: "lowpass" });
  tone(ctx, dest, at, { freq: 150, toFreq: 28, duration: 0.75, gain: 0.3, type: "sine", attack: 0.015 });
  tone(ctx, dest, at + 0.06, { freq: 320, toFreq: 70, duration: 0.5, gain: 0.11, type: "sawtooth" });
  return 0.88;
};

/** A ratchet, once per turn of capture progress. */
const captureTick: Voice = (ctx, dest, at) => {
  for (let i = 0; i < 3; i++) {
    tone(ctx, dest, at + i * 0.07, {
      freq: pitch(-5 + i * 2),
      duration: 0.055,
      gain: 0.1,
      type: "square",
    });
  }
  return 0.24;
};

/** The flag goes up: a bright four-note arpeggio. */
const captureDone: Voice = (ctx, dest, at) => {
  [0, 4, 7, 12].forEach((step, i) => {
    tone(ctx, dest, at + i * 0.075, {
      freq: pitch(step),
      duration: 0.22,
      gain: 0.13,
      type: "square",
    });
  });
  return 0.5;
};

/** Factory doors and machinery, then the unit rolling out. */
const build: Voice = (ctx, dest, at) => {
  noise(ctx, dest, at, { duration: 0.22, gain: 0.13, freq: 700, toFreq: 300, type: "bandpass", q: 1.2 });
  tone(ctx, dest, at + 0.12, { freq: pitch(-12), duration: 0.14, gain: 0.13, type: "square" });
  tone(ctx, dest, at + 0.24, { freq: pitch(-5), duration: 0.2, gain: 0.13, type: "square" });
  return 0.46;
};

function fanfare(root: number, gain: number): Voice {
  return (ctx, dest, at) => {
    [0, 4, 7].forEach((step, i) => {
      tone(ctx, dest, at + i * 0.09, {
        freq: pitch(root + step),
        duration: 0.24,
        gain,
        type: "square",
      });
      tone(ctx, dest, at + i * 0.09, {
        freq: pitch(root + step - 12),
        duration: 0.24,
        gain: gain * 0.6,
        type: "triangle",
      });
    });
    return 0.5;
  };
}

const victory: Voice = (ctx, dest, at) => {
  [0, 4, 7, 12, 16].forEach((step, i) => {
    tone(ctx, dest, at + i * 0.11, {
      freq: pitch(step),
      duration: 0.4,
      gain: 0.15,
      type: "square",
    });
  });
  return 0.95;
};

const defeat: Voice = (ctx, dest, at) => {
  [0, -3, -7, -12].forEach((step, i) => {
    tone(ctx, dest, at + i * 0.17, {
      freq: pitch(step),
      duration: 0.5,
      gain: 0.14,
      type: "triangle",
    });
  });
  return 1.2;
};

export const SOUNDS: Record<SoundId, Voice> = {
  cursor,
  select,
  cancel,
  menu,
  moveFoot,
  moveTread,
  moveTire,
  machineGun,
  cannon,
  rocket,
  impact,
  destroy,
  captureTick,
  captureDone,
  build,
  // The two sides get different keys, so whose turn it is registers before
  // the banner has even finished sliding in.
  turnPlayer: fanfare(0, 0.14),
  turnEnemy: fanfare(-5, 0.13),
  victory,
  defeat,
};

export const SOUND_IDS = Object.keys(SOUNDS) as SoundId[];
