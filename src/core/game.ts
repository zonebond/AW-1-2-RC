import { computeDamage, ammoCost, displayHp } from "./damage";
import { findHq, tileAt, type GameMap, type Tile } from "./map";
import { CAPTURE_POINTS, INCOME_PER_PROPERTY, TERRAIN } from "./terrain";
import { UNITS, hasWeapon, isIndirect } from "./units";
import {
  buildOccupancy,
  inRange,
  pathTo,
  reachable,
  type ReachableNode,
} from "./pathfinding";
import { canSeeUnit, visibleUnits } from "./fog";
import { NEUTRAL, key, type PlayerId, type Point, type UnitId } from "./types";

export interface Unit {
  id: number;
  type: UnitId;
  owner: PlayerId;
  x: number;
  y: number;
  /** Internal 0-100 pool; the HUD shows ceil(hp / 10). */
  hp: number;
  fuel: number;
  ammo: number;
  /** True once the unit has finished acting this turn. */
  done: boolean;
  /** Set while this unit is part-way through taking a property. */
  capturing: boolean;
  cargo: Unit[];
}

export interface Player {
  id: PlayerId;
  funds: number;
  isAI: boolean;
}

export interface GameState {
  map: GameMap;
  units: Unit[];
  players: [Player, Player];
  turn: PlayerId;
  day: number;
  winner: PlayerId | null;
  /** Why the game ended, for the result banner. */
  endReason: "hq" | "rout" | null;
  /** Fog of war. Terrain stays known either way; only units are hidden. */
  fog: boolean;
  nextUnitId: number;
  log: string[];
  /** Injected so tests and the AI can run with a fixed sequence. */
  random: () => number;
}

export interface StartUnit {
  type: UnitId;
  owner: PlayerId;
  x: number;
  y: number;
}

export function createGame(
  map: GameMap,
  startUnits: readonly StartUnit[],
  options: { aiOpponent?: boolean; random?: () => number; fog?: boolean } = {},
): GameState {
  const { aiOpponent = true, random = Math.random, fog = false } = options;

  const state: GameState = {
    map,
    units: [],
    players: [
      { id: 0, funds: 0, isAI: false },
      { id: 1, funds: 0, isAI: aiOpponent },
    ],
    turn: 0,
    day: 1,
    winner: null,
    endReason: null,
    fog,
    nextUnitId: 1,
    log: [],
    random,
  };

  for (const spec of startUnits) {
    state.units.push(spawnUnit(state, spec.type, spec.owner, spec.x, spec.y));
  }

  // Day 1 income lands before the human's first move, so there is something
  // to spend on turn one rather than a wasted opening turn.
  collectIncome(state, 0);
  return state;
}

export function spawnUnit(
  state: GameState,
  type: UnitId,
  owner: PlayerId,
  x: number,
  y: number,
): Unit {
  const def = UNITS[type];
  return {
    id: state.nextUnitId++,
    type,
    owner,
    x,
    y,
    hp: 100,
    fuel: def.maxFuel,
    ammo: def.maxAmmo,
    done: false,
    capturing: false,
    cargo: [],
  };
}

export function unitAt(state: GameState, x: number, y: number): Unit | undefined {
  return state.units.find((u) => u.x === x && u.y === y);
}

export function unitById(state: GameState, id: number): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

export function tileUnder(state: GameState, unit: Unit): Tile {
  return tileAt(state.map, unit.x, unit.y)!;
}

export function propertiesOf(state: GameState, player: PlayerId): number {
  return state.map.tiles.filter((t) => t.owner === player && TERRAIN[t.terrain].capturable)
    .length;
}

/* ------------------------------------------------------------------ *
 * Movement
 * ------------------------------------------------------------------ */

/**
 * Where this unit could go. Under fog the range is computed against the units
 * its owner can actually see, so a route may be planned straight through a
 * hidden enemy — that plan is what `resolveMovePath` later cuts short.
 */
