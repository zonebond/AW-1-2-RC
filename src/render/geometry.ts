import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Rounded boxes everywhere. Sharp cube edges are what make procedural models
 * read as "programmer art"; a 2-3% corner radius is most of what sells the
 * injection-moulded look, so this is the default primitive of the whole game.
 */
const boxCache = new Map<string, RoundedBoxGeometry>();

export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius = Math.min(width, height, depth) * 0.16,
  // One segment is enough for a readable bevel at this scale and costs about
  // half the triangles of the default two.
  segments = 1,
): RoundedBoxGeometry {
  const safeRadius = Math.min(radius, Math.min(width, height, depth) / 2 - 1e-4);
  const id = `${width}|${height}|${depth}|${safeRadius}|${segments}`;
  const hit = boxCache.get(id);
  if (hit !== undefined) return hit;
  const geometry = new RoundedBoxGeometry(width, height, depth, segments, safeRadius);
  boxCache.set(id, geometry);
  return geometry;
}

const cylinderCache = new Map<string, THREE.CylinderGeometry>();

export function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments = 16,
): THREE.CylinderGeometry {
  const id = `${radiusTop}|${radiusBottom}|${height}|${segments}`;
  const hit = cylinderCache.get(id);
  if (hit !== undefined) return hit;
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
  cylinderCache.set(id, geometry);
  return geometry;
}

const sphereCache = new Map<string, THREE.SphereGeometry>();

export function sphere(radius: number, segments = 16): THREE.SphereGeometry {
  const id = `${radius}|${segments}`;
  const hit = sphereCache.get(id);
  if (hit !== undefined) return hit;
  const geometry = new THREE.SphereGeometry(radius, segments, Math.max(6, segments / 2));
  sphereCache.set(id, geometry);
  return geometry;
}

/** Build a mesh that casts and receives shadows, positioned in one call. */
export function part(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Deterministic per-tile noise. Scenery placement must be stable across
 * reloads — a forest that reshuffles itself every frame is unreadable.
 */
export function tileRandom(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2654435761) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Small helper for "pick one of these, deterministically". */
export function pick<T>(items: readonly T[], roll: number): T {
  return items[Math.min(items.length - 1, Math.floor(roll * items.length))];
}

/**
 * Collapse a group of meshes into one mesh per material.
 *
 * Models here are assembled from dozens of small primitives, which is lovely
 * to author and terrible to draw: a board of 300 tiles was issuing a few
 * thousand draw calls per frame, twice over once shadows are counted. Baking
 * the transforms into merged buffers cuts that to roughly one call per finish
 * and costs nothing, because none of these parts animate independently.
 */
export function bake(source: THREE.Object3D): THREE.Group {
  source.updateMatrixWorld(true);

  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  let castShadow = false;
  let receiveShadow = false;

  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.Material;
    if (Array.isArray(mesh.material)) return;

    // Merging requires identical attribute sets and a consistent index across
    // the whole batch. Boxes come out indexed while cones and cylinders do
    // not, so everything is flattened to non-indexed first — otherwise the
    // merge silently returns null and those parts vanish from the model.
    let geometry = mesh.geometry.clone();
    if (geometry.index !== null) geometry = geometry.toNonIndexed();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.deleteAttribute("uv1");

    const bucket = buckets.get(material);
    if (bucket === undefined) buckets.set(material, [geometry]);
    else bucket.push(geometry);

    castShadow ||= mesh.castShadow;
    receiveShadow ||= mesh.receiveShadow;
  });

  const baked = new THREE.Group();
  for (const [material, geometries] of buckets) {
    const merged =
      geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (merged === null) {
      // Never drop geometry silently: a failed merge means a visibly
      // incomplete model, so fall back to unmerged meshes.
      for (const geometry of geometries) baked.add(new THREE.Mesh(geometry, material));
      continue;
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    baked.add(mesh);
  }
  return baked;
}
