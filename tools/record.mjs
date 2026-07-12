// record.mjs — headless playthrough capture: two forces clash in a lane so the
// screenshot shows firing animations, depleted health bars, and hit flashes.
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const out = process.argv[2] || '/tmp/record.png';
import { globSync } from 'node:fs';
const chromePath = process.env.CHROMIUM_PATH
  || globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome').sort().pop()
  || undefined; // fall back to Playwright's own resolution
const browser = await chromium.launch(chromePath ? { executablePath: chromePath } : {});
const page = await browser.newPage({ viewport: { width: 1000, height: 620 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:8000/', { waitUntil: 'networkidle' });
await page.waitForFunction('window.game && window.game.state');

await page.evaluate(() => {
  const g = window.game;
  for (const p of g.state.players) p.mana = 50;
  // Same bottom lane, marching into each other.
  g.cmd('p1', 'PLACE_UNITS', 'tank', 8, 2.5);
  g.cmd('p1', 'PLACE_UNITS', 'mdtank', 6, 2.5);
  g.cmd('p2', 'PLACE_UNITS', 'tank', 15, 2.5);
  g.cmd('p2', 'PLACE_UNITS', 'mdtank', 17, 2.5);
  // Top lane infantry skirmish.
  g.cmd('p1', 'PLACE_UNITS', 'infantry', 8, 9.5);
  g.cmd('p2', 'PLACE_UNITS', 'recon', 15, 9.5);
});
await page.waitForTimeout(5200);   // let them meet and fight
const info = await page.evaluate(() => {
  const s = window.game.state;
  const hurt = s.units.filter(u => u.health < u.maxHealth).length;
  const firing = s.units.filter(u => u.attacking).length;
  return { tick: s.tick, units: s.units.length, hurt, firing };
});
await page.screenshot({ path: out });
console.log(JSON.stringify({ ...info, errors }));
await browser.close();
