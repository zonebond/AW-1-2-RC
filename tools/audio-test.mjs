/**
 * Sound cannot be heard from a headless browser, but it can be measured.
 * Every effect is rendered through an OfflineAudioContext and checked for the
 * three ways a procedural sound usually goes wrong: silence, clipping, and a
 * tail that runs far longer or shorter than the caller was told.
 *
 *   node tools/audio-test.mjs
 */
import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });

const failures = [];
page.on("pageerror", (e) => {
  failures.push(`pageerror: ${e.message}`);
  console.log("[pageerror]", e.message);
});

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__audio !== undefined);

const check = (label, condition, detail = "") => {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures.push(`${label} ${detail}`);
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

const ids = await page.evaluate(() => window.__audio.ids);
console.log(`\n[音效] 共 ${ids.length} 个`);

for (const id of ids) {
  const r = await page.evaluate((sound) => window.__audio.render(sound), id);
  const peak = r.peak.toFixed(3);

  if (r.peak <= 0.01) {
    check(`${id} 有声音`, false, `峰值=${peak}（几乎无声）`);
    continue;
  }
  if (r.peak > 1) {
    check(`${id} 不削波`, false, `峰值=${peak}`);
    continue;
  }
  // A sound whose energy stops long before its declared length would leave
  // the caller waiting on silence; one that runs well past it would overlap
  // whatever comes next.
  const ratio = r.tail / r.declared;
  const sane = ratio > 0.35 && ratio < 1.6;
  check(
    `${id}  峰值 ${peak}  时长 ${r.tail.toFixed(2)}s / 声明 ${r.declared.toFixed(2)}s`,
    sane,
    sane ? "" : `比值=${ratio.toFixed(2)}`,
  );
}

console.log("\n[音乐]");
const music = await page.evaluate(() => window.__audio.renderMusic(6));
check("音乐循环有声音", music.peak > 0.02, `峰值=${music.peak.toFixed(3)}`);
check("音乐循环不削波", music.peak <= 1, `峰值=${music.peak.toFixed(3)}`);
check(
  "音乐音量低于音效（不能盖过操作反馈）",
  music.rms < 0.12,
  `rms=${music.rms.toFixed(4)}`,
);

console.log("");
await browser.close();

if (failures.length > 0) {
  console.log(`失败 ${failures.length} 项：`);
  for (const f of failures) console.log("  - " + f);
  process.exitCode = 1;
} else {
  console.log("全部通过");
}