export function movementRange(state: GameState, unit: Unit): Map<number, ReachableNode> {
  return reachable(state.map, unit, buildOccupancy(visibleUnits(state, unit.owner)));
}

/** Tiles the unit may actually finish its move on. */
export function landingTiles(state: GameState, unit: Unit): Point[] {
  const nodes = movementRange(state, unit);
  const out: Point[] = [];
  for (const node of nodes.values()) {
    if (node.canStop || (node.x === unit.x && node.y === unit.y)) {
      out.push({ x: node.x, y: node.y });
    }
  }
  return out;
}

/**
 * Move a unit along a path. Fuel is spent on the terrain actually crossed, and
 * an interrupted capture is forfeited the moment the unit steps off the tile.
 */
export function moveUnit(state: GameState, unit: Unit, path: readonly Point[]): void {
  if (path.length === 0) return;
  const destination = path[path.length - 1];
  if (destination.x === unit.x && destination.y === unit.y) return;

  let spent = 0;
  const def = UNITS[unit.type];
  for (let i = 1; i < path.length; i++) {
    const tile = tileAt(state.map, path[i].x, path[i].y)!;
    spent += TERRAIN[tile.terrain].cost[def.moveClass] ?? 0;
  }

  breakCapture(state, unit);
  unit.fuel = Math.max(0, unit.fuel - spent);
  unit.x = destination.x;
  unit.y = destination.y;
}

/** Give up any capture in progress and hand the property back its progress. */
export function breakCapture(state: GameState, unit: Unit): void {
  if (!unit.capturing) return;
  const tile = tileAt(state.map, unit.x, unit.y);
  if (tile !== null) tile.captureLeft = CAPTURE_POINTS;
  unit.capturing = false;
}

/* ------------------------------------------------------------------ *
 * Combat
 * ------------------------------------------------------------------ */

export interface Forecast {
  damage: number;
  /** Damage the defender deals back, or null when it cannot answer. */
  counter: number | null;
  destroys: boolean;
}

/**
 * What an attack would do, with luck fixed at zero. This is the number shown
 * before the player commits, so it must be the floor of the real outcome
 * rather than an average.
 */
export function forecast(state: GameState, attacker: Unit, defender: Unit): Forecast | null {
  const defenderTile = tileAt(state.map, defender.x, defender.y)!;
  const damage = computeDamage({
    attackerType: attacker.type,
    attackerHp: attacker.hp,
    attackerAmmo: attacker.ammo,
    defenderType: defender.type,
    defenderHp: defender.hp,
    defenderTerrain: defenderTile.terrain,
    luck: 0,
  });
  if (damage === null) return null;

  const remaining = defender.hp - damage;
  const destroys = remaining <= 0;

  let counter: number | null = null;
  if (!destroys && canCounter(state, attacker, defender)) {
    const attackerTile = tileAt(state.map, attacker.x, attacker.y)!;
    counter = computeDamage({
      attackerType: defender.type,
      attackerHp: remaining,
      attackerAmmo: defender.ammo,
      defenderType: attacker.type,
      defenderHp: attacker.hp,
      defenderTerrain: attackerTile.terrain,
      luck: 0,
    });
  }
  return { damage, counter, destroys };
}

/**
 * Only adjacent direct-fire units answer back. Artillery and rockets never
 * counter, and nothing counters them — which is the whole reason to field them.
 */
function canCounter(state: GameState, attacker: Unit, defender: Unit): boolean {
  const distance = Math.abs(attacker.x - defender.x) + Math.abs(attacker.y - defender.y);
  if (distance !== 1) return false;
  if (!hasWeapon(defender.type) || isIndirect(defender.type)) return false;
  return (
    computeDamage({
      attackerType: defender.type,
      attackerHp: defender.hp,
      attackerAmmo: defender.ammo,
      defenderType: attacker.type,
      defenderHp: attacker.hp,
      defenderTerrain: tileAt(state.map, attacker.x, attacker.y)!.terrain,
      luck: 0,
    }) !== null
  );
}

