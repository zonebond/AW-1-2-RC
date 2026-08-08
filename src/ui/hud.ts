import { displayHp } from "../core/damage";
import { propertiesOf, type Forecast, type GameState, type Unit } from "../core/game";
import { tileAt, type Tile } from "../core/map";
import { CAPTURE_POINTS, TERRAIN } from "../core/terrain";
import {
  BUILD_ORDER,
  FOOT_UNITS,
  PROFILES,
  UNITS,
  VEHICLE_UNITS,
  isIndirect,
} from "../core/units";
import { canTarget } from "../core/damage";
import { unitIcon } from "../render/unitIcon";
import { NEUTRAL, type Owner, type Point, type UnitId } from "../core/types";
import { TEAMS } from "../render/palette";

/**
 * The whole interface is plain DOM layered over the canvas. Text, buttons and
 * panels are things browsers are already extremely good at, and keeping them
 * out of the 3D scene means the renderer only ever draws the battlefield.
 */

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function ownerLabel(owner: Owner): string {
  return owner === NEUTRAL ? "中立" : TEAMS[owner].name;
}

function ownerColor(owner: Owner): string {
  return owner === NEUTRAL ? "#b6b0a2" : hex(TEAMS[owner].primary);
}

export interface MenuItem {
  label: string;
  cost?: number;
  disabled?: boolean;
  onSelect: () => void;
}

export class Hud {
  readonly root = element("div");

  private readonly dayLabel = element("span", "day");
  private readonly treasuries: HTMLElement[] = [];
  private readonly terrainPanel = element("div", "panel info-terrain");
  private readonly unitPanel = element("div", "panel info-unit");
  private readonly menu = element("div", "panel menu hidden");
  private readonly build = element("div", "build hidden");
  private readonly forecastPanel = element("div", "panel forecast hidden");
  private readonly banner = element("div", "banner");
  private readonly endTurnButton = element("button", "end-turn", "结束回合");
  private resultScreen: HTMLElement | null = null;

  constructor(
    parent: HTMLElement,
    private readonly onEndTurn: () => void,
    private readonly onRestart: () => void,
  ) {
    this.root.id = "hud";

    const topbar = element("div", "panel topbar");
    topbar.append(this.dayLabel);
    for (const id of [0, 1] as const) {
      const box = element("div", `treasury p${id}`);
      box.append(element("span", "pip"), element("span", "amount", "0"));
      this.treasuries.push(box);
      topbar.append(box);
    }

    const hint = element("div", "panel hint");
    hint.innerHTML =
      "<kbd>左键</kbd>选择/确认　<kbd>拖动</kbd>或<kbd>WASD</kbd>平移　" +
      "<kbd>空格</kbd>回到我方　<kbd>右键</kbd>取消　<kbd>滚轮</kbd>缩放　<kbd>E</kbd>结束回合";

    this.endTurnButton.addEventListener("click", () => this.onEndTurn());

    this.root.append(
      topbar,
      this.terrainPanel,
      this.unitPanel,
      this.menu,
      this.build,
      this.forecastPanel,
      this.banner,
      this.endTurnButton,
      hint,
    );
    parent.append(this.root);
  }

  /* ---------------------------------------------------------------- *
   * Persistent panels
   * ---------------------------------------------------------------- */

  refresh(state: GameState): void {
    this.dayLabel.textContent = `第 ${state.day} 天`;
    for (const id of [0, 1] as const) {
      const box = this.treasuries[id];
      box.classList.toggle("active", state.turn === id);
      box.querySelector(".amount")!.textContent =
        `$${state.players[id].funds.toLocaleString()} · ${propertiesOf(state, id)}地`;
    }

    const humanTurn = state.turn === 0 && state.winner === null;
    this.endTurnButton.disabled = !humanTurn;
    this.endTurnButton.textContent = humanTurn ? "结束回合" : "蓝月军行动中…";
  }

