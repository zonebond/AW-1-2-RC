import * as THREE from "three";
import type { GameMap } from "../core/map";
import { worldX, worldZ } from "./board";
import type { Point } from "../core/types";

/**
 * Everything drawn on top of the terrain to explain the rules: where a unit
 * can go, what it can shoot, the route it will take, and where the cursor is.
 *
 * All of it is unlit and sits just above the tile surface, so it keeps the
 * same readable colour regardless of the lighting on the board underneath.
 */

const SURFACE_Y = 0.035;
const PATH_Y = 0.075;

/**
 * Diagonal hatching that scrolls, so a range reads as live rather than
 * painted on. Movement and threat use opposite diagonals: over saturated
 * grass a red wash and an orange-owned tile land on nearly the same colour,
 * so the two have to be told apart by texture, not just hue.
 */
function stripeTexture(lean: 1 | -1 = 1): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "rgba(255,255,255,0.30)";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 9;
  for (let i = -size; i < size * 2; i += 21) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + lean * size, size);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The chevron that hangs over whichever unit is selected. */
function chevronTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const draw = (inset: number): void => {
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size - inset);
    ctx.lineTo(size - inset, inset);
    ctx.lineTo(size * 0.5, size * 0.45);
    ctx.lineTo(inset, inset);
    ctx.closePath();
  };

  draw(8);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  draw(16);
  ctx.fillStyle = "#ffd23c";
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function flatQuad(
  size: number,
  color: number,
  opacity: number,
  map: THREE.Texture | null,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      color,
      map,
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
    private readonly map: THREE.Texture | null = null,
  ) {}

  begin(): void {
    this.used = 0;
  }

  place(x: number, z: number, y = SURFACE_Y): void {
    let mesh = this.meshes[this.used];
    if (mesh === undefined) {
      mesh = flatQuad(this.size, this.color, this.opacity, this.map);
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

/** Four thick corner brackets that hover and bob over the focused tile. */
function buildCursor(): THREE.Group {
  const group = new THREE.Group();

  const make = (color: number, arm: number, thickness: number, reach: number, order: number) => {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      depthTest: false,
    });
    const layer = new THREE.Group();
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const horizontal = new THREE.Mesh(new THREE.PlaneGeometry(arm, thickness), material);
      horizontal.rotation.x = -Math.PI / 2;
      horizontal.position.set(sx * (reach - arm / 2), 0, sz * reach);

      const vertical = new THREE.Mesh(new THREE.PlaneGeometry(thickness, arm), material);
      vertical.rotation.x = -Math.PI / 2;
      vertical.position.set(sx * reach, 0, sz * (reach - arm / 2));

      layer.add(horizontal, vertical);
    }
    layer.renderOrder = order;
    return layer;
  };

  // White underlay behind a yellow bracket: the outline is what keeps the
  // cursor readable over pale roads and bright grass alike.
  group.add(make(0xffffff, 0.42, 0.15, 0.47, 6));
  const inner = make(0xffd23c, 0.36, 0.09, 0.45, 7);
  inner.position.y = 0.001;
  group.add(inner);
  return group;
}

/**
 * Ribbon geometry along an axis-aligned path, with an arrowhead on the end.
 * Segments are drawn overlong so their ends overlap at corners, which fills
 * the elbow without any mitring maths.
 */
function pathGeometry(
  points: readonly THREE.Vector2[],
  width: number,
  headLength: number,
  headWidth: number,
): THREE.BufferGeometry | null {
  if (points.length < 2) return null;

  const positions: number[] = [];
  const half = width / 2;

  const quad = (
    cx: number,
    cz: number,
    halfX: number,
    halfZ: number,
  ): void => {
    positions.push(
      cx - halfX, 0, cz - halfZ,
      cx + halfX, 0, cz - halfZ,
      cx + halfX, 0, cz + halfZ,
      cx - halfX, 0, cz - halfZ,
      cx + halfX, 0, cz + halfZ,
      cx - halfX, 0, cz + halfZ,
    );
  };

  const last = points[points.length - 1];
  const beforeLast = points[points.length - 2];
  const headDir = new THREE.Vector2(last.x - beforeLast.x, last.y - beforeLast.y).normalize();
  // Stop the ribbon short so the arrowhead is not buried inside it.
  const tip = last.clone();
  const shaftEnd = tip.clone().addScaledVector(headDir, -headLength);

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = i === points.length - 2 ? shaftEnd : points[i + 1];
    const cx = (a.x + b.x) / 2;
    const cz = (a.y + b.y) / 2;
    const halfX = Math.abs(b.x - a.x) / 2 + half;
    const halfZ = Math.abs(b.y - a.y) / 2 + half;
    if (halfX <= half && halfZ <= half && i === points.length - 2) continue;
    quad(cx, cz, halfX, halfZ);
  }

  // Arrowhead: a triangle pointing along the final leg.
  const side = new THREE.Vector2(-headDir.y, headDir.x).multiplyScalar(headWidth / 2);
  const baseA = shaftEnd.clone().add(side);
  const baseB = shaftEnd.clone().sub(side);
  positions.push(tip.x, 0, tip.y, baseA.x, 0, baseA.y, baseB.x, 0, baseB.y);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

