import * as THREE from "three";

/**
 * Canvas-drawn billboards for the little numbers that float over units: HP,
 * capture progress, and damage popups. Sprites always face the camera, so
 * these stay legible from any zoom without fighting the 3D perspective.
 */

const textureCache = new Map<string, THREE.Texture>();

interface BadgeStyle {
  background: string;
  border: string;
  text: string;
}

function badgeTexture(label: string, style: BadgeStyle): THREE.Texture {
  const id = `${label}|${style.background}|${style.border}|${style.text}`;
  const hit = textureCache.get(id);
  if (hit !== undefined) return hit;

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const radius = 30;
  const x = 14;
  const y = 34;
  const w = size - 28;
  const h = size - 68;

  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fillStyle = style.background;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = style.border;
  ctx.stroke();

  ctx.fillStyle = style.text;
  ctx.font = "bold 46px -apple-system, Helvetica Neue, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, size / 2, y + h / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(id, texture);
  return texture;
}

const HP_STYLE: BadgeStyle = {
  background: "#1d2430",
  border: "#f4f7fa",
  text: "#ffffff",
};

const CAPTURE_STYLE: BadgeStyle = {
  background: "#f6c445",
  border: "#7a5407",
  text: "#3a2803",
};

const DAMAGE_STYLE: BadgeStyle = {
  background: "#e23b3b",
  border: "#ffe0e0",
  text: "#ffffff",
};

function sprite(texture: THREE.Texture, scale: number): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const item = new THREE.Sprite(material);
  item.scale.setScalar(scale);
  item.renderOrder = 10;
  return item;
}

/** The 1-9 HP pip that hangs off a damaged unit. */
export function hpBadge(hp: number): THREE.Sprite {
  return sprite(badgeTexture(String(hp), HP_STYLE), 0.42);
}

/** Remaining capture points, shown while a property is being taken. */
export function captureBadge(remaining: number): THREE.Sprite {
  return sprite(badgeTexture(String(remaining), CAPTURE_STYLE), 0.4);
}

/** Floating "-35" that rises off a unit when it is hit. */
export function damagePopup(amount: number): THREE.Sprite {
  return sprite(badgeTexture(`-${amount}`, DAMAGE_STYLE), 0.62);
}
