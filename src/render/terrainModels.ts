import * as THREE from "three";
import { NEUTRAL_COLORS, PALETTE, TEAMS, type TeamColors } from "./palette";
import { glass, metal, plastic, rubber } from "./materials";
import { bake, cylinder, part, pick, roundedBox, sphere, tileRandom } from "./geometry";
import { NEUTRAL, type Owner, type TerrainId } from "../core/types";

/** One tile is one world unit. Everything else is expressed as a fraction. */
export const TILE = 1;
/** Terrain slabs are this thick; their top face is the y = 0 play surface. */
export const SLAB_H = 0.5;

export interface TileContext {
  terrain: TerrainId;
  owner: Owner;
  x: number;
  y: number;
  /** Neighbour terrain, for road joins and river banks. null = off-map. */
  north: TerrainId | null;
  east: TerrainId | null;
  south: TerrainId | null;
  west: TerrainId | null;
}

function ownerColors(owner: Owner): TeamColors {
  return owner === NEUTRAL ? NEUTRAL_COLORS : TEAMS[owner];
}

function isRoadLike(terrain: TerrainId | null): boolean {
  return terrain === "road" || terrain === "city" || terrain === "base" || terrain === "hq";
}

/**
 * The slab every land tile stands on.
 *
 * The top face is inset and sits on a slightly larger, darker block, so the
 * gap between neighbouring tiles reads as a drawn grid line. Being able to
 * count tiles at a glance matters more here than a seamless field.
 */
function groundSlab(top: number, side: number, grout = PALETTE.grout): THREE.Mesh {
  const mesh = part(roundedBox(TILE * 0.968, SLAB_H, TILE * 0.968, 0.04), plastic(top), 0, -SLAB_H / 2, 0);

  const base = part(roundedBox(TILE, SLAB_H * 0.92, TILE, 0.03), plastic(grout));
  base.position.y = -SLAB_H * 0.06;
  mesh.add(base);

  const skirt = part(roundedBox(TILE * 0.995, SLAB_H * 0.5, TILE * 0.995, 0.03), plastic(side));
  skirt.position.y = -SLAB_H * 0.74;
  mesh.add(skirt);
  return mesh;
}

function grassSlab(ctx: TileContext): THREE.Mesh {
  const shade = tileRandom(ctx.x, ctx.y, 11);
  const top = pick([PALETTE.grassTop, PALETTE.grassAlt, PALETTE.grassTop], shade);
  return groundSlab(top, PALETTE.grassSide);
}

/** Flag pole + banner, so ownership is legible from any camera angle. */
function flag(colors: TeamColors, height = 0.46): THREE.Group {
  const group = new THREE.Group();
  group.add(part(cylinder(0.016, 0.016, height, 8), metal(0xd8d8d8), 0, height / 2, 0));
  const banner = part(roundedBox(0.2, 0.13, 0.022, 0.012), plastic(colors.primary));
  banner.position.set(0.11, height - 0.09, 0);
  group.add(banner);
  group.add(part(sphere(0.028, 10), plastic(colors.light), 0, height + 0.01, 0));
  return group;
}

