import * as THREE from "three";
import { PALETTE } from "./palette";

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  key: THREE.DirectionalLight;
  resize: (width: number, height: number) => void;
  render: () => void;
}

/** A soft vertical gradient reads as sky without the cost of a skybox. */
function backdrop(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, "#a8d8f0");
  gradient.addColorStop(0.55, "#d8eefa");
  gradient.addColorStop(1, "#eef6f2");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface StageOptions {
  /** Shadow map resolution; 0 turns shadows off entirely. */
  shadowMapSize?: number;
  antialias?: boolean;
}

export function createStage(canvas: HTMLCanvasElement, options: StageOptions = {}): Stage {
  const { shadowMapSize = 1024, antialias = true } = options;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = shadowMapSize > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = backdrop();
  scene.fog = new THREE.Fog(PALETTE.fog, 26, 62);

  const camera = new THREE.PerspectiveCamera(24, 16 / 9, 0.5, 260);

  // Key light: warm, high, and off to one side so every box gets a lit face,
  // a mid-tone face and a shadowed face. This single choice does most of the
  // work of making flat-coloured plastic look three-dimensional.
  const key = new THREE.DirectionalLight(0xfff2df, 2.5);
  key.position.set(9, 16, 7);
  key.castShadow = shadowMapSize > 0;
  if (shadowMapSize > 0) key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  // Cool sky bounce keeps shadow sides blue-grey rather than dead black.
  const sky = new THREE.HemisphereLight(PALETTE.sky, PALETTE.ground, 1.15);
  scene.add(sky);

  // A dim rim light from behind separates units from the terrain they stand on.
  const rim = new THREE.DirectionalLight(0xdcecff, 0.55);
  rim.position.set(-8, 6, -9);
  scene.add(rim);

  scene.add(new THREE.AmbientLight(0xffffff, 0.18));

  const resize = (width: number, height: number): void => {
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };

  return {
    renderer,
    scene,
    camera,
    key,
    resize,
    render: () => renderer.render(scene, camera),
  };
}

/**
 * The fixed view angle the whole game is framed from: straight down the Z
 * axis, tilted about 58 degrees. Adding an X component gives a prettier
 * diorama but rotates the grid on screen, and a tactics game lives or dies on
 * being able to count tiles at a glance.
 */
export const VIEW_DIR = new THREE.Vector3(0, 0.9, 0.56).normalize();

/** Corners of the board's bounding volume, including terrain that sticks up. */
function boardCorners(width: number, height: number): THREE.Vector3[] {
  const hx = width / 2 + 0.35;
  const hz = height / 2 + 0.35;
  const corners: THREE.Vector3[] = [];
  for (const x of [-hx, hx]) {
    for (const z of [-hz, hz]) {
      for (const y of [-0.6, 1.2]) corners.push(new THREE.Vector3(x, y, z));
    }
  }
  return corners;
}

/**
 * Fit the board to the viewport by binary-searching the camera distance along
 * a fixed 3/4 view. A bounding-sphere fit would be simpler, but it wastes a
 * third of the screen on a wide board — and screen space is the whole point.
 */
export function frameBoard(stage: Stage, width: number, height: number, zoom = 1): number {
  const camera = stage.camera;
  const corners = boardCorners(width, height);

  const vfov = (camera.fov * Math.PI) / 180;
  const tanV = Math.tan(vfov / 2);
  const tanH = tanV * camera.aspect;

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const position = new THREE.Vector3();

  const fits = (distance: number): boolean => {
    position.copy(VIEW_DIR).multiplyScalar(distance);
    forward.copy(position).negate().normalize();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    up.crossVectors(right, forward).normalize();

    for (const corner of corners) {
      offset.copy(corner).sub(position);
      const z = offset.dot(forward);
      if (z <= 0.1) return false;
      if (Math.abs(offset.dot(right)) > z * tanH) return false;
      if (Math.abs(offset.dot(up)) > z * tanV) return false;
    }
    return true;
  };

  let low = 1;
  let high = Math.hypot(width, height) * 6 + 40;
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2;
    if (fits(mid)) high = mid;
    else low = mid;
  }
  const distance = high * 1.02 * zoom;

  camera.position.copy(VIEW_DIR).multiplyScalar(distance);
  camera.lookAt(0, 0, 0);

  // Point the key light at the board and size its frustum to just cover it,
  // which is what keeps 2048px of shadow map looking sharp on a big map.
  const span = Math.max(width, height) * 0.62 + 3;
  const shadow = stage.key.shadow.camera;
  shadow.left = -span;
  shadow.right = span;
  shadow.top = span;
  shadow.bottom = -span;
  shadow.updateProjectionMatrix();

  stage.scene.fog = new THREE.Fog(PALETTE.fog, distance * 0.9, distance * 2.4);
  return distance;
}

