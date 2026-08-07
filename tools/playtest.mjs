/**
 * Drives a real game in a real browser: selects units, moves them, cancels a
 * move, captures a property over the two turns it takes, hands the turn to the
 * AI, and builds from a factory — screenshotting each stage and asserting on
 * the game state in between.
 *
 * Runs with animations sped up, because this container renders through
 * SwiftShader at about one frame per second and every animation is driven by
 * requestAnimationFrame. That would otherwise make the test measure the
 * software rasteriser rather than the game.
 *
 *   node tools/playtest.mjs [outputDir]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "/tmp/aw-playtest";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-gpu-sandbox",
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const failures = [];
page.on("pageerror", (error) => {
  failures.push(`pageerror: ${error.message}`);
  console.log("  [pageerror]", error.message);
});
page.on("console", (message) => {
  // The dev server serves no favicon; that 404 is not a game failure.
  if (message.type() === "error" && !message.text().includes("404")) {
    failures.push(`console: ${message.text()}`);
    console.log("  [console.error]", message.text());
  }
});

await page.goto("http://127.0.0.1:5173/?speed=24", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__aw !== undefined);
await page.waitForTimeout(800);

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

const shot = async (name) => {
  await page.screenshot({ path: join(out, `${name}.png`) });
};

const state = () =>
  page.evaluate(() => {
    const s = window.__aw.state();
    return {
      day: s.day,
      turn: s.turn,
      winner: s.winner,
      funds: [s.players[0].funds, s.players[1].funds],
      owned: [
        s.map.tiles.filter((t) => t.owner === 0).length,
        s.map.tiles.filter((t) => t.owner === 1).length,
      ],
      units: s.units.map((u) => ({
        id: u.id,
        type: u.type,
        owner: u.owner,
        x: u.x,
        y: u.y,
        hp: u.hp,
        done: u.done,
      })),
      mode: window.__aw.mode(),
    };
  });

const tileInfo = (x, y) =>
  page.evaluate(
    ([tx, ty]) => {
      const s = window.__aw.state();
      const t = s.map.tiles[ty * s.map.width + tx];
      return { terrain: t.terrain, owner: t.owner, captureLeft: t.captureLeft };
    },
    [x, y],
  );

/** Animations run through a "busy" mode; every interaction waits it out. */
const settle = async () => {
  await page.waitForFunction(() => window.__aw.mode() !== "busy", null, { timeout: 60000 });
  await page.waitForTimeout(40);
};

const clickTile = async (x, y) => {
  const point = await page.evaluate(([tx, ty]) => window.__aw.project(tx, ty), [x, y]);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(40);
  await page.mouse.click(point.x, point.y);
  await settle();
};

const menuButton = (label) => page.locator(".menu button", { hasText: label }).first();

const clickMenu = async (label) => {
  const button = menuButton(label);
  await button.waitFor({ state: "visible", timeout: 6000 });
  await button.click();
  await settle();
};

const endTurnAndWaitForAi = async () => {
  const { day } = await state();
  await page.keyboard.press("e");
  await page.waitForFunction(
    (previous) => {
      const s = window.__aw.state();
      return s.winner !== null || (s.turn === 0 && s.day > previous);
    },
    day,
    { timeout: 180000 },
  );
  await settle();
};