function buildPlain(ctx: TileContext): THREE.Group {
  const group = new THREE.Group();
  group.add(grassSlab(ctx));

  // Roughly a third of plains carry a warm shrub clump; the rest get a couple
  // of small green tufts. The mix is what stops a wide field reading as a
  // single flat colour.
  if (tileRandom(ctx.x, ctx.y, 2) > 0.66) {
    const cx = (tileRandom(ctx.x, ctx.y, 21) - 0.5) * 0.34;
    const cz = (tileRandom(ctx.x, ctx.y, 22) - 0.5) * 0.34;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + tileRandom(ctx.x, ctx.y, 23) * 3;
      const reach = 0.09 + tileRandom(ctx.x, ctx.y, 24 + i) * 0.07;
      const blade = part(
        new THREE.ConeGeometry(0.05, 0.12, 5),
        plastic(i % 2 === 0 ? PALETTE.shrub : PALETTE.shrubDark, { flatShading: true }),
        cx + Math.cos(angle) * reach,
        0.05,
        cz + Math.sin(angle) * reach,
      );
      blade.rotation.z = Math.cos(angle) * 0.5;
      blade.rotation.x = -Math.sin(angle) * 0.5;
      blade.castShadow = false;
      group.add(blade);
    }
    return group;
  }

  const count = tileRandom(ctx.x, ctx.y, 3) > 0.55 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const rx = (tileRandom(ctx.x, ctx.y, 20 + i) - 0.5) * 0.58;
    const rz = (tileRandom(ctx.x, ctx.y, 40 + i) - 0.5) * 0.58;
    const tuft = part(sphere(0.05, 8), plastic(PALETTE.foliageDark, { flatShading: true }));
    tuft.scale.set(1, 0.5, 1);
    tuft.position.set(rx, 0.02, rz);
    tuft.castShadow = false;
    group.add(tuft);
  }
  return group;
}

function buildRoad(ctx: TileContext): THREE.Group {
  const group = new THREE.Group();
  const overWater =
    ctx.north === "river" || ctx.east === "river" || ctx.south === "river" || ctx.west === "river";

  if (overWater) {
    // Bridges sit on water, so the slab underneath is river, not soil.
    group.add(buildRiverBed(ctx));
  } else {
    group.add(grassSlab(ctx));
  }

  const surfaceY = overWater ? 0.06 : 0.012;
  const deck = plastic(PALETTE.roadTop, { roughness: 0.75 });

  const links: Array<[boolean, number, number, number, number]> = [
    [isRoadLike(ctx.north), 0, -0.34, 0.62, 0.34],
    [isRoadLike(ctx.south), 0, 0.34, 0.62, 0.34],
    [isRoadLike(ctx.west), -0.34, 0, 0.34, 0.62],
    [isRoadLike(ctx.east), 0.34, 0, 0.34, 0.62],
  ];

  const anyLink = links.some(([connected]) => connected);
  // An isolated road tile still needs a surface, so fall back to a full patch.
  const centre = part(
    roundedBox(anyLink ? 0.62 : 0.86, 0.05, anyLink ? 0.62 : 0.86, 0.02),
    deck,
    0,
    surfaceY,
    0,
  );
  centre.castShadow = false;
  group.add(centre);

  for (const [connected, dx, dz, w, d] of links) {
    if (!connected) continue;
    const arm = part(roundedBox(w, 0.05, d, 0.02), deck, dx, surfaceY, dz);
    arm.castShadow = false;
    group.add(arm);
  }

  // Centre line dashes, drawn along whichever axis the road actually runs.
  const runsVertical = isRoadLike(ctx.north) || isRoadLike(ctx.south);
  const runsHorizontal = isRoadLike(ctx.east) || isRoadLike(ctx.west);
  const mark = plastic(PALETTE.roadMark, { roughness: 0.8 });
  if (runsVertical !== runsHorizontal) {
    for (const offset of [-0.26, 0.26]) {
      const dash = runsVertical
        ? part(roundedBox(0.06, 0.02, 0.2, 0.008), mark, 0, surfaceY + 0.026, offset)
        : part(roundedBox(0.2, 0.02, 0.06, 0.008), mark, offset, surfaceY + 0.026, 0);
      dash.castShadow = false;
      group.add(dash);
    }
  }

  if (overWater) {
    const railing = plastic(PALETTE.concrete, { roughness: 0.7 });
    // Railings run along the road's own axis, on both shoulders.
    const along = runsVertical || !runsHorizontal;
    for (const side of [-0.42, 0.42]) {
      const rail = along
        ? part(roundedBox(0.06, 0.16, 0.98, 0.025), railing, side, surfaceY + 0.09, 0)
        : part(roundedBox(0.98, 0.16, 0.06, 0.025), railing, 0, surfaceY + 0.09, side);
      group.add(rail);
    }
  }
  return group;
}