  showTerrain(state: GameState, at: Point | null): void {
    if (at === null) {
      this.terrainPanel.classList.add("hidden");
      return;
    }
    const tile = tileAt(state.map, at.x, at.y);
    if (tile === null) {
      this.terrainPanel.classList.add("hidden");
      return;
    }
    this.terrainPanel.classList.remove("hidden");
    this.terrainPanel.replaceChildren(...this.terrainRows(tile));
  }

  private terrainRows(tile: Tile): HTMLElement[] {
    const def = TERRAIN[tile.terrain];
    const rows: HTMLElement[] = [];

    const title = element("div", "info-title");
    if (def.capturable) {
      const swatch = element("span", "swatch");
      swatch.style.background = ownerColor(tile.owner);
      title.append(swatch);
    }
    title.append(element("span", undefined, def.name));
    rows.push(title);

    const defence = element("div", "stat");
    defence.append(element("span", undefined, "防御"));
    const stars = element("b", "stars", "★".repeat(def.defence) + "☆".repeat(4 - def.defence));
    defence.append(stars);
    rows.push(defence);

    if (def.capturable) {
      rows.push(this.statRow("归属", ownerLabel(tile.owner)));
      if (tile.captureLeft < CAPTURE_POINTS) {
        rows.push(this.statRow("占领进度", `${CAPTURE_POINTS - tile.captureLeft}/${CAPTURE_POINTS}`));
      }
      if (def.builds) rows.push(this.statRow("功能", "可生产单位"));
      if (def.isHq) rows.push(this.statRow("功能", "被占领即战败"));
    }
    return rows;
  }

  private statRow(label: string, value: string): HTMLElement {
    const row = element("div", "stat");
    row.append(element("span", undefined, label), element("b", undefined, value));
    return row;
  }

  showUnit(unit: Unit | null): void {
    if (unit === null) {
      this.unitPanel.classList.add("hidden");
      return;
    }
    this.unitPanel.classList.remove("hidden");

    const def = UNITS[unit.type];
    const title = element("div", "info-title");
    const swatch = element("span", "swatch");
    swatch.style.background = hex(TEAMS[unit.owner].primary);
    title.append(swatch, element("span", undefined, def.name));

    const rows = [
      title,
      this.statRow("HP", `${displayHp(unit.hp)} / 10`),
      this.statRow("移动力", `${def.move} · ${moveClassName(unit.type)}`),
      this.statRow("燃料", `${unit.fuel} / ${def.maxFuel}`),
    ];
    if (def.maxAmmo > 0) rows.push(this.statRow("弹药", `${unit.ammo} / ${def.maxAmmo}`));
    if (def.rangeMax > 0) {
      rows.push(
        this.statRow(
          "射程",
          def.rangeMin === def.rangeMax
            ? String(def.rangeMax)
            : `${def.rangeMin}-${def.rangeMax}（移动后不可攻击）`,
        ),
      );
    }
    if (def.capacity > 0) rows.push(this.statRow("载员", `${unit.cargo.length} / ${def.capacity}`));

    this.unitPanel.replaceChildren(...rows);
  }

  /* ---------------------------------------------------------------- *
   * Menus and forecast
   * ---------------------------------------------------------------- */