export function canAttack(state: GameState, attacker: Unit, defender: Unit): boolean {
  if (attacker.owner === defender.owner) return false;
  if (!inRange(attacker.type, attacker, defender)) return false;
  // You cannot shoot what you have not found.
  if (!canSeeUnit(state, attacker.owner, defender)) return false;
  return forecast(state, attacker, defender) !== null;
}

/** Enemies this unit could hit from where it currently stands. */
export function targetsFor(state: GameState, unit: Unit): Unit[] {
  return state.units.filter((other) => canAttack(state, unit, other));
}

export interface AttackResult {
  damage: number;
  counter: number;
  defenderDestroyed: boolean;
  attackerDestroyed: boolean;
}

export function attack(state: GameState, attacker: Unit, defender: Unit): AttackResult {
  const luck = Math.floor(state.random() * 10);
  const defenderTile = tileAt(state.map, defender.x, defender.y)!;

  const damage =
    computeDamage({
      attackerType: attacker.type,
      attackerHp: attacker.hp,
      attackerAmmo: attacker.ammo,
      defenderType: defender.type,
      defenderHp: defender.hp,
      defenderTerrain: defenderTile.terrain,
      luck,
    }) ?? 0;

  attacker.ammo = Math.max(0, attacker.ammo - ammoCost(attacker.type, defender.type, attacker.ammo));
  defender.hp -= damage;

  const result: AttackResult = {
    damage,
    counter: 0,
    defenderDestroyed: false,
    attackerDestroyed: false,
  };

  if (defender.hp <= 0) {
    destroyUnit(state, defender);
    result.defenderDestroyed = true;
    state.log.push(`${UNITS[attacker.type].name} 击毁了 ${UNITS[defender.type].name}`);
    finishAction(state, attacker);
    checkVictory(state);
    return result;
  }

  if (canCounter(state, attacker, defender)) {
    const counterLuck = Math.floor(state.random() * 10);
    const counter =
      computeDamage({
        attackerType: defender.type,
        attackerHp: defender.hp,
        attackerAmmo: defender.ammo,
        defenderType: attacker.type,
        defenderHp: attacker.hp,
        defenderTerrain: tileAt(state.map, attacker.x, attacker.y)!.terrain,
        luck: counterLuck,
      }) ?? 0;

    defender.ammo = Math.max(
      0,
      defender.ammo - ammoCost(defender.type, attacker.type, defender.ammo),
    );
    attacker.hp -= counter;
    result.counter = counter;

    if (attacker.hp <= 0) {
      destroyUnit(state, attacker);
      result.attackerDestroyed = true;
      state.log.push(`${UNITS[attacker.type].name} 被反击摧毁`);
      checkVictory(state);
      return result;
    }
  }

  finishAction(state, attacker);
  checkVictory(state);
  return result;
}

export function destroyUnit(state: GameState, unit: Unit): void {
  breakCapture(state, unit);
  const index = state.units.indexOf(unit);
  if (index >= 0) state.units.splice(index, 1);
}

/* ------------------------------------------------------------------ *
 * Capture, transport, production
 * ------------------------------------------------------------------ */

export function canCapture(state: GameState, unit: Unit): boolean {
  if (!UNITS[unit.type].canCapture) return false;
  const tile = tileUnder(state, unit);
  return TERRAIN[tile.terrain].capturable && tile.owner !== unit.owner;
}

/** Chip away at a property by the unit's current HP; 20 points takes it. */
export function capture(state: GameState, unit: Unit): boolean {
  const tile = tileUnder(state, unit);
  tile.captureLeft -= displayHp(unit.hp);
  unit.capturing = true;

  let captured = false;
  if (tile.captureLeft <= 0) {
    tile.owner = unit.owner;
    tile.captureLeft = CAPTURE_POINTS;
    unit.capturing = false;
    captured = true;
    state.log.push(`占领了${TERRAIN[tile.terrain].name}`);
  }

  finishAction(state, unit);
  checkVictory(state);
  return captured;
}

