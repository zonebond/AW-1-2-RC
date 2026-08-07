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

export interface UnitProfile {
  /** One-line summary of what this unit is for, shown in the build menu. */
  blurb: string;
  /** Ammo-consuming weapon, if any. */
  primary?: string;
  /** Unlimited fallback weapon, if any. */
  secondary?: string;
}

export const PROFILES: Record<UnitId, UnitProfile> = {
  infantry: {
    blurb: "最便宜的单位。占领建筑只能靠它，前期铺开的数量直接决定中期的收入。",
    secondary: "机枪",
  },
  mech: {
    blurb: "走得慢，但能翻山渡河，反装甲火力远强于步兵。守桥和守山地的首选。",
    primary: "火箭筒",
    secondary: "机枪",
  },
  recon: {
    blurb: "全场机动力最高、视野最广。专门收拾落单的步兵，碰上装甲要绕开。",
    secondary: "机枪",
  },
  apc: {
    blurb: "没有任何武器，用来把步兵快速送到前线。也能为相邻友军补给。",
  },
  artillery: {
    blurb: "便宜的间接火力。架好之后能在敌人够不到的距离输出，但移动后无法开火。",
    primary: "加农炮",
  },
  tank: {
    blurb: "攻守均衡的主力。造价不高、什么都能打，任何阶段买它都不算错。",
    primary: "坦克炮",
    secondary: "机枪",
  },
  antiair: {
    blurb: "对步兵伤害极高，是清扫敌方占领部队最有效的手段。对重装甲基本无力。",
    primary: "速射机炮",
  },
  rockets: {
    blurb: "射程最远的间接单位，能覆盖大片战场。装甲很薄，必须放在防线后面。",
    primary: "火箭发射器",
  },
  mdtank: {
    blurb: "最强的直射单位，正面几乎无解。代价是慢、贵，且怕被间接火力放风筝。",
    primary: "重型坦克炮",
    secondary: "机枪",
  },
};

/** Broad target classes, for the "what can this shoot" row in the build menu. */
export const FOOT_UNITS: readonly UnitId[] = ["infantry", "mech"];
export const VEHICLE_UNITS: readonly UnitId[] = [
  "recon",
  "apc",
  "artillery",
  "tank",
  "antiair",
  "rockets",
  "mdtank",
];
