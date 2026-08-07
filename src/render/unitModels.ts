import * as THREE from "three";
import { TEAMS, type TeamColors } from "./palette";
import { glass, metal, plastic, rubber } from "./materials";
import { bake, cylinder, part, roundedBox, sphere } from "./geometry";
import type { PlayerId, UnitId } from "../core/types";

/**
 * Every model is built facing north (-Z) and sits on y = 0, so the renderer
 * only ever has to place and yaw them. Proportions are deliberately chunky:
 * these are meant to look like moulded toys on a board, not scale models.
 */

/** Sub-assembly kept out of the bake so it can still be articulated. */
const TURRET = "turret";

/** How a unit fidgets when it has nothing to do. */
export type IdleStyle = "foot" | "tracked" | "wheeled";

export const IDLE_STYLE: Record<UnitId, IdleStyle> = {
  infantry: "foot",
  mech: "foot",
  recon: "wheeled",
  apc: "tracked",
  artillery: "tracked",
  tank: "tracked",
  antiair: "tracked",
  rockets: "wheeled",
  mdtank: "tracked",
};

/** Name of the pivot node that idle animation rotates, when a unit has one. */
export const TURRET_PIVOT = "turretPivot";

const SKIN = 0xe8b48c;
const DARK_METAL = 0x5c636d;

/**
 * Track units run along both flanks of the hull, so `offset` is the distance
 * from the centreline to each belt — normally half the hull width.
 */
function tracks(
  length: number,
  beltWidth: number,
  offset: number,
  height = 0.12,
  y = 0.06,
): THREE.Group {
  const group = new THREE.Group();
  for (const side of [-1, 1]) {
    const x = side * offset;
    group.add(part(roundedBox(beltWidth, height, length, height * 0.45), rubber(), x, y, 0));
    // Road wheels peeking out of the belt catch the light and add detail.
    for (const z of [-length * 0.32, 0, length * 0.32]) {
      const wheel = part(
        cylinder(height * 0.36, height * 0.36, beltWidth * 1.12, 10),
        rubber(0x3a4048),
        x,
        y,
        z,
      );
      wheel.rotation.z = Math.PI / 2;
      group.add(wheel);
    }
    // A fender over the top edge of the belt, the way real hulls overhang.
    const fender = part(
      roundedBox(beltWidth * 1.3, 0.028, length * 0.92, 0.012),
      rubber(0x474d55),
      x,
      y + height * 0.55,
      0,
    );
    group.add(fender);
  }
  return group;
}

function wheels(
  positions: readonly (readonly [number, number])[],
  radius: number,
  width: number,
): THREE.Group {
  const group = new THREE.Group();
  for (const [x, z] of positions) {
    const wheel = part(cylinder(radius, radius, width, 12), rubber(), x, radius, z);
    wheel.rotation.z = Math.PI / 2;
    group.add(wheel);
    const hub = part(cylinder(radius * 0.42, radius * 0.42, width * 1.06, 8), metal(0x9aa1a9), x, radius, z);
    hub.rotation.z = Math.PI / 2;
    group.add(hub);
  }
  return group;
}

function barrel(length: number, radius: number, colors: TeamColors): THREE.Group {
  const group = new THREE.Group();
  const tube = part(cylinder(radius, radius * 1.1, length, 12), metal(DARK_METAL), 0, 0, -length / 2);
  tube.rotation.x = Math.PI / 2;
  group.add(tube);
  const muzzle = part(cylinder(radius * 1.35, radius * 1.35, length * 0.14, 12), plastic(colors.dark), 0, 0, -length * 0.94);
  muzzle.rotation.x = Math.PI / 2;
  group.add(muzzle);
  return group;
}

