import * as THREE from "three";
import { buildUnitModel } from "./unitModels";
import { PALETTE } from "./palette";
import type { PlayerId, UnitId } from "../core/types";

/**
 * Renders a unit model once into a PNG data URL, for use as an <img> in the
 * build menu. The alternative — hand-drawn 2D icons — would drift out of sync
 * with the models the moment either changed; this way the menu always shows
 * exactly the thing you are about to buy.
 *
 * Uses its own small offscreen context so it can never disturb the main
 * renderer's state mid-frame.
 */

const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;

const SIZE = 192;

function offscreen(): THREE.WebGLRenderer {
  if (renderer !== null) return renderer;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

export function unitIcon(type: UnitId, owner: PlayerId): string {
  const id = `${type}:${owner}`;
  const hit = cache.get(id);
  if (hit !== undefined) return hit;

  const scene = new THREE.Scene();

  // Lighting mirrors the board so an icon and the unit on the field read as
  // the same object in the same world.
  const key = new THREE.DirectionalLight(0xfff2df, 2.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(PALETTE.sky, PALETTE.ground, 1.2));
  const rim = new THREE.DirectionalLight(0xdcecff, 0.6);
  rim.position.set(-3, 2, -4);
  scene.add(rim);

  const model = buildUnitModel(type, owner);
  // Three-quarter view: front and one flank, the two faces that carry the
  // silhouette.
  model.rotation.y = Math.PI - 0.7;
  scene.add(model);

  const bounds = new THREE.Box3().setFromObject(model);
  const centre = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getSize(new THREE.Vector3()).length() / 2;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 40);
  const fov = (camera.fov * Math.PI) / 180;
  const distance = (radius / Math.sin(fov / 2)) * 1.08;
  camera.position.copy(new THREE.Vector3(0.34, 0.5, 1).normalize().multiplyScalar(distance)).add(centre);
  camera.lookAt(centre);

  const gl = offscreen();
  gl.render(scene, camera);
  const url = gl.domElement.toDataURL("image/png");

  scene.clear();
  cache.set(id, url);
  return url;
}
