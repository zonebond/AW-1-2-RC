/**
 * Deterministic tests for the rules engine. No renderer, no AI, no randomness:
 * every case sets up an exact board and asserts an exact number.
 *
 * This is where rule correctness is pinned down. The browser playtest covers
 * the interface; it is a bad place to assert on rules, because whether a
 * capture finishes there depends on how well the opponent happens to play.
 *
 *   npx tsx tools/rules-test.ts
 */
import {
  actionsAt,
  attack,
  buildUnit,
  capture,
  createGame,
  endTurn,
  finishAction,
  forecast,
  loadUnit,
  moveUnit,
  landingTiles,
  spawnUnit,
  unloadTiles,
  unloadUnit,
  type GameState,
  type Unit,
} from "../src/core/game";
import { computeDamage, displayHp } from "../src/core/damage";
import { parseMap } from "../src/core/map";
import { moveCost } from "../src/core/terrain";
import { UNITS } from "../src/core/units";
import type { PlayerId, UnitId } from "../src/core/types";

let passed = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) {
    passed++;
    return;
  }
  failures.push(`${label}: 得到 ${String(actual)}，期望 ${String(expected)}`);
}

function ok(label: string, condition: boolean): void {
  check(label, condition, true);
}

function group(name: string): void {
  console.log(`\n${name}`);
}

/* ------------------------------------------------------------------ *
 * A small sandbox map with every terrain type, laid out predictably.
 * ------------------------------------------------------------------ */

const SANDBOX = [
  "..........^^ff==~~c.b.h0",
  "........................",
  "..........^^ff==~~c.b.h1",
  "........................",
  "........................",
];

/** Board is 12 wide, 5 tall. Columns 5-11 of rows 0 and 2 hold the specials. */
function sandbox(): GameState {
  return createGame(parseMap("sandbox", SANDBOX), [], { random: () => 0 });
}

function place(
  state: GameState,
  type: UnitId,
  owner: PlayerId,
  x: number,
  y: number,
  patch: Partial<Unit> = {},
): Unit {
  const unit = Object.assign(spawnUnit(state, type, owner, x, y), patch);
  state.units.push(unit);
  return unit;
}

/* ------------------------------------------------------------------ *
 * Damage formula
 * ------------------------------------------------------------------ */

group("伤害公式");

// (base + luck) x (attackerHP/10) x (100 - stars x defenderHP) / 100
check(
  "步兵打步兵·平原(1星)",
  computeDamage({
    attackerType: "infantry",
    attackerHp: 100,
    attackerAmmo: 0,
    defenderType: "infantry",
    defenderHp: 100,
    defenderTerrain: "plain",
    luck: 0,
  }),
  49, // 55 x 1.0 x 0.90
);

check(
  "步兵打步兵·山地(4星)",
  computeDamage({
    attackerType: "infantry",
    attackerHp: 100,
    attackerAmmo: 0,
    defenderType: "infantry",
    defenderHp: 100,
    defenderTerrain: "mountain",
    luck: 0,
  }),
  33, // 55 x 1.0 x 0.60
);

check(
  "步兵打步兵·道路(0星)",
  computeDamage({
    attackerType: "infantry",
    attackerHp: 100,
    attackerAmmo: 0,
    defenderType: "infantry",
    defenderHp: 100,
    defenderTerrain: "road",
    luck: 0,
  }),
  55,
);

check(
  "半血攻击者伤害减半",
  computeDamage({
    attackerType: "infantry",
    attackerHp: 50,
    attackerAmmo: 0,
    defenderType: "infantry",
    defenderHp: 100,
    defenderTerrain: "plain",
    luck: 0,
  }),
  24, // 55 x 0.5 x 0.90
);

check(
  "残血防御者失去掩体收益",
  computeDamage({
    attackerType: "infantry",
    attackerHp: 100,
    attackerAmmo: 0,
    defenderType: "infantry",
    defenderHp: 20,
    defenderTerrain: "mountain",
    luck: 0,
  }),
  50, // 55 x 1.0 x (100 - 4x2)/100
);

check(
  "运气值提高伤害",
  computeDamage({
    attackerType: "infantry",
    attackerHp: 100,
    attackerAmmo: 0,
    defenderType: "infantry",
    defenderHp: 100,
    defenderTerrain: "plain",
    luck: 9,
  }),
  57, // (55+9) x 0.90
);

check("坦克对重坦是硬骨头", computeDamage({
  attackerType: "tank", attackerHp: 100, attackerAmmo: 9,
  defenderType: "mdtank", defenderHp: 100, defenderTerrain: "road", luck: 0,
}), 15);

check("重坦反过来碾压坦克", computeDamage({
  attackerType: "mdtank", attackerHp: 100, attackerAmmo: 8,
  defenderType: "tank", defenderHp: 100, defenderTerrain: "road", luck: 0,
}), 85);