/** True where a tile is water rather than something you can stand on. */
function isWater(terrain: TerrainId | null): boolean {
  return terrain === "river";
}

/**
 * Water sits below the land, and every edge where it meets solid ground shows
 * a lip of exposed orange earth. That bank is what stops a river reading as a
 * blue rug laid over the grass.
 */
function buildRiverBed(ctx?: TileContext): THREE.Group {
  const group = new THREE.Group();
  const bed = part(
    roundedBox(TILE, SLAB_H, TILE, 0.045),
    plastic(PALETTE.riverDeep, { roughness: 0.5 }),
    0,
    -SLAB_H / 2 - 0.1,
    0,
  );
  bed.castShadow = false;
  group.add(bed);

  const surface = part(
    roundedBox(TILE * 0.999, 0.1, TILE * 0.999, 0.02),
    plastic(PALETTE.riverTop, {
      roughness: 0.1,
      metalness: 0.06,
      transparent: true,
      opacity: 0.86,
    }),
    0,
    -0.13,
    0,
  );
  surface.castShadow = false;
  group.add(surface);

  if (ctx !== undefined) {
    const edges: Array<[TerrainId | null, number, number, number, number]> = [
      [ctx.north, 0, -0.485, TILE, 0.07],
      [ctx.south, 0, 0.485, TILE, 0.07],
      [ctx.west, -0.485, 0, 0.07, TILE],
      [ctx.east, 0.485, 0, 0.07, TILE],
    ];
    for (const [neighbour, dx, dz, w, d] of edges) {
      // Off-map counts as land, so the river is walled in at the board edge.
      if (isWater(neighbour)) continue;
      group.add(part(roundedBox(w, 0.26, d, 0.025), plastic(PALETTE.bank), dx, -0.19, dz));
      group.add(
        part(roundedBox(w * 0.96, 0.05, d * 0.96, 0.018), plastic(PALETTE.bankDark), dx, -0.055, dz),
      );
    }
  }
  return group;
}

function buildRiver(ctx: TileContext): THREE.Group {
  const group = buildRiverBed(ctx);
  // Foam flecks give the water some life without an animated shader.
  for (let i = 0; i < 2; i++) {
    const roll = tileRandom(ctx.x, ctx.y, 60 + i);
    if (roll < 0.45) continue;
    const fleck = part(
      roundedBox(0.22, 0.02, 0.07, 0.01),
      plastic(0xdff2fb, { roughness: 0.3, transparent: true, opacity: 0.7 }),
      (tileRandom(ctx.x, ctx.y, 70 + i) - 0.5) * 0.5,
      -0.07,
      (tileRandom(ctx.x, ctx.y, 80 + i) - 0.5) * 0.5,
    );
    fleck.castShadow = false;
    group.add(fleck);
  }
  return group;
}

function buildWood(ctx: TileContext): THREE.Group {
  const group = new THREE.Group();
  group.add(grassSlab(ctx));

  // A stand of many small conifers, not a handful of big ones. The reference
  // packs six to nine per tile, and that density is most of what makes a
  // forest read as a forest from the play camera.
  const count = 6 + Math.floor(tileRandom(ctx.x, ctx.y, 5) * 4);
  for (let i = 0; i < count; i++) {
    const rx = (tileRandom(ctx.x, ctx.y, 100 + i) - 0.5) * 0.74;
    const rz = (tileRandom(ctx.x, ctx.y, 130 + i) - 0.5) * 0.74;
    const scale = 0.7 + tileRandom(ctx.x, ctx.y, 160 + i) * 0.5;

    const tree = new THREE.Group();
    tree.add(part(cylinder(0.02, 0.026, 0.09, 6), plastic(PALETTE.trunk), 0, 0.045, 0));

    // Two stacked cones read as a conifer far more cheaply than a real canopy.
    const lower = part(
      new THREE.ConeGeometry(0.115, 0.17, 6),
      plastic(PALETTE.foliageDark, { flatShading: true }),
      0,
      0.15,
      0,
    );
    const upper = part(
      new THREE.ConeGeometry(0.085, 0.15, 6),
      plastic(PALETTE.foliage, { flatShading: true }),
      0,
      0.26,
      0,
    );
    tree.add(lower, upper);
    tree.position.set(rx, 0, rz);
    tree.scale.setScalar(scale);
    tree.rotation.y = tileRandom(ctx.x, ctx.y, 190 + i) * Math.PI * 2;
    group.add(tree);
  }
  return group;
}

