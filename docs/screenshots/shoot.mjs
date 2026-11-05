// Take the README screenshots from a local Lækkert filled by demo.py.
// Usage: node docs/screenshots/shoot.mjs <out dir>   (app on localhost:8080)
// Needs Playwright with Chromium; require() so a global install works too.
// Screens with photos are saved as WebP, which keeps them a few hundred KB.
import { createRequire } from 'module';
import { writeFileSync } from 'fs';

const { chromium } = createRequire(import.meta.url)('playwright');

const out = process.argv[2] ?? 'docs/screenshots';
const B = 'http://localhost:8080';
const b = await chromium.launch();
const desk = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const phone = await b.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const encoder = await b.newPage();

async function open(ctx, url) {
  const p = await ctx.newPage();
  await p.goto(B + url);
  await p.waitForLoadState('networkidle');
  // Wait for every photo, then let transitions settle.
  await p.waitForFunction(() => [...document.images].every(i => i.complete));
  await p.waitForTimeout(600);
  return p;
}

// Save a PNG screenshot as WebP, encoded by Chromium.
async function saveWebp(png, path) {
  const url = await encoder.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', 0.85);
  }, `data:image/png;base64,${png.toString('base64')}`);
  writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));
}

let p = await open(desk, '/food?have=spaghetti&have=garlic&have=olive%20oil&have=chilli%20flakes&have=parsley');
await saveWebp(await p.screenshot(), `${out}/food.webp`);
await p.close();

p = await open(desk, '/food/red-lentil-dal');
await p.setViewportSize({ width: 1280, height: 2200 });
await p.waitForTimeout(300);
const h = await p.getByRole('heading', { name: 'History' }).boundingBox();
await p.screenshot({ path: `${out}/history.png`, clip: { x: 56, y: h.y - 8, width: 790, height: 685 } });
await p.close();

p = await open(desk, '/drinks?sort=rating&show=all');
await saveWebp(await p.screenshot(), `${out}/drinks.webp`);
await p.close();

p = await open(desk, '/bar');
await p.screenshot({ path: `${out}/bar.png` });
await p.close();

// Three phones side by side: the food list, a recipe, a drink and its bar.
const phones = [];
for (const url of ['/food?sort=rating', '/food/shakshuka', '/drinks/whiskey-sour']) {
  p = await open(phone, url);
  phones.push((await p.screenshot()).toString('base64'));
  await p.close();
}
const comp = await b.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
await comp.setContent(`<body style="margin:0;background:#efe6d8;display:flex;gap:44px;justify-content:center;align-items:center;height:760px">
${phones.map(s => `<img src="data:image/png;base64,${s}" style="width:330px;border-radius:36px;border:8px solid #2a211b;box-shadow:0 18px 40px rgba(42,33,27,.25)">`).join('')}
</body>`);
await comp.waitForTimeout(300);
await saveWebp(await comp.screenshot(), `${out}/phone.webp`);
await b.close();
