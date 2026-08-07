import * as THREE from "three";
import { tileAt, type GameMap } from "../core/map";
import { buildTerrainTile, SLAB_H, TILE, type TileContext } from "./terrainModels";
import { plastic } from "./materials";
import { bake, roundedBox } from "./geometry";
import { TERRAIN } from "../core/terrain";
import type { TerrainId } from "../core/types";

/** Tile (x, y) sits at world (x - w/2, 0, y - h/2), so the board is centred. */
export function worldX(map: GameMap, x: number): number {
  return (x - (map.width - 1) / 2) * TILE;
}

export function worldZ(map: GameMap, y: number): number {
  return (y - (map.height - 1) / 2) * TILE;
}

function neighbourTerrain(map: GameMap, x: number, y: number): TerrainId | null {
  return tileAt(map, x, y)?.terrain ?? null;
}

export interface Board {
  group: THREE.Group;
  map: GameMap;
}

/**
 * Terrain splits in two: scenery that never changes gets baked into a handful
 * of merged meshes, while properties stay as individual groups because their
 * roofs and flags have to be rebuilt the moment they are captured.
 */
export function buildBoard(map: GameMap): Board {
  const group = new THREE.Group();
  const scenery = new THREE.Group();

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = tileAt(map, x, y)!;
      const ctx: TileContext = {
        terrain: tile.terrain,
        owner: tile.owner,
        x,
        y,
        north: neighbourTerrain(map, x, y - 1),
        east: neighbourTerrain(map, x + 1, y),
        south: neighbourTerrain(map, x, y + 1),
        west: neighbourTerrain(map, x - 1, y),
      };
      const mesh = buildTerrainTile(ctx);
      mesh.position.set(worldX(map, x), 0, worldZ(map, y));
      if (TERRAIN[tile.terrain].capturable) group.add(mesh);
      else scenery.add(mesh);
    }
  }

  scenery.add(baseplate(map));
  group.add(bake(scenery));
  return { group, map };
}

/**
 * The board sits on a moulded baseplate with a lip, the way a boxed toy
 * battlefield would. It also catches the shadows that fall off the edge.
 */
function baseplate(map: GameMap): THREE.Group {
  const group = new THREE.Group();
  const w = map.width * TILE;
  const h = map.height * TILE;

  const plate = new THREE.Mesh(
    roundedBox(w + 0.7, 0.34, h + 0.7, 0.12),
    plastic(0xb9b2a4, { roughness: 0.8 }),
  );
  plate.position.y = -SLAB_H - 0.17 + 0.02;
  plate.receiveShadow = true;
  group.add(plate);

  const trim = new THREE.Mesh(
    roundedBox(w + 1.05, 0.16, h + 1.05, 0.06),
    plastic(0x8e8779, { roughness: 0.85 }),
  );
  trim.position.y = -SLAB_H - 0.36;
  trim.receiveShadow = true;
  group.add(trim);

  return group;
}