/** A soldier: the one model where silhouette matters more than surface detail. */
function soldier(colors: TeamColors, bulky: boolean): THREE.Group {
  const group = new THREE.Group();
  const bodyW = bulky ? 0.2 : 0.17;

  group.add(part(roundedBox(bodyW, 0.22, 0.13, 0.05), plastic(colors.primary), 0, 0.19, 0));
  // Legs, slightly apart, so the figure does not read as a bollard.
  for (const side of [-1, 1]) {
    group.add(part(roundedBox(0.062, 0.16, 0.075, 0.028), plastic(colors.dark), side * 0.045, 0.08, 0));
  }
  group.add(part(sphere(0.062, 12), plastic(SKIN), 0, 0.345, 0));
  group.add(part(roundedBox(0.145, 0.055, 0.14, 0.025), plastic(colors.dark), 0, 0.375, 0));
  group.add(part(roundedBox(0.13, 0.03, 0.05, 0.014), plastic(colors.dark), 0, 0.352, -0.055));
  group.add(part(roundedBox(0.16, 0.14, 0.08, 0.03), plastic(colors.dark), 0, 0.21, 0.095));

  if (bulky) {
    // Mech: a bazooka over the shoulder plus shoulder plates.
    const tube = part(cylinder(0.036, 0.036, 0.34, 10), metal(DARK_METAL), 0.075, 0.3, -0.02);
    tube.rotation.x = Math.PI / 2;
    tube.rotation.z = -0.22;
    group.add(tube);
    group.add(part(cylinder(0.05, 0.05, 0.05, 10), plastic(colors.accent), 0.075, 0.3, 0.14));
    for (const side of [-1, 1]) {
      group.add(part(roundedBox(0.07, 0.07, 0.12, 0.03), plastic(colors.light), side * 0.115, 0.27, 0));
    }
  } else {
    // Infantry: rifle held across the chest.
    const rifle = part(roundedBox(0.026, 0.026, 0.26, 0.011), metal(0x4a4f57), 0.075, 0.235, -0.04);
    rifle.rotation.x = 0.18;
    group.add(rifle);
    group.add(part(roundedBox(0.03, 0.05, 0.07, 0.014), plastic(colors.dark), 0.075, 0.215, 0.06));
  }
  return group;
}

/**
 * Foot units are scaled far above true proportion, on purpose. A soldier drawn
 * at 1:1 against a tank is a speck you cannot find on a zoomed-out board, and
 * infantry are the units you spend the whole game looking at. The series does
 * the same thing: every unit, on foot or not, fills most of its tile.
 */
function buildInfantry(colors: TeamColors): THREE.Group {
  const group = soldier(colors, false);
  group.scale.setScalar(1.75);
  return group;
}

function buildMech(colors: TeamColors): THREE.Group {
  const group = soldier(colors, true);
  group.scale.setScalar(1.85);
  return group;
}

function buildRecon(colors: TeamColors): THREE.Group {
  const group = new THREE.Group();
  group.add(wheels(
    [
      [-0.17, -0.17],
      [0.17, -0.17],
      [-0.17, 0.19],
      [0.17, 0.19],
    ],
    0.075,
    0.06,
  ));

  group.add(part(roundedBox(0.32, 0.12, 0.6, 0.04), plastic(colors.primary), 0, 0.15, 0));
  group.add(part(roundedBox(0.3, 0.1, 0.24, 0.035), plastic(colors.dark), 0, 0.25, 0.06));
  // Windscreen, raked forward.
  const screen = part(roundedBox(0.28, 0.12, 0.02, 0.012), glass(), 0, 0.27, -0.07);
  screen.rotation.x = -0.35;
  group.add(screen);
  // Roll bar and pintle-mounted machine gun.
  for (const side of [-1, 1]) {
    group.add(part(roundedBox(0.026, 0.14, 0.026, 0.012), metal(0xb0b6bd), side * 0.13, 0.31, 0.17));
  }
  group.add(part(roundedBox(0.3, 0.026, 0.026, 0.012), metal(0xb0b6bd), 0, 0.38, 0.17));
  const mg = part(roundedBox(0.03, 0.03, 0.24, 0.013), metal(0x4a4f57), 0, 0.33, -0.06);
  group.add(mg);
  group.add(part(roundedBox(0.34, 0.04, 0.1, 0.018), plastic(colors.light), 0, 0.21, -0.28));
  return group;
}

