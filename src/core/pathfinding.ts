import { canTarget } from "./damage";
import { tileAt, type GameMap } from "./map";
import { TERRAIN } from "./terrain";
import { UNITS } from "./units";
import { DIRECTIONS, key, type Point, type PlayerId, type UnitId } from "./types";

export interface ReachableNode {
  x: number;
  y: number;
  /** Movement points spent to arrive here. */
  cost: number;
  /** Packed key of the previous tile, or -1 for the origin. */
  from: number;
  /** False when a unit already sits here, so you may pass but not stop. */
  canStop: boolean;
}

export interface UnitLike {
  type: UnitId;
  owner: PlayerId;
  x: number;
  y: number;
  fuel: number;
}

/** Anything the mover has to route around: unit positions by owner. */
export interface Occupancy {
  /** owner of the unit standing on a tile, or undefined if empty */
  get(x: number, y: number): PlayerId | undefined;
}

export function buildOccupancy(units: readonly UnitLike[]): Occupancy {
  const byTile = new Map<number, PlayerId>();
  for (const unit of units) byTile.set(key(unit.x, unit.y), unit.owner);
  return { get: (x, y) => byTile.get(key(x, y)) };
}

/**
 * Dijkstra over movement cost. A unit is capped by both its move stat and its
 * remaining fuel, and may pass through allies but never through enemies.
 */
export function reachable(
  map: GameMap,
  unit: UnitLike,
  occupancy: Occupancy,
): Map<number, ReachableNode> {
  const def = UNITS[unit.type];
  const budget = Math.min(def.move, unit.fuel);

  const origin: ReachableNode = { x: unit.x, y: unit.y, cost: 0, from: -1, canStop: true };
  const nodes = new Map<number, ReachableNode>([[key(unit.x, unit.y), origin]]);

  // Small budgets make a sorted frontier cheaper than a real heap here.
  const frontier: ReachableNode[] = [origin];
  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost);
    const current = frontier.shift()!;
    if (current.cost > (nodes.get(key(current.x, current.y))?.cost ?? Infinity)) continue;

    for (const dir of DIRECTIONS) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      const tile = tileAt(map, nx, ny);
      if (tile === null) continue;

      const stepCost = TERRAIN[tile.terrain].cost[def.moveClass];
      if (stepCost === null) continue;

      const occupant = occupancy.get(nx, ny);
      if (occupant !== undefined && occupant !== unit.owner) continue; // enemies block

      const cost = current.cost + stepCost;
      if (cost > budget) continue;

      const k = key(nx, ny);
      const existing = nodes.get(k);
      if (existing !== undefined && existing.cost <= cost) continue;

      const node: ReachableNode = {
        x: nx,
        y: ny,
        cost,
        from: key(current.x, current.y),
        canStop: occupant === undefined,
      };
      nodes.set(k, node);
      frontier.push(node);
    }
  }
  return nodes;
}

/** Walk the `from` links back to the origin and return the path start-to-end. */
export function pathTo(
  nodes: Map<number, ReachableNode>,
  targetX: number,
  targetY: number,
): Point[] {
  const path: Point[] = [];
  let cursor = nodes.get(key(targetX, targetY));
  while (cursor !== undefined) {
    path.push({ x: cursor.x, y: cursor.y });
    if (cursor.from === -1) break;
    cursor = nodes.get(cursor.from);
  }
  return path.reverse();
}

/**
 * Tiles this unit could shoot from the given position. Indirect units fire in
 * a ring and must have stayed put; direct units hit their neighbours.
 */
export function attackableTiles(map: GameMap, type: UnitId, from: Point): Point[] {
  const def = UNITS[type];
  if (def.rangeMax === 0) return [];

  const tiles: Point[] = [];
  for (let dy = -def.rangeMax; dy <= def.rangeMax; dy++) {
    for (let dx = -def.rangeMax; dx <= def.rangeMax; dx++) {
      const distance = Math.abs(dx) + Math.abs(dy);
      if (distance < def.rangeMin || distance > def.rangeMax) continue;
      const x = from.x + dx;
      const y = from.y + dy;
      if (tileAt(map, x, y) === null) continue;
      tiles.push({ x, y });
    }
  }
  return tiles;
}

/** True when this attacker, standing here, could engage that defender there. */
export function inRange(attackerType: UnitId, from: Point, target: Point): boolean {
  const def = UNITS[attackerType];
  const distance = Math.abs(from.x - target.x) + Math.abs(from.y - target.y);
  return distance >= def.rangeMin && distance <= def.rangeMax && def.rangeMax > 0;
}

export function canEngage(attackerType: UnitId, defenderType: UnitId): boolean {
  return canTarget(attackerType, defenderType);
}
