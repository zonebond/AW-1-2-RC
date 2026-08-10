import { displayHp } from "../core/damage";
import {
  canActivate,
  maxStars,
  powerStars,
  propertiesOf,
  type Forecast,
  type GameState,
  type PowerKind,
  type Unit,
} from "../core/game";
import { COS, CO_IDS, type CoId } from "../core/co";
import { coPortrait } from "./coCard";
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

/** Human-readable summary of a commander's always-on bias. */
function describeD2d(id: CoId): string {
  const mods = COS[id].d2d;
  const scope =
    mods.scope === "foot" ? "步兵" : mods.scope === "indirect" ? "间接单位" : "全军";
  const parts: string[] = [];
  if (mods.attack !== undefined) {
    parts.push(`${scope}攻击 ${mods.attack > 0 ? "+" : ""}${mods.attack}%`);
  }
  if (mods.defence !== undefined) {
    parts.push(`防御 ${mods.defence > 0 ? "+" : ""}${mods.defence}%`);
  }
  return parts.length === 0 ? "无加成，无短板" : parts.join("，");
}

export class Hud {
  readonly root = element("div");

  private readonly dayLabel = element("span", "day");
  private readonly treasuries: HTMLElement[] = [];
  private readonly terrainPanel = element("div", "panel info-terrain");
  private readonly unitPanel = element("div", "panel info-unit");
  private readonly menu = element("div", "panel menu hidden");
  private readonly build = element("div", "build hidden");
  private readonly cinema = element("div", "cinema hidden");
  private readonly audioToast = element("div", "panel toast hidden");
  private toastTimer = 0;
  private readonly cinemaCards: [HTMLElement, HTMLElement] = [
    element("div", "combatant left"),
    element("div", "combatant right"),
  ];
  private readonly forecastPanel = element("div", "panel forecast hidden");
  private readonly banner = element("div", "banner");
  private readonly endTurnButton = element("button", "end-turn", "结束回合");
  private readonly fogButton = element("button", "fog-toggle", "迷雾：关");
  private readonly coBar = element("div", "co-bar");
  private readonly coCards: HTMLElement[] = [];
  private readonly powerButtons: HTMLButtonElement[] = [];
  private coPicker: HTMLElement | null = null;
  private resultScreen: HTMLElement | null = null;

