import { TERRAIN } from "./terrain";
import { UNITS, hasWeapon } from "./units";
import type { TerrainId, UnitId } from "./types";

/**
 * Base damage chart, attacker -> defender, in internal HP points (0-100).
 *
 * `primary` consumes ammo and is the heavy weapon; `secondary` is the
 * machine gun and never runs dry. A unit falls back to the secondary when
 * the primary is empty, exactly like the games this borrows from.
 */
interface WeaponTable {
  primary?: Partial<Record<UnitId, number>>;
  secondary?: Partial<Record<UnitId, number>>;
}

export const DAMAGE: Record<UnitId, WeaponTable> = {
  infantry: {
    secondary: {
      infantry: 55,
      mech: 45,
      recon: 12,
      apc: 14,
      artillery: 15,
      tank: 5,
      antiair: 5,
      rockets: 25,
      mdtank: 1,
    },
  },
  mech: {
    primary: {
      recon: 85,
      apc: 75,
      artillery: 70,
      tank: 55,
      antiair: 65,
      rockets: 85,
      mdtank: 15,
    },
    secondary: { infantry: 65, mech: 55 },
  },
  recon: {
    secondary: {
      infantry: 70,
      mech: 65,
      recon: 35,
      apc: 45,
      artillery: 45,
      tank: 6,
      antiair: 4,
      rockets: 55,
      mdtank: 1,
    },
  },
  apc: {},
  artillery: {
    primary: {
      infantry: 90,
      mech: 85,
      recon: 80,
      apc: 70,
      artillery: 75,
      tank: 70,
      antiair: 75,
      rockets: 80,
      mdtank: 45,
    },
  },
  tank: {
    primary: {
      recon: 85,
      apc: 75,
      artillery: 70,
      tank: 55,
      antiair: 65,
      rockets: 85,
      mdtank: 15,
    },
    secondary: { infantry: 75, mech: 70 },
  },
  antiair: {
    primary: {
      infantry: 105,
      mech: 105,
      recon: 60,
      apc: 50,
      artillery: 50,
      tank: 25,
      antiair: 45,
      rockets: 45,
      mdtank: 10,
    },
  },
  rockets: {
    primary: {
      infantry: 95,
      mech: 90,
      recon: 90,
      apc: 80,
      artillery: 80,
      tank: 80,
      antiair: 85,
      rockets: 85,
      mdtank: 55,
    },
  },
  mdtank: {
    primary: {
      recon: 105,
      apc: 105,
      artillery: 105,
      tank: 85,
      antiair: 105,
      rockets: 105,
      mdtank: 55,
    },
    secondary: { infantry: 105, mech: 95 },
  },
};

export type WeaponSlot = "primary" | "secondary";

export interface WeaponChoice {
  slot: WeaponSlot;
  base: number;
}

/**
 * Pick the weapon that actually fires: the primary if it can hurt the target
 * and has ammo left, otherwise the secondary. Returns null when the attacker
 * simply cannot engage this target.
 */
export function chooseWeapon(
  attacker: UnitId,
  defender: UnitId,
  ammo: number,
): WeaponChoice | null {
  const table = DAMAGE[attacker];
  const primary = table.primary?.[defender];
  if (primary !== undefined && ammo > 0) return { slot: "primary", base: primary };
  const secondary = table.secondary?.[defender];
  if (secondary !== undefined) return { slot: "secondary", base: secondary };
  return null;
}

/** True if this attacker has any weapon at all that touches this defender. */
export function canTarget(attacker: UnitId, defender: UnitId): boolean {
  if (!hasWeapon(attacker)) return false;
  const table = DAMAGE[attacker];
  return table.primary?.[defender] !== undefined || table.secondary?.[defender] !== undefined;
}

/** Display HP is 1-10, derived from the 0-100 internal pool. */
export function displayHp(internalHp: number): number {
  return Math.max(0, Math.ceil(internalHp / 10));
}

export interface DamageInput {
  attackerType: UnitId;
  attackerHp: number;
  attackerAmmo: number;
  defenderType: UnitId;
  defenderHp: number;
  defenderTerrain: TerrainId;
  /** 0-9 luck roll. Pass 0 for the deterministic forecast shown in the UI. */
  luck: number;
  /** Attacker's commander bonus, in percent. 10 means +10% damage. */
  attackBonus?: number;
  /** Defender's commander bonus, in percent. 10 means incoming / 1.10. */
  defenceBonus?: number;
}

/**
 * D = (base x atk% + luck) x (attackerHP/10) x (100 - terrainStars x defenderHP) / 100 / def%
 *
 * All three HP values are the 1-10 display figure, which is why a wounded
 * unit both hits softer and — sitting on cover — takes more.
 *
 * The commander bonuses bracket that core: the attacker's scales the weapon's
 * base value before luck is added, so luck stays a flat roll rather than being
 * amplified by a power; the defender's divides at the very end, which keeps
 * "+10% defence" meaning the same thing regardless of what hit you.
 */
export function computeDamage(input: DamageInput): number | null {
  const weapon = chooseWeapon(input.attackerType, input.defenderType, input.attackerAmmo);
  if (weapon === null) return null;

  const atkHp = displayHp(input.attackerHp);
  const defHp = displayHp(input.defenderHp);
  if (atkHp <= 0 || defHp <= 0) return null;

  const attackMul = (100 + (input.attackBonus ?? 0)) / 100;
  const defenceDiv = Math.max(0.1, (100 + (input.defenceBonus ?? 0)) / 100);

  const stars = TERRAIN[input.defenderTerrain].defence;
  const defenceMultiplier = (100 - stars * defHp) / 100;
  const raw =
    ((weapon.base * attackMul + input.luck) * (atkHp / 10) * defenceMultiplier) / defenceDiv;
  return Math.max(0, Math.floor(raw));
}

/** Forecast the UI shows before you commit: damage as a 0-100% figure. */
export function forecastPercent(input: DamageInput): number | null {
  const dmg = computeDamage({ ...input, luck: 0 });
  if (dmg === null) return null;
  return dmg;
}

/** Ammo the chosen weapon will burn. Secondary weapons are free. */
export function ammoCost(attacker: UnitId, defender: UnitId, ammo: number): number {
  const weapon = chooseWeapon(attacker, defender, ammo);
  return weapon?.slot === "primary" ? 1 : 0;
}

export function unitValue(id: UnitId, hp: number): number {
  return (UNITS[id].cost * displayHp(hp)) / 10;
}
