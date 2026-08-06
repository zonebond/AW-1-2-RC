import type { PlayerId } from "../core/types";

/**
 * A toy-plastic palette: saturated but slightly desaturated-in-shadow colours,
 * nothing pure black or pure white, so the standard material reads as moulded
 * plastic under a single warm key light rather than as flat vector art.
 */
export const PALETTE = {
  grassTop: 0x8cc760,
  grassSide: 0x6da344,
  grassAlt: 0x7fbc55,

  roadTop: 0xc9c2b4,
  roadSide: 0xa79f90,
  roadMark: 0xf0ece0,

  riverTop: 0x59b0dd,
  riverDeep: 0x2f7fae,

  rock: 0xa1968a,
  rockDark: 0x7d7266,
  snow: 0xeef2f4,

  foliage: 0x57a447,
  foliageDark: 0x3f8035,
  trunk: 0x7d5a3c,

  concrete: 0xdad5c9,
  concreteDark: 0xb3ac9d,
  window: 0x86c5e8,
  roofNeutral: 0xa8a196,

  sky: 0xbfe3f5,
  ground: 0x6b7a55,
  fog: 0xcfe6f2,
} as const;

export interface TeamColors {
  name: string;
  primary: number;
  dark: number;
  light: number;
  accent: number;
}

/** Orange Star and Blue Moon in spirit: warm red-orange versus cool blue. */
export const TEAMS: Record<PlayerId, TeamColors> = {
  0: {
    name: "红星军",
    primary: 0xf07a2a,
    dark: 0xbf5514,
    light: 0xffa860,
    accent: 0xffd9a0,
  },
  1: {
    name: "蓝月军",
    primary: 0x3f81d8,
    dark: 0x2755a0,
    light: 0x79b0f0,
    accent: 0xc2ddff,
  },
};

/** Unowned properties are moulded in bare off-white plastic. */
export const NEUTRAL_COLORS: TeamColors = {
  name: "中立",
  primary: 0xcfc9bc,
  dark: 0x9d968a,
  light: 0xe8e3d8,
  accent: 0xf5f2ea,
};
