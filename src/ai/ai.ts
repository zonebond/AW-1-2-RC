import {
  forecast,
  movementRange,
  unitAt,
  type GameState,
  type Unit,
} from "../core/game";
import { attackableTiles, buildOccupancy, inRange, pathTo, reachable } from "../core/pathfinding";
import { displayHp } from "../core/damage";
import { tileAt } from "../core/map";
import { TERRAIN } from "../core/terrain";
import { UNITS, hasWeapon, isIndirect } from "../core/units";
import { key, type Point, type PlayerId, type UnitId } from "../core/types";

/**
 * A one-turn greedy commander. It scores every place each unit could stand,
 * every shot it could take from there, and every property it could sit on,
 * then plays the single best option — repeating until nothing is worth doing.
 *
 * It does not plan ahead, but it does look one turn *back* at the player:
 * a threat map of everywhere the enemy could shoot next turn discourages it
 * from parking wounded units in the open.
 */

export type AiFollowUp =
  | { kind: "attack"; targetId: number }
  | { kind: "capture" }
  | { kind: "wait" };

export interface AiOrder {
  unitId: number;
  /** Includes the starting tile; length 1 means "act without moving". */
  path: Point[];
  then: AiFollowUp;
}

export type AiStep =
  | { kind: "order"; order: AiOrder }
  | { kind: "build"; x: number; y: number; type: UnitId }
  | { kind: "end" };

interface ScoredOrder {
  order: AiOrder;
  score: number;
}

/** Roughly how much damage output an enemy could bring to bear on a tile. */
function threatMap(state: GameState, forOwner: PlayerId): Map<number, number> {
  const threat = new Map<number, number>();
  const occupancy = buildOccupancy(state.units);

  for (const enemy of state.units) {
    if (enemy.owner === forOwner) continue;
    if (!hasWeapon(enemy.type)) continue;

    const power = (UNITS[enemy.type].cost / 1000) * (displayHp(enemy.hp) / 10);
    const nodes = reachable(state.map, enemy, occupancy);
    const covered = new Set<number>();

    for (const node of nodes.values()) {
      // Indirect units have to stand still to shoot, so only their current
      // position projects threat.
      if (isIndirect(enemy.type) && (node.x !== enemy.x || node.y !== enemy.y)) continue;
      for (const tile of attackableTiles(state.map, enemy.type, node)) {
        covered.add(key(tile.x, tile.y));
      }
    }
    for (const k of covered) threat.set(k, (threat.get(k) ?? 0) + power);
  }
  return threat;
}

/** What this unit should walk towards when it has nothing better to do. */
function pickObjective(state: GameState, unit: Unit): Point | null {
  const isFoot = UNITS[unit.type].isFoot;

  if (isFoot) {
    let best: Point | null = null;
    let bestDistance = Infinity;
    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < state.map.width; x++) {
        const tile = tileAt(state.map, x, y)!;
        if (!TERRAIN[tile.terrain].capturable || tile.owner === unit.owner) continue;
        const occupant = unitAt(state, x, y);
        if (occupant !== undefined && occupant.owner === unit.owner) continue;
        const distance = Math.abs(x - unit.x) + Math.abs(y - unit.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { x, y };
        }
      }
    }
    if (best !== null) return best;
  }

  let closest: Unit | null = null;
  let closestDistance = Infinity;
  for (const enemy of state.units) {
    if (enemy.owner === unit.owner) continue;
    const distance = Math.abs(enemy.x - unit.x) + Math.abs(enemy.y - unit.y);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = enemy;
    }
  }
  return closest === null ? null : { x: closest.x, y: closest.y };
}

function propertyValue(state: GameState, x: number, y: number): number {
  const tile = tileAt(state.map, x, y)!;
  // Taking the enemy HQ ends the game, so nothing else can outbid it.
  if (tile.terrain === "hq") return 500_000;
  return tile.terrain === "base" ? 9_000 : 6_000;
}

