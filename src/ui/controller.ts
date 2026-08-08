import {
  actionsAt,
  attack,
  buildUnit,
  buildableAt,
  capture,
  createGame,
  endTurn,
  finishAction,
  forecast,
  loadUnit,
  moveUnit,
  movementRange,
  pathBetween,
  unitAt,
  unitById,
  unloadTilesAt,
  unloadUnit,
  type GameState,
  type Unit,
} from "../core/game";
import { nextAiStep } from "../ai/ai";
import { attackableTiles } from "../core/pathfinding";
import { pathTo } from "../core/pathfinding";
import type { MapEntry } from "../core/maps";
import { key, type PlayerId, type Point, type UnitId } from "../core/types";
import { CameraRig } from "../render/scene";
import { TEAMS } from "../render/palette";
import { World, type AttackAnimation } from "../render/world";
import { Hud, type MenuItem } from "./hud";
import { audio } from "../audio/audio";
import type { SoundId } from "../audio/sounds";
import { UNITS, isIndirect } from "../core/units";
import { chooseWeapon } from "../core/damage";
import type { Stage } from "../render/scene";

/**
 * Turns pointer and key events into rules calls, and sequences the animations
 * in between. The one subtlety worth knowing: choosing a destination only
 * *previews* the move — the unit's real position does not change until an
 * action is confirmed, so cancelling can walk it straight back.
 */

/** Pixels of pointer travel before a press counts as a drag, not a click. */
const DRAG_THRESHOLD = 6;

/** Each move class gets its own note: boots, tracks or tyres. */
function moveSound(type: UnitId): SoundId {
  switch (UNITS[type].moveClass) {
    case "foot":
    case "boots":
      return "moveFoot" as const;
    case "tires":
      return "moveTire" as const;
    case "treads":
      return "moveTread" as const;
  }
}

/**
 * Which weapon report to play when this unit opens fire. It depends on the
 * *target*, not just the shooter: a mech answers a tank with its bazooka and
 * infantry with its machine gun, and those are two completely different
 * noises. Ammo is not consulted — the report we want is the one the shot the
 * player is watching actually used, and the engine has already spent it.
 */
function fireSound(attacker: UnitId, defender: UnitId): SoundId {
  const slot = chooseWeapon(attacker, defender, 1)?.slot ?? "secondary";
  if (slot === "secondary") return "machineGun" as const;

  switch (attacker) {
    case "rockets":
      return "rocket" as const;
    case "mech":
      return "rocket" as const;
    // Autocannons, not artillery: a fast stutter rather than a single boom.
    case "antiair":
    case "recon":
    case "infantry":
      return "machineGun" as const;
    default:
      return "cannon" as const;
  }
}

function teamHex(player: PlayerId): string {
  return `#${TEAMS[player].light.toString(16).padStart(6, "0")}`;
}

type Mode =
  | { kind: "idle" }
  | { kind: "selected"; unitId: number; landing: Point[] }
  | { kind: "menu"; unitId: number; at: Point; origin: Point; path: Point[] }
  | { kind: "targeting"; unitId: number; at: Point; path: Point[]; targets: Unit[] }
  | { kind: "unloading"; unitId: number; at: Point; path: Point[]; tiles: Point[] }
  | { kind: "building"; at: Point }
  | { kind: "busy" }
  | { kind: "over" };

export class Controller {
  private state: GameState;
  private world: World;
  private readonly hud: Hud;
  private readonly rig: CameraRig;
  private mode: Mode = { kind: "idle" };
  private hovered: Point | null = null;
  /** Which button is being held for a possible camera drag, if any. */
  private dragButton: number | null = null;
  private dragDistance = 0;

  constructor(
    private readonly stage: Stage,
    private readonly host: HTMLElement,
    private readonly entry: MapEntry,
    private readonly animationSpeed = 1,
    /** Battle cutscenes; off at high speed so the playtest is not held up. */
    private readonly cutscenes = true,
  ) {
    this.state = createGame(entry.build(), entry.startUnits);
    this.world = new World(stage, this.state.map);
    this.world.speed = animationSpeed;
    this.rig = new CameraRig(stage, this.state.map.width, this.state.map.height);
    this.world.setShakeSink(this.rig);
    this.hud = new Hud(
      host,
      () => void this.endHumanTurn(),
      () => this.restart(),
    );

    this.world.sync(this.state);
    this.hud.refresh(this.state);
    this.openingView();
    this.bindInput();
  }