  constructor(
    parent: HTMLElement,
    private readonly onEndTurn: () => void,
    private readonly onRestart: () => void,
    private readonly onToggleFog: () => void = () => {},
    private readonly onPower: (kind: PowerKind) => void = () => {},
    private readonly onPickCo: (id: CoId) => void = () => {},
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
    // Fog changes the shape of the whole match, so it cannot be flipped
    // mid-game — the button starts a fresh one.
    this.fogButton.addEventListener("click", () => this.onToggleFog());
    topbar.append(this.fogButton);

    const bars = element("div", "cinema-bars");
    bars.append(element("div", "cinema-bar top"), element("div", "cinema-bar bottom"));
    this.cinema.append(bars, this.cinemaCards[0], this.cinemaCards[1]);

    const hint = element("div", "panel hint");
    hint.innerHTML =
      "<kbd>左键</kbd>选择/确认　<kbd>拖动</kbd>或<kbd>WASD</kbd>平移　" +
      "<kbd>空格</kbd>回到我方　<kbd>右键</kbd>取消　<kbd>滚轮</kbd>缩放　" +
      "<kbd>P</kbd>指挥官技　<kbd>M</kbd>静音　<kbd>E</kbd>结束回合";

    // One card per side. Only the player's carries buttons; the opponent's is
    // a readout, so you can see a power coming before it lands on you.
    for (const id of [0, 1] as const) {
      const card = element("div", `panel co-card p${id}`);
      const portrait = element("img", "co-portrait") as HTMLImageElement;
      const text = element("div", "co-text");
      const nameRow = element("div", "co-name");
      const meter = element("div", "co-meter");
      text.append(nameRow, meter);
      card.append(portrait, text);

      if (id === 0) {
        const actions = element("div", "co-actions");
        for (const kind of ["power", "super"] as PowerKind[]) {
          const button = element("button", `co-power ${kind}`) as HTMLButtonElement;
          button.addEventListener("click", () => this.onPower(kind));
          this.powerButtons.push(button);
          actions.append(button);
        }
        const change = element("button", "co-change", "换将");
        change.addEventListener("click", () => this.showCoPicker());
        actions.append(change);
        text.append(actions);
      }

      this.coCards.push(card);
      this.coBar.append(card);
    }

    this.endTurnButton.addEventListener("click", () => this.onEndTurn());

    this.root.append(
      topbar,
      this.terrainPanel,
      this.unitPanel,
      this.menu,
      this.build,
      this.cinema,
      this.coBar,
      this.audioToast,
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

    this.fogButton.textContent = state.fog ? "迷雾：开" : "迷雾：关";
    this.fogButton.classList.toggle("on", state.fog);
    this.refreshCoBar(state);

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

  /**
   * Commander cards: portrait, name, and the meter as discrete stars. Stars
   * are drawn rather than shown as a percentage because the two thresholds
   * that matter are whole numbers, and counting pips is faster than reading
   * a bar.
   */
  private refreshCoBar(state: GameState): void {
    for (const id of [0, 1] as const) {
      const seat = state.players[id];
      const co = COS[seat.co];
      const card = this.coCards[id];

      const portrait = card.querySelector(".co-portrait") as HTMLImageElement;
      if (portrait.dataset.co !== seat.co) {
        portrait.src = coPortrait(seat.co);
        portrait.dataset.co = seat.co;
      }
      card.style.setProperty("--co-accent", hex(co.color));
      card.classList.toggle("acting", state.turn === id && state.winner === null);
      card.classList.toggle("powered", seat.activePower !== null);

      const stars = powerStars(state, id);
      const total = maxStars(state, id);
      const active =
        seat.activePower === null
          ? ""
          : ` · ${seat.activePower === "super" ? co.super.name : co.power.name}`;
      card.querySelector(".co-name")!.textContent = `${co.name}「${co.title}」${active}`;

      const meter = card.querySelector(".co-meter")!;
      meter.textContent = "";
      for (let i = 0; i < total; i++) {
        const pip = element("span", "co-star");
        if (i < stars) pip.classList.add("full");
        // Mark where each power sits, so the meter shows what it is worth.
        if (i + 1 === co.powerStars) pip.classList.add("mark-power");
        if (i + 1 === co.superStars) pip.classList.add("mark-super");
        meter.append(pip);
      }
    }

    const you = state.players[0];
    const co = COS[you.co];
    for (const [index, kind] of (["power", "super"] as PowerKind[]).entries()) {
      const button = this.powerButtons[index];
      const power = kind === "super" ? co.super : co.power;
      const cost = kind === "super" ? co.superStars : co.powerStars;
      button.textContent = `${power.name} ${cost}★`;
      button.title = power.description;
      button.disabled = !canActivate(state, 0, kind);
    }
  }

  /** Commander select. Picking one starts a fresh match. */
  showCoPicker(): void {
    this.hideCoPicker();

    const screen = element("div", "co-picker");
    const panel = element("div", "co-picker-panel");
    panel.append(element("h2", undefined, "选择指挥官"));
    panel.append(
      element(
        "p",
        "co-picker-note",
        "指挥官决定你的日常加成和两个战术技能。换将会重新开始一局。",
      ),
    );

    const grid = element("div", "co-grid");
    for (const id of CO_IDS) {
      const co = COS[id];
      const item = element("button", "co-option") as HTMLButtonElement;
      item.style.setProperty("--co-accent", hex(co.color));

      const portrait = element("img", "co-option-portrait") as HTMLImageElement;
      portrait.src = coPortrait(id, 128);

      const body = element("div", "co-option-body");
      body.append(element("div", "co-option-name", `${co.name}「${co.title}」`));
      body.append(element("div", "co-option-blurb", co.blurb));
      body.append(element("div", "co-option-line", `日常：${describeD2d(co.id)}`));
      body.append(
        element("div", "co-option-line", `${co.powerStars}★ ${co.power.name} — ${co.power.description}`),
      );
      body.append(
        element("div", "co-option-line", `${co.superStars}★ ${co.super.name} — ${co.super.description}`),
      );

      item.append(portrait, body);
      item.addEventListener("click", () => {
        this.hideCoPicker();
        this.onPickCo(id);
      });
      grid.append(item);
    }

    const close = element("button", "co-picker-close", "取消");
    close.addEventListener("click", () => this.hideCoPicker());

    panel.append(grid, close);
    screen.append(panel);
    this.root.append(screen);
    this.coPicker = screen;
  }

  hideCoPicker(): void {
    this.coPicker?.remove();
    this.coPicker = null;
  }

  get coPickerOpen(): boolean {
    return this.coPicker !== null;
  }

  /** A line of text that appears near the top and fades itself out. */
  showToast(text: string, holdMs = 1800): void {
    this.audioToast.textContent = text;
    this.audioToast.classList.remove("hidden");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.audioToast.classList.add("hidden"), holdMs);
  }

  /** Brief confirmation when the mute or music keys are pressed. */
  showAudioState(muted: boolean, music: boolean): void {
    this.showToast(
      muted
        ? "🔇 已静音（M 恢复）"
        : music
          ? "🔊 音效开 · 音乐开（M 静音 / N 关音乐）"
          : "🔊 音效开 · 音乐关（N 开音乐）",
    );
  }

  /* ---------------------------------------------------------------- *
   * Battle cutscene furniture
   * ---------------------------------------------------------------- */

  /**
   * Letterbox bars and a card per combatant. The cards carry the same HP
   * figure the board does, so the moment a shot lands is legible without
   * having to read the tiny badge on the model.
   */
  showBattle(attacker: Unit, defender: Unit): void {
    // The tactical readouts share the bottom corners with the combatant cards,
    // so they step aside for the duration.
    this.terrainPanel.classList.add("hidden");
    this.unitPanel.classList.add("hidden");
    this.fillCombatant(this.cinemaCards[0], attacker);
    this.fillCombatant(this.cinemaCards[1], defender);
    this.cinema.classList.remove("hidden");
    // A frame later, so the transition has a state to animate away from.
    requestAnimationFrame(() => this.cinema.classList.add("show"));
  }

  /** Update one side's HP mid-exchange. `side` 0 is the attacker. */
  updateBattleHp(side: 0 | 1, hp: number): void {
    const card = this.cinemaCards[side];
    const fill = card.querySelector(".combatant-fill") as HTMLElement | null;
    if (fill !== null) fill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
    const label = card.querySelector(".combatant-hp");
    if (label !== null) label.textContent = `${Math.max(0, displayHp(hp))}`;
  }

  hideBattle(): void {
    this.cinema.classList.remove("show");
    setTimeout(() => this.cinema.classList.add("hidden"), 260);
  }

  private fillCombatant(card: HTMLElement, unit: Unit): void {
    const colors = TEAMS[unit.owner];
    card.style.setProperty("--team", hex(colors.primary));

    const name = element("div", "combatant-name", UNITS[unit.type].name);
    const hp = element("div", "combatant-hp", `${displayHp(unit.hp)}`);

    // A continuous bar, not ten pips. Damage is quoted on the 0-100 internal
    // scale, so a six-point hit must visibly move something even though the
    // 1-10 figure beside it does not change.
    const bar = element("div", "combatant-bar");
    const fill = element("div", "combatant-fill");
    fill.style.width = `${Math.max(0, Math.min(100, unit.hp))}%`;
    bar.append(fill);

    const head = element("div", "combatant-head");
    head.append(name, hp);
    card.replaceChildren(head, bar);
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
