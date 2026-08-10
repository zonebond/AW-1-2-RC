/**
 * Headless AI-versus-AI match. Exercises every rule in the engine without a
 * renderer, which makes it the fastest way to catch a broken damage table,
 * a pathfinding dead end, or a turn loop that never terminates.
 *
 *   npx tsx tools/simulate.ts [mapId] [maxDays] [seed] [fog] [coA] [coB]
 *
 * Pass "fog" as the fourth argument to run the match under fog of war, where
 * both commanders only ever see part of the board.
 */
import {
  activatePower,
  attack,
  buildUnit,
  capture,
  createGame,
  endTurn,
  finishAction,
  moveUnit,
  propertiesOf,
  unitById,
  type GameState,
} from "../src/core/game";
import { nextAiStep } from "../src/ai/ai";
import { resolveMovePath } from "../src/core/fog";
import { mapById, MAPS } from "../src/core/maps";
import { displayHp } from "../src/core/damage";
import { UNITS } from "../src/core/units";
import type { PlayerId } from "../src/core/types";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mapId = process.argv[2] ?? MAPS[0].id;
const maxDays = Number(process.argv[3] ?? 40);
const seed = Number(process.argv[4] ?? 12345);
const fog = process.argv[5] === "fog";
const coA = (process.argv[6] ?? "steady") as CoId;
const coB = (process.argv[7] ?? "steady") as CoId;

const entry = mapById(mapId);
const state = createGame(entry.build(), entry.startUnits, {
  aiOpponent: true,
  random: mulberry32(seed),
  fog,
  cos: [coA, coB],
});
// Drive both sides with the AI so a full match runs unattended.
state.players[0].isAI = true;

function summarise(state: GameState, player: PlayerId): string {
  const units = state.units.filter((u) => u.owner === player);
  const hp = units.reduce((sum, u) => sum + displayHp(u.hp), 0);
  return `${units.length}单位 ${hp}HP ${propertiesOf(state, player)}地 $${state.players[player].funds}`;
}

let steps = 0;
let ambushes = 0;
const powersUsed: [number, number] = [0, 0];
let ordersThisTurn = 0;
const stepBudget = 200_000;

while (state.winner === null && state.day <= maxDays && steps < stepBudget) {
  steps++;
  const step = nextAiStep(state);

  if (step.kind === "end") {
    if (state.turn === 1) {
      console.log(
        `第 ${String(state.day).padStart(2)} 天  红星: ${summarise(state, 0)}  |  蓝月: ${summarise(state, 1)}`,
      );
    }
    ordersThisTurn = 0;
    endTurn(state);
    continue;
  }

  if (step.kind === "power") {
    if (!activatePower(state, state.turn, step.power)) {
      throw new Error(`AI tried an illegal power: ${step.power}`);
    }
    powersUsed[state.turn]++;
    continue;
  }

  if (step.kind === "build") {
    const built = buildUnit(state, step.x, step.y, step.type);
    if (built === null) {
      throw new Error(`AI tried an illegal build: ${step.type} at ${step.x},${step.y}`);
    }
    continue;
  }

  const unit = unitById(state, step.order.unitId);
  if (unit === undefined) throw new Error(`AI ordered a unit that no longer exists`);
  if (unit.done) throw new Error(`AI ordered ${UNITS[unit.type].name} twice in one turn`);

  ordersThisTurn++;
  if (ordersThisTurn > 400) throw new Error("turn did not terminate");

  // Under fog the AI can plan through a unit it cannot see; the move stops
  // there and the turn is spent, exactly as it would be for a human.
  const walked = resolveMovePath(state, unit, step.order.path);
  moveUnit(state, unit, walked);
  if (walked.length < step.order.path.length) {
    ambushes++;
    finishAction(state, unit);
    continue;
  }

  switch (step.order.then.kind) {
    case "attack": {
      const target = unitById(state, step.order.then.targetId);
      if (target === undefined) {
        finishAction(state, unit);
        break;
      }
      attack(state, unit, target);
      break;
    }
    case "capture":
      capture(state, unit);
      break;
    case "wait":
      finishAction(state, unit);
      break;
  }
}

console.log(`指挥官技能发动次数：红星 ${powersUsed[0]} 次，蓝月 ${powersUsed[1]} 次`);
if (fog) console.log(`战争迷雾：开 —— 全场共 ${ambushes} 次遭遇伏击`);
if (state.winner !== null) {
  const name = state.winner === 0 ? "红星军" : "蓝月军";
  const reason = state.endReason === "hq" ? "攻陷司令部" : "全歼敌军";
  console.log(`结果：${name} 获胜（${reason}），第 ${state.day} 天，共 ${steps} 步`);
} else if (steps >= stepBudget) {
  console.log(`结果：超出步数上限 —— 疑似死循环`);
  process.exitCode = 1;
} else {
  console.log(`结果：${maxDays} 天未分胜负`);
}
