// smoke.mjs — headless browser smoke test / screenshot grabber.
// Usage: node tools/smoke.mjs <url> <outPng> [phase]
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;

const url = process.argv[2] || 'http://localhost:8000/';
const out = process.argv[3] || '/tmp/shot.png';
const phase = process.argv[4] || 'debug';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1000, height: 620 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction('window.game && window.game.state', { timeout: 5000 });

// Inject a scripted skirmish so the screenshot shows live entities.
// Grant mana so the whole board fills for the screenshot (bypasses the economy).
await page.evaluate(() => {
  const g = window.game;
  for (const p of g.state.players) p.mana = 50;
  g.cmd('p1', 'PLACE_UNITS', 'mdtank', 9, 8);
  g.cmd('p1', 'PLACE_UNITS', 'tank', 8, 4);
  g.cmd('p1', 'PLACE_UNITS', 'infantry', 5, 6);
  g.cmd('p2', 'PLACE_UNITS', 'mdtank', 13, 8);
  g.cmd('p2', 'PLACE_UNITS', 'recon', 14, 4);
  g.cmd('p2', 'PLACE_UNITS', 'infantry', 17, 6);
});
await page.waitForTimeout(2500);
await page.evaluate(() => window.game.cmd('p1', 'CAST_SPELL', 'explosion', 13, 8));
await page.waitForTimeout(200);

const tick = await page.evaluate(() => window.game.state.tick);
const units = await page.evaluate(() => window.game.state.units.length);
await page.screenshot({ path: out });
console.log(`phase=${phase} tick=${tick} units=${units} errors=${errors.length}`);
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
await browser.close();
process.exit(errors.length ? 1 : 0);