function buildApc(colors: TeamColors): THREE.Group {
  const group = new THREE.Group();
  group.add(tracks(0.62, 0.1, 0.2));
  group.add(part(roundedBox(0.38, 0.2, 0.62, 0.05), plastic(colors.primary), 0, 0.21, 0));
  // Sloped glacis plate at the front.
  const glacis = part(roundedBox(0.36, 0.18, 0.04, 0.02), plastic(colors.light), 0, 0.23, -0.3);
  glacis.rotation.x = 0.5;
  group.add(glacis);
  group.add(part(roundedBox(0.24, 0.09, 0.3, 0.035), plastic(colors.dark), 0, 0.35, 0.02));
  group.add(part(roundedBox(0.2, 0.02, 0.2, 0.01), plastic(colors.accent), 0, 0.4, 0.02));
  const vision = part(roundedBox(0.26, 0.07, 0.02, 0.012), glass(), 0, 0.29, -0.31);
  group.add(vision);
  // Rear ramp.
  group.add(part(roundedBox(0.3, 0.16, 0.03, 0.015), plastic(colors.dark), 0, 0.2, 0.31));
  return group;
}

function buildArtillery(colors: TeamColors): THREE.Group {
  const group = new THREE.Group();
  group.add(tracks(0.58, 0.1, 0.2));
  group.add(part(roundedBox(0.38, 0.16, 0.56, 0.045), plastic(colors.primary), 0, 0.19, 0.02));
  group.add(part(roundedBox(0.3, 0.14, 0.26, 0.04), plastic(colors.dark), 0, 0.32, 0.1));

  // The gun is the whole point of this unit, so it is long and raised.
  const gun = new THREE.Group();
  gun.name = TURRET;
  gun.add(barrel(0.62, 0.036, colors));
  gun.position.set(0, 0.35, -0.02);
  // Positive X rotation lifts a -Z barrel. Negative buries it in the ground.
  gun.rotation.x = 0.34;
  group.add(gun);
  group.add(part(roundedBox(0.14, 0.12, 0.16, 0.04), plastic(colors.light), 0, 0.35, 0.04));
  // Recoil spades dug in at the back.
  for (const side of [-1, 1]) {
    const spade = part(roundedBox(0.05, 0.12, 0.18, 0.02), plastic(colors.dark), side * 0.15, 0.12, 0.32);
    spade.rotation.x = -0.5;
    group.add(spade);
  }
  return group;
}

function buildTank(colors: TeamColors): THREE.Group {
  const group = new THREE.Group();
  group.add(tracks(0.66, 0.11, 0.225));
  group.add(part(roundedBox(0.42, 0.15, 0.64, 0.045), plastic(colors.primary), 0, 0.18, 0));
  const glacis = part(roundedBox(0.4, 0.16, 0.04, 0.02), plastic(colors.light), 0, 0.2, -0.31);
  glacis.rotation.x = 0.55;
  group.add(glacis);

  const turret = new THREE.Group();
  turret.name = TURRET;
  turret.add(part(roundedBox(0.34, 0.15, 0.4, 0.055), plastic(colors.primary), 0, 0.08, 0));
  turret.add(part(roundedBox(0.14, 0.06, 0.16, 0.025), plastic(colors.dark), 0, 0.17, 0.08));
  turret.add(part(sphere(0.05, 10), plastic(colors.accent), 0.1, 0.17, 0.02));
  const gun = barrel(0.46, 0.035, colors);
  gun.position.set(0, 0.08, -0.2);
  turret.add(gun);
  turret.position.y = 0.26;
  group.add(turret);

  for (const side of [-1, 1]) {
    group.add(part(roundedBox(0.05, 0.05, 0.5, 0.02), plastic(colors.dark), side * 0.24, 0.26, 0.02));
  }
  return group;
}

