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
import { BUILD_ORDER, UNITS, isIndirect } from "../core/units";
import type { MapEntry } from "../core/maps";
import { key, type PlayerId, type Point, type UnitId } from "../core/types";
import { CameraRig } from "../render/scene";
import { TEAMS } from "../render/palette";
import { World } from "../render/world";
import { Hud, type MenuItem } from "./hud";
import type { Stage } from "../render/scene";

/**
 * Turns pointer and key events into rules calls, and sequences the animations
 * in between. The one subtlety worth knowing: choosing a destination only
 * *previews* the move — the unit's real position does not change until an
 * action is confirmed, so cancelling can walk it straight back.
 */

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
  private panning = false;

  constructor(
    private readonly stage: Stage,
    private readonly host: HTMLElement,
    private readonly entry: MapEntry,
    private readonly animationSpeed = 1,
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
    this.bindInput();
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
    this.rig.apply();
    this.mode = { kind: "idle" };
  }

  /* ---------------------------------------------------------------- *
   * Input
   * ---------------------------------------------------------------- */

  private bindInput(): void {
    const canvas = this.stage.renderer.domElement;

    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    canvas.addEventListener("pointermove", (event) => {
      if (this.panning) {
        // Screen-space drag maps straight to board axes; the view never rotates.
        const scale = this.rig.zoom * 0.028;
        this.rig.panBy(-event.movementX * scale, -event.movementY * scale);
        return;
      }
      this.onHover(this.world.tileAtScreen(event.clientX, event.clientY));
    });

    canvas.addEventListener("pointerdown", (event) => {
      if (event.button === 1) {
        this.panning = true;
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
      const tile = this.world.tileAtScreen(event.clientX, event.clientY);
      if (event.button === 2) void this.cancel();
      else if (tile !== null) void this.onClick(tile);
    });

    canvas.addEventListener("pointerup", (event) => {
      if (event.button === 1) this.panning = false;
    });

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.rig.zoomBy(event.deltaY > 0 ? 1.12 : 0.89);
      },
      { passive: false },
    );

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") void this.cancel();
      if (event.key === "e" || event.key === "E") void this.endHumanTurn();
    });
  }

  private onHover(tile: Point | null): void {
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
        this.mode = { kind: "idle" };
        this.hud.hideMenu();
        this.selectAt(tile);
        return;
    }
  }

  private selectAt(tile: Point): void {
    this.hud.hideMenu();
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
    await this.world.animateMove(unit.id, path);

    this.openActionMenu(unit, at, origin, path);
  }

  private openActionMenu(unit: Unit, at: Point, origin: Point, path: Point[]): void {
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
    const funds = this.state.players[0].funds;
    const items: MenuItem[] = BUILD_ORDER.map((type: UnitId) => ({
      label: UNITS[type].name,
      cost: UNITS[type].cost,
      disabled: UNITS[type].cost > funds,
      onSelect: () => {
        buildUnit(this.state, tile.x, tile.y, type);
        this.hud.hideMenu();
        this.mode = { kind: "idle" };
        this.world.sync(this.state);
        this.hud.refresh(this.state);
      },
    }));
    items.push({ label: "取消", onSelect: () => void this.cancel() });

    this.mode = { kind: "building", at: tile };
    this.hud.showMenu(items, this.world.project(tile), `工厂 · 资金 $${funds.toLocaleString()}`);
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
    if (unit !== undefined) capture(this.state, unit);
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

    const result = attack(this.state, attacker, defender);

    await this.world.animateAttack({
      attackerId,
      attackerType,
      targetId: defenderId,
      targetTile: defenderTile,
      targetOwner: defenderOwner,
      damage: Math.min(result.damage, 100),
      destroyed: result.defenderDestroyed,
      indirect: isIndirect(attackerType),
    });

    if (result.counter > 0 || result.attackerDestroyed) {
      await this.world.animateAttack({
        attackerId: defenderId,
        attackerType: defenderType,
        targetId: attackerId,
        targetTile: attackerTile,
        targetOwner: attackerOwner,
        damage: Math.min(result.counter, 100),
        destroyed: result.attackerDestroyed,
        // Counterattacks are only ever made by adjacent direct-fire units.
        indirect: false,
      });
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
      this.hud.showResult(this.state);
      return;
    }
    this.mode = { kind: "idle" };
  }

  /** Back out of whatever is open, walking a previewed move back if needed. */
  private async cancel(): Promise<void> {
    this.hud.hideMenu();
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
          capture(this.state, unit);
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
      this.hud.showResult(this.state);
      return;
    }

    endTurn(this.state);
    this.world.sync(this.state);
    this.hud.refresh(this.state);
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
