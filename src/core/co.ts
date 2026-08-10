import { UNITS, isIndirect } from "./units";
import type { UnitId } from "./types";

/**
 * Commanders.
 *
 * These are original characters, not the series' cast — the same rule that
 * applies to every other asset here. What is borrowed is the *shape* of the
 * system: a always-on day-to-day bias, a meter that fills as you fight, and
 * two powers that spend it.
 *
 * Every commander is built for a land war, because that is the only war this
 * game currently fights. A naval or air specialist would be a dead pick.
 */

export type CoId = "steady" | "granite" | "edge" | "swift" | "thunder";

/** Which units a bonus applies to. */
export type Scope = "all" | "foot" | "indirect" | "direct";

export interface CoMods {
  /** Percent added to outgoing damage. 10 means +10%. */
  attack?: number;
  /** Percent added to defence. 10 means incoming damage is divided by 1.10. */
  defence?: number;
  /** Extra movement points for every unit. */
  move?: number;
  /** Extra maximum range, indirect units only. */
  range?: number;
  /** HP restored to every friendly unit the moment the power fires. */
  heal?: number;
  /** Restricts `attack` to a class of unit. Defaults to everything. */
  scope?: Scope;
}

export interface CoPower {
  name: string;
  description: string;
  mods: CoMods;
}

export interface CoDef {
  id: CoId;
  name: string;
  title: string;
  blurb: string;
  /** Accent colour for the portrait card, as a hex integer. */
  color: number;
  /** Emblem drawn on the procedural portrait. */
  emblem: "shield" | "blade" | "arrow" | "burst";
  /** Meter cost, in stars, of the normal and super power. */
  powerStars: number;
  superStars: number;
  /** Always on, no meter required. */
  d2d: CoMods;
  power: CoPower;
  super: CoPower;
}

const C = (d: CoDef): CoDef => d;

export const COS: Record<CoId, CoDef> = {
  steady: C({
    id: "steady",
    name: "常岚",
    title: "中流",
    blurb: "没有偏科，也没有短板。不确定选谁的时候就选他。",
    color: 0xc79a3c,
    emblem: "burst",
    powerStars: 3,
    superStars: 6,
    // Deliberately empty: this is the baseline every other commander is
    // measured against, and the game with him in the field plays exactly as
    // it did before commanders existed.
    d2d: {},
    power: {
      name: "整备",
      description: "本回合攻击 +15%，全军回复 1 HP",
      mods: { attack: 15, heal: 10 },
    },
    super: {
      name: "总攻",
      description: "本回合攻击 +30%、防御 +15%，全军回复 2 HP",
      mods: { attack: 30, defence: 15, heal: 20 },
    },
  }),
  granite: C({
    id: "granite",
    name: "石岩",
    title: "磐石",
    blurb: "守得住就赢得了。伤害吃得少，但也打得不重。",
    color: 0x5f8fbf,
    emblem: "shield",
    powerStars: 3,
    superStars: 6,
    d2d: { defence: 10, attack: -5 },
    power: {
      name: "掘壕",
      description: "本回合防御 +30%",
      mods: { defence: 30 },
    },
    super: {
      name: "铜墙",
      description: "本回合防御 +50%，全军回复 2 HP",
      mods: { defence: 50, heal: 20 },
    },
  }),
  edge: C({
    id: "edge",
    name: "凌锋",
    title: "锋刃",
    blurb: "把所有资源压在进攻上，代价是自己也不禁打。",
    color: 0xd4553a,
    emblem: "blade",
    powerStars: 3,
    superStars: 6,
    d2d: { attack: 15, defence: -12 },
    power: {
      name: "突刺",
      description: "本回合攻击 +25%",
      mods: { attack: 25 },
    },
    super: {
      name: "破阵",
      description: "本回合攻击 +45%，移动 +1",
      mods: { attack: 45, move: 1 },
    },
  }),
  swift: C({
    id: "swift",
    name: "苏晴",
    title: "疾行",
    blurb: "靠脚快和步兵抢地。正面硬碰不占便宜。",
    color: 0x4fae76,
    emblem: "arrow",
    powerStars: 3,
    superStars: 5,
    d2d: { attack: 15, scope: "foot" },
    power: {
      name: "疾进",
      description: "本回合全军移动 +1",
      mods: { move: 1 },
    },
    super: {
      name: "奔袭",
      description: "本回合移动 +2，步兵攻击 +30%",
      mods: { move: 2, attack: 30, scope: "foot" },
    },
  }),
  thunder: C({
    id: "thunder",
    name: "秦戈",
    title: "远雷",
    blurb: "火炮和火箭炮打得又远又狠，近身则很脆。",
    color: 0x8a6bc4,
    emblem: "burst",
    powerStars: 3,
    superStars: 6,
    d2d: { attack: 20, scope: "indirect" },
    power: {
      name: "弹幕",
      description: "本回合间接单位攻击 +40%",
      mods: { attack: 40, scope: "indirect" },
    },
    super: {
      name: "覆盖射击",
      description: "本回合间接单位射程 +1、攻击 +40%",
      mods: { attack: 40, range: 1, scope: "indirect" },
    },
  }),
};

export const CO_IDS = Object.keys(COS) as CoId[];

export function coById(id: CoId): CoDef {
  return COS[id];
}

/* ------------------------------------------------------------------ *
 * Meter
 * ------------------------------------------------------------------ */

/**
 * Power points in one star.
 *
 * The meter is denominated in funds: one point is one dollar of damage. A
 * star costs about three tanks' worth, which is what keeps powers to a
 * handful per match instead of one every turn. Tuned by running whole
 * headless matches and counting activations — see tools/simulate.ts.
 */
export const POINTS_PER_STAR = 20_000;

/**
 * Meter gained when `hpLost` internal HP is knocked off a unit of this type.
 * Both sides charge from the same exchange — the attacker for dealing it, the
 * defender, at half rate, for having survived it.
 */
export function chargeFor(type: UnitId, hpLost: number, role: "dealt" | "taken"): number {
  if (hpLost <= 0) return 0;
  const worth = UNITS[type].cost * (hpLost / 100);
  return worth * (role === "dealt" ? 1 : 0.5);
}

/** Stars currently filled, as a whole number. */
export function starsOf(charge: number): number {
  return Math.floor(charge / POINTS_PER_STAR);
}

/* ------------------------------------------------------------------ *
 * Applying modifiers
 * ------------------------------------------------------------------ */

function inScope(scope: Scope | undefined, type: UnitId): boolean {
  switch (scope ?? "all") {
    case "all":
      return true;
    case "foot":
      return UNITS[type].isFoot;
    case "indirect":
      return isIndirect(type);
    case "direct":
      return !isIndirect(type);
  }
}

/**
 * Fold a list of modifier sets into the numbers combat actually uses. The
 * day-to-day bias and an active power stack, which is exactly what makes a
 * power turn feel different rather than merely better.
 */
export function resolveMods(sets: readonly CoMods[], type: UnitId): Required<Omit<CoMods, "scope">> {
  let attack = 0;
  let defence = 0;
  let move = 0;
  let range = 0;
  let heal = 0;

  for (const mods of sets) {
    // Only the attack bonus is scoped; defence and movement are army-wide.
    if (mods.attack !== undefined && inScope(mods.scope, type)) attack += mods.attack;
    if (mods.defence !== undefined) defence += mods.defence;
    if (mods.move !== undefined) move += mods.move;
    if (mods.range !== undefined && isIndirect(type)) range += mods.range;
    if (mods.heal !== undefined) heal = Math.max(heal, mods.heal);
  }
  return { attack, defence, move, range, heal };
}
