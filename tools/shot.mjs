import { chromium } from "playwright";

const targets = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });

page.on("console", (m) => console.log(`[console:${m.type()}]`, m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

for (const target of targets) {
  const [url, out] = target.split("=>");
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out });
  console.log("saved", out);
}

await browser.close();
