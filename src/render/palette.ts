import type { PlayerId } from "../core/types";

/**
 * A toy-plastic palette: saturated but slightly desaturated-in-shadow colours,
 * nothing pure black or pure white, so the standard material reads as moulded
 * plastic under a single warm key light rather than as flat vector art.
 */
export const PALETTE = {
  // Grass is pushed well towards yellow-green and high saturation; a muted
  // pastel field reads as a diagram, not a toy battlefield.
  grassTop: 0x8ed246,
  grassAlt: 0x83c73d,
  grassSide: 0x5d9a2e,
  /** Darker line between tiles, so the grid is countable at a glance. */
  grout: 0x6cab33,

  roadTop: 0xa8a49b,
  roadSide: 0x86837b,
  roadMark: 0xf7f4ec,

  riverTop: 0x4ec8f0,
  riverDeep: 0x2596c8,
  /** Exposed earth where land drops away to water. */
  bank: 0xc9803c,
  bankDark: 0x9c5a22,

  shrub: 0xe8a42c,
  shrubDark: 0xc47f18,

  // Rock is warm tan rather than grey: the reference peaks read as sun-baked
  // earth, and grey stone against saturated grass looks like missing texture.
  rock: 0xb28f61,
  rockDark: 0x8a6a42,
  rockLight: 0xd9c39a,
  snow: 0xf0f2f2,

  foliage: 0x57a447,
  foliageDark: 0x3f8035,
  trunk: 0x7d5a3c,

  concrete: 0xeeeae0,
  concreteDark: 0xc7bfae,
  concreteShade: 0xd6d0c2,
  window: 0x74bfe8,
  windowLit: 0xa8dcf5,
  roofNeutral: 0xa8a196,
  yard: 0x9d9689,

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
