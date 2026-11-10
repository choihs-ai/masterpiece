// Visual smoke test: drives the built game in headless Chromium and saves screenshots.
// Usage: node scripts/shot.mjs <url> <outDir> [width height] [scenario]
const { chromium } = require('playwright');
const fs = require('node:fs');

(async () => {

const [url = 'http://localhost:4173/', out = 'shots', w = '390', h = '844', scenario = 'basic'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/01-title.png` });
await page.mouse.click(Number(w) / 2, Number(h) * 0.6);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/02-menu.png` });
const sleep = (ms) => page.waitForTimeout(ms);
if (scenario === 'basic' || scenario === 'all') {
  await page.evaluate(() => window.__pulsar.start('echo', 'normal'));
  await sleep(2500);
  await page.screenshot({ path: `${out}/03-intro.png` });
  // hold right arrow a bit
  await page.keyboard.down('ArrowLeft');
  await sleep(400);
  await page.keyboard.up('ArrowLeft');
  await sleep(6000);
  await page.screenshot({ path: `${out}/04-wave.png` });
  const info = await page.evaluate(() => {
    const w = window.__pulsar.world;
    return { phase: w.director.phase, enemies: w.enemies.length, eb: w.eb.count, pb: w.pb.count, score: w.score, time: w.time.toFixed(1) };
  });
  console.log('state', JSON.stringify(info));
}
if (scenario === 'boss' || scenario === 'all') {
  for (const [i, id] of [[0, 'herald'], [1, 'tidecaller'], [2, 'archon'], [3, 'tyrant'], [4, 'silence']]) {
    await page.evaluate(([i, id]) => {
      const p = window.__pulsar;
      if (!p.world) p.start('echo', 'normal');
      const w = p.world;
      w.invincible = true;
      w.enterSector(i);
      w.director.sector = i;
      w.dismissEnemies();
      w.eb.clear();
      if (w.boss) { w.boss.alive = false; w.boss = null; }
      w.director.phase = 'boss';
      w.spawnBoss(id);
      p.setSector(i);
    }, [i, id]);
    await sleep(9000);
    await page.screenshot({ path: `${out}/boss-${i + 1}-${id}.png` });
  }
}
if (scenario === 'screens' || scenario === 'all') {
  await page.evaluate(() => document.querySelector('[data-act=play]').click());
  await sleep(800);
  await page.screenshot({ path: `${out}/s-select.png` });
  await page.evaluate(() => window.__pulsar.start('echo', 'normal'));
  await sleep(1500);
  await page.evaluate(() => window.__pulsar.offer());
  await sleep(1200);
  await page.screenshot({ path: `${out}/s-upgrade.png` });
  await page.evaluate(() => document.querySelector('.card').click());
  await sleep(600);
  await page.evaluate(() => window.__pulsar.pause());
  await sleep(800);
  await page.screenshot({ path: `${out}/s-pause.png` });
  await page.evaluate(() => document.querySelector('#pause [data-act=settings]').click());
  await sleep(700);
  await page.screenshot({ path: `${out}/s-settings.png` });
  await page.evaluate(() => document.querySelector('#settings [data-act=back]').click());
  await sleep(500);
  await page.evaluate(() => document.querySelector('#pause [data-act=retire]').click());
  await sleep(2500);
  await page.screenshot({ path: `${out}/s-results.png` });
  await page.evaluate(() => document.querySelector('#results [data-act=menu]').click());
  await sleep(800);
  await page.evaluate(() => document.querySelector('[data-act=records]').click());
  await sleep(700);
  await page.screenshot({ path: `${out}/s-records.png` });
  await page.evaluate(() => document.querySelector('#records [data-act=back]').click());
  await sleep(500);
  await page.evaluate(() => document.querySelector('[data-act=help]').click());
  await sleep(700);
  await page.screenshot({ path: `${out}/s-help.png` });
}
if (scenario === 'audio') {
  const results = {};
  for (const [label, setup] of [
    ['title', null],
    ['s4-i1', [3, 1]], ['s4-i3', [3, 3]], ['s4-i4', [3, 4]], ['s2-i1', [1, 1]], ['s3-i1', [2, 1]],
  ]) {
    if (setup) {
      await page.evaluate(([sector, lvl]) => {
        const p = window.__pulsar;
        if (!p.world) p.start('echo', 'normal');
        p.world.invincible = true;
        p.world.events.push({ t: 'music', cue: { song: sector, intensity: lvl, dropout: false } });
      }, setup);
      await sleep(5000);
    } else await sleep(3000);
    let peak = 0, rmsSum = 0, n = 0, maxRms = 0;
    for (let k = 0; k < 40; k++) {
      const m = await page.evaluate(() => window.__pulsar.meter());
      peak = Math.max(peak, m.peak); rmsSum += m.rms; n++; maxRms = Math.max(maxRms, m.rms);
      results.state = m.state; results.clock = m.audioClock;
      await sleep(60);
    }
    results[label] = { peak: +peak.toFixed(3), rms: +(rmsSum / n).toFixed(3), maxRms: +maxRms.toFixed(3) };
  }
  console.log(JSON.stringify(results, null, 1));
}
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
})();