export function canLoadInto(carrier: Unit, passenger: Unit): boolean {
  const def = UNITS[carrier.type];
  return (
    carrier.owner === passenger.owner &&
    def.capacity > 0 &&
    carrier.cargo.length < def.capacity &&
    UNITS[passenger.type].isFoot
  );
}

export function loadUnit(state: GameState, carrier: Unit, passenger: Unit): void {
  breakCapture(state, passenger);
  const index = state.units.indexOf(passenger);
  if (index >= 0) state.units.splice(index, 1);
  carrier.cargo.push(passenger);
  finishAction(state, passenger);
  finishAction(state, carrier);
}

/** Tiles a carried unit could step out onto. */
export function unloadTiles(state: GameState, carrier: Unit): Point[] {
  if (carrier.cargo.length === 0) return [];
  const passenger = carrier.cargo[0];
  const def = UNITS[passenger.type];
  const out: Point[] = [];
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]) {
    const x = carrier.x + dx;
    const y = carrier.y + dy;
    const tile = tileAt(state.map, x, y);
    if (tile === null) continue;
    if (TERRAIN[tile.terrain].cost[def.moveClass] === null) continue;
    // The carrier itself is about to vacate its old tile, so it is not an
    // obstacle to its own passengers.
    const occupant = unitAt(state, x, y);
    if (occupant !== undefined && occupant.id !== carrier.id) continue;
    out.push({ x, y });
  }
  return out;
}

export function unloadUnit(state: GameState, carrier: Unit, at: Point): Unit | null {
  const passenger = carrier.cargo.shift();
  if (passenger === undefined) return null;
  passenger.x = at.x;
  passenger.y = at.y;
  passenger.done = true;
  state.units.push(passenger);
  finishAction(state, carrier);
  return passenger;
}

export function buildableAt(state: GameState, x: number, y: number): boolean {
  const tile = tileAt(state.map, x, y);
  if (tile === null) return false;
  return (
    TERRAIN[tile.terrain].builds &&
    tile.owner === state.turn &&
    unitAt(state, x, y) === undefined
  );
}

export function buildUnit(
  state: GameState,
  x: number,
  y: number,
  type: UnitId,
): Unit | null {
  if (!buildableAt(state, x, y)) return null;
  const player = state.players[state.turn];
  const cost = UNITS[type].cost;
  if (player.funds < cost) return null;

  player.funds -= cost;
  const unit = spawnUnit(state, type, state.turn, x, y);
  // Freshly built units cannot act until the following turn.
  unit.done = true;
  state.units.push(unit);
  state.log.push(`生产了${UNITS[type].name}`);
  return unit;
}

/* ------------------------------------------------------------------ *
 * Turn structure
 * ------------------------------------------------------------------ */

export function finishAction(state: GameState, unit: Unit): void {
  void state;
  unit.done = true;
}

function collectIncome(state: GameState, player: PlayerId): void {
  state.players[player].funds += propertiesOf(state, player) * INCOME_PER_PROPERTY;
}

/**
 * Units sitting on a friendly property are repaired, refuelled and rearmed.
 * Repairs are charged at the unit's per-HP build cost, so a wounded heavy is
 * an expensive thing to nurse back.
 */