export class Overlay {
  readonly group = new THREE.Group();

  private readonly movePool: QuadPool;
  private readonly attackPool: QuadPool;
  private readonly targetPool: QuadPool;
  private readonly cursor = buildCursor();
  private readonly chevron: THREE.Sprite;
  private readonly pathFill: THREE.Mesh;
  private readonly pathEdge: THREE.Mesh;
  private readonly stripes = stripeTexture(1);
  private readonly threatStripes = stripeTexture(-1);

  private cursorTile: Point | null = null;
  private chevronTile: Point | null = null;
  private elapsed = 0;

  constructor(private readonly map: GameMap) {
    this.movePool = new QuadPool(this.group, 0.96, 0x2f8ff0, 0.55, this.stripes);
    this.attackPool = new QuadPool(this.group, 0.96, 0xe11040, 0.52, this.threatStripes);
    this.targetPool = new QuadPool(this.group, 0.96, 0xff2d2d, 0.66);

    // Double sided on purpose: the ribbon is built as flat triangles in the
    // XZ plane, whose winding puts the front face downwards. Rather than fix
    // the winding in two places, draw both faces.
    const edgeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: 0xf5327f,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.pathEdge = new THREE.Mesh(new THREE.BufferGeometry(), edgeMaterial);
    this.pathFill = new THREE.Mesh(new THREE.BufferGeometry(), fillMaterial);
    this.pathEdge.renderOrder = 4;
    this.pathFill.renderOrder = 5;
    this.pathEdge.visible = false;
    this.pathFill.visible = false;
    this.group.add(this.pathEdge, this.pathFill);

    this.chevron = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: chevronTexture(),
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.chevron.scale.setScalar(0.66);
    this.chevron.renderOrder = 11;
    this.chevron.visible = false;
    this.group.add(this.chevron);

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

  /** The route the unit will walk, as a ribbon with an arrowhead. */
  setPath(path: readonly Point[]): void {
    const visible = path.length >= 2;
    this.pathFill.visible = visible;
    this.pathEdge.visible = visible;
    if (!visible) return;

    const points = path.map((p) => new THREE.Vector2(this.wx(p.x), this.wz(p.y)));

    const fill = pathGeometry(points, 0.26, 0.34, 0.54);
    const edge = pathGeometry(points, 0.36, 0.4, 0.68);
    if (fill === null || edge === null) {
      this.pathFill.visible = false;
      this.pathEdge.visible = false;
      return;
    }

    this.pathFill.geometry.dispose();
    this.pathEdge.geometry.dispose();
    this.pathFill.geometry = fill;
    this.pathEdge.geometry = edge;
    this.pathFill.position.y = PATH_Y + 0.002;
    this.pathEdge.position.y = PATH_Y;
  }

  setCursor(tile: Point | null): void {
    this.cursorTile = tile;
    this.cursor.visible = tile !== null;
    if (tile !== null) this.cursor.position.set(this.wx(tile.x), 0, this.wz(tile.y));
  }

  /** Big chevron over the unit currently under orders. */
  setSelected(tile: Point | null): void {
    this.chevronTile = tile;
    this.chevron.visible = tile !== null;
    if (tile !== null) this.chevron.position.set(this.wx(tile.x), 1.15, this.wz(tile.y));
  }

  clear(): void {
    this.setMovement([], []);
    this.setTargets([]);
    this.setPath([]);
    this.setSelected(null);
  }

  update(dt: number): void {
    this.elapsed += dt;
    // Scrolling hatch: the movement range should look like it is being offered
    // to you, not painted on.
    this.stripes.offset.set(-this.elapsed * 0.32, this.elapsed * 0.32);
    this.threatStripes.offset.set(this.elapsed * 0.32, this.elapsed * 0.32);

    if (this.cursorTile !== null) {
      this.cursor.position.y = 0.09 + Math.sin(this.elapsed * 4.2) * 0.035;
    }
    if (this.chevronTile !== null) {
      this.chevron.position.y = 1.15 + Math.sin(this.elapsed * 3.1) * 0.09;
    }
  }
}