function buildAntiAir(colors: TeamColors): THREE.Group {
  const group = new THREE.Group();
  group.add(tracks(0.6, 0.1, 0.21));
  group.add(part(roundedBox(0.4, 0.15, 0.58, 0.045), plastic(colors.primary), 0, 0.18, 0));

  const turret = new THREE.Group();
  turret.name = TURRET;
  turret.add(part(roundedBox(0.3, 0.18, 0.3, 0.05), plastic(colors.dark), 0, 0.09, 0));
  turret.add(part(roundedBox(0.24, 0.06, 0.24, 0.02), plastic(colors.light), 0, 0.19, 0));

  // Twin autocannons, elevated the way an AA mount sits at rest. Each barrel
  // is assembled flat and then tilted as one piece, so the muzzle brake stays
  // welded to the end of its tube instead of floating off in mid-air.
  for (const side of [-1, 1]) {
    const gun = new THREE.Group();
    const tube = part(cylinder(0.024, 0.024, 0.42, 10), metal(DARK_METAL), 0, 0, -0.21);
    tube.rotation.x = Math.PI / 2;
    gun.add(tube);
    const brake = part(cylinder(0.034, 0.034, 0.06, 10), plastic(colors.accent), 0, 0, -0.42);
    brake.rotation.x = Math.PI / 2;
    gun.add(brake);
    gun.position.set(side * 0.062, 0.15, -0.07);
    gun.rotation.x = 0.42;
    turret.add(gun);
  }

  // Search radar on a short mast at the back of the turret.
  const radar = new THREE.Group();
  radar.add(part(cylinder(0.018, 0.018, 0.12, 8), metal(0xb0b6bd), 0, 0.06, 0));
  const dish = part(cylinder(0.085, 0.085, 0.018, 14), plastic(colors.light), 0, 0.14, 0);
  dish.rotation.x = -0.85;
  radar.add(dish);
  radar.position.set(0, 0.17, 0.11);
  turret.add(radar);

  turret.position.y = 0.25;
  group.add(turret);
  return group;
}

function buildRockets(colors: TeamColors): THREE.Group {
  const group = new THREE.Group();
  group.add(wheels(
    [
      [-0.19, -0.2],
      [0.19, -0.2],
      [-0.19, 0.08],
      [0.19, 0.08],
      [-0.19, 0.26],
      [0.19, 0.26],
    ],
    0.078,
    0.06,
  ));

  group.add(part(roundedBox(0.36, 0.13, 0.68, 0.04), plastic(colors.primary), 0, 0.16, 0));
  group.add(part(roundedBox(0.32, 0.18, 0.24, 0.04), plastic(colors.dark), 0, 0.28, -0.2));
  const screen = part(roundedBox(0.28, 0.1, 0.02, 0.012), glass(), 0, 0.3, -0.32);
  screen.rotation.x = -0.3;
  group.add(screen);

  // Launcher pack, elevated over the bed. The tubes deliberately overhang the
  // front of the box so the silhouette reads as "rockets" and not "cargo".
  const launcher = new THREE.Group();
  launcher.name = TURRET;
  launcher.add(part(roundedBox(0.34, 0.22, 0.28, 0.035), plastic(colors.dark), 0, 0, 0));
  for (const side of [-1, 1]) {
    for (const row of [-1, 1]) {
      const tube = part(
        cylinder(0.038, 0.038, 0.52, 10),
        plastic(colors.light),
        side * 0.085,
        row * 0.06,
        -0.14,
      );
      tube.rotation.x = Math.PI / 2;
      launcher.add(tube);
      const mouth = part(
        cylinder(0.046, 0.046, 0.04, 10),
        plastic(colors.accent),
        side * 0.085,
        row * 0.06,
        -0.4,
      );
      mouth.rotation.x = Math.PI / 2;
      launcher.add(mouth);
    }
  }
  launcher.add(part(roundedBox(0.38, 0.05, 0.05, 0.02), plastic(colors.primary), 0, -0.13, 0.1));
  launcher.position.set(0, 0.34, 0.16);
  launcher.rotation.x = 0.42;
  group.add(launcher);
  // Stabiliser legs.
  for (const side of [-1, 1]) {
    group.add(part(roundedBox(0.045, 0.1, 0.06, 0.02), plastic(colors.dark), side * 0.2, 0.1, 0.3));
  }
  return group;
}

