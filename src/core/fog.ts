import { tileAt } from "./map";
import { TERRAIN } from "./terrain";
import { UNITS } from "./units";
import { key, type PlayerId, type Point } from "./types";
import type { GameState, Unit } from "./game";

/**
 * Fog of war.
 *
 * The map itself is never hidden — you always know where the mountains and
 * the factories are, exactly as in the series. What fog takes away is
 * knowledge of *units*: outside your vision you cannot see them, cannot
 * target them, and cannot plan around them.
 *
 * Two rules make it a game rather than a nuisance:
 *
 *  - Woods hide whoever stands in them from anything that is not directly
 *    adjacent, so a tank can drive past an ambush it never saw.
 *  - Foot units on a mountain see much further, which is the whole reason to
 *    walk infantry up a peak instead of leaving them on the road.
 */

/** Extra sight given to a foot unit that has climbed a mountain. */
const MOUNTAIN_BONUS = 3;

/** How far your own properties light up around themselves. */
const PROPERTY_VISION = 2;

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Sight radius for a unit standing where it currently is. */
export function visionOf(state: GameState, unit: Unit): number {
  const def = UNITS[unit.type];
  const tile = tileAt(state.map, unit.x, unit.y);
  const climbed = def.isFoot && tile !== null && tile.terrain === "mountain";
  return def.vision + (climbed ? MOUNTAIN_BONUS : 0);
}

/** Stamp a diamond of radius `radius` around `centre` into `out`. */
function light(state: GameState, out: Set<number>, centre: Point, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) {
    const span = radius - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      const x = centre.x + dx;
      const y = centre.y + dy;
      if (tileAt(state.map, x, y) === null) continue;
      out.add(key(x, y));
    }
  }
}

/**
 * Every tile this player can currently see into. With fog off this is the
 * whole board, which lets every caller ask the same question either way.
 */
export function visibleTiles(state: GameState, player: PlayerId): Set<number> {
  const { width, tiles } = state.map;
  const seen = new Set<number>();

  if (!state.fog) {
    for (let i = 0; i < tiles.length; i++) seen.add(key(i % width, Math.floor(i / width)));
    return seen;
  }

  for (const unit of state.units) {
    if (unit.owner !== player) continue;
    light(state, seen, unit, visionOf(state, unit));
  }
  // Tiles are stored flat, so the coordinates come from the index.
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    if (tile.owner !== player || !TERRAIN[tile.terrain].capturable) continue;
    light(state, seen, { x: i % width, y: Math.floor(i / width) }, PROPERTY_VISION);
  }
  return seen;
}

export function isTileVisible(state: GameState, player: PlayerId, x: number, y: number): boolean {
  if (!state.fog) return true;
  return visibleTiles(state, player).has(key(x, y));
}

/**
 * Can `player` see `unit`? Own and allied units are always visible. An enemy
 * is visible when its tile is lit — except in cover, where only a neighbour
 * can pick it out.
 */
export function canSeeUnit(
  state: GameState,
  player: PlayerId,
  unit: Unit,
  precomputed?: Set<number>,
): boolean {
  if (!state.fog) return true;
  if (unit.owner === player) return true;

  const lit = precomputed ?? visibleTiles(state, player);
  if (!lit.has(key(unit.x, unit.y))) return false;

  const tile = tileAt(state.map, unit.x, unit.y);
  if (tile !== null && TERRAIN[tile.terrain].hides) {
    return state.units.some((mine) => mine.owner === player && manhattan(mine, unit) === 1);
  }
  return true;
}

/**
 * The units this player is allowed to know about. Everything that reasons
 * about the board — the AI, pathfinding, the attack menu — goes through this
 * rather than reading `state.units` directly.
 */
export function visibleUnits(state: GameState, player: PlayerId): Unit[] {
  if (!state.fog) return state.units;
  const lit = visibleTiles(state, player);
  return state.units.filter((unit) => canSeeUnit(state, player, unit, lit));
}

/**
 * Walk a planned path and cut it short where a hidden enemy is standing.
 * Under fog you may route straight through a tile you believe is empty; the
 * ambush is discovering that it is not. The unit halts on the last tile it
 * safely reached.
 *
 * Returns the path actually walked. When it is shorter than the plan, the
 * move was interrupted.
 */
export function resolveMovePath(
  state: GameState,
  unit: Unit,
  path: readonly Point[],
): Point[] {
  if (!state.fog || path.length <= 1) return [...path];

  const walked: Point[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const step = path[i];
    const blocker = state.units.find(
      (other) => other.x === step.x && other.y === step.y && other.owner !== unit.owner,
    );
    if (blocker !== undefined) return walked;
    walked.push(step);
  }
  return walked;
}
