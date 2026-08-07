import * as THREE from "three";
import type { GameMap } from "../core/map";
import { worldX, worldZ } from "./board";
import type { Point } from "../core/types";

/**
 * Everything drawn on top of the terrain to explain the rules: where a unit
 * can go, what it can shoot, the route it will take, and where the cursor is.
 *
 * All of it lives just above the tile surface and is unlit, so it stays the
 * same readable colour regardless of the time-of-day lighting on the board.
 */

const SURFACE_Y = 0.035;

function flatQuad(size: number, color: number, opacity: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  return mesh;
}

/** A reusable pool of flat tiles in one colour. */
class QuadPool {
  private readonly meshes: THREE.Mesh[] = [];
  private used = 0;

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly size: number,
    private readonly color: number,
    private readonly opacity: number,
  ) {}

  begin(): void {
    this.used = 0;
  }

  place(x: number, z: number, y = SURFACE_Y): void {
    let mesh = this.meshes[this.used];
    if (mesh === undefined) {
      mesh = flatQuad(this.size, this.color, this.opacity);
      this.meshes.push(mesh);
      this.parent.add(mesh);
    }
    mesh.position.set(x, y, z);
    mesh.visible = true;
    this.used++;
  }

  end(): void {
    for (let i = this.used; i < this.meshes.length; i++) this.meshes[i].visible = false;
  }
}

/** Four corner brackets that hover and bob over the focused tile. */
function buildCursor(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0xfff4c2,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    depthTest: false,
  });

  const armLong = 0.34;
  const armShort = 0.08;
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const corner = new THREE.Group();
    const horizontal = new THREE.Mesh(new THREE.PlaneGeometry(armLong, armShort), material);
    horizontal.rotation.x = -Math.PI / 2;
    horizontal.position.set((-sx * armLong) / 2 + sx * 0.46, 0, sz * 0.46);

    const vertical = new THREE.Mesh(new THREE.PlaneGeometry(armShort, armLong), material);
    vertical.rotation.x = -Math.PI / 2;
    vertical.position.set(sx * 0.46, 0, (-sz * armLong) / 2 + sz * 0.46);

    corner.add(horizontal, vertical);
    group.add(corner);
  }
  group.renderOrder = 6;
  return group;
}

export class Overlay {
  readonly group = new THREE.Group();

  private readonly movePool: QuadPool;
  private readonly attackPool: QuadPool;
  private readonly targetPool: QuadPool;
  private readonly pathPool: QuadPool;
  private readonly cursor = buildCursor();
  private cursorTile: Point | null = null;
  private elapsed = 0;

  constructor(private readonly map: GameMap) {
    this.movePool = new QuadPool(this.group, 0.9, 0x3d9bff, 0.42);
    this.attackPool = new QuadPool(this.group, 0.9, 0xff4b4b, 0.34);
    this.targetPool = new QuadPool(this.group, 0.9, 0xff2d2d, 0.62);
    this.pathPool = new QuadPool(this.group, 0.34, 0xfff0b0, 0.9);
    this.group.add(this.cursor);
    this.clear();
  }

  private wx(x: number): number {
    return worldX(this.map, x);
  }

  private wz(y: number): number {
    return worldZ(this.map, y);
  }

  /** Blue reachable tiles plus the red ring of tiles it could shoot into. */
  setMovement(move: readonly Point[], attack: readonly Point[]): void {
    this.movePool.begin();
    for (const p of move) this.movePool.place(this.wx(p.x), this.wz(p.y));
    this.movePool.end();

    this.attackPool.begin();
    for (const p of attack) this.attackPool.place(this.wx(p.x), this.wz(p.y), SURFACE_Y - 0.004);
    this.attackPool.end();
  }

  /** Enemies currently selectable as an attack target. */
  setTargets(targets: readonly Point[]): void {
    this.targetPool.begin();
    for (const p of targets) this.targetPool.place(this.wx(p.x), this.wz(p.y), SURFACE_Y + 0.006);
    this.targetPool.end();
  }

  /** Breadcrumbs along the route the unit will actually walk. */
  setPath(path: readonly Point[]): void {
    this.pathPool.begin();
    for (let i = 1; i < path.length; i++) {
      this.pathPool.place(this.wx(path[i].x), this.wz(path[i].y), SURFACE_Y + 0.012);
    }
    this.pathPool.end();
  }

  setCursor(tile: Point | null): void {
    this.cursorTile = tile;
    this.cursor.visible = tile !== null;
    if (tile !== null) this.cursor.position.set(this.wx(tile.x), 0, this.wz(tile.y));
  }

  clear(): void {
    this.setMovement([], []);
    this.setTargets([]);
    this.setPath([]);
  }

  update(dt: number): void {
    this.elapsed += dt;
    if (this.cursorTile !== null) {
      this.cursor.position.y = 0.09 + Math.sin(this.elapsed * 4.2) * 0.035;
    }
  }
}
