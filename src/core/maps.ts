import { parseMap, type GameMap } from "./map";

/**
 * Both maps are 180-degree rotationally symmetric, so neither side gets a
 * better opening. See map.ts for the two-character cell format.
 */

/**
 * Twin Bridges — 20x15. A river splits the field; vehicles cross only at the
 * two flanking bridges or through the open ground in the centre, while foot
 * units can wade anywhere. Contested neutral bases sit on each bank.
 */
const TWIN_BRIDGES = [
  "^^....==..........==h1..........==....^^",
  "....ff==..c1....b1====..b1..c1..==ff....",
  "......============================......",
  "....c1==....^^....====....^^....==c1....",
  "......==ff....^^..==c1..^^....ff==......",
  "^^c...==....c1..ff====ff..c1....==..c.^^",
  "......==..b.ff..c.====c...ff....==......",
  "~~~~~~==~~~~~~~~..====..~~~~~~~~==~~~~~~",
  "......==....ff..c.====c...ffb...==......",
  "^^c...==....c0..ff====ff..c0....==..c.^^",
  "......==ff....^^..c0==..^^....ff==......",
  "....c0==....^^....====....^^....==c0....",
  "......============================......",
  "....ff==..c0..b0..====b0....c0..==ff....",
  "^^....==..........h0==..........==....^^",
];

/**
 * Crossroads — 14x10. No river, no chokepoints, two bases each. Games here
 * are short and decided by unit trades rather than positioning.
 */
const CROSSROADS = [
  "^^......b1..h1..b1........^^",
  "....ff..............ff......",
  "..c1..================..c1..",
  "^^....==..^^....^^..==....^^",
  "..c...==....c.......==..c...",
  "..c...==......c.....==..c...",
  "^^....==..^^....^^..==....^^",
  "..c0..================..c0..",
  "......ff............ff......",
  "^^........b0..h0..b0......^^",
];

export interface MapEntry {
  id: string;
  label: string;
  blurb: string;
  build: () => GameMap;
}

export const MAPS: readonly MapEntry[] = [
  {
    id: "twin-bridges",
    label: "双桥防线",
    blurb: "20x15 · 河流分割 · 两座桥 + 中央开阔地",
    build: () => parseMap("双桥防线", TWIN_BRIDGES),
  },
  {
    id: "crossroads",
    label: "十字路口",
    blurb: "14x10 · 无河流 · 短平快的正面交锋",
    build: () => parseMap("十字路口", CROSSROADS),
  },
];

export function mapById(id: string): MapEntry {
  const entry = MAPS.find((m) => m.id === id);
  if (entry === undefined) throw new Error(`unknown map "${id}"`);
  return entry;
}