function evaluate(
  state: GameState,
  unit: Unit,
  threat: Map<number, number>,
): ScoredOrder | null {
  const nodes = movementRange(state, unit);
  const options: ScoredOrder[] = [];

  for (const node of nodes.values()) {
    const isOrigin = node.x === unit.x && node.y === unit.y;
    if (!node.canStop && !isOrigin) continue;

    const at: Point = { x: node.x, y: node.y };
    const moved = !isOrigin;
    const path = pathTo(nodes, at.x, at.y);
    const tileThreat = threat.get(key(at.x, at.y)) ?? 0;
    const tile = tileAt(state.map, at.x, at.y)!;

    if (!(moved && isIndirect(unit.type))) {
      const probe: Unit = { ...unit, x: at.x, y: at.y };
      for (const enemy of state.units) {
        if (enemy.owner === unit.owner) continue;
        if (!inRange(unit.type, at, enemy)) continue;
        const shot = forecast(state, probe, enemy);
        if (shot === null) continue;

        const dealt = Math.min(shot.damage, enemy.hp) / 100;
        const gain =
          dealt * UNITS[enemy.type].cost + (shot.destroys ? UNITS[enemy.type].cost * 0.25 : 0);
        const taken = shot.counter === null ? 0 : Math.min(shot.counter, unit.hp) / 100;
        const loss = taken * UNITS[unit.type].cost;

        options.push({
          order: { unitId: unit.id, path, then: { kind: "attack", targetId: enemy.id } },
          // Trades are weighted slightly against the AI so it does not throw
          // units away for an even exchange.
          score: gain - loss * 1.15 - tileThreat * 0.12,
        });
      }
    }

    if (
      UNITS[unit.type].canCapture &&
      TERRAIN[tile.terrain].capturable &&
      tile.owner !== unit.owner
    ) {
      const completesNow = displayHp(unit.hp) >= tile.captureLeft;
      const value = propertyValue(state, at.x, at.y) * (completesNow ? 1 : 0.55);
      options.push({
        order: { unitId: unit.id, path, then: { kind: "capture" } },
        score: value - tileThreat * 0.3,
      });
    }
  }

  const objective = pickObjective(state, unit);
  if (objective !== null) {
    let bestNode: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    for (const node of nodes.values()) {
      const isOrigin = node.x === unit.x && node.y === unit.y;
      if (!node.canStop && !isOrigin) continue;
      const distance = Math.abs(node.x - objective.x) + Math.abs(node.y - objective.y);
      const cover = TERRAIN[tileAt(state.map, node.x, node.y)!.terrain].defence;
      const tileThreat = threat.get(key(node.x, node.y)) ?? 0;
      const score = -distance * 100 + cover * 15 - tileThreat * 0.6;
      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }
    if (bestNode !== null) {
      options.push({
        order: {
          unitId: unit.id,
          path: pathTo(nodes, bestNode.x, bestNode.y),
          then: { kind: "wait" },
        },
        // Scaled down so advancing only wins when no shot or capture is worth
        // taking, but still beats standing still.
        score: bestScore / 1000,
      });
    }
  }

  if (options.length === 0) {
    return {
      order: { unitId: unit.id, path: [{ x: unit.x, y: unit.y }], then: { kind: "wait" } },
      score: -Infinity,
    };
  }

  options.sort((a, b) => b.score - a.score);
  return options[0];
}

function countOwn(state: GameState, owner: PlayerId): Unit[] {
  return state.units.filter((u) => u.owner === owner);
}

/**
 * Production policy: keep enough boots on the ground to actually take
 * property, then convert surplus income into the heaviest thing affordable.
 */
function pickBuild(state: GameState): UnitId | null {
  const owner = state.turn;
  const funds = state.players[owner].funds;
  const own = countOwn(state, owner);
  const foot = own.filter((u) => UNITS[u.type].isFoot).length;
  const indirect = own.filter((u) => isIndirect(u.type)).length;

  const wantFoot = foot < 2 || foot < own.length * 0.4;
  if (wantFoot && funds >= 1_000) {
    return funds >= 3_000 && foot >= 2 ? "mech" : "infantry";
  }

  if (funds >= 16_000 && own.length >= 5) return "mdtank";
  if (funds >= 15_000 && indirect < 2) return "rockets";
  if (funds >= 7_000) return "tank";
  if (funds >= 6_000 && indirect < 2) return "artillery";
  if (funds >= 4_000) return "recon";
  if (funds >= 3_000) return "mech";
  if (funds >= 1_000) return "infantry";
  return null;
}

function freeBase(state: GameState): Point | null {
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      const tile = tileAt(state.map, x, y)!;
      if (!TERRAIN[tile.terrain].builds) continue;
      if (tile.owner !== state.turn) continue;
      if (unitAt(state, x, y) !== undefined) continue;
      return { x, y };
    }
  }
  return null;
}

/**
 * The next thing the AI wants to do. Call repeatedly, applying each step, until
 * it returns `end`. Splitting it this way lets the renderer animate one order
 * at a time instead of the whole turn appearing at once.
 */
export function nextAiStep(state: GameState): AiStep {
  if (state.winner !== null) return { kind: "end" };

  const idle = state.units.filter((u) => u.owner === state.turn && !u.done);
  if (idle.length > 0) {
    const threat = threatMap(state, state.turn);

    let best: ScoredOrder | null = null;
    for (const unit of idle) {
      const candidate = evaluate(state, unit, threat);
      if (candidate === null) continue;
      if (best === null || candidate.score > best.score) best = candidate;
    }
    if (best !== null) return { kind: "order", order: best.order };
  }

  const site = freeBase(state);
  if (site !== null) {
    const type = pickBuild(state);
    if (type !== null) return { kind: "build", x: site.x, y: site.y, type };
  }

  return { kind: "end" };
}
