import * as THREE from "three";
import { buildBoard, worldX, worldZ } from "./board";
import { buildTerrainTile, type TileContext } from "./terrainModels";
import { buildUnitModel } from "./unitModels";
import { captureBadge, damagePopup, hpBadge } from "./labels";
import { dimmed } from "./materials";
import { Overlay } from "./overlay";
import { displayHp } from "../core/damage";
import { tileAt, type GameMap } from "../core/map";
import { CAPTURE_POINTS, TERRAIN } from "../core/terrain";
import type { GameState, Unit } from "../core/game";
import type { Owner, Point, TerrainId } from "../core/types";
import type { Stage } from "./scene";

/**
 * Owns everything in the scene and keeps it in step with the game state. The
 * rules never touch three.js; this is the only place the two meet.
 */

interface UnitView {
  id: number;
  model: THREE.Group;
  hp: THREE.Sprite | null;
  facing: number;
  done: boolean;
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
  private readonly tileMeshes = new Map<number, THREE.Group>();
  private readonly tileOwners = new Map<number, Owner>();
  private readonly captureBadges = new Map<number, THREE.Sprite>();

  private readonly ticking: Array<(dt: number) => boolean> = [];

  /**
   * Animation speed multiplier. Durations below are authored for normal play;
   * the automated playtest cranks this up so a match runs at logic speed
   * instead of at the mercy of the frame rate.
   */
  speed = 1;

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
      this.setDone(view, unit.done);
      this.refreshHp(view, unit);
    }

    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.unitLayer.remove(view.model);
      this.views.delete(id);
    }

    this.syncTiles();
  }

  private createView(unit: Unit): UnitView {
    const model = buildUnitModel(unit.type, unit.owner);
    // Both armies face the middle of the board at the start of the game.
    const facing = unit.owner === 0 ? Math.PI : 0;
    model.rotation.y = facing;
    model.position.set(this.wx(unit.x), 0, this.wz(unit.y));
    this.unitLayer.add(model);

    // Remember the original finish of every part so "done" can be undone.
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.userData.baseMaterial = mesh.material;
    });

    return { id: unit.id, model, hp: null, facing, done: false };
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

    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1];
      const to = path[i];
      const target = Math.atan2(this.wx(to.x) - this.wx(from.x), this.wz(to.y) - this.wz(from.y));
      this.turnTo(view, target);

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

  /** Lunge, flash, and float the damage number off the target. */
  async animateAttack(attackerId: number, target: Point, damage: number): Promise<void> {
    const view = this.views.get(attackerId);
    if (view === undefined) return;

    const origin = view.model.position.clone();
    const toward = new THREE.Vector3(this.wx(target.x), 0, this.wz(target.y))
      .sub(origin)
      .normalize()
      .multiplyScalar(0.22);

    this.turnTo(view, Math.atan2(toward.x, toward.z));

    await this.run(0.13, (t) => {
      const k = Math.sin(easeInOut(t) * Math.PI);
      view.model.position.copy(origin).addScaledVector(toward, k);
    });
    view.model.position.copy(origin);

    if (damage > 0) await this.popDamage(target, damage);
  }

  private popDamage(at: Point, amount: number): Promise<void> {
    const popup = damagePopup(amount);
    popup.position.set(this.wx(at.x), 0.7, this.wz(at.y));
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

  update(dt: number): void {
    for (let i = this.ticking.length - 1; i >= 0; i--) {
      if (!this.ticking[i](dt)) this.ticking.splice(i, 1);
    }
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