function buildMdTank(colors: TeamColors): THREE.Group {
  const group = new THREE.Group();
  group.add(tracks(0.74, 0.13, 0.255, 0.14, 0.07));
  group.add(part(roundedBox(0.48, 0.17, 0.72, 0.05), plastic(colors.primary), 0, 0.21, 0));
  const glacis = part(roundedBox(0.46, 0.2, 0.05, 0.022), plastic(colors.light), 0, 0.23, -0.35);
  glacis.rotation.x = 0.6;
  group.add(glacis);
  // Side skirts: the visual cue that this is the heavy.
  for (const side of [-1, 1]) {
    group.add(part(roundedBox(0.04, 0.11, 0.66, 0.018), plastic(colors.dark), side * 0.26, 0.16, 0));
  }

  const turret = new THREE.Group();
  turret.name = TURRET;
  turret.add(part(roundedBox(0.42, 0.18, 0.46, 0.06), plastic(colors.primary), 0, 0.09, 0));
  turret.add(part(roundedBox(0.44, 0.06, 0.2, 0.025), plastic(colors.dark), 0, 0.19, 0.1));
  turret.add(part(roundedBox(0.16, 0.07, 0.18, 0.03), plastic(colors.dark), -0.08, 0.21, 0.06));
  turret.add(part(sphere(0.055, 10), plastic(colors.accent), 0.12, 0.2, 0.02));
  const mainGun = barrel(0.66, 0.042, colors);
  mainGun.position.set(0, 0.1, -0.23);
  turret.add(mainGun);
  // Coaxial machine gun alongside the main armament.
  const coax = part(cylinder(0.018, 0.018, 0.22, 8), metal(0x4a4f57), 0.11, 0.13, -0.28);
  coax.rotation.x = Math.PI / 2;
  turret.add(coax);
  turret.position.y = 0.3;
  group.add(turret);
  return group;
}

const BUILDERS: Record<UnitId, (colors: TeamColors) => THREE.Group> = {
  infantry: buildInfantry,
  mech: buildMech,
  recon: buildRecon,
  apc: buildApc,
  artillery: buildArtillery,
  tank: buildTank,
  antiair: buildAntiAir,
  rockets: buildRockets,
  mdtank: buildMdTank,
};

/**
 * Units fill roughly three quarters of a tile: large enough to read at the
 * zoom where the whole board is visible, small enough that two units in
 * neighbouring tiles never visually merge into one shape.
 */
export const UNIT_SCALE = 1.08;

/**
 * One baked template per unit type and livery. Instances are clones, which
 * share the merged geometry and the material, so putting twenty tanks on the
 * board costs twenty draw calls rather than four hundred.
 */
/**
 * Yaw that makes a model's nose point along (dx, dz) in world space.
 *
 * Models are authored facing local -Z. A rotation of theta about Y sends that
 * to (-sin, -cos), so aiming at a direction needs the negated arguments —
 * atan2(dx, dz) points every unit exactly backwards.
 */
export function yawTowards(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/**
 * Barrel tip in model space, for muzzle flashes and tracer origins. These are
 * read off the model definitions above — a flash at the wrong distance reads
 * as the gun firing out of its own turret.
 */
export const MUZZLE: Record<UnitId, { height: number; forward: number }> = {
  infantry: { height: 0.41, forward: 0.3 },
  mech: { height: 0.56, forward: 0.35 },
  recon: { height: 0.33, forward: 0.18 },
  apc: { height: 0.3, forward: 0.3 },
  artillery: { height: 0.56, forward: 0.6 },
  tank: { height: 0.34, forward: 0.66 },
  antiair: { height: 0.57, forward: 0.45 },
  rockets: { height: 0.5, forward: 0.22 },
  mdtank: { height: 0.4, forward: 0.89 },
};

const templates = new Map<string, THREE.Group>();

/**
 * Bake a model, but keep its turret as a separate object on its own pivot so
 * idle animation can still swing it. Everything else is merged flat, which is
 * what keeps a board full of units down to a sane number of draw calls.
 */
function bakeUnit(source: THREE.Group): THREE.Group {
  const assembled = new THREE.Group();

  const turret = source.getObjectByName(TURRET);
  if (turret !== undefined) {
    const pivotAt = turret.position.clone();
    // Bake the turret about its own origin, then hang it off a pivot placed
    // where it sat, so rotating it spins the turret rather than orbiting it.
    turret.position.set(0, 0, 0);
    turret.removeFromParent();

    const pivot = new THREE.Group();
    pivot.name = TURRET_PIVOT;
    pivot.position.copy(pivotAt);
    pivot.add(bake(turret));
    assembled.add(pivot);
  }

  assembled.add(bake(source));
  return assembled;
}

export function buildUnitModel(type: UnitId, owner: PlayerId): THREE.Group {
  const id = `${type}:${owner}`;
  let template = templates.get(id);
  if (template === undefined) {
    template = bakeUnit(BUILDERS[type](TEAMS[owner]));
    templates.set(id, template);
  }

  const wrapper = new THREE.Group();
  wrapper.add(template.clone());
  wrapper.scale.setScalar(UNIT_SCALE);
  wrapper.name = `unit:${id}`;
  return wrapper;
}
