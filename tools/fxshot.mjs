/**
 * Capture exact instants of a combat effect. The effects lab drives its own
 * clock, so each frame here is a deterministic moment of the animation rather
 * than whatever the renderer happened to finish in time.
 *
 *   node tools/fxshot.mjs <outDir> <direct|indirect|kill> [t1,t2,...]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "/tmp/aw-fx";
const kind = process.argv[3] ?? "direct";
const marks = (process.argv[4] ?? "0.10,0.22,0.34,0.46,0.62,0.85")
  .split(",")
  .map(Number);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("404")) console.log("[console]", m.text());
});

await page.goto("http://127.0.0.1:5173/?view=fx", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__fx !== undefined);
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, `${kind}-00-before.png`) });

await page.evaluate((k) => window.__fx.fire(k), kind);

const step = 0.01;
let clock = 0;
for (const mark of marks) {
  while (clock < mark - 1e-9) {
    const dt = Math.min(step, mark - clock);
    await page.evaluate((d) => window.__fx.advance(d), dt);
    clock += dt;
  }
  const label = String(Math.round(mark * 100)).padStart(2, "0");
  await page.screenshot({ path: join(out, `${kind}-${label}.png`) });
  console.log(`captured t=${mark.toFixed(2)}s`);
}

await browser.close();
