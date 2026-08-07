import * as THREE from "three";
import { plastic } from "./materials";
import { roundedBox, sphere } from "./geometry";

/**
 * Muzzle flashes, tracers, shells, explosions and debris.
 *
 * Everything is procedural: a couple of canvas-drawn radial textures on
 * additive sprites do the light, and small lit boxes do the debris. One pooled
 * point light is added at construction — adding a light later would force
 * every material in the scene to recompile mid-fight.
 */

function radialTexture(stops: Array<[number, string]>): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function ringTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = "rgba(255,232,178,0.9)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 10, 0, Math.PI * 2);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let flashTexture: THREE.Texture | null = null;
let smokeTexture: THREE.Texture | null = null;
let shockTexture: THREE.Texture | null = null;

function textures(): {
  flash: THREE.Texture;
  smoke: THREE.Texture;
  shock: THREE.Texture;
} {
  flashTexture ??= radialTexture([
    [0, "rgba(255,255,245,1)"],
    [0.28, "rgba(255,224,140,0.95)"],
    [0.62, "rgba(255,138,42,0.55)"],
    [1, "rgba(255,120,30,0)"],
  ]);
  smokeTexture ??= radialTexture([
    [0, "rgba(190,190,190,0.9)"],
    [0.55, "rgba(150,150,150,0.5)"],
    [1, "rgba(130,130,130,0)"],
  ]);
  shockTexture ??= ringTexture();
  return { flash: flashTexture, smoke: smokeTexture, shock: shockTexture };
}

type Tick = (dt: number) => boolean;

export interface ShakeSink {
  shake(amount: number): void;
}

export class Effects {
  readonly group = new THREE.Group();

  private readonly active: Tick[] = [];
  private readonly light: THREE.PointLight;
  private lightEnergy = 0;
  private shakeSink: ShakeSink | null = null;