function buildMountain(ctx: TileContext): THREE.Group {
  const group = new THREE.Group();
  group.add(groundSlab(PALETTE.rockDark, PALETTE.rockDark));

  const height = 0.62 + tileRandom(ctx.x, ctx.y, 7) * 0.22;
  const peak = part(
    new THREE.ConeGeometry(0.46, height, 5),
    plastic(PALETTE.rock, { flatShading: true, roughness: 0.8 }),
    0,
    height / 2,
    0,
  );
  peak.rotation.y = tileRandom(ctx.x, ctx.y, 8) * Math.PI * 2;
  group.add(peak);

  // A smaller shoulder peak stops every mountain looking identical.
  const shoulderH = height * 0.55;
  const shoulder = part(
    new THREE.ConeGeometry(0.24, shoulderH, 5),
    plastic(PALETTE.rockDark, { flatShading: true, roughness: 0.85 }),
    (tileRandom(ctx.x, ctx.y, 9) - 0.5) * 0.42,
    shoulderH / 2,
    (tileRandom(ctx.x, ctx.y, 10) - 0.5) * 0.42,
  );
  shoulder.rotation.y = tileRandom(ctx.x, ctx.y, 12) * Math.PI * 2;
  group.add(shoulder);

  const cap = part(
    new THREE.ConeGeometry(0.17, height * 0.3, 5),
    plastic(PALETTE.snow, { flatShading: true, roughness: 0.65 }),
    0,
    height - height * 0.15,
    0,
  );
  cap.rotation.y = peak.rotation.y;
  group.add(cap);
  return group;
}

function windowBand(width: number, depth: number, y: number): THREE.Mesh {
  const band = part(roundedBox(width, 0.07, depth, 0.02), glass(), 0, y, 0);
  band.castShadow = false;
  return band;
}

function buildCity(ctx: TileContext): THREE.Group {
  const group = new THREE.Group();
  group.add(groundSlab(PALETTE.concreteDark, PALETTE.concreteDark));
  const colors = ownerColors(ctx.owner);

  const spots: Array<[number, number]> = [
    [-0.21, -0.21],
    [0.22, -0.19],
    [-0.19, 0.22],
    [0.21, 0.21],
  ];
  const count = 3 + (tileRandom(ctx.x, ctx.y, 13) > 0.5 ? 1 : 0);

  for (let i = 0; i < count; i++) {
    const [bx, bz] = spots[i];
    const h = 0.3 + tileRandom(ctx.x, ctx.y, 200 + i) * 0.42;
    const w = 0.26 + tileRandom(ctx.x, ctx.y, 220 + i) * 0.08;
    const d = 0.26 + tileRandom(ctx.x, ctx.y, 240 + i) * 0.08;

    const block = new THREE.Group();
    block.add(part(roundedBox(w, h, d, 0.03), plastic(PALETTE.concrete), 0, h / 2, 0));
    block.add(windowBand(w * 1.02, d * 1.02, h * 0.62));
    block.add(windowBand(w * 1.02, d * 1.02, h * 0.32));
    // Owner-coloured roof: the fastest read of who holds the property.
    block.add(part(roundedBox(w * 1.06, 0.06, d * 1.06, 0.02), plastic(colors.primary), 0, h, 0));
    block.position.set(bx, 0, bz);
    group.add(block);
  }

  const banner = flag(colors, 0.4);
  banner.position.set(0.36, 0, -0.36);
  group.add(banner);
  return group;
}

