import type { MoveClass, TerrainId } from "./types";

export interface TerrainDef {
  id: TerrainId;
  name: string;
  /** Defence stars, 0-4. Feeds straight into the damage formula. */
  defence: number;
  /** Movement cost per move class. null = impassable. */
  cost: Record<MoveClass, number | null>;
  /** Capturable properties generate funds and can be taken by foot units. */
  capturable: boolean;
  /** Bases build units; HQs end the game when captured. */
  builds: boolean;
  isHq: boolean;
  /** Blocks line of sight bonus / hides units in fog (reserved for fog of war). */
  hides: boolean;
}

const T = (d: TerrainDef): TerrainDef => d;

export const TERRAIN: Record<TerrainId, TerrainDef> = {
  plain: T({
    id: "plain",
    name: "平原",
    defence: 1,
    cost: { foot: 1, boots: 1, tires: 2, treads: 1 },
    capturable: false,
    builds: false,
    isHq: false,
    hides: false,
  }),
  wood: T({
    id: "wood",
    name: "森林",
    defence: 2,
    cost: { foot: 1, boots: 1, tires: 3, treads: 2 },
    capturable: false,
    builds: false,
    isHq: false,
    hides: true,
  }),
  mountain: T({
    id: "mountain",
    name: "山地",
    defence: 4,
    cost: { foot: 2, boots: 1, tires: null, treads: null },
    capturable: false,
    builds: false,
    isHq: false,
    hides: false,
  }),
  road: T({
    id: "road",
    name: "道路",
    defence: 0,
    cost: { foot: 1, boots: 1, tires: 1, treads: 1 },
    capturable: false,
    builds: false,
    isHq: false,
    hides: false,
  }),
  river: T({
    id: "river",
    name: "河流",
    defence: 0,
    cost: { foot: 2, boots: 1, tires: null, treads: null },
    capturable: false,
    builds: false,
    isHq: false,
    hides: false,
  }),
  city: T({
    id: "city",
    name: "城市",
    defence: 3,
    cost: { foot: 1, boots: 1, tires: 1, treads: 1 },
    capturable: true,
    builds: false,
    isHq: false,
    hides: false,
  }),
  base: T({
    id: "base",
    name: "工厂",
    defence: 3,
    cost: { foot: 1, boots: 1, tires: 1, treads: 1 },
    capturable: true,
    builds: true,
    isHq: false,
    hides: false,
  }),
  hq: T({
    id: "hq",
    name: "司令部",
    defence: 4,
    cost: { foot: 1, boots: 1, tires: 1, treads: 1 },
    capturable: true,
    builds: false,
    isHq: true,
    hides: false,
  }),
};

export function moveCost(terrain: TerrainId, moveClass: MoveClass): number | null {
  return TERRAIN[terrain].cost[moveClass];
}

/** Properties (city/base/hq) each pay this much per turn to their owner. */
export const INCOME_PER_PROPERTY = 1000;

/** A property takes this much capture progress to flip. */
export const CAPTURE_POINTS = 20;
