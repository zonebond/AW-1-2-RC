import { COS, type CoDef, type CoId } from "../core/co";

/**
 * Commander portraits, drawn rather than loaded.
 *
 * There is no art to ship here, so each commander gets a bold geometric
 * emblem on a plate in their accent colour. It reads as deliberate design
 * rather than a missing image, and it costs nothing to add a commander.
 */

const cache = new Map<string, string>();

function drawEmblem(ctx: CanvasRenderingContext2D, emblem: CoDef["emblem"], size: number): void {
  const c = size / 2;
  const r = size * 0.26;
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.strokeStyle = "rgba(255,255,255,0.94)";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  switch (emblem) {
    case "shield": {
      ctx.beginPath();
      ctx.moveTo(c, c - r * 1.15);
      ctx.lineTo(c + r * 0.88, c - r * 0.55);
      ctx.lineTo(c + r * 0.7, c + r * 0.5);
      ctx.lineTo(c, c + r * 1.2);
      ctx.lineTo(c - r * 0.7, c + r * 0.5);
      ctx.lineTo(c - r * 0.88, c - r * 0.55);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "blade": {
      ctx.beginPath();
      ctx.moveTo(c - r * 0.5, c + r * 1.1);
      ctx.lineTo(c + r * 0.85, c - r * 1.1);
      ctx.lineTo(c + r * 1.1, c - r * 0.55);
      ctx.lineTo(c - r * 0.16, c + r * 1.1);
      ctx.closePath();
      ctx.fill();
      // Cross-guard, so it reads as a weapon rather than a stripe.
      ctx.lineWidth = size * 0.075;
      ctx.beginPath();
      ctx.moveTo(c - r * 0.95, c + r * 0.42);
      ctx.lineTo(c - r * 0.02, c + r * 0.95);
      ctx.stroke();
      break;
    }
    case "arrow": {
      ctx.lineWidth = size * 0.1;
      ctx.beginPath();
      ctx.moveTo(c - r * 1.05, c + r * 0.75);
      ctx.lineTo(c + r * 0.15, c - r * 0.75);
      ctx.lineTo(c + r * 1.05, c + r * 0.75);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c - r * 1.05, c - r * 0.05);
      ctx.lineTo(c + r * 0.15, c - r * 1.4);
      ctx.lineTo(c + r * 1.05, c - r * 0.05);
      ctx.stroke();
      break;
    }
    case "burst": {
      ctx.lineWidth = size * 0.085;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(angle) * r * 0.45, c + Math.sin(angle) * r * 0.45);
        ctx.lineTo(c + Math.cos(angle) * r * 1.15, c + Math.sin(angle) * r * 1.15);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(c, c, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

/** A square portrait plate for a commander, as a data URL. Cached per size. */
export function coPortrait(id: CoId, size = 96): string {
  const cacheKey = `${id}@${size}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;

  const co = COS[id];
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const base = `#${co.color.toString(16).padStart(6, "0")}`;
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, base);
  gradient.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // A diagonal band behind the emblem, so two commanders sharing an emblem
  // shape still look different at a glance.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(size * 0.55, 0);
  ctx.lineTo(size, 0);
  ctx.lineTo(size * 0.45, size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  drawEmblem(ctx, co.emblem, size);

  const url = canvas.toDataURL("image/png");
  cache.set(cacheKey, url);
  return url;
}