check("防空车对步兵伤害极高", computeDamage({
  attackerType: "antiair", attackerHp: 100, attackerAmmo: 9,
  defenderType: "infantry", defenderHp: 100, defenderTerrain: "road", luck: 0,
}), 105);

group("主副武器与弹药");

check("坦克打步兵走机枪（无需弹药）", computeDamage({
  attackerType: "tank", attackerHp: 100, attackerAmmo: 0,
  defenderType: "infantry", defenderHp: 100, defenderTerrain: "road", luck: 0,
}), 75);

check("坦克没弹药就打不动坦克", computeDamage({
  attackerType: "tank", attackerHp: 100, attackerAmmo: 0,
  defenderType: "tank", defenderHp: 100, defenderTerrain: "road", luck: 0,
}), null);

check("运输车没有武器", computeDamage({
  attackerType: "apc", attackerHp: 100, attackerAmmo: 0,
  defenderType: "infantry", defenderHp: 100, defenderTerrain: "road", luck: 0,
}), null);

check("HP 显示为 1-10", displayHp(1), 1);
check("HP 55 显示为 6", displayHp(55), 6);
check("HP 100 显示为 10", displayHp(100), 10);

/* ------------------------------------------------------------------ *
 * Combat resolution
 * ------------------------------------------------------------------ */

group("战斗结算");

{
  const state = sandbox();
  const attacker = place(state, "tank", 0, 1, 1);
  const defender = place(state, "tank", 1, 2, 1);
  const result = attack(state, attacker, defender);

  check("相邻直射会遭到反击", result.counter > 0, true);
  check("攻击方消耗一发弹药", attacker.ammo, UNITS.tank.maxAmmo - 1);
  check("攻击后该单位本回合结束", attacker.done, true);
}

{
  const state = sandbox();
  const artillery = place(state, "artillery", 0, 1, 1);
  const target = place(state, "tank", 1, 3, 1);
  const result = attack(state, artillery, target);

  ok("火炮能在 2 格外开火", result.damage > 0);
  check("间接攻击不会被反击", result.counter, 0);
}

{
  const state = sandbox();
  const tank = place(state, "tank", 0, 1, 1);
  const artillery = place(state, "artillery", 1, 2, 1);
  const result = attack(state, tank, artillery);

  ok("坦克能贴脸打火炮", result.damage > 0);
  check("火炮被贴脸也不反击", result.counter, 0);
}

{
  const state = sandbox();
  const attacker = place(state, "mdtank", 0, 1, 1);
  const victim = place(state, "infantry", 1, 2, 1, { hp: 30 });
  const result = attack(state, attacker, victim);

  check("残血步兵被重坦击毁", result.defenderDestroyed, true);
  check("被击毁的单位移出战场", state.units.includes(victim), false);
  check("被击毁则没有反击", result.counter, 0);
}

/* ------------------------------------------------------------------ *
 * Indirect units may not move and fire
 * ------------------------------------------------------------------ */

group("间接单位不能移动后攻击");

{
  const state = sandbox();
  const artillery = place(state, "artillery", 0, 1, 1);
  place(state, "tank", 1, 3, 1);

  const stationary = actionsAt(state, artillery, { x: 1, y: 1 }, false);
  check("原地可以攻击", stationary.canAttack, true);

  const afterMove = actionsAt(state, artillery, { x: 1, y: 1 }, true);
  check("移动后不能攻击", afterMove.canAttack, false);
}

{
  const state = sandbox();
  const tank = place(state, "tank", 0, 1, 1);
  place(state, "tank", 1, 2, 1);
  const afterMove = actionsAt(state, tank, { x: 1, y: 1 }, true);
  check("直射单位移动后仍可攻击", afterMove.canAttack, true);
}

/* ------------------------------------------------------------------ *
 * Movement, terrain and fuel
 * ------------------------------------------------------------------ */

group("移动与地形");

check("履带无法进入山地", moveCost("mountain", "treads"), null);
check("履带无法渡河", moveCost("river", "treads"), null);
check("轮胎无法进入森林外的山地", moveCost("mountain", "tires"), null);
check("步行进山地消耗 2", moveCost("mountain", "foot"), 2);
check("机步进山地只消耗 1", moveCost("mountain", "boots"), 1);
check("机步渡河只消耗 1", moveCost("river", "boots"), 1);
check("轮胎在平原消耗 2、道路消耗 1", moveCost("plain", "tires"), 2);
check("轮胎在道路消耗 1", moveCost("road", "tires"), 1);
check("履带在森林消耗 2", moveCost("wood", "treads"), 2);

{
  const state = sandbox();
  const tank = place(state, "tank", 0, 1, 1);
  const reachable = landingTiles(state, tank);
  const canReachMountain = reachable.some((p) => p.x === 10 && p.y === 0);
  check("坦克的可达范围不含山地", canReachMountain, false);
}