const check = (label, condition, detail = "") => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label} ${detail}`);
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

/* ------------------------------------------------------------------ *
 * 1. Opening position
 * ------------------------------------------------------------------ */

console.log("\n[1] 初始状态");
let s = await state();
check(
  "双方各有起始单位",
  s.units.some((u) => u.owner === 0) && s.units.some((u) => u.owner === 1),
);
check("第 1 天，红星回合", s.day === 1 && s.turn === 0, `day=${s.day} turn=${s.turn}`);
check("红星有开局资金", s.funds[0] > 0, `funds=${s.funds[0]}`);
await shot("01-initial");

/* ------------------------------------------------------------------ *
 * 2-3. Select, move, wait
 * ------------------------------------------------------------------ */

console.log("\n[2] 选中坦克并查看移动范围");
const tank = s.units.find((u) => u.owner === 0 && u.type === "tank");
await clickTile(tank.x, tank.y);
check("进入选中状态", (await state()).mode === "selected");
await shot("02-selected-tank");

console.log("\n[3] 移动并待命");
await clickTile(tank.x, tank.y - 3);
check("移动后弹出行动菜单", (await state()).mode === "menu");
await shot("03-action-menu");
await clickMenu("待命");
s = await state();
const movedTank = s.units.find((u) => u.id === tank.id);
check("坦克移动到目标格", movedTank.y === tank.y - 3, `y=${movedTank.y}`);
check("坦克本回合已行动", movedTank.done === true);
await shot("04-after-move");

/* ------------------------------------------------------------------ *
 * 4. Cancel restores the unit
 * ------------------------------------------------------------------ */

console.log("\n[4] 取消移动");
const recon = s.units.find((u) => u.owner === 0 && u.type === "recon");
await clickTile(recon.x, recon.y);

// A tile with a unit on it is a re-selection, not a destination, so try a few
// offsets until one actually opens the action menu.
let opened = false;
for (const [dx, dy] of [
  [-2, 0],
  [2, 0],
  [0, -2],
  [-1, -1],
  [1, -1],
  [-3, 0],
]) {
  await clickTile(recon.x + dx, recon.y + dy);
  if ((await state()).mode === "menu") {
    opened = true;
    break;
  }
  await clickTile(recon.x, recon.y);
}
check("侦察车进入行动菜单", opened);
await clickMenu("取消");
s = await state();
const restored = s.units.find((u) => u.id === recon.id);
check("取消后位置未变", restored.x === recon.x && restored.y === recon.y);
check("取消后仍可再行动", restored.done === false);
await shot("05-cancelled");

/* ------------------------------------------------------------------ *
 * 5. Capture a property, which takes two turns at full HP
 * ------------------------------------------------------------------ */

console.log("\n[5] 占领建筑（满血步兵需要两个回合）");

const nearestTarget = (ux, uy) =>
  page.evaluate(
    ([x0, y0]) => {
      const s = window.__aw.state();
      let best = null;
      let bestDistance = Infinity;
      for (let y = 0; y < s.map.height; y++) {
        for (let x = 0; x < s.map.width; x++) {
          const tile = s.map.tiles[y * s.map.width + x];
          const capturable =
            tile.terrain === "city" || tile.terrain === "base" || tile.terrain === "hq";
          if (!capturable || tile.owner === 0) continue;
          const distance = Math.abs(x - x0) + Math.abs(y - y0);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = { x, y };
          }
        }
      }
      return best;
    },
    [ux, uy],
  );

let captureSite = null;
let carrierId = null;
let progressSeen = false;
let capturedTile = false;

// The nearest unowned property sits in the contested middle of the map, so the
// soldier doing the capturing can be killed part-way through. That is normal
// play, not a failure: pick a fresh soldier and start again.
for (let round = 0; round < 14 && !capturedTile; round++) {
  s = await state();
  if (s.winner !== null) break;

  const available = s.units.filter((u) => u.owner === 0 && u.type === "infantry" && !u.done);
  let soldier = available.find((u) => u.id === carrierId) ?? available[0];
  if (soldier === undefined) {
    await endTurnAndWaitForAi();
    continue;
  }
  carrierId = soldier.id;

  const goal = captureSite ?? (await nearestTarget(soldier.x, soldier.y));
  if (goal === null) break;

  await clickTile(soldier.x, soldier.y);
  if ((await state()).mode !== "selected") {
    await endTurnAndWaitForAi();
    continue;
  }

  const step = await page.evaluate(
    ([id, gx, gy]) => {
      const tiles = window.__aw.landing(id);
      let best = null;
      let bestDistance = Infinity;
      for (const t of tiles) {
        const distance = Math.abs(t.x - gx) + Math.abs(t.y - gy);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = t;
        }
      }
      return best;
    },
    [soldier.id, goal.x, goal.y],
  );

  if (step !== null) {
    await clickTile(step.x, step.y);
    if ((await state()).mode === "menu") {
      if (await menuButton("占领").isVisible().catch(() => false)) {
        if (!progressSeen) await shot("06-capture-menu");
        await clickMenu("占领");
        captureSite = { x: step.x, y: step.y };

        const tile = await tileInfo(step.x, step.y);
        if (tile.owner === 0) {
          capturedTile = true;
        } else {
          check(
            "占领进度按步兵 HP 推进（满血扣 10/20）",
            tile.captureLeft === 10,
            `captureLeft=${tile.captureLeft}`,
          );
          progressSeen = true;
        }
      } else {
        await clickMenu("待命");
      }
    }
  }

  if (!capturedTile) {
    // A soldier killed mid-capture loses its progress; that is the rule, so
    // reset the target only when the property has gone back to full.
    if (captureSite !== null) {
      const tile = await tileInfo(captureSite.x, captureSite.y);
      if (tile.owner === 0) capturedTile = true;
    }
    if (!capturedTile) await endTurnAndWaitForAi();
  }
}

check("目标建筑被占领易主", capturedTile, captureSite ? JSON.stringify(captureSite) : "未到达");
if (captureSite !== null) {
  const tile = await tileInfo(captureSite.x, captureSite.y);
  check("目标建筑归属为玩家", tile.owner === 0, `owner=${tile.owner}`);
  check("占领后进度重置为 20", tile.captureLeft === 20, `captureLeft=${tile.captureLeft}`);
}
await shot("07-captured");

/* ------------------------------------------------------------------ *
 * 6. Hand the turn to the AI
 * ------------------------------------------------------------------ */

console.log("\n[6] AI 回合");
s = await state();
const dayBefore = s.day;
const enemyBefore = s.units.filter((u) => u.owner === 1).map((u) => `${u.id}@${u.x},${u.y}`).join();
const started = Date.now();

await page.keyboard.press("e");
await page.waitForTimeout(900);
await shot("08-ai-turn");
await page.waitForFunction(
  (previous) => {
    const s = window.__aw.state();
    return s.winner !== null || (s.turn === 0 && s.day > previous);
  },
  dayBefore,
  { timeout: 180000 },
);
await settle();

const aiSeconds = (Date.now() - started) / 1000;
console.log(`  AI 回合耗时 ${aiSeconds.toFixed(1)}s（含 ~1fps 的软件渲染）`);
s = await state();
check("回合交还给玩家", s.turn === 0 || s.winner !== null);
check("天数推进", s.day > dayBefore, `${dayBefore} -> ${s.day}`);
check("玩家单位重置为可行动", s.units.filter((u) => u.owner === 0).every((u) => !u.done));
const enemyAfter = s.units.filter((u) => u.owner === 1).map((u) => `${u.id}@${u.x},${u.y}`).join();
check("AI 确实行动过", enemyAfter !== enemyBefore);
await shot("09-next-day");

/* ------------------------------------------------------------------ *
 * 7. Production
 * ------------------------------------------------------------------ */

console.log("\n[7] 工厂生产");
const site = await page.evaluate(() => {
  const s = window.__aw.state();
  for (let y = 0; y < s.map.height; y++) {
    for (let x = 0; x < s.map.width; x++) {
      const tile = s.map.tiles[y * s.map.width + x];
      if (tile.terrain !== "base" || tile.owner !== 0) continue;
      if (!s.units.some((u) => u.x === x && u.y === y)) return { x, y };
    }
  }
  return null;
});

if (site === null) {
  check("找到空闲己方工厂", false);
} else {
  await clickTile(site.x, site.y);
  s = await state();
  check("点击工厂弹出生产菜单", s.mode === "building", `mode=${s.mode}`);
  await shot("10-build-menu");

  const fundsBefore = s.funds[0];
  await clickMenu("步兵");
  s = await state();
  check("生产扣款 1000", s.funds[0] === fundsBefore - 1000, `${fundsBefore} -> ${s.funds[0]}`);
  check(
    "工厂上出现新单位且本回合不可动",
    s.units.some((u) => u.x === site.x && u.y === site.y && u.owner === 0 && u.done),
  );
  await shot("11-built");
}

/* ------------------------------------------------------------------ *
 * 8. Combat and the damage forecast
 * ------------------------------------------------------------------ */

console.log("\n[8] 战斗与伤害预测");
let fought = false;

for (let round = 0; round < 10 && !fought; round++) {
  s = await state();
  if (s.winner !== null) break;

  for (const unit of s.units.filter(
    (u) => u.owner === 0 && !u.done && (u.type === "tank" || u.type === "recon"),
  )) {
    const enemy = s.units
      .filter((u) => u.owner === 1)
      .sort(
        (a, b) =>
          Math.abs(a.x - unit.x) + Math.abs(a.y - unit.y) -
          (Math.abs(b.x - unit.x) + Math.abs(b.y - unit.y)),
      )[0];
    if (enemy === undefined) break;

    await clickTile(unit.x, unit.y);
    if ((await state()).mode !== "selected") continue;

    const step = await page.evaluate(
      ([id, gx, gy]) => {
        const tiles = window.__aw.landing(id);
        let best = null;
        let bestDistance = Infinity;
        for (const t of tiles) {
          const distance = Math.abs(t.x - gx) + Math.abs(t.y - gy);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = t;
          }
        }
        return best;
      },
      [unit.id, enemy.x, enemy.y],
    );
    if (step === null) continue;

    await clickTile(step.x, step.y);
    if ((await state()).mode !== "menu") continue;

    if (await menuButton("攻击").isVisible().catch(() => false)) {
      await clickMenu("攻击");
      check("进入选择目标状态", (await state()).mode === "targeting");

      // Hovering a target must raise the forecast panel before committing.
      const point = await page.evaluate(([tx, ty]) => window.__aw.project(tx, ty), [
        enemy.x,
        enemy.y,
      ]);
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(150);
      const forecastVisible = await page.locator(".forecast").isVisible();
      check("悬停敌方单位显示伤害预测", forecastVisible);
      await shot("12-forecast");

      const hpBefore = enemy.hp;
      await page.mouse.click(point.x, point.y);
      await settle();

      s = await state();
      const after = s.units.find((u) => u.id === enemy.id);
      check("攻击造成伤害或击毁", after === undefined || after.hp < hpBefore, `${hpBefore} -> ${after?.hp}`);
      await shot("13-after-attack");
      fought = true;
      break;
    }
    await clickMenu("待命");
  }

  if (!fought) await endTurnAndWaitForAi();
}

check("完成一次战斗", fought);

/* ------------------------------------------------------------------ */

console.log("");
await browser.close();

if (failures.length > 0) {
  console.log(`失败 ${failures.length} 项：`);
  for (const failure of failures) console.log("  - " + failure);
  process.exitCode = 1;
} else {
  console.log("全部通过");
}