/**
 * Camera controller for play: the angle never changes, only how far out the
 * camera sits and what point on the board it is centred on. Keeping the view
 * direction locked means the grid never rotates under the player's mouse.
 */
export class CameraRig {
  readonly target = new THREE.Vector3();
  private distance: number;
  private readonly fitDistance: number;
  private shakeAmount = 0;
  private readonly shakeOffset = new THREE.Vector3();
  /** While suspended the rig leaves the camera alone, for cutscenes. */
  private suspended = false;

  constructor(
    private readonly stage: Stage,
    private readonly width: number,
    private readonly height: number,
  ) {
    this.fitDistance = frameBoard(stage, width, height);
    this.distance = this.fitDistance;
    this.apply();
  }

  /** 1 = whole board visible; smaller numbers move in for a closer look. */
  get zoom(): number {
    return this.distance / this.fitDistance;
  }

  /** Set zoom directly as a fraction of the whole-board fit. */
  setZoom(fraction: number): void {
    this.distance = THREE.MathUtils.clamp(
      this.fitDistance * fraction,
      this.fitDistance * 0.3,
      this.fitDistance * 1.05,
    );
    this.clampTarget();
    this.apply();
  }

  zoomBy(factor: number): void {
    this.distance = THREE.MathUtils.clamp(
      this.distance * factor,
      this.fitDistance * 0.3,
      this.fitDistance * 1.05,
    );
    // Zooming out shrinks how far the camera is allowed to stray from the
    // centre. Without re-clamping here, zooming out after panning leaves the
    // view stranded off to one side with no way to walk it back.
    this.clampTarget();
    this.apply();
  }

  /** Keep the look-at point inside whatever slack the current zoom allows. */
  private clampTarget(): void {
    const slackX = Math.max(0, (this.width / 2) * (1 - this.zoom));
    const slackZ = Math.max(0, (this.height / 2) * (1 - this.zoom));
    this.target.x = THREE.MathUtils.clamp(this.target.x, -slackX, slackX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -slackZ, slackZ);
  }

  /** Pan in screen space; the board never rotates so the mapping is direct. */
  panBy(dx: number, dz: number): void {
    this.target.x += dx;
    this.target.z += dz;
    this.clampTarget();
    this.apply();
  }

  /** Bring a board position into view without jumping the zoom level. */
  focus(x: number, z: number): void {
    this.target.x = x;
    this.target.z = z;
    this.clampTarget();
    this.apply();
  }

  /**
   * Hand the camera over to something else — a battle cutscene, say. The rig
   * keeps its own target and distance, so resuming restores the exact
   * tactical view the player had before the interruption.
   */
  suspend(): void {
    this.suspended = true;
  }

  resume(): void {
    this.suspended = false;
    this.shakeAmount = 0;
    this.shakeOffset.set(0, 0, 0);
    this.apply();
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  /** Add a jolt. Repeated hits stack up to a cap rather than resetting. */
  shake(amount: number): void {
    this.shakeAmount = Math.min(0.42, this.shakeAmount + amount);
  }

  /** Decay the jolt and re-offset the camera; call once per frame. */
  updateShake(dt: number): void {
    if (this.suspended) return;
    if (this.shakeAmount <= 0.0005) {
      if (this.shakeOffset.lengthSq() > 0) {
        this.shakeOffset.set(0, 0, 0);
        this.apply();
      }
      return;
    }
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.9);
    const a = this.shakeAmount;
    this.shakeOffset.set(
      (Math.random() - 0.5) * a,
      (Math.random() - 0.5) * a * 0.55,
      (Math.random() - 0.5) * a,
    );
    this.apply();
  }

  apply(): void {
    if (this.suspended) return;
    const camera = this.stage.camera;
    camera.position
      .copy(VIEW_DIR)
      .multiplyScalar(this.distance)
      .add(this.target)
      .add(this.shakeOffset);
    camera.lookAt(this.target);

    this.stage.key.position.set(this.target.x + 9, 16, this.target.z + 7);
    this.stage.key.target.position.copy(this.target);
    this.stage.key.target.updateMatrixWorld();
  }
}
