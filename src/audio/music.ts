import { noise, pitch, tone, type Ctx } from "./synth";

/**
 * An original march loop, written out as note tables and scheduled ahead of
 * the playhead. It is not the series' music and does not try to be — it is a
 * simple minor-key march that sits under the board without asking for
 * attention.
 */

const BPM = 112;
const BEAT = 60 / BPM;
/** Eight bars of four beats. */
const BARS = 8;
export const LOOP_SECONDS = BARS * 4 * BEAT;

/** Semitone offsets from A4. Chord roots, one per bar: Am F C G, twice. */
const ROOTS = [0, -4, 3, -2, 0, -4, 3, -2];

/** Melody as [bar, beat-offset, semitone, beats]. */
const MELODY: Array<[number, number, number, number]> = [
  [0, 0, 0, 1], [0, 1, 3, 1], [0, 2, 7, 1.5], [0, 3.5, 3, 0.5],
  [1, 0, -4, 1], [1, 1, 0, 1], [1, 2, 3, 1.5], [1, 3.5, 0, 0.5],
  [2, 0, -9, 1], [2, 1, -5, 1], [2, 2, -2, 1.5], [2, 3.5, -5, 0.5],
  [3, 0, -2, 1], [3, 1, 2, 1], [3, 2, 5, 2],
  [4, 0, 7, 1], [4, 1, 5, 1], [4, 2, 3, 1.5], [4, 3.5, 0, 0.5],
  [5, 0, 8, 1], [5, 1, 5, 1], [5, 2, 0, 1.5], [5, 3.5, -4, 0.5],
  [6, 0, 3, 1], [6, 1, 7, 1], [6, 2, 10, 1.5], [6, 3.5, 7, 0.5],
  [7, 0, 5, 1], [7, 1, 2, 1], [7, 2, 0, 2],
];

/**
 * Schedule one pass of the loop starting at `at`. Returns when the next pass
 * should begin, so the caller can chain them without a gap.
 */
export function scheduleLoop(ctx: Ctx, dest: AudioNode, at: number): number {
  for (let bar = 0; bar < BARS; bar++) {
    const barAt = at + bar * 4 * BEAT;
    const root = ROOTS[bar];

    // Bass: root on the downbeat, fifth on beat three, an octave and a half
    // below the melody so the two never crowd each other.
    tone(ctx, dest, barAt, {
      freq: pitch(root - 24),
      duration: BEAT * 1.7,
      gain: 0.075,
      type: "triangle",
      attack: 0.05,
    });
    tone(ctx, dest, barAt + 2 * BEAT, {
      freq: pitch(root - 17),
      duration: BEAT * 1.7,
      gain: 0.065,
      type: "triangle",
      attack: 0.05,
    });

    // Percussion: kick on one and three, a soft hat on every off-beat.
    for (const beat of [0, 2]) {
      tone(ctx, dest, barAt + beat * BEAT, {
        freq: 120,
        toFreq: 44,
        duration: 0.16,
        gain: 0.11,
        type: "sine",
        attack: 0.02,
      });
    }
    for (let eighth = 1; eighth < 8; eighth += 2) {
      noise(ctx, dest, barAt + eighth * BEAT * 0.5, {
        duration: 0.05,
        gain: 0.022,
        freq: 7000,
        type: "highpass",
      });
    }
  }

  for (const [bar, beat, step, beats] of MELODY) {
    tone(ctx, dest, at + (bar * 4 + beat) * BEAT, {
      freq: pitch(step),
      duration: beats * BEAT * 0.92,
      gain: 0.052,
      type: "square",
      attack: 0.08,
    });
  }

  return at + LOOP_SECONDS;
}
