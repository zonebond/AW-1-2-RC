import * as THREE from "three";
import { buildBoard, worldX, worldZ } from "./board";
import { buildTerrainTile, type TileContext } from "./terrainModels";
import {
  IDLE_STYLE,
  MUZZLE,
  TURRET_PIVOT,
  UNIT_SCALE,
  buildUnitModel,
  yawTowards,
  type IdleStyle,
} from "./unitModels";
import { Effects, type ShakeSink } from "./effects";
import { TEAMS } from "./palette";
import type { PlayerId, UnitId } from "../core/types";
import { captureBadge, damagePopup, hpBadge } from "./labels";
import { dimmed } from "./materials";
import { Overlay } from "./overlay";
import { displayHp } from "../core/damage";
import { tileAt, type GameMap } from "../core/map";
import { CAPTURE_POINTS, TERRAIN } from "../core/terrain";
import type { GameState, Unit } from "../core/game";
import type { Owner, Point, TerrainId } from "../core/types";

/** Everything the renderer needs to stage one exchange of fire. */
export interface AttackAnimation {
  attackerId: number;
  attackerType: UnitId;
  /** The unit being shot at; its model is removed at the moment of impact. */
  targetId: number;
  targetTile: Point;
  targetOwner: PlayerId;
  damage: number;
  destroyed: boolean;
  /** Indirect fire lobs a shell on an arc instead of firing a flat tracer. */
  indirect: boolean;
}
import type { Stage } from "./scene";

/**
 * Owns everything in the scene and keeps it in step with the game state. The
 * rules never touch three.js; this is the only place the two meet.
 */

interface UnitView {
  id: number;
  /** Carries tile position and facing; animations move this. */
  model: THREE.Group;
  /** Child of the model. Idle motion lives here so it never fights a move. */
  body: THREE.Group;
  /** Articulated turret, for the units that have one. */
  turret: THREE.Object3D | null;
  hp: THREE.Sprite | null;
  facing: number;
  done: boolean;
  idle: IdleStyle;
  /** Per-unit offset so a row of tanks does not breathe in lockstep. */
  phase: number;
  /** Vertical squash from taking a hit, folded into the idle transform. */
  squash: number;
}

