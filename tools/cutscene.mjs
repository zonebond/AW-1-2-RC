/**
 * Capture exact instants of a battle cutscene. The game's clock is handed to
 * this script via ?manual=1, so each frame is a chosen moment rather than
 * whatever the software renderer managed to finish in time.
 *
 *   node tools/cutscene.mjs <outDir>
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "/tmp/aw-cutscene";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("404")) console.log("[console]", m.text());
});

await page.goto("http://127.0.0.1:5173/?manual=1", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__aw !== undefined);
await page.waitForTimeout(1200);

const advance = async (seconds, step = 1 / 60) => {
  let done = 0;
  while (done < seconds - 1e-9) {
    const dt = Math.min(step, seconds - done);
    await page.evaluate((d) => window.__aw.advance(d), dt);
    done += dt;
  }
};

const clickTile = async (x, y) => {
  await page.evaluate(([tx, ty]) => window.__aw.focusTile(tx, ty), [x, y]);
  const p = await page.evaluate(([tx, ty]) => window.__aw.project(tx, ty), [x, y]);
  await page.mouse.move(p.x, p.y);
  await advance(0.05);
  await page.mouse.click(p.x, p.y);
  await advance(0.05);
};

// Walk a tank into contact, then take the shot and film the exchange.
const state = () => page.evaluate(() => window.__aw.state());
let s = await state();
const tank = s.units.find((u) => u.owner === 0 && u.type === "tank");
const enemy = s.units
  .filter((u) => u.owner === 1)
  .sort(
    (a, b) =>
      Math.abs(a.x - tank.x) + Math.abs(a.y - tank.y) -
      (Math.abs(b.x - tank.x) + Math.abs(b.y - tank.y)),
  )[0];

let fired = false;
let cameraMoved = 0;
let cameraReturned = Infinity;
let sawLetterbox = false;
let panelsRestored = false;
for (let round = 0; round < 6 && !fired; round++) {
  s = await state();
  for (const unit of s.units.filter((u) => u.owner === 0 && !u.done && u.type !== "infantry")) {
    await clickTile(unit.x, unit.y);
    if ((await page.evaluate(() => window.__aw.mode())) !== "selected") continue;

    const step = await page.evaluate(
      ([id, gx, gy]) => {
        const tiles = window.__aw.landing(id);
        let best = null;
        let bestDistance = Infinity;
        for (const t of tiles) {
          const d = Math.abs(t.x - gx) + Math.abs(t.y - gy);
          if (d < bestDistance) {
            bestDistance = d;
            best = t;
          }
        }
        return best;
      },
      [unit.id, enemy.x, enemy.y],
    );
    if (step === null) continue;

    await clickTile(step.x, step.y);
    await advance(1.5);
    if ((await page.evaluate(() => window.__aw.mode())) !== "menu") continue;

    const attackButton = page.locator(".menu button", { hasText: "攻击" }).first();
    if (await attackButton.isVisible().catch(() => false)) {
      await attackButton.click();
      await advance(0.1);

      const targets = await state();
      const victim = targets.units.find(
        (u) => u.owner === 1 && Math.abs(u.x - step.x) + Math.abs(u.y - step.y) === 1,
      );
      if (victim === undefined) continue;

      const p = await page.evaluate(([tx, ty]) => window.__aw.project(tx, ty), [victim.x, victim.y]);
      await page.mouse.move(p.x, p.y);
      await advance(0.05);
      await page.mouse.click(p.x, p.y);

      // Film the cutscene: camera swing in, exchange, swing out. Marks are
      // absolute times from the moment the shot was ordered, so each step
      // advances only the difference — not the mark itself.
      const cameraAt = () =>
        page.evaluate(() => {
          const c = window.__aw.rawCamera();
          return { x: c.x, y: c.y, z: c.z };
        });
      const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      const beforeShot = await cameraAt();

      let clock = 0;
      for (const mark of [0.1, 0.24, 0.38, 0.55, 0.75, 1.0, 1.35, 1.9, 2.4]) {
        await advance(mark - clock, 1 / 120);
        clock = mark;
        await page.screenshot({
          path: join(out, `cut-${String(Math.round(mark * 100)).padStart(3, "0")}.png`),
        });
        console.log(`captured t=${mark.toFixed(2)}s`);
        fired = true;

        const now = await cameraAt();
        cameraMoved = Math.max(cameraMoved, distance(now, beforeShot));
        if (mark < 1.9) {
          sawLetterbox ||= await page.locator(".cinema.show").isVisible().catch(() => false);
        }
        if (mark === 2.4) {
          cameraReturned = distance(now, beforeShot);
          panelsRestored = !(await page.locator(".cinema").isVisible().catch(() => true));
        }
      }
      break;
    }
    const wait = page.locator(".menu button", { hasText: "待命" }).first();
    if (await wait.isVisible().catch(() => false)) {
      await wait.click();
      await advance(0.2);
    }
  }
  if (!fired) {
    await page.keyboard.press("e");
    // The AI turn runs on the same manual clock.
    for (let i = 0; i < 900 && (await state()).turn !== 0; i++) await advance(0.05);
    await advance(0.5);
  }
}

/* ------------------------------------------------------------------ *
 * Assertions: the capture above is also the test for this feature.
 * ------------------------------------------------------------------ */

const failures = [];
const check = (label, condition, detail = "") => {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures.push(`${label} ${detail}`);
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

console.log("");
check("触发了一次战斗过场", fired);

if (fired) {
  check("过场中镜头确实离开了战术机位", cameraMoved > 1.5, `位移=${cameraMoved.toFixed(2)}`);
  check("过场中出现黑边与双方卡片", sawLetterbox);
  check("过场结束后镜头回到原位", cameraReturned < 0.05, `残留=${cameraReturned.toFixed(3)}`);
  check("过场结束后常规面板恢复", panelsRestored);
}

await browser.close();

if (failures.length > 0) {
  console.log(`\n失败 ${failures.length} 项：`);
  for (const f of failures) console.log("  - " + f);
  process.exitCode = 1;
} else {
  console.log("\n全部通过");
}
