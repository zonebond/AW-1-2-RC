import type { MoveClass, UnitId } from "./types";

export interface UnitDef {
  id: UnitId;
  name: string;
  cost: number;
  move: number;
  moveClass: MoveClass;
  vision: number;
  maxAmmo: number;
  maxFuel: number;
  /** Attack range in tiles. min > 1 means indirect: it may not move and fire. */
  rangeMin: number;
  rangeMax: number;
  canCapture: boolean;
  /** How many foot units this can carry. 0 = not a transport. */
  capacity: number;
  /** Foot units are the only thing an APC will load. */
  isFoot: boolean;
}

const U = (d: UnitDef): UnitDef => d;

export const UNITS: Record<UnitId, UnitDef> = {
  infantry: U({
    id: "infantry",
    name: "步兵",
    cost: 1000,
    move: 3,
    moveClass: "foot",
    vision: 2,
    maxAmmo: 0,
    maxFuel: 99,
    rangeMin: 1,
    rangeMax: 1,
    canCapture: true,
    capacity: 0,
    isFoot: true,
  }),
  mech: U({
    id: "mech",
    name: "机步",
    cost: 3000,
    move: 2,
    moveClass: "boots",
    vision: 2,
    maxAmmo: 3,
    maxFuel: 70,
    rangeMin: 1,
    rangeMax: 1,
    canCapture: true,
    capacity: 0,
    isFoot: true,
  }),
  recon: U({
    id: "recon",
    name: "侦察车",
    cost: 4000,
    move: 8,
    moveClass: "tires",
    vision: 5,
    maxAmmo: 0,
    maxFuel: 80,
    rangeMin: 1,
    rangeMax: 1,
    canCapture: false,
    capacity: 0,
    isFoot: false,
  }),
  apc: U({
    id: "apc",
    name: "运输车",
    cost: 5000,
    move: 6,
    moveClass: "treads",
    vision: 1,
    maxAmmo: 0,
    maxFuel: 70,
    rangeMin: 0,
    rangeMax: 0,
    canCapture: false,
    capacity: 1,
    isFoot: false,
  }),
  artillery: U({
    id: "artillery",
    name: "火炮",
    cost: 6000,
    move: 5,
    moveClass: "treads",
    vision: 1,
    maxAmmo: 9,
    maxFuel: 50,
    rangeMin: 2,
    rangeMax: 3,
    canCapture: false,
    capacity: 0,
    isFoot: false,
  }),
  tank: U({
    id: "tank",
    name: "坦克",
    cost: 7000,
    move: 6,
    moveClass: "treads",
    vision: 3,
    maxAmmo: 9,
    maxFuel: 70,
    rangeMin: 1,
    rangeMax: 1,
    canCapture: false,
    capacity: 0,
    isFoot: false,
  }),
  antiair: U({
    id: "antiair",
    name: "防空车",
    cost: 8000,
    move: 6,
    moveClass: "treads",
    vision: 2,
    maxAmmo: 9,
    maxFuel: 60,
    rangeMin: 1,
    rangeMax: 1,
    canCapture: false,
    capacity: 0,
    isFoot: false,
  }),
  rockets: U({
    id: "rockets",
    name: "火箭炮",
    cost: 15000,
    move: 5,
    moveClass: "tires",
    vision: 1,
    maxAmmo: 6,
    maxFuel: 50,
    rangeMin: 3,
    rangeMax: 5,
    canCapture: false,
    capacity: 0,
    isFoot: false,
  }),
  mdtank: U({
    id: "mdtank",
    name: "重坦",
    cost: 16000,
    move: 5,
    moveClass: "treads",
    vision: 1,
    maxAmmo: 8,
    maxFuel: 50,
    rangeMin: 1,
    rangeMax: 1,
    canCapture: false,
    capacity: 0,
    isFoot: false,
  }),
};

/** Production menu order — cheapest first, the way the base menu reads. */
export const BUILD_ORDER: readonly UnitId[] = [
  "infantry",
  "mech",
  "recon",
  "apc",
  "artillery",
  "tank",
  "antiair",
  "rockets",
  "mdtank",
];

export function isIndirect(id: UnitId): boolean {
  return UNITS[id].rangeMin > 1;
}

export function hasWeapon(id: UnitId): boolean {
  return UNITS[id].rangeMax > 0;
}