  /** Matches World.speed so effects compress along with everything else. */
  speed = 1;

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
    this.light = new THREE.PointLight(0xffa64a, 0, 9, 2);
    this.light.visible = false;
    this.group.add(this.light);
  }

  setShakeSink(sink: ShakeSink | null): void {
    this.shakeSink = sink;
  }

  private run(duration: number, step: (t: number) => void, onDone?: () => void): Promise<void> {
    const scaled = Math.max(1e-4, duration / this.speed);
    return new Promise((resolve) => {
      let elapsed = 0;
      this.active.push((dt) => {
        elapsed += dt;
        const t = Math.min(1, elapsed / scaled);
        step(t);
        if (t < 1) return true;
        onDone?.();
        resolve();
        return false;
      });
    });
  }

  private sprite(texture: THREE.Texture, color: number, opacity: number): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const item = new THREE.Sprite(material);
    item.renderOrder = 8;
    this.group.add(item);
    return item;
  }

  private discard(object: THREE.Object3D): void {
    this.group.remove(object);
    const sprite = object as THREE.Sprite;
    if (sprite.isSprite) sprite.material.dispose();
  }

  private pulseLight(at: THREE.Vector3, energy: number): void {
    this.light.position.copy(at);
    this.light.visible = true;
    this.lightEnergy = Math.max(this.lightEnergy, energy);
  }

  /* ---------------------------------------------------------------- *
   * Individual effects
   * ---------------------------------------------------------------- */

  /** Bloom of light at the barrel tip, plus a brief burst of sparks. */
  muzzleFlash(at: THREE.Vector3, direction: THREE.Vector3, scale = 1): void {
    const { flash } = textures();

    const core = this.sprite(flash, 0xfff4d0, 1);
    core.position.copy(at);
    this.pulseLight(at, 4 * scale);

    void this.run(
      0.13,
      (t) => {
        core.scale.setScalar((0.24 + t * 0.5) * scale);
        core.material.opacity = 1 - t;
      },
      () => this.discard(core),
    );

    // A few sparks thrown forward along the barrel.
    for (let i = 0; i < 4; i++) {
      const spark = this.sprite(flash, 0xffd27a, 0.9);
      spark.position.copy(at);
      const spread = new THREE.Vector3(
        direction.x + (Math.random() - 0.5) * 0.5,
        0.25 + Math.random() * 0.4,
        direction.z + (Math.random() - 0.5) * 0.5,
      ).normalize();
      const speed = 1.4 + Math.random() * 1.2;

      void this.run(
        0.22,
        (t) => {
          spark.position
            .copy(at)
            .addScaledVector(spread, speed * t * 0.2)
            .setY(at.y + spread.y * speed * t * 0.2 - 0.5 * 3 * (t * 0.2) ** 2);
          spark.scale.setScalar(0.13 * (1 - t) * scale);
          spark.material.opacity = 1 - t;
        },
        () => this.discard(spark),
      );
    }
  }

  /** Flat-trajectory round: a bright streak that crosses to the target. */
  tracer(from: THREE.Vector3, to: THREE.Vector3): Promise<void> {
    const { flash } = textures();
    const streak = this.sprite(flash, 0xffe9a8, 1);
    streak.scale.set(0.34, 0.11, 1);

    const distance = from.distanceTo(to);
    return this.run(
      Math.min(0.26, 0.05 + distance * 0.028),
      (t) => {
        streak.position.lerpVectors(from, to, t);
        streak.material.opacity = t > 0.85 ? (1 - t) / 0.15 : 1;
      },
      () => this.discard(streak),
    );
  }

  /** Indirect fire: a shell lobbed on a visible arc, trailing smoke. */
  shell(from: THREE.Vector3, to: THREE.Vector3): Promise<void> {
    const { flash, smoke } = textures();

    // A lit, solid round reads against bright grass; an additive dot does not.
    const round = new THREE.Mesh(
      sphere(0.085, 10),
      plastic(0x35393f, { roughness: 0.5, metalness: 0.3 }),
    );
    round.castShadow = true;
    this.group.add(round);

    const glow = this.sprite(flash, 0xffd58a, 0.85);
    glow.scale.setScalar(0.3);

    const distance = from.distanceTo(to);
    const apex = 0.9 + distance * 0.42;
    let trailTimer = 0;

    return this.run(
      Math.min(0.9, 0.3 + distance * 0.05),
      (t) => {
        round.position.lerpVectors(from, to, t);
        round.position.y += Math.sin(t * Math.PI) * apex;
        round.rotation.x += 0.4;
        glow.position.copy(round.position);

        trailTimer += 0.016;
        if (trailTimer > 0.035) {
          trailTimer = 0;
          const puff = this.sprite(smoke, 0xe8ecef, 0.75);
          puff.material.blending = THREE.NormalBlending;
          puff.position.copy(round.position);
          void this.run(
            0.5,
            (u) => {
              puff.scale.setScalar(0.18 + u * 0.34);
              puff.material.opacity = 0.75 * (1 - u);
            },
            () => this.discard(puff),
          );
        }
      },
      () => {
        this.group.remove(round);
        this.discard(glow);
      },
    );
  }

  /**
   * Impact. `power` scales the whole thing: 1 for a hit, ~1.6 for a kill.
   * `debrisColor` tints the thrown chunks so a destroyed unit visibly comes
   * apart in its own livery.
   */
  explosion(at: THREE.Vector3, power = 1, debrisColor = 0x6b6f75): void {
    const { flash, smoke, shock } = textures();
    this.pulseLight(at, 9 * power);
    this.shakeSink?.shake(0.1 * power);

    const core = this.sprite(flash, 0xfff0c8, 1);
    core.position.copy(at);
    void this.run(
      0.16,
      (t) => {
        core.scale.setScalar((0.4 + t * 1.5) * power);
        core.material.opacity = 1 - t * t;
      },
      () => this.discard(core),
    );

    // Fireball. Deliberately NOT additive: additive orange over bright grass
    // washes straight out to white, and the blast reads as a faint haze. An
    // opaque ball keeps its colour and hides the unit behind it.
    for (let i = 0; i < 5; i++) {
      const blob = this.sprite(flash, i === 0 ? 0xffd27a : 0xf87a1e, 1);
      blob.material.blending = THREE.NormalBlending;
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 0.42,
        Math.random() * 0.24,
        (Math.random() - 0.5) * 0.42,
      );
      const delay = i * 0.04;
      void this.run(
        0.4 + delay,
        (t) => {
          const u = Math.max(0, (t - delay) / (1 - delay));
          blob.position.copy(at).add(offset).setY(at.y + offset.y + u * 0.4);
          blob.scale.setScalar((0.35 + u * 1.0) * power);
          // Hold full opacity through the first half so the ball reads solid,
          // then fade.
          blob.material.opacity = u < 0.45 ? 1 : 1 - (u - 0.45) / 0.55;
        },
        () => this.discard(blob),
      );
    }

    // Smoke lingers after the fire is gone.
    for (let i = 0; i < 5; i++) {
      const puff = this.sprite(smoke, 0xc9cdd1, 0.75);
      puff.material.blending = THREE.NormalBlending;
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 0.55,
        0,
        (Math.random() - 0.5) * 0.55,
      );
      const rise = 0.5 + Math.random() * 0.5;
      const delay = 0.18 + i * 0.03;
      void this.run(
        1.0,
        (t) => {
          const u = Math.max(0, (t - delay) / (1 - delay));
          puff.position.copy(at).add(offset).setY(at.y + u * rise);
          puff.scale.setScalar((0.35 + u * 1.0) * power);
          puff.material.opacity = 0.8 * (1 - u) ** 1.3;
        },
        () => this.discard(puff),
      );
    }

    // Ground shockwave ring, flat on the tile.
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: shock,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, 0.04, at.z);
    ring.renderOrder = 7;
    this.group.add(ring);
    void this.run(
      0.36,
      (t) => {
        const size = (0.5 + t * 2.1) * power;
        ring.scale.set(size, size, 1);
        ring.material.opacity = 0.8 * (1 - t);
      },
      () => {
        this.group.remove(ring);
        ring.material.dispose();
        ring.geometry.dispose();
      },
    );

    this.debris(at, power, debrisColor);
  }

  /** Chunks thrown out on ballistic arcs, tumbling as they go. */
  private debris(at: THREE.Vector3, power: number, color: number): void {
    const count = Math.round(7 * power);
    for (let i = 0; i < count; i++) {
      const size = 0.08 + Math.random() * 0.1;
      const chunk = new THREE.Mesh(
        roundedBox(size, size * 0.7, size * 1.2, size * 0.2),
        plastic(color, { roughness: 0.75 }),
      );
      chunk.castShadow = true;
      chunk.position.copy(at);
      this.group.add(chunk);

      const angle = Math.random() * Math.PI * 2;
      const speed = 1.1 + Math.random() * 1.5;
      const up = 2.2 + Math.random() * 1.8;
      const spin = new THREE.Vector3(
        Math.random() * 12 - 6,
        Math.random() * 12 - 6,
        Math.random() * 12 - 6,
      );

      void this.run(
        0.7,
        (t) => {
          const time = t * 0.7;
          chunk.position.set(
            at.x + Math.cos(angle) * speed * time,
            Math.max(0.02, at.y + up * time - 4.9 * time * time),
            at.z + Math.sin(angle) * speed * time,
          );
          chunk.rotation.set(spin.x * time, spin.y * time, spin.z * time);
        },
        () => {
          this.group.remove(chunk);
          chunk.geometry.dispose();
        },
      );
    }
  }

  /** A unit coming apart: a heavier blast tinted with its own colour. */
  destruction(at: THREE.Vector3, color: number): void {
    this.explosion(at, 1.65, color);
    this.shakeSink?.shake(0.22);
  }

  /* ---------------------------------------------------------------- */

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (!this.active[i](dt)) this.active.splice(i, 1);
    }

    if (this.lightEnergy > 0) {
      this.lightEnergy = Math.max(0, this.lightEnergy - dt * 42 * this.speed);
      this.light.intensity = this.lightEnergy;
      this.light.visible = this.lightEnergy > 0.01;
    }
  }

  clear(): void {
    this.active.length = 0;
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i];
      if (child === this.light) continue;
      this.group.remove(child);
    }
    this.lightEnergy = 0;
    this.light.visible = false;
  }
}
