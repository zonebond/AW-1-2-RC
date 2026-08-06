import { NEUTRAL, type Owner, type PlayerId, type TerrainId } from "./types";
import { CAPTURE_POINTS } from "./terrain";

export interface Tile {
  terrain: TerrainId;
  owner: Owner;
  /** Capture progress remaining. Resets to full whenever the capture breaks. */
  captureLeft: number;
}

export interface GameMap {
  name: string;
  width: number;
  height: number;
  tiles: Tile[];
}

/**
 * Maps are written as a grid of two-character cells:
 *
 *   ..  plain      ff  forest    ^^  mountain
 *   ==  road       ~~  river
 *   c.  city (neutral)   c0 / c1  city owned by player 0 / 1
 *   b.  base (neutral)   b0 / b1  base owned by player 0 / 1
 *   h0 / h1  headquarters
 *
 * Two characters per tile keeps ownership explicit without a second layer,
 * and the rows still line up visually when you read the source.
 */
const TERRAIN_CHARS: Record<string, TerrainId> = {
  "..": "plain",
  ff: "wood",
  "^^": "mountain",
  "==": "road",
  "~~": "river",
};

const PROPERTY_CHARS: Record<string, TerrainId> = {
  c: "city",
  b: "base",
  h: "hq",
};

function parseOwner(ch: string): Owner {
  if (ch === "0") return 0;
  if (ch === "1") return 1;
  return NEUTRAL;
}

export function parseMap(name: string, rows: readonly string[]): GameMap {
  if (rows.length === 0) throw new Error(`map "${name}" has no rows`);
  const height = rows.length;
  const width = rows[0].length / 2;
  if (!Number.isInteger(width)) {
    throw new Error(`map "${name}" row 0 has odd length ${rows[0].length}`);
  }

  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    if (row.length !== width * 2) {
      throw new Error(`map "${name}" row ${y} is ${row.length / 2} wide, expected ${width}`);
    }
    for (let x = 0; x < width; x++) {
      const cell = row.slice(x * 2, x * 2 + 2);
      const plainTerrain = TERRAIN_CHARS[cell];
      if (plainTerrain !== undefined) {
        tiles.push({ terrain: plainTerrain, owner: NEUTRAL, captureLeft: CAPTURE_POINTS });
        continue;
      }
      const propertyTerrain = PROPERTY_CHARS[cell[0]];
      if (propertyTerrain === undefined) {
        throw new Error(`map "${name}" has unknown cell "${cell}" at ${x},${y}`);
      }
      tiles.push({
        terrain: propertyTerrain,
        owner: parseOwner(cell[1]),
        captureLeft: CAPTURE_POINTS,
      });
    }
  }
  return { name, width, height, tiles };
}

export function tileAt(map: GameMap, x: number, y: number): Tile | null {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  return map.tiles[y * map.width + x];
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

/** Where each player's HQ sits. Used for AI targeting and win checks. */
export function findHq(map: GameMap, player: PlayerId): { x: number; y: number } | null {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y * map.width + x];
      if (tile.terrain === "hq" && tile.owner === player) return { x, y };
    }
  }
  return null;
}