  showMenu(items: readonly MenuItem[], screen: { x: number; y: number }, title?: string): void {
    if (items.length === 0) {
      this.hideMenu();
      return;
    }

    const nodes: HTMLElement[] = [];
    if (title !== undefined) nodes.push(element("div", "menu-title", title));

    for (const item of items) {
      const button = element("button");
      button.append(document.createTextNode(item.label));
      if (item.cost !== undefined) {
        button.append(element("span", "cost", `$${item.cost.toLocaleString()}`));
      }
      button.disabled = item.disabled === true;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        item.onSelect();
      });
      nodes.push(button);
    }

    this.menu.replaceChildren(...nodes);
    this.menu.classList.remove("hidden");
    this.position(this.menu, screen);
  }

  hideMenu(): void {
    this.menu.classList.add("hidden");
  }

  /* ---------------------------------------------------------------- *
   * Production
   * ---------------------------------------------------------------- */

  /**
   * The factory screen: a priced roster on the left, full stats for whichever
   * entry is highlighted on the right. The icons are the actual unit models,
   * rendered offscreen, so the menu can never show something the battlefield
   * does not.
   */
  showBuild(funds: number, onPick: (type: UnitId) => void, onCancel: () => void): void {
    const list = element("div", "build-list");
    const detail = element("div", "build-detail");

    const header = element("div", "build-header");
    header.append(
      element("span", "build-title", "工厂"),
      element("span", "build-funds", `$${funds.toLocaleString()}`),
    );

    let current: UnitId | null = null;
    const showDetail = (type: UnitId): void => {
      if (current === type) return;
      current = type;
      detail.replaceChildren(...this.buildDetail(type));
      for (const node of list.querySelectorAll(".build-item")) {
        node.classList.toggle("current", (node as HTMLElement).dataset.unit === type);
      }
    };

    for (const type of BUILD_ORDER) {
      const def = UNITS[type];
      const affordable = def.cost <= funds;

      const item = element("button", "build-item");
      item.dataset.unit = type;
      item.disabled = !affordable;

      const icon = element("img", "build-icon");
      icon.src = unitIcon(type, 0);
      icon.alt = def.name;

      item.append(
        icon,
        element("span", "build-name", def.name),
        element("span", "build-cost", `$${def.cost.toLocaleString()}`),
      );
      // Hovering previews, clicking commits — the same split the series uses.
      item.addEventListener("mouseenter", () => showDetail(type));
      item.addEventListener("focus", () => showDetail(type));
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        if (affordable) onPick(type);
      });
      list.append(item);
    }

    const cancel = element("button", "build-cancel", "取消");
    cancel.addEventListener("click", (event) => {
      event.stopPropagation();
      onCancel();
    });

    const columns = element("div", "build-columns");
    columns.append(list, detail);
    this.build.replaceChildren(header, columns, cancel);
    this.build.classList.remove("hidden");
    showDetail(BUILD_ORDER[0]);
  }

  hideBuild(): void {
    this.build.classList.add("hidden");
  }

  private buildDetail(type: UnitId): HTMLElement[] {
    const def = UNITS[type];
    const profile = PROFILES[type];
    const nodes: HTMLElement[] = [];

    const banner = element("div", "detail-banner", def.name);
    nodes.push(banner);

    const top = element("div", "detail-top");
    const stats = element("div", "detail-stats");
    stats.append(
      this.detailStat("移动", `${def.move}`),
      this.detailStat("视野", `${def.vision}`),
      this.detailStat("燃料", `${def.maxFuel} / ${def.maxFuel}`),
      this.detailStat("造价", `$${def.cost.toLocaleString()}`),
    );
    const portrait = element("img", "detail-portrait");
    portrait.src = unitIcon(type, 0);
    portrait.alt = def.name;
    top.append(stats, portrait);
    nodes.push(top);

    nodes.push(element("p", "detail-blurb", profile.blurb));

    nodes.push(
      this.weaponBlock(
        "主武器",
        profile.primary,
        def.maxAmmo > 0 ? `${def.maxAmmo} / ${def.maxAmmo}` : "无限",
        def,
        type,
      ),
    );
    nodes.push(this.weaponBlock("副武器", profile.secondary, "无限", def, type));
    return nodes;
  }

  private detailStat(label: string, value: string): HTMLElement {
    const row = element("div", "detail-stat");
    row.append(element("span", undefined, label), element("b", undefined, value));
    return row;
  }

  private weaponBlock(
    title: string,
    name: string | undefined,
    ammo: string,
    def: (typeof UNITS)[UnitId],
    type: UnitId,
  ): HTMLElement {
    const block = element("div", "detail-weapon");

    const head = element("div", "weapon-head");
    head.append(element("span", "weapon-label", title));
    if (name === undefined) {
      head.append(element("span", "weapon-none", "无"));
      block.append(head);
      return block;
    }

    head.append(element("span", "weapon-name", name));
    head.append(element("span", "weapon-ammo", ammo));
    if (def.rangeMax > 0) {
      head.append(
        element(
          "span",
          "weapon-range",
          def.rangeMin === def.rangeMax ? `射程 ${def.rangeMax}` : `射程 ${def.rangeMin}~${def.rangeMax}`,
        ),
      );
    }
    block.append(head);

    // What this weapon can actually hurt, read straight off the damage chart.
    const targets = element("div", "weapon-targets");
    for (const [label, group] of [
      ["步兵", FOOT_UNITS],
      ["车辆", VEHICLE_UNITS],
    ] as const) {
      const hits = group.some((other) => canTarget(type, other));
      const chip = element("span", `target ${hits ? "on" : "off"}`, label);
      targets.append(chip);
    }
    block.append(targets);
    return block;
  }

  showForecast(
    attacker: Unit,
    defender: Unit,
    shot: Forecast,
    screen: { x: number; y: number },
  ): void {
    const attackRow = element("div", "forecast-row attack");
    attackRow.append(
      element("span", undefined, `${UNITS[attacker.type].name} → ${UNITS[defender.type].name}`),
      element("span", "value", `${displayHp(defender.hp)} → ${displayHp(Math.max(0, defender.hp - shot.damage))}`),
    );

    const nodes: HTMLElement[] = [attackRow];

    const counterRow = element("div", "forecast-row counter");
    counterRow.append(element("span", undefined, "反击"));
    if (shot.destroys) {
      counterRow.append(element("span", "value", "无"));
    } else if (shot.counter === null) {
      counterRow.append(
        element("span", "value", isIndirect(defender.type) ? "间接单位不反击" : "无"),
      );
    } else {
      counterRow.append(
        element(
          "span",
          "value",
          `${displayHp(attacker.hp)} → ${displayHp(Math.max(0, attacker.hp - shot.counter))}`,
        ),
      );
    }
    nodes.push(counterRow);

    if (shot.destroys) nodes.push(element("div", "forecast-kill", "可击毁"));

    this.forecastPanel.replaceChildren(...nodes);
    this.forecastPanel.classList.remove("hidden");
    this.position(this.forecastPanel, { x: screen.x, y: screen.y - 96 });
  }

  hideForecast(): void {
    this.forecastPanel.classList.add("hidden");
  }

  /** Keep floating panels fully on screen no matter where the tile is. */
  private position(node: HTMLElement, screen: { x: number; y: number }): void {
    node.style.left = "0px";
    node.style.top = "0px";
    const box = node.getBoundingClientRect();
    const margin = 12;
    const x = Math.min(
      Math.max(margin, screen.x + 26),
      window.innerWidth - box.width - margin,
    );
    const y = Math.min(
      Math.max(margin, screen.y - box.height / 2),
      window.innerHeight - box.height - margin,
    );
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
  }

  /* ---------------------------------------------------------------- *
   * Banners
   * ---------------------------------------------------------------- */

  async flashBanner(text: string, color: string, ms = 900): Promise<void> {
    this.banner.textContent = text;
    this.banner.style.color = color;
    this.banner.classList.add("show");
    await new Promise((resolve) => setTimeout(resolve, ms));
    this.banner.classList.remove("show");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  showResult(state: GameState): void {
    if (state.winner === null || this.resultScreen !== null) return;

    const won = state.winner === 0;
    const screen = element("div", "result");
    screen.append(element("h1", undefined, won ? "胜利" : "失败"));
    screen.append(
      element(
        "p",
        undefined,
        `${TEAMS[state.winner].name}${state.endReason === "hq" ? "攻陷了敌方司令部" : "全歼了敌军"}　·　第 ${state.day} 天`,
      ),
    );

    const again = element("button", undefined, "再来一局");
    again.addEventListener("click", () => this.onRestart());
    screen.append(again);

    this.resultScreen = screen;
    this.root.append(screen);
  }

  clearResult(): void {
    this.resultScreen?.remove();
    this.resultScreen = null;
  }
}

function moveClassName(type: UnitId): string {
  switch (UNITS[type].moveClass) {
    case "foot":
      return "步行";
    case "boots":
      return "山地靴";
    case "tires":
      return "轮胎";
    case "treads":
      return "履带";
  }
}