/** Linear tween helper; every animation here is short enough not to need more. */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class World {
  readonly overlay: Overlay;

  private readonly root = new THREE.Group();
  private readonly unitLayer = new THREE.Group();
  private readonly effectLayer = new THREE.Group();
  private readonly views = new Map<number, UnitView>();
  private visibleIds: Set<number> | null = null;
  private readonly tileMeshes = new Map<number, THREE.Group>();
  private readonly tileOwners = new Map<number, Owner>();
  private readonly captureBadges = new Map<number, THREE.Sprite>();
  private readonly effects: Effects;

  private readonly ticking: Array<(dt: number) => boolean> = [];
  private clock = 0;

  /**
   * Animation speed multiplier. Durations below are authored for normal play;
   * the automated playtest cranks this up so a match runs at logic speed
   * instead of at the mercy of the frame rate.
   */
  private animationSpeed = 1;

  get speed(): number {
    return this.animationSpeed;
  }

  set speed(value: number) {
    this.animationSpeed = value;
    this.effects.speed = value;
  }

  constructor(
    private readonly stage: Stage,
    private readonly map: GameMap,
  ) {
    const board = buildBoard(map);
    this.root.add(board.group, this.unitLayer, this.effectLayer);

    // Only properties are individual objects; the rest of the terrain is baked
    // into merged meshes and never needs to be touched again.
    for (const child of board.group.children) {
      const match = /^tile:(\d+),(\d+)$/.exec(child.name);
      if (match === null) continue;
      const x = Number(match[1]);
      const y = Number(match[2]);
      this.tileMeshes.set(this.tileKey(x, y), child as THREE.Group);
      this.tileOwners.set(this.tileKey(x, y), tileAt(map, x, y)!.owner);
    }

    this.effects = new Effects(this.effectLayer);
    this.overlay = new Overlay(map);
    this.root.add(this.overlay.group);
    stage.scene.add(this.root);
  }

  private tileKey(x: number, y: number): number {
    return y * 1000 + x;
  }

  private wx(x: number): number {
    return worldX(this.map, x);
  }

  private wz(y: number): number {
    return worldZ(this.map, y);
  }

  /* ---------------------------------------------------------------- *
   * State synchronisation
   * ---------------------------------------------------------------- */

  /**
   * Ids the viewing player is allowed to see, or null for no fog. Models of
   * everything else stay in the scene but are not drawn, so an ambush is
   * hidden without tearing down and rebuilding its view every turn.
   */
  setVisibleUnits(ids: Set<number> | null): void {
    this.visibleIds = ids;
  }

  /** How many unit models are actually being drawn. Used by the fog tests. */
  drawnUnitCount(): number {
    let count = 0;
    for (const view of this.views.values()) if (view.model.visible) count++;
    return count;
  }

  /** Add, remove and reposition models so the scene matches the state. */
  sync(state: GameState): void {
    const seen = new Set<number>();

    for (const unit of state.units) {
      seen.add(unit.id);
      let view = this.views.get(unit.id);
      if (view === undefined) {
        view = this.createView(unit);
        this.views.set(unit.id, view);
      }
      view.model.position.set(this.wx(unit.x), 0, this.wz(unit.y));
      // Greying out means "this one has had its go", which is only meaningful
      // for the side currently to move. The opponent's units keep their done
      // flag from their own turn, and showing them greyed reads as disabled.
      this.setDone(view, unit.done && unit.owner === state.turn);
      this.refreshHp(view, unit);
      view.model.visible = this.visibleIds === null || this.visibleIds.has(unit.id);
    }

    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.unitLayer.remove(view.model);
      this.views.delete(id);
    }

    this.syncTiles();
  }

  private createView(unit: Unit): UnitView {
    const body = buildUnitModel(unit.type, unit.owner);

    // Two levels: the outer node is driven by movement and facing, the inner
    // one by the idle loop. Keeping them apart means a unit can breathe while
    // it walks without the two transforms overwriting each other.
    const model = new THREE.Group();
    model.add(body);

    // Both armies start facing the middle of the board: player 0 deploys along
    // the south edge and looks north, player 1 does the reverse.
    const facing = unit.owner === 0 ? yawTowards(0, -1) : yawTowards(0, 1);
    model.rotation.y = facing;
    model.position.set(this.wx(unit.x), 0, this.wz(unit.y));
    this.unitLayer.add(model);

    // Remember the original finish of every part so "done" can be undone.
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.userData.baseMaterial = mesh.material;
    });

    return {
      id: unit.id,
      model,
      body,
      turret: body.getObjectByName(TURRET_PIVOT) ?? null,
      hp: null,
      facing,
      done: false,
      idle: IDLE_STYLE[unit.type],
      phase: (unit.id * 2.399963) % (Math.PI * 2),
      squash: 0,
    };
  }

  private setDone(view: UnitView, done: boolean): void {
    if (view.done === done) return;
    view.done = done;
    view.model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const base = mesh.userData.baseMaterial as THREE.MeshStandardMaterial | undefined;
      if (base === undefined) return;
      mesh.material = done ? dimmed(base) : base;
    });
  }

  private refreshHp(view: UnitView, unit: Unit): void {
    const hp = displayHp(unit.hp);
    if (view.hp !== null) {
      view.model.remove(view.hp);
      view.hp = null;
    }
    if (hp >= 10) return;

    const badge = hpBadge(hp);
    // Bottom-right of the tile, the way the series puts it.
    badge.position.set(0.3, 0.24, 0.32);
    view.model.add(badge);
    view.hp = badge;
  }

  /** Rebuild any property whose owner changed, and refresh capture badges. */
  private syncTiles(): void {
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const tile = tileAt(this.map, x, y)!;
        if (!TERRAIN[tile.terrain].capturable) continue;
        const k = this.tileKey(x, y);

        if (this.tileOwners.get(k) !== tile.owner) {
          this.tileOwners.set(k, tile.owner);
          this.rebuildTile(x, y);
        }

        const existing = this.captureBadges.get(k);
        const capturing = TERRAIN[tile.terrain].capturable && tile.captureLeft < CAPTURE_POINTS;
        if (capturing && existing === undefined) {
          const badge = captureBadge(tile.captureLeft);
          badge.position.set(this.wx(x) - 0.3, 0.85, this.wz(y) + 0.3);
          this.effectLayer.add(badge);
          this.captureBadges.set(k, badge);
        } else if (!capturing && existing !== undefined) {
          this.effectLayer.remove(existing);
          this.captureBadges.delete(k);
        } else if (capturing && existing !== undefined) {
          const badge = captureBadge(tile.captureLeft);
          badge.position.copy(existing.position);
          this.effectLayer.remove(existing);
          this.effectLayer.add(badge);
          this.captureBadges.set(k, badge);
        }
      }
    }
  }

  private neighbour(x: number, y: number): TerrainId | null {
    return tileAt(this.map, x, y)?.terrain ?? null;
  }

  private rebuildTile(x: number, y: number): void {
    const k = this.tileKey(x, y);
    const old = this.tileMeshes.get(k);
    if (old !== undefined) old.parent?.remove(old);

    const tile = tileAt(this.map, x, y)!;
    const ctx: TileContext = {
      terrain: tile.terrain,
      owner: tile.owner,
      x,
      y,
      north: this.neighbour(x, y - 1),
      east: this.neighbour(x + 1, y),
      south: this.neighbour(x, y + 1),
      west: this.neighbour(x - 1, y),
    };
    const mesh = buildTerrainTile(ctx);
    mesh.position.set(this.wx(x), 0, this.wz(y));
    this.root.add(mesh);
    this.tileMeshes.set(k, mesh);
  }

  /* ---------------------------------------------------------------- *
   * Animation
   * ---------------------------------------------------------------- */

  private run(duration: number, step: (t: number) => void): Promise<void> {
    const scaled = duration / this.speed;
    return new Promise((resolve) => {
      let elapsed = 0;
      this.ticking.push((dt) => {
        elapsed += dt;
        const t = scaled <= 0 ? 1 : Math.min(1, elapsed / scaled);
        step(t);
        if (t < 1) return true;
        resolve();
        return false;
      });
    });
  }

  /** Walk a unit tile by tile, turning to face each leg of the journey. */
  async animateMove(unitId: number, path: readonly Point[]): Promise<void> {
    const view = this.views.get(unitId);
    if (view === undefined || path.length < 2) return;

    // Each leg costs at least one frame, so at high speed the walk is skipped
    // outright rather than spending a frame per tile going nowhere visible.
    if (this.speed >= 8) {
      const from = path[path.length - 2];
      const end = path[path.length - 1];
      this.turnTo(view, yawTowards(end.x - from.x, end.y - from.y));
      view.model.position.set(this.wx(end.x), 0, this.wz(end.y));
      return;
    }

    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1];
      const to = path[i];
      this.turnTo(view, yawTowards(to.x - from.x, to.y - from.y));

      const sx = this.wx(from.x);
      const sz = this.wz(from.y);
      const dx = this.wx(to.x);
      const dz = this.wz(to.y);

      await this.run(0.085, (t) => {
        view.model.position.x = sx + (dx - sx) * t;
        view.model.position.z = sz + (dz - sz) * t;
        // A small hop sells the weight of each step without a walk cycle.
        view.model.position.y = Math.sin(t * Math.PI) * 0.05;
      });
      view.model.position.y = 0;
    }
  }

  private turnTo(view: UnitView, target: number): void {
    let delta = target - view.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    view.facing += delta;
    view.model.rotation.y = view.facing;
  }

  /** Where the shot leaves the barrel, given who is firing and which way. */
  private muzzlePoint(
    type: UnitId,
    origin: THREE.Vector3,
    forward: THREE.Vector3,
  ): THREE.Vector3 {
    const spec = MUZZLE[type];
    return origin
      .clone()
      .addScaledVector(forward, spec.forward * UNIT_SCALE)
      .setY(spec.height * UNIT_SCALE);
  }

  /**
   * One exchange of fire: turn, recoil, muzzle flash, round in flight, impact.
   * The target's model is pulled at the moment of the blast so it disappears
   * inside the explosion rather than blinking out afterwards.
   */
  async animateAttack(spec: AttackAnimation): Promise<void> {
    const view = this.views.get(spec.attackerId);
    if (view === undefined) return;

    const origin = view.model.position.clone();
    const targetPoint = new THREE.Vector3(
      this.wx(spec.targetTile.x),
      0,
      this.wz(spec.targetTile.y),
    );

    const forward = targetPoint.clone().sub(origin).setY(0);
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    this.turnTo(view, yawTowards(forward.x, forward.z));

    const muzzle = this.muzzlePoint(spec.attackerType, origin, forward);
    const impact = targetPoint.clone().setY(0.32);

    // Recoil and muzzle flash fire together; the round leaves once the gun has
    // finished kicking back.
    const recoil = this.run(0.12, (t) => {
      const k = Math.sin(easeInOut(t) * Math.PI);
      view.model.position.copy(origin).addScaledVector(forward, -0.18 * k);
    });
    this.effects.muzzleFlash(muzzle, forward, spec.indirect ? 1.35 : 1);
    await recoil;
    view.model.position.copy(origin);

    if (spec.indirect) await this.effects.shell(muzzle, impact);
    else await this.effects.tracer(muzzle, impact);

    if (spec.destroyed) {
      const victim = this.views.get(spec.targetId);
      if (victim !== undefined) {
        this.unitLayer.remove(victim.model);
        this.views.delete(spec.targetId);
      }
      this.effects.destruction(impact, TEAMS[spec.targetOwner].primary);
    } else {
      this.effects.explosion(impact, 1);
      const hit = this.views.get(spec.targetId);
      if (hit !== undefined) {
        // A short squash sells the impact without needing a hit material. The
        // idle loop applies it, so the two never fight over the scale.
        void this.run(0.2, (t) => {
          hit.squash = Math.sin(t * Math.PI);
        });
      }
    }

    if (spec.damage > 0) await this.popDamage(spec.targetTile, spec.damage);
  }

  private popDamage(at: Point, amount: number): Promise<void> {
    const popup = damagePopup(amount);
    // Above the blast, not inside it: at impact the fireball fills the tile.
    popup.position.set(this.wx(at.x), 1.25, this.wz(at.y));
    this.effectLayer.add(popup);

    return this.run(0.42, (t) => {
      popup.position.y = 0.7 + t * 0.5;
      popup.material.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    }).then(() => {
      this.effectLayer.remove(popup);
    });
  }

  /** Brief pause so consecutive AI orders stay readable. */
  wait(seconds: number): Promise<void> {
    return this.run(seconds, () => {});
  }

  /**
   * Remove everything this World added. Clearing the whole scene would also
   * take the lights with it, which are owned by the Stage and set up once.
   */
  dispose(): void {
    this.ticking.length = 0;
    this.effects.clear();
    this.effects.setShakeSink(null);
    this.stage.scene.remove(this.root);
    this.views.clear();
    this.tileMeshes.clear();
    this.tileOwners.clear();
    this.captureBadges.clear();
  }

  /* ---------------------------------------------------------------- *
   * Battle cutscene
   * ---------------------------------------------------------------- */

  /**
   * Frame two tiles for a close, low-angle exchange: the camera drops to the
   * side of the firing line so both units are in profile, the way a battle
   * scene reads. The side is chosen to match whichever flank the tactical
   * camera was already on, so the cut never crosses the line and flips which
   * army appears on the left.
   */
  private battleFraming(a: Point, b: Point): { position: THREE.Vector3; look: THREE.Vector3 } {
    const from = new THREE.Vector3(this.wx(a.x), 0, this.wz(a.y));
    const to = new THREE.Vector3(this.wx(b.x), 0, this.wz(b.y));

    const mid = from.clone().add(to).multiplyScalar(0.5);
    const axis = to.clone().sub(from).setY(0);
    const separation = axis.length();
    if (separation < 1e-4) axis.set(0, 0, -1);
    axis.normalize();

    const side = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
    const current = this.stage.camera.position.clone().sub(mid);
    if (side.dot(current) < 0) side.negate();

    // Pull back far enough that both combatants fit with room to spare. The
    // margin is generous on purpose: framed tight, the near unit crops against
    // the edge of the screen and the shot reads as a mistake.
    const halfSpan = separation / 2 + 2.2;
    const vfov = (this.stage.camera.fov * Math.PI) / 180;
    const tanH = Math.tan(vfov / 2) * this.stage.camera.aspect;
    const distance = Math.max(7.5, halfSpan / tanH);

    const elevation = 0.52;
    const position = mid
      .clone()
      .addScaledVector(side, Math.cos(elevation) * distance)
      .addScaledVector(new THREE.Vector3(0, 1, 0), Math.sin(elevation) * distance)
      // Nudge along the firing line so the shot is not perfectly symmetrical.
      .addScaledVector(axis, -distance * 0.12);

    return { position, look: mid.clone().setY(0.45) };
  }

  /**
   * Run `body` with the camera swung in on the two tiles, then put the camera
   * back exactly where it was. The caller is responsible for suspending
   * whatever normally drives the camera.
   */
  async cinematic(a: Point, b: Point, body: () => Promise<void>): Promise<void> {
    const camera = this.stage.camera;
    // Tactical overlays belong to the tactical camera; a cursor bracket and a
    // movement range make no sense inside a close-up.
    const overlayWasVisible = this.overlay.group.visible;
    this.overlay.group.visible = false;
    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();

    const framing = this.battleFraming(a, b);
    const endQuat = (() => {
      const probe = camera.clone();
      probe.position.copy(framing.position);
      probe.lookAt(framing.look);
      return probe.quaternion.clone();
    })();

    await this.run(0.32, (t) => {
      const k = easeInOut(t);
      camera.position.lerpVectors(startPos, framing.position, k);
      camera.quaternion.slerpQuaternions(startQuat, endQuat, k);
    });

    await body();
    await this.wait(0.22);

    await this.run(0.3, (t) => {
      const k = easeInOut(t);
      camera.position.lerpVectors(framing.position, startPos, k);
      camera.quaternion.slerpQuaternions(endQuat, startQuat, k);
    });

    this.overlay.group.visible = overlayWasVisible;
  }

  /** Turn a unit to face a tile without moving it. */
  faceTowards(unitId: number, tile: Point): void {
    const view = this.views.get(unitId);
    if (view === undefined) return;
    const dx = this.wx(tile.x) - view.model.position.x;
    const dz = this.wz(tile.y) - view.model.position.z;
    if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return;
    this.turnTo(view, yawTowards(dx, dz));
  }

  /** Route explosion jolts to the camera. */
  setShakeSink(sink: ShakeSink | null): void {
    this.effects.setShakeSink(sink);
  }

  /**
   * Idle motion. Nothing on the board is ever perfectly still: infantry
   * breathe and shift their weight, tracked hulls tremble with the engine and
   * rock gently, wheeled units bounce on their suspension, and any unit with a
   * turret slowly sweeps it across the field.
   *
   * The amplitudes are deliberately tiny — large enough to notice out of the
   * corner of your eye, small enough that a unit still reads as sitting
   * squarely on its tile.
   */
  private applyIdle(view: UnitView): void {
    const t = this.clock + view.phase;
    const body = view.body;

    let lift = 0;
    let roll = 0;
    let sway = 0;
    let breathe = 0;

    switch (view.idle) {
      case "foot":
        lift = Math.sin(t * 2.1) * 0.014;
        breathe = Math.sin(t * 2.1) * 0.035;
        sway = Math.sin(t * 0.83) * 0.05;
        break;
      case "tracked":
        // A fast tremble for the engine, plus a slow rock on the suspension.
        lift = Math.sin(t * 8.7) * 0.006 + Math.sin(t * 1.3) * 0.008;
        roll = Math.sin(t * 7.1) * 0.008 + Math.sin(t * 1.1) * 0.016;
        sway = Math.sin(t * 0.61) * 0.022;
        break;
      case "wheeled":
        lift = Math.sin(t * 3.3) * 0.012;
        roll = Math.sin(t * 2.2) * 0.026;
        sway = Math.sin(t * 0.74) * 0.03;
        break;
    }

    const squash = view.squash;
    body.position.y = lift;
    body.rotation.z = roll;
    body.rotation.y = sway;
    body.scale.set(
      UNIT_SCALE * (1 + squash * 0.12),
      UNIT_SCALE * (1 + breathe * 0.4 - squash * 0.16),
      UNIT_SCALE * (1 + squash * 0.12),
    );

    if (view.turret !== null) {
      view.turret.rotation.y = Math.sin(t * 0.42) * 0.16;
    }
  }

  update(dt: number): void {
    this.clock += dt;
    for (let i = this.ticking.length - 1; i >= 0; i--) {
      if (!this.ticking[i](dt)) this.ticking.splice(i, 1);
    }
    for (const view of this.views.values()) this.applyIdle(view);
    this.effects.update(dt);
    this.overlay.update(dt);
  }

  /**
   * Which tile the pointer is over. Rays are cast against the flat play
   * surface rather than the terrain meshes, so a tall mountain never steals
   * the hit from the tile the player is actually pointing at.
   */
  tileAtScreen(clientX: number, clientY: number): Point | null {
    const canvas = this.stage.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.stage.camera);

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, hit) === null) return null;

    const x = Math.round(hit.x + (this.map.width - 1) / 2);
    const y = Math.round(hit.z + (this.map.height - 1) / 2);
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return null;
    return { x, y };
  }

  /** Screen position of a tile, for anchoring DOM popups to the board. */
  project(tile: Point): { x: number; y: number } {
    const vector = new THREE.Vector3(this.wx(tile.x), 0.5, this.wz(tile.y));
    vector.project(this.stage.camera);
    const canvas = this.stage.renderer.domElement;
    return {
      x: ((vector.x + 1) / 2) * canvas.clientWidth,
      y: ((1 - vector.y) / 2) * canvas.clientHeight,
    };
  }
}
