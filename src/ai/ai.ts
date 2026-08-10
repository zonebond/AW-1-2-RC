import {
  canActivate,
  forecast,
  modsFor,
  movementRange,
  unitAt,
  type GameState,
  type PowerKind,
  type Unit,
} from "../core/game";
import { attackableTiles, buildOccupancy, inRange, pathTo, reachable } from "../core/pathfinding";
import { displayHp } from "../core/damage";
import { findHq, tileAt } from "../core/map";
import { TERRAIN } from "../core/terrain";
import { UNITS, hasWeapon, isIndirect } from "../core/units";
import { visibleUnits } from "../core/fog";
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
  | { kind: "power"; power: PowerKind }
  | { kind: "end" };

interface ScoredOrder {
  order: AiOrder;
  score: number;
}

/**
 * Roughly how much damage output an enemy could bring to bear on a tile.
 * Built from `known` rather than the true unit list, so under fog the AI is
 * blind to exactly the same ambushes the player is.
 */
function threatMap(
  state: GameState,
  forOwner: PlayerId,
  known: readonly Unit[],
): Map<number, number> {
  const threat = new Map<number, number>();
  const occupancy = buildOccupancy(known);

  for (const enemy of known) {
    if (enemy.owner === forOwner) continue;
    if (!hasWeapon(enemy.type)) continue;

    const power = (UNITS[enemy.type].cost / 1000) * (displayHp(enemy.hp) / 10);
    const enemyRange = modsFor(state, enemy.owner, enemy.type).range;
    const nodes = reachable(state.map, enemy, occupancy, modsFor(state, enemy.owner, enemy.type).move);
    const covered = new Set<number>();

    for (const node of nodes.values()) {
      // Indirect units have to stand still to shoot, so only their current
      // position projects threat.
      if (isIndirect(enemy.type) && (node.x !== enemy.x || node.y !== enemy.y)) continue;
      for (const tile of attackableTiles(state.map, enemy.type, node, enemyRange)) {
        covered.add(key(tile.x, tile.y));
      }
    }
    for (const k of covered) threat.set(k, (threat.get(k) ?? 0) + power);
  }
  return threat;
}

/** What this unit should walk towards when it has nothing better to do. */
function pickObjective(state: GameState, unit: Unit, known: readonly Unit[]): Point | null {
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
  for (const enemy of known) {
    if (enemy.owner === unit.owner) continue;
    const distance = Math.abs(enemy.x - unit.x) + Math.abs(enemy.y - unit.y);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = enemy;
    }
  }
  if (closest !== null) return { x: closest.x, y: closest.y };

  // Nothing in sight. Under fog that is the normal opening state, and a unit
  // with no objective would simply never move — so fall back to the one
  // target that is always on the map and always worth walking towards.
  const enemyHq = findHq(state.map, unit.owner === 0 ? 1 : 0);
  return enemyHq === null ? null : { x: enemyHq.x, y: enemyHq.y };
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
  known: readonly Unit[],
): ScoredOrder | null {
  const nodes = movementRange(state, unit);
  const rangeBonus = modsFor(state, unit.owner, unit.type).range;
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
      for (const enemy of known) {
        if (enemy.owner === unit.owner) continue;
        if (!inRange(unit.type, at, enemy, rangeBonus)) continue;
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

  const objective = pickObjective(state, unit, known);
  if (objective !== null) {
    const standOff = isIndirect(unit.type) ? UNITS[unit.type].rangeMax + rangeBonus : 0;
    let bestNode: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    for (const node of nodes.values()) {
      const isOrigin = node.x === unit.x && node.y === unit.y;
      if (!node.canStop && !isOrigin) continue;
      const distance = Math.abs(node.x - objective.x) + Math.abs(node.y - objective.y);
      const cover = TERRAIN[tileAt(state.map, node.x, node.y)!.terrain].defence;
      const tileThreat = threat.get(key(node.x, node.y)) ?? 0;
      // Guns want to arrive at their firing distance, not on top of the
      // target: an indirect unit that closes to melee cannot shoot at all,
      // and is defenceless when it gets there.
      const score = -Math.abs(distance - standOff) * 100 + cover * 15 - tileThreat * 0.6;
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

  // Build towards the commander — but only by raising the ceiling, never by
  // buying guns ahead of tanks. Spending the opening on artillery loses the
  // early fight for the map, and the guns never get to matter.
  const artilleryBonus = modsFor(state, owner, "artillery").attack;
  const footBonus = modsFor(state, owner, "infantry").attack;
  const tankBonus = modsFor(state, owner, "tank").attack;
  const lovesIndirect = artilleryBonus > tankBonus;
  const lovesFoot = footBonus > tankBonus;

  const indirectCap = lovesIndirect ? 3 : 2;
  const footShare = lovesFoot ? 0.5 : 0.4;

  const wantFoot = foot < 2 || foot < own.length * footShare;
  if (wantFoot && funds >= 1_000) {
    return funds >= 3_000 && foot >= 2 ? "mech" : "infantry";
  }

  if (funds >= 16_000 && own.length >= 5) return "mdtank";
  if (funds >= 15_000 && indirect < indirectCap) return "rockets";
  if (funds >= 7_000) return "tank";
  if (funds >= 6_000 && indirect < indirectCap) return "artillery";
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
 * Is anything worth spending a power on this turn? A power lasts one turn, so
 * firing it while the armies are still walking towards each other throws it
 * away. "In contact" here means some unit of ours could reach a shot at
 * something we can see.
 */
function inContact(state: GameState, known: readonly Unit[]): boolean {
  const mine = state.units.filter((u) => u.owner === state.turn && !u.done);
  for (const unit of mine) {
    if (!hasWeapon(unit.type)) continue;
    const range = modsFor(state, unit.owner, unit.type).range;
    for (const node of movementRange(state, unit).values()) {
      if (isIndirect(unit.type) && (node.x !== unit.x || node.y !== unit.y)) continue;
      for (const enemy of known) {
        if (enemy.owner === unit.owner) continue;
        if (inRange(unit.type, node, enemy, range)) return true;
      }
    }
  }
  return false;
}

/**
 * The next thing the AI wants to do. Call repeatedly, applying each step, until
 * it returns `end`. Splitting it this way lets the renderer animate one order
 * at a time instead of the whole turn appearing at once.
 */
export function nextAiStep(state: GameState): AiStep {
  if (state.winner !== null) return { kind: "end" };

  const idle = state.units.filter((u) => u.owner === state.turn && !u.done);

  // Powers go off before any unit moves, so the whole turn benefits. The
  // super is always worth waiting for when it is within reach of being paid
  // for; below that, spend the normal power rather than sit on a full meter.
  if (state.players[state.turn].activePower === null && idle.length > 0) {
    const known = visibleUnits(state, state.turn);
    if (inContact(state, known)) {
      if (canActivate(state, state.turn, "super")) {
        return { kind: "power", power: "super" };
      }
      if (canActivate(state, state.turn, "power")) {
        return { kind: "power", power: "power" };
      }
    }
  }
  if (idle.length > 0) {
    const known = visibleUnits(state, state.turn);
    const threat = threatMap(state, state.turn, known);

    let best: ScoredOrder | null = null;
    for (const unit of idle) {
      const candidate = evaluate(state, unit, threat, known);
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
