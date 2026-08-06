/** Shared vocabulary for the whole game. Nothing here has behaviour. */

export type TerrainId =
  | "plain"
  | "wood"
  | "mountain"
  | "road"
  | "river"
  | "city"
  | "base"
  | "hq";

/**
 * Land roster only. Missiles are deliberately absent: they are an anti-air
 * weapon, and with no aircraft in the build they would have nothing to shoot.
 */
export type UnitId =
  | "infantry"
  | "mech"
  | "recon"
  | "apc"
  | "artillery"
  | "tank"
  | "antiair"
  | "rockets"
  | "mdtank";

/** How a unit pays for terrain. Land-only for now; air/sea land here later. */
export type MoveClass = "foot" | "boots" | "tires" | "treads";

/** Player slot. 0 = Orange Star (human), 1 = Blue Moon (AI). */
export type PlayerId = 0 | 1;

/** A property with no owner yet. */
export const NEUTRAL = -1;
export type Owner = PlayerId | typeof NEUTRAL;

export interface Point {
  x: number;
  y: number;
}

export function key(x: number, y: number): number {
  return y * 1000 + x;
}

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export const DIRECTIONS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
