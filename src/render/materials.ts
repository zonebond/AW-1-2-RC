import * as THREE from "three";

/**
 * Every surface in the game is one of a handful of plastic finishes. Sharing
 * material instances keeps the draw-call count low and, more importantly,
 * keeps the whole board looking like it came out of the same moulding machine.
 */
const cache = new Map<string, THREE.MeshStandardMaterial>();

export interface PlasticOptions {
  /** 0 = mirror, 1 = chalk. Toy plastic lives around 0.4-0.6. */
  roughness?: number;
  metalness?: number;
  /** Slight self-illumination keeps shadowed sides from going muddy. */
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  flatShading?: boolean;
}

export function plastic(color: number, options: PlasticOptions = {}): THREE.MeshStandardMaterial {
  const {
    roughness = 0.55,
    metalness = 0.0,
    emissive = 0x000000,
    emissiveIntensity = 1,
    transparent = false,
    opacity = 1,
    flatShading = false,
  } = options;

  const id = [
    color,
    roughness,
    metalness,
    emissive,
    emissiveIntensity,
    transparent,
    opacity,
    flatShading,
  ].join("|");

  const hit = cache.get(id);
  if (hit !== undefined) return hit;

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive,
    emissiveIntensity,
    transparent,
    opacity,
    flatShading,
  });
  cache.set(id, material);
  return material;
}

/** Rubber for tracks and tyres: dark, matte, no highlight to speak of. */
export function rubber(color = 0x2f3238): THREE.MeshStandardMaterial {
  return plastic(color, { roughness: 0.85 });
}

/** Gunmetal for barrels and hardware. */
export function metal(color = 0x767d86): THREE.MeshStandardMaterial {
  return plastic(color, { roughness: 0.4, metalness: 0.6 });
}

/** Glass for windows and canopies. */
export function glass(color = 0x86c5e8): THREE.MeshStandardMaterial {
  return plastic(color, { roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
}

export function disposeMaterialCache(): void {
  for (const material of cache.values()) material.dispose();
  cache.clear();
}