  /**
   * Start close in, looking at your own army, the way the series does. Fitting
   * the whole board on screen makes every tile too small to read and gives the
   * opening turn no sense of place.
   */
  private openingView(): void {
    // Set, not multiply: this runs again at the start of every player turn,
    // and a relative zoom would creep in a little closer each time.
    this.rig.setZoom(0.72);

    const own = this.state.units.filter((u) => u.owner === 0);
    if (own.length === 0) return;
    const cx = own.reduce((sum, u) => sum + u.x, 0) / own.length;
    const cy = own.reduce((sum, u) => sum + u.y, 0) / own.length;
    this.rig.focus(cx - (this.state.map.width - 1) / 2, cy - (this.state.map.height - 1) / 2);
  }

  private restart(): void {
    this.hud.clearResult();
    this.world.dispose();
    this.state = createGame(this.entry.build(), this.entry.startUnits);
    this.world = new World(this.stage, this.state.map);
    this.world.speed = this.animationSpeed;
    this.world.setShakeSink(this.rig);
    this.world.sync(this.state);
    this.hud.refresh(this.state);
    this.openingView();
    this.mode = { kind: "idle" };
  }

  /* ---------------------------------------------------------------- *
   * Input
   * ---------------------------------------------------------------- */

  private bindInput(): void {
    const canvas = this.stage.renderer.domElement;

    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    canvas.addEventListener("pointermove", (event) => {
      if (this.dragButton !== null) {
        // Past the threshold this is a camera drag, not a click. Tracking it
        // this way means panning works with the left button on a trackpad,
        // which has no middle button at all.
        this.dragDistance += Math.abs(event.movementX) + Math.abs(event.movementY);
        if (this.dragButton === 1 || this.dragDistance > DRAG_THRESHOLD) {
          const scale = this.rig.zoom * 0.03;
          this.rig.panBy(-event.movementX * scale, -event.movementY * scale);
          return;
        }
      }
      this.onHover(this.world.tileAtScreen(event.clientX, event.clientY));
    });

    canvas.addEventListener("pointerdown", (event) => {
      // Browsers hold audio until the user interacts with the page.
      audio.unlock();
      if (event.button === 2) {
        void this.cancel();
        return;
      }
      if (event.button !== 0 && event.button !== 1) return;
      this.dragButton = event.button;
      this.dragDistance = 0;
        canvas.setPointerCapture(event.pointerId);
      if (event.button === 1) event.preventDefault();
    });

    const endDrag = (event: PointerEvent): void => {
      const button = this.dragButton;
      const distance = this.dragDistance;
      this.dragButton = null;
      this.dragDistance = 0;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      // A left press that never turned into a drag is a click on the board.
      if (button !== 0 || distance > DRAG_THRESHOLD) return;
      const tile = this.world.tileAtScreen(event.clientX, event.clientY);
      if (tile !== null) void this.onClick(tile);
    };

    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", (event) => {
      this.dragButton = null;
      this.dragDistance = 0;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    });

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        // Trackpad pinch arrives as ctrl+wheel; a two-finger scroll arrives as
        // plain wheel with both axes. Treat a horizontal component as a pan so
        // trackpad users can move the board without any modifier.
        if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
          const scale = this.rig.zoom * 0.012;
          this.rig.panBy(event.deltaX * scale, event.deltaY * scale);
          return;
        }
        this.rig.zoomBy(event.deltaY > 0 ? 1.12 : 0.89);
      },
      { passive: false },
    );

    window.addEventListener("keydown", (event) => {
      audio.unlock();
      switch (event.key) {
        case "m":
        case "M":
          audio.setMuted(!audio.muted);
          this.hud.showAudioState(audio.muted, audio.musicEnabled);
          return;
        case "n":
        case "N":
          audio.setMusic(!audio.musicEnabled);
          this.hud.showAudioState(audio.muted, audio.musicEnabled);
          return;
        case "Escape":
          void this.cancel();
          return;
        case "e":
        case "E":
          void this.endHumanTurn();
          return;
        case " ":
          // Always a way back: re-frame on your own army.
          event.preventDefault();
          this.openingView();
          return;
        default:
          break;
      }

      const step = 0.9;
      const pan: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        a: [-step, 0],
        A: [-step, 0],
        ArrowRight: [step, 0],
        d: [step, 0],
        D: [step, 0],
        ArrowUp: [0, -step],
        w: [0, -step],
        W: [0, -step],
        ArrowDown: [0, step],
        s: [0, step],
        S: [0, step],
      };
      const delta = pan[event.key];
      if (delta === undefined) return;
      event.preventDefault();
      this.rig.panBy(delta[0], delta[1]);
    });
  }

  private onHover(tile: Point | null): void {
    const changed =
      tile !== null && (this.hovered === null || this.hovered.x !== tile.x || this.hovered.y !== tile.y);
    if (changed) audio.play("cursor", { minGap: 0.05 });
    this.hovered = tile;
    this.world.overlay.setCursor(tile);
    this.hud.showTerrain(this.state, tile);

    if (tile === null) {
      this.hud.hideForecast();
      return;
    }

    if (this.mode.kind === "selected") {
      const unit = unitById(this.state, this.mode.unitId);
      if (unit !== undefined && this.mode.landing.some((p) => p.x === tile.x && p.y === tile.y)) {
        this.world.overlay.setPath(pathBetween(this.state, unit, tile));
      } else {
        this.world.overlay.setPath([]);
      }
      this.hud.showUnit(unit ?? null);
      return;
    }

    if (this.mode.kind === "targeting") {
      const attacker = unitById(this.state, this.mode.unitId);
      const target = this.mode.targets.find((t) => t.x === tile.x && t.y === tile.y);
      if (attacker !== undefined && target !== undefined) {
        const probe: Unit = { ...attacker, x: this.mode.at.x, y: this.mode.at.y };
        const shot = forecast(this.state, probe, target);
        if (shot !== null) {
          this.hud.showForecast(probe, target, shot, this.world.project(tile));
          return;
        }
      }
      this.hud.hideForecast();
      return;
    }

    this.hud.showUnit(unitAt(this.state, tile.x, tile.y) ?? null);
  }

  /* ---------------------------------------------------------------- *
   * Selection and orders
   * ---------------------------------------------------------------- */

  private async onClick(tile: Point): Promise<void> {
    if (this.state.winner !== null) return;
    if (this.state.turn !== 0) return;

    switch (this.mode.kind) {
      case "busy":
      case "over":
        return;

      case "idle":
        this.selectAt(tile);
        return;

      case "selected": {
        const unit = unitById(this.state, this.mode.unitId);
        if (unit === undefined) return void this.cancel();
        if (this.mode.landing.some((p) => p.x === tile.x && p.y === tile.y)) {
          await this.previewMove(unit, pathBetween(this.state, unit, tile));
          return;
        }
        this.selectAt(tile);
        return;
      }

      case "menu":
        await this.cancel();
        return;

      case "targeting": {
        const target = this.mode.targets.find((t) => t.x === tile.x && t.y === tile.y);
        if (target === undefined) return void this.cancel();
        await this.resolveAttack(this.mode.unitId, this.mode.path, target.id);
        return;
      }

      case "unloading": {
        if (!this.mode.tiles.some((p) => p.x === tile.x && p.y === tile.y)) {
          return void this.cancel();
        }
        await this.resolveUnload(this.mode.unitId, this.mode.path, tile);
        return;
      }

      case "building":
        this.hud.hideBuild();
        this.mode = { kind: "idle" };
        this.selectAt(tile);
        return;
    }
  }

  private selectAt(tile: Point): void {
    this.hud.hideMenu();
    this.hud.hideBuild();
    this.hud.hideForecast();

    const unit = unitAt(this.state, tile.x, tile.y);
    if (unit !== undefined && unit.owner === 0 && !unit.done) {
      this.select(unit);
      return;
    }

    if (unit === undefined && buildableAt(this.state, tile.x, tile.y)) {
      this.openBuildMenu(tile);
      return;
    }

    this.mode = { kind: "idle" };
    this.world.overlay.clear();
    this.world.overlay.setCursor(this.hovered);
  }

  private select(unit: Unit): void {
    audio.play("select");
    const nodes = movementRange(this.state, unit);
    const landing: Point[] = [];
    for (const node of nodes.values()) {
      if (node.canStop || (node.x === unit.x && node.y === unit.y)) {
        landing.push({ x: node.x, y: node.y });
      }
    }

    // Indirect units cannot move and fire, so their threat ring is drawn from
    // where they stand; direct units project it from anywhere they can reach.
    const reach = new Set(landing.map((p) => key(p.x, p.y)));
    const threatened = new Set<number>();
    const origins = isIndirect(unit.type) ? [{ x: unit.x, y: unit.y }] : landing;
    for (const from of origins) {
      for (const t of attackableTiles(this.state.map, unit.type, from)) {
        const k = key(t.x, t.y);
        if (!reach.has(k)) threatened.add(k);
      }
    }

    this.mode = { kind: "selected", unitId: unit.id, landing };
    this.world.overlay.setSelected({ x: unit.x, y: unit.y });
    this.world.overlay.setMovement(
      landing,
      [...threatened].map((k) => ({ x: k % 1000, y: Math.floor(k / 1000) })),
    );
    this.world.overlay.setTargets([]);
    this.world.overlay.setPath([]);
    this.hud.showUnit(unit);
  }

  /** Walk the unit to the chosen tile without committing, then offer actions. */
  private async previewMove(unit: Unit, path: Point[]): Promise<void> {
    if (path.length === 0) return;
    const origin: Point = { x: unit.x, y: unit.y };
    const at = path[path.length - 1];

    this.mode = { kind: "busy" };
    this.world.overlay.clear();
    this.world.overlay.setCursor(null);
    if (path.length > 1) audio.play(moveSound(unit.type), { minGap: 0 });
    await this.world.animateMove(unit.id, path);

    this.world.overlay.setSelected(at);
    this.openActionMenu(unit, at, origin, path);
  }

  private openActionMenu(unit: Unit, at: Point, origin: Point, path: Point[]): void {
    audio.play("menu");
    const moved = at.x !== origin.x || at.y !== origin.y;
    const actions = actionsAt(this.state, unit, at, moved);
    const items: MenuItem[] = [];

    if (actions.canAttack) {
      items.push({
        label: "攻击",
        onSelect: () => {
          this.hud.hideMenu();
          this.mode = { kind: "targeting", unitId: unit.id, at, path, targets: actions.targets };
          this.world.overlay.setTargets(actions.targets.map((t) => ({ x: t.x, y: t.y })));
        },
      });
    }

    if (actions.canCapture) {
      items.push({
        label: "占领",
        onSelect: () => void this.resolveCapture(unit.id, path),
      });
    }

    if (actions.canLoad !== null) {
      const carrier = actions.canLoad;
      items.push({
        label: "登车",
        onSelect: () => void this.resolveLoad(unit.id, path, carrier.id),
      });
    }

    if (actions.canUnload) {
      items.push({
        label: "卸载",
        onSelect: () => {
          this.hud.hideMenu();
          const tiles = unloadTilesAt(this.state, unit, at);
          this.mode = { kind: "unloading", unitId: unit.id, at, path, tiles };
          this.world.overlay.setTargets(tiles);
        },
      });
    }

    if (actions.canWait) {
      items.push({ label: "待命", onSelect: () => void this.resolveWait(unit.id, path) });
    }

    items.push({ label: "取消", onSelect: () => void this.cancel() });

    this.mode = { kind: "menu", unitId: unit.id, at, origin, path };
    this.hud.showMenu(items, this.world.project(at));
  }

  private openBuildMenu(tile: Point): void {
    audio.play("menu");
    this.mode = { kind: "building", at: tile };
    this.hud.showBuild(
      this.state.players[0].funds,
      (type) => {
        buildUnit(this.state, tile.x, tile.y, type);
        audio.play("build");
        this.hud.hideBuild();
        this.mode = { kind: "idle" };
        this.world.sync(this.state);
        this.hud.refresh(this.state);
      },
      () => void this.cancel(),
    );
  }

  /* ---------------------------------------------------------------- *
   * Committing actions
   * ---------------------------------------------------------------- */

  private commitMove(unitId: number, path: Point[]): Unit | undefined {
    const unit = unitById(this.state, unitId);
    if (unit === undefined) return undefined;
    moveUnit(this.state, unit, path);
    return unit;
  }

  private async resolveWait(unitId: number, path: Point[]): Promise<void> {
    this.mode = { kind: "busy" };
    this.hud.hideMenu();
    const unit = this.commitMove(unitId, path);
    if (unit !== undefined) finishAction(this.state, unit);
    this.afterAction();
  }

  private async resolveCapture(unitId: number, path: Point[]): Promise<void> {
    this.mode = { kind: "busy" };
    this.hud.hideMenu();
    const unit = this.commitMove(unitId, path);
    if (unit !== undefined) {
      const captured = capture(this.state, unit);
      audio.play(captured ? "captureDone" : "captureTick");
    }
    this.afterAction();
  }

  private async resolveLoad(unitId: number, path: Point[], carrierId: number): Promise<void> {
    this.mode = { kind: "busy" };
    this.hud.hideMenu();
    const unit = this.commitMove(unitId, path);
    const carrier = unitById(this.state, carrierId);
    if (unit !== undefined && carrier !== undefined) loadUnit(this.state, carrier, unit);
    this.afterAction();
  }

  private async resolveUnload(unitId: number, path: Point[], at: Point): Promise<void> {
    this.mode = { kind: "busy" };
    this.hud.hideMenu();
    const carrier = this.commitMove(unitId, path);
    if (carrier !== undefined) unloadUnit(this.state, carrier, at);
    this.afterAction();
  }

  private async resolveAttack(unitId: number, path: Point[], targetId: number): Promise<void> {
    this.mode = { kind: "busy" };
    this.hud.hideMenu();
    this.hud.hideForecast();
    this.world.overlay.clear();

    const unit = this.commitMove(unitId, path);
    const target = unitById(this.state, targetId);
    if (unit === undefined || target === undefined) return this.afterAction();

    await this.playExchange(unit, target);
    this.afterAction();
  }

  /**
   * Resolve an attack and stage both halves of it: the shot, then the
   * counterattack if the defender survives to answer. Everything the animation
   * needs is captured before the rules run, because a destroyed unit is gone
   * from the state by the time we come to draw it.
   */
  private async playExchange(attacker: Unit, defender: Unit): Promise<void> {
    const attackerId = attacker.id;
    const defenderId = defender.id;
    const attackerType = attacker.type;
    const defenderType = defender.type;
    const attackerOwner = attacker.owner;
    const defenderOwner = defender.owner;
    const defenderTile: Point = { x: defender.x, y: defender.y };
    const attackerTile: Point = { x: attacker.x, y: attacker.y };
    // Snapshots: after the rules run, a destroyed unit is gone from the state.
    const attackerBefore: Unit = { ...attacker };
    const defenderBefore: Unit = { ...defender };

    const result = attack(this.state, attacker, defender);

    const shot: AttackAnimation = {
      attackerId,
      attackerType,
      targetId: defenderId,
      targetTile: defenderTile,
      targetOwner: defenderOwner,
      damage: Math.min(result.damage, 100),
      destroyed: result.defenderDestroyed,
      indirect: isIndirect(attackerType),
    };
    const counter: AttackAnimation | null =
      result.counter > 0 || result.attackerDestroyed
        ? {
            attackerId: defenderId,
            attackerType: defenderType,
            targetId: attackerId,
            targetTile: attackerTile,
            targetOwner: attackerOwner,
            damage: Math.min(result.counter, 100),
            destroyed: result.attackerDestroyed,
            // Counterattacks are only ever made by adjacent direct-fire units.
            indirect: false,
          }
        : null;

    const sequence = async (): Promise<void> => {
      audio.play(fireSound(attackerType, defenderType), { minGap: 0 });
      await this.world.animateAttack(shot);
      audio.play(result.defenderDestroyed ? "destroy" : "impact", { minGap: 0 });
      if (this.cutscenes) {
        this.hud.updateBattleHp(1, defenderBefore.hp - result.damage);
      }
      if (counter !== null) {
        audio.play(fireSound(defenderType, attackerType), { minGap: 0 });
        await this.world.animateAttack(counter);
        audio.play(result.attackerDestroyed ? "destroy" : "impact", { minGap: 0 });
        if (this.cutscenes) {
          this.hud.updateBattleHp(0, attackerBefore.hp - result.counter);
        }
      }
    };

    if (!this.cutscenes) {
      await sequence();
      return;
    }

    // Both sides square up before the camera arrives, so the cut lands on two
    // units already facing each other rather than on them turning.
    this.world.faceTowards(attackerId, defenderTile);
    this.world.faceTowards(defenderId, attackerTile);

    this.hud.showBattle(attackerBefore, defenderBefore);
    this.rig.suspend();
    try {
      await this.world.cinematic(attackerTile, defenderTile, sequence);
    } finally {
      this.rig.resume();
      this.hud.hideBattle();
    }
  }

  private afterAction(): void {
    this.world.sync(this.state);
    this.hud.refresh(this.state);
    this.world.overlay.clear();
    this.world.overlay.setCursor(this.hovered);
    this.hud.hideForecast();

    if (this.state.winner !== null) {
      this.mode = { kind: "over" };
      audio.play(this.state.winner === 0 ? "victory" : "defeat");
      this.hud.showResult(this.state);
      return;
    }
    this.mode = { kind: "idle" };
  }

  /** Back out of whatever is open, walking a previewed move back if needed. */
  private async cancel(): Promise<void> {
    if (this.mode.kind !== "idle") audio.play("cancel");
    this.hud.hideMenu();
    this.hud.hideBuild();
    this.hud.hideForecast();

    switch (this.mode.kind) {
      case "menu": {
        const { unitId, origin, path } = this.mode;
        this.mode = { kind: "busy" };
        if (path.length > 1) await this.world.animateMove(unitId, [...path].reverse());
        this.world.sync(this.state);
        void origin;
        this.mode = { kind: "idle" };
        const unit = unitById(this.state, unitId);
        if (unit !== undefined) this.select(unit);
        return;
      }

      case "targeting":
      case "unloading": {
        const unit = unitById(this.state, this.mode.unitId);
        const at = this.mode.at;
        const path = this.mode.path;
        if (unit === undefined) break;
        this.world.overlay.setTargets([]);
        this.openActionMenu(unit, at, { x: unit.x, y: unit.y }, path);
        return;
      }

      default:
        break;
    }

    this.mode = { kind: "idle" };
    this.world.overlay.clear();
    this.world.overlay.setCursor(this.hovered);
    this.world.sync(this.state);
  }

  /* ---------------------------------------------------------------- *
   * Turn flow
   * ---------------------------------------------------------------- */

  private async endHumanTurn(): Promise<void> {
    if (this.state.turn !== 0 || this.state.winner !== null) return;
    if (this.mode.kind === "busy") return;

    this.hud.hideMenu();
    this.world.overlay.clear();
    this.mode = { kind: "busy" };

    endTurn(this.state);
    this.world.sync(this.state);
    this.hud.refresh(this.state);

    audio.play("turnEnemy");
    await this.hud.flashBanner("蓝月军 回合", teamHex(1));
    await this.runAiTurn();
  }

  private async runAiTurn(): Promise<void> {
    let guard = 0;
    while (this.state.turn === 1 && this.state.winner === null && guard++ < 500) {
      const step = nextAiStep(this.state);
      if (step.kind === "end") break;

      if (step.kind === "build") {
        buildUnit(this.state, step.x, step.y, step.type);
        audio.play("build");
        this.world.sync(this.state);
        this.hud.refresh(this.state);
        await this.world.wait(0.06);
        continue;
      }

      const unit = unitById(this.state, step.order.unitId);
      if (unit === undefined) break;

      // Keep the acting unit on screen when the player is zoomed in.
      if (this.rig.zoom < 0.95) {
        const target = step.order.path[step.order.path.length - 1];
        this.rig.focus(
          target.x - (this.state.map.width - 1) / 2,
          target.y - (this.state.map.height - 1) / 2,
        );
      }

      if (step.order.path.length > 1) audio.play(moveSound(unit.type), { minGap: 0 });
      await this.world.animateMove(unit.id, step.order.path);
      moveUnit(this.state, unit, step.order.path);

      switch (step.order.then.kind) {
        case "attack": {
          const target = unitById(this.state, step.order.then.targetId);
          if (target === undefined) {
            finishAction(this.state, unit);
            break;
          }
          await this.playExchange(unit, target);
          break;
        }
        case "capture":
          audio.play(capture(this.state, unit) ? "captureDone" : "captureTick");
          break;
        case "wait":
          finishAction(this.state, unit);
          break;
      }

      this.world.sync(this.state);
      this.hud.refresh(this.state);
      await this.world.wait(0.05);
    }

    if (this.state.winner !== null) {
      this.mode = { kind: "over" };
      this.world.sync(this.state);
      this.hud.refresh(this.state);
      audio.play(this.state.winner === 0 ? "victory" : "defeat");
      this.hud.showResult(this.state);
      return;
    }

    endTurn(this.state);
    this.world.sync(this.state);
    this.hud.refresh(this.state);
    // The camera followed the AI around; hand the player back a view of their
    // own army rather than wherever the last enemy order happened to end.
    this.openingView();
    audio.play("turnPlayer");
    await this.hud.flashBanner("红星军 回合", teamHex(0));

    this.mode = this.state.winner === null ? { kind: "idle" } : { kind: "over" };
    if (this.state.winner !== null) this.hud.showResult(this.state);
  }

  update(dt: number): void {
    this.world.update(dt);
    this.rig.updateShake(dt);
  }

  /** Exposed so the bootstrap can rebuild the layout on resize. */
  get element(): HTMLElement {
    return this.host;
  }

  /**
   * Development-only handle used by tools/playtest.mjs to find the screen
   * position of a tile and to assert on game state after each click.
   */
  debug(): {
    state: () => GameState;
    project: (x: number, y: number) => { x: number; y: number };
    mode: () => string;
    landing: (unitId: number) => Point[];
    aiProbe: () => void;
    stats: () => { calls: number; triangles: number; programs: number };
    restart: () => void;
    lightCount: () => number;
    focusTile: (x: number, y: number) => void;
    camera: () => { x: number; z: number; zoom: number };
    advance: (dt: number) => void;
    rawCamera: () => { x: number; y: number; z: number };
  } {
    return {
      state: () => this.state,
      project: (x, y) => this.world.project({ x, y }),
      mode: () => this.mode.kind,
      landing: (unitId) => {
        const unit = unitById(this.state, unitId);
        if (unit === undefined) return [];
        const out: Point[] = [];
        for (const node of movementRange(this.state, unit).values()) {
          if (node.canStop || (node.x === unit.x && node.y === unit.y)) {
            out.push({ x: node.x, y: node.y });
          }
        }
        return out;
      },
      aiProbe: () => void nextAiStep(this.state),
      restart: () => this.restart(),
      advance: (dt) => this.update(dt),
      rawCamera: () => ({
        x: this.stage.camera.position.x,
        y: this.stage.camera.position.y,
        z: this.stage.camera.position.z,
      }),
      camera: () => ({
        x: this.rig.target.x,
        z: this.rig.target.z,
        zoom: this.rig.zoom,
      }),
      focusTile: (x, y) =>
        this.rig.focus(
          x - (this.state.map.width - 1) / 2,
          y - (this.state.map.height - 1) / 2,
        ),
      lightCount: () =>
        this.stage.scene.children.filter((child) => (child as { isLight?: boolean }).isLight)
          .length,
      stats: () => ({
        calls: this.stage.renderer.info.render.calls,
        triangles: this.stage.renderer.info.render.triangles,
        programs: this.stage.renderer.info.programs?.length ?? 0,
      }),
    };
  }
}

/** Re-exported for tools that need to replay a path outside the controller. */
export { pathTo };