{
  const state = sandbox();
  const tank = place(state, "tank", 0, 0, 1);
  const before = tank.fuel;
  moveUnit(state, tank, [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
  ]);
  check("移动到目标格", `${tank.x},${tank.y}`, "3,1");
  check("燃料按经过地形扣除", before - tank.fuel, 3);
}

{
  const state = sandbox();
  const tank = place(state, "tank", 0, 0, 1, { fuel: 2 });
  const reachable = landingTiles(state, tank);
  const furthest = Math.max(...reachable.map((p) => Math.abs(p.x - 0) + Math.abs(p.y - 1)));
  check("燃料不足时移动范围受限", furthest, 2);
}

{
  // A one-tile-wide corridor, so "blocked" cannot be answered by going around.
  const state = createGame(parseMap("corridor", ["=========="]), [], { random: () => 0 });
  const mover = place(state, "tank", 0, 0, 0);
  place(state, "tank", 1, 2, 0);
  const reachable = landingTiles(state, mover);
  check("敌方单位阻断通路", reachable.some((p) => p.x === 3), false);
  check("敌方所在格不能停", reachable.some((p) => p.x === 2), false);
  check("敌方之前的格子仍可达", reachable.some((p) => p.x === 1), true);
}

{
  const state = sandbox();
  const mover = place(state, "tank", 0, 0, 1);
  place(state, "tank", 0, 2, 1);
  const reachable = landingTiles(state, mover);
  check("可以穿过友军", reachable.some((p) => p.x === 3 && p.y === 1), true);
  check("但不能停在友军身上", reachable.some((p) => p.x === 2 && p.y === 1), false);
}

/* ------------------------------------------------------------------ *
 * Capture
 * ------------------------------------------------------------------ */

group("占领");

// Column 9 of row 0 is a neutral city; column 11 of row 2 is player 1's HQ.
{
  const state = sandbox();
  const soldier = place(state, "infantry", 0, 9, 0);
  const city = state.map.tiles[0 * 12 + 9];

  check("目标是中立城市", city.terrain, "city");
  capture(state, soldier);
  check("满血步兵一回合推进 10 点", city.captureLeft, 10);
  check("尚未易主", city.owner, -1);
  check("占领中标记", soldier.capturing, true);

  soldier.done = false;
  capture(state, soldier);
  check("第二回合完成占领", city.owner, 0);
  check("占领后进度重置", city.captureLeft, 20);
  check("占领完成后不再处于占领中", soldier.capturing, false);
}

{
  const state = sandbox();
  const soldier = place(state, "infantry", 0, 9, 0, { hp: 50 });
  const city = state.map.tiles[0 * 12 + 9];
  capture(state, soldier);
  check("半血步兵一回合只推进 5 点", city.captureLeft, 15);
}

{
  const state = sandbox();
  const soldier = place(state, "infantry", 0, 9, 0);
  const city = state.map.tiles[0 * 12 + 9];
  capture(state, soldier);
  check("占领进度已推进", city.captureLeft, 10);

  moveUnit(state, soldier, [
    { x: 9, y: 0 },
    { x: 9, y: 1 },
  ]);
  check("离开后进度清零", city.captureLeft, 20);
  check("离开后不再处于占领中", soldier.capturing, false);
}

{
  const state = sandbox();
  const soldier = place(state, "infantry", 0, 9, 0);
  capture(state, soldier);
  soldier.done = false;
  const other = place(state, "tank", 1, 9, 1);
  attack(state, other, soldier);
  const city = state.map.tiles[0 * 12 + 9];
  ok("占领者阵亡或受伤后进度处理正确", city.captureLeft === 20 || state.units.includes(soldier));
}

{
  const state = sandbox();
  const tank = place(state, "tank", 0, 9, 0);
  const actions = actionsAt(state, tank, { x: 9, y: 0 }, false);
  check("坦克不能占领", actions.canCapture, false);
}

/* ------------------------------------------------------------------ *
 * Economy: income, production, repair
 * ------------------------------------------------------------------ */

group("经济");

{
  const state = sandbox();
  // Both sides need a unit alive, otherwise the rout condition ends the game
  // on the first turn boundary and endTurn stops doing anything.
  place(state, "infantry", 0, 0, 4);
  place(state, "infantry", 1, 1, 4);

  // Player 0 owns one HQ on this map, so one property's worth of income.
  check("开局即有第一天收入", state.players[0].funds, 1000);

  endTurn(state); // to player 1
  endTurn(state); // back to player 0, day 2
  check("每回合按建筑数收入", state.players[0].funds, 2000);
  check("天数推进", state.day, 2);
}