function repairAndResupply(state: GameState, player: PlayerId): void {
  const wallet = state.players[player];
  for (const unit of state.units) {
    if (unit.owner !== player) continue;
    const tile = tileUnder(state, unit);
    if (!TERRAIN[tile.terrain].capturable || tile.owner !== player) continue;

    const def = UNITS[unit.type];
    unit.fuel = def.maxFuel;
    unit.ammo = def.maxAmmo;

    if (unit.hp >= 100) continue;
    const wanted = Math.min(2, Math.ceil((100 - unit.hp) / 10));
    const price = Math.round((def.cost / 10) * wanted);
    if (wallet.funds < price) continue;
    wallet.funds -= price;
    unit.hp = Math.min(100, unit.hp + wanted * 10);
  }
}

export function endTurn(state: GameState): void {
  if (state.winner !== null) return;

  for (const unit of state.units) {
    if (unit.owner === state.turn) unit.done = true;
  }

  state.turn = state.turn === 0 ? 1 : 0;
  if (state.turn === 0) state.day++;

  startTurn(state);
}

function startTurn(state: GameState): void {
  collectIncome(state, state.turn);
  repairAndResupply(state, state.turn);

  for (const unit of state.units) {
    if (unit.owner === state.turn) unit.done = false;
  }
  checkVictory(state);
}

export function checkVictory(state: GameState): void {
  if (state.winner !== null) return;

  for (const player of [0, 1] as PlayerId[]) {
    const enemy: PlayerId = player === 0 ? 1 : 0;

    const hq = findHq(state.map, enemy);
    if (hq === null) {
      state.winner = player;
      state.endReason = "hq";
      return;
    }
    if (!state.units.some((u) => u.owner === enemy)) {
      state.winner = player;
      state.endReason = "rout";
      return;
    }
  }
}

/** All the ways a selected unit could finish its turn on a given tile. */
export interface ActionMenu {
  canWait: boolean;
  canCapture: boolean;
  canAttack: boolean;
  canLoad: Unit | null;
  canUnload: boolean;
  targets: Unit[];
}

/**
 * Work out the menu for a unit standing at `at`. Indirect units lose their
 * attack option entirely once they have moved, which is the single rule that
 * makes artillery positioning matter.
 */
export function actionsAt(state: GameState, unit: Unit, at: Point, moved: boolean): ActionMenu {
  const probe: Unit = { ...unit, x: at.x, y: at.y };
  const tile = tileAt(state.map, at.x, at.y)!;

  const blockedByMove = moved && isIndirect(unit.type);
  const targets = blockedByMove
    ? []
    : visibleUnits(state, unit.owner).filter(
        (other) =>
          other.owner !== unit.owner &&
          other.id !== unit.id &&
          inRange(unit.type, at, other) &&
          forecast(state, probe, other) !== null,
      );

  const occupant = unitAt(state, at.x, at.y);
  const carrier =
    occupant !== undefined && occupant.id !== unit.id && canLoadInto(occupant, unit)
      ? occupant
      : null;

  return {
    canWait: carrier === null,
    canCapture:
      carrier === null &&
      UNITS[unit.type].canCapture &&
      TERRAIN[tile.terrain].capturable &&
      tile.owner !== unit.owner,
    canAttack: targets.length > 0,
    canLoad: carrier,
    canUnload: carrier === null && unit.cargo.length > 0 && unloadTilesAt(state, unit, at).length > 0,
    targets,
  };
}

/** Unload destinations for a carrier considered to be standing at `at`. */
export function unloadTilesAt(state: GameState, carrier: Unit, at: Point): Point[] {
  const probe: Unit = { ...carrier, x: at.x, y: at.y };
  return unloadTiles(state, probe);
}

/** Path from the unit's current tile to a destination inside its range. */
export function pathBetween(
  state: GameState,
  unit: Unit,
  destination: Point,
): Point[] {
  const nodes = movementRange(state, unit);
  if (!nodes.has(key(destination.x, destination.y))) return [];
  return pathTo(nodes, destination.x, destination.y);
}

export function neutralPropertyCount(state: GameState): number {
  return state.map.tiles.filter((t) => TERRAIN[t.terrain].capturable && t.owner === NEUTRAL)
    .length;
}