function buildBase(ctx: TileContext): THREE.Group {
  const group = new THREE.Group();
  group.add(groundSlab(PALETTE.concreteDark, PALETTE.concreteDark));
  const colors = ownerColors(ctx.owner);

  const body = part(roundedBox(0.74, 0.34, 0.62, 0.05), plastic(PALETTE.concrete), 0, 0.17, 0);
  group.add(body);

  // A barrel-vaulted hangar roof in the owner's colour.
  const roof = part(cylinder(0.33, 0.33, 0.66, 18), plastic(colors.primary), 0, 0.36, 0);
  roof.rotation.z = Math.PI / 2;
  roof.scale.set(1, 1, 0.62);
  group.add(roof);

  const door = part(roundedBox(0.3, 0.24, 0.05, 0.02), plastic(colors.dark), 0, 0.13, 0.31);
  group.add(door);
  group.add(part(roundedBox(0.3, 0.03, 0.02, 0.008), plastic(colors.accent), 0, 0.25, 0.34));

  for (const cx of [-0.28, 0.28]) {
    group.add(part(cylinder(0.045, 0.05, 0.26, 10), plastic(PALETTE.concreteDark), cx, 0.5, -0.2));
  }

  const banner = flag(colors, 0.42);
  banner.position.set(0.36, 0, 0.34);
  group.add(banner);
  return group;
}

function buildHq(ctx: TileContext): THREE.Group {
  const group = new THREE.Group();
  group.add(groundSlab(PALETTE.concreteDark, PALETTE.concreteDark));
  const colors = ownerColors(ctx.owner);

  // Three-step ziggurat: unmistakable at a glance, even zoomed out.
  group.add(part(roundedBox(0.78, 0.22, 0.78, 0.04), plastic(PALETTE.concrete), 0, 0.11, 0));
  group.add(part(roundedBox(0.6, 0.26, 0.6, 0.04), plastic(PALETTE.concrete), 0, 0.35, 0));
  group.add(windowBand(0.62, 0.62, 0.38));
  group.add(part(roundedBox(0.42, 0.28, 0.42, 0.04), plastic(colors.primary), 0, 0.62, 0));
  group.add(part(roundedBox(0.5, 0.05, 0.5, 0.02), plastic(colors.dark), 0, 0.78, 0));

  for (const [cx, cz] of [
    [-0.3, -0.3],
    [0.3, -0.3],
    [-0.3, 0.3],
    [0.3, 0.3],
  ]) {
    group.add(part(roundedBox(0.1, 0.3, 0.1, 0.02), plastic(colors.dark), cx, 0.15, cz));
  }

  const banner = flag(colors, 0.62);
  banner.position.set(0, 0.8, 0);
  group.add(banner);
  return group;
}

const BUILDERS: Record<TerrainId, (ctx: TileContext) => THREE.Group> = {
  plain: buildPlain,
  road: buildRoad,
  river: buildRiver,
  wood: buildWood,
  mountain: buildMountain,
  city: buildCity,
  base: buildBase,
  hq: buildHq,
};

export function buildTerrainTile(ctx: TileContext): THREE.Group {
  // Baked per tile: nothing inside a tile moves independently, and properties
  // are rebuilt wholesale when captured, so there is no reason to pay for a
  // draw call per window pane and flag pole.
  const group = bake(BUILDERS[ctx.terrain](ctx));
  group.name = `tile:${ctx.x},${ctx.y}`;
  return group;
}

/** Exposed for the unit models, which reuse the same rubber/metal finishes. */
export const FINISHES = { plastic, metal, rubber, glass };