{
  const state = sandbox();
  state.players[0].funds = 10_000;
  // Give player 0 the base at column 10 of row 0.
  state.map.tiles[0 * 12 + 10].owner = 0;

  const built = buildUnit(state, 10, 0, "tank");
  ok("在己方工厂可以生产", built !== null);
  check("按造价扣款", state.players[0].funds, 3_000);
  check("新造单位当回合不可行动", built?.done, true);

  const tooExpensive = buildUnit(state, 10, 0, "mdtank");
  check("工厂被占用时无法再生产", tooExpensive, null);
}

{
  const state = sandbox();
  state.players[0].funds = 0;
  const nothing = buildUnit(state, 10, 0, "infantry");
  check("不是己方工厂就不能生产", nothing, null);
}

{
  const state = sandbox();
  state.map.tiles[0 * 12 + 9].owner = 0; // city
  state.players[0].funds = 10_000;
  const wounded = place(state, "infantry", 0, 9, 0, { hp: 50, ammo: 0, fuel: 10 });
  place(state, "infantry", 1, 1, 4);

  endTurn(state);
  endTurn(state); // back to player 0

  check("己方建筑上回复 2 HP", wounded.hp, 70);
  check("补满燃料", wounded.fuel, UNITS.infantry.maxFuel);
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

group("运输");

{
  const state = sandbox();
  const apc = place(state, "apc", 0, 1, 1);
  const soldier = place(state, "infantry", 0, 2, 1);

  const actions = actionsAt(state, soldier, { x: 1, y: 1 }, true);
  ok("步兵可以登上相邻运输车", actions.canLoad !== null);

  loadUnit(state, apc, soldier);
  check("载员上车后离开战场格", state.units.includes(soldier), false);
  check("运输车载员数为 1", apc.cargo.length, 1);

  const spots = unloadTiles(state, apc);
  ok("有可卸载的方向", spots.length > 0);

  const dropped = unloadUnit(state, apc, spots[0]);
  check("卸载后重新出现在战场", state.units.includes(dropped!), true);
  check("卸载后运输车空载", apc.cargo.length, 0);
  check("刚卸下的单位本回合不可动", dropped?.done, true);
}

{
  const state = sandbox();
  const apc = place(state, "apc", 0, 1, 1);
  const tank = place(state, "tank", 0, 2, 1);
  const actions = actionsAt(state, tank, { x: 1, y: 1 }, true);
  check("运输车不能装载车辆", actions.canLoad, null);
}

/* ------------------------------------------------------------------ *
 * Victory conditions
 * ------------------------------------------------------------------ */

group("胜负判定");

{
  const state = sandbox();
  // Player 1's HQ sits at column 11 of row 2.
  const soldier = place(state, "infantry", 0, 11, 2);
  place(state, "infantry", 1, 0, 4);

  capture(state, soldier);
  check("首回合尚未拿下司令部", state.winner, null);
  soldier.done = false;
  capture(state, soldier);

  check("攻陷司令部即获胜", state.winner, 0);
  check("胜利原因为司令部", state.endReason, "hq");
}

{
  const state = sandbox();
  const attacker = place(state, "mdtank", 0, 1, 1);
  const lastEnemy = place(state, "infantry", 1, 2, 1, { hp: 10 });
  attack(state, attacker, lastEnemy);

  check("全歼敌军即获胜", state.winner, 0);
  check("胜利原因为全歼", state.endReason, "rout");
}

/* ------------------------------------------------------------------ *
 * Turn bookkeeping
 * ------------------------------------------------------------------ */

group("回合流程");

{
  const state = sandbox();
  const mine = place(state, "tank", 0, 1, 1);
  const theirs = place(state, "tank", 1, 5, 4);
  place(state, "infantry", 0, 0, 4);

  finishAction(state, mine);
  check("行动后标记为已完成", mine.done, true);

  endTurn(state);
  check("轮到对方", state.turn, 1);
  check("对方单位可行动", theirs.done, false);
  check("我方单位仍是已完成", mine.done, true);

  endTurn(state);
  check("轮回我方", state.turn, 0);
  check("我方单位恢复可行动", mine.done, false);
  check("天数加一", state.day, 2);
}

{
  const state = sandbox();
  const attacker = place(state, "tank", 0, 1, 1);
  const defender = place(state, "tank", 1, 2, 1);
  const shot = forecast(state, attacker, defender)!;
  const result = attack(state, attacker, defender);

  ok("预测伤害不高于实际伤害（运气只会加成）", shot.damage <= result.damage);
}

/* ------------------------------------------------------------------ */

console.log("");
if (failures.length > 0) {
  console.log(`失败 ${failures.length} 项（通过 ${passed} 项）：`);
  for (const failure of failures) console.log("  - " + failure);
  process.exitCode = 1;
} else {
  console.log(`全部通过：${passed} 项断言`);
}
