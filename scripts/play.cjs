// Long in-browser playthrough with an invincible bot pilot; saves periodic screenshots.
// Usage: node scripts/play.cjs <url> <outDir> <seconds> [width height]
const { chromium } = require('playwright');
const fs = require('node:fs');
(async () => {
  const [url, out, secs = '120', w = '390', h = '844'] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  const errors = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  await page.goto(url);
  await page.waitForTimeout(1000);
  await page.mouse.click(+w / 2, +h * 0.6);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const P = window.__pulsar;
    P.start('echo', 'normal');
    P.world.invincible = true;
    // potential-field pilot, same idea as the headless test harness
    setInterval(() => {
      const w = P.world;
      if (!w) return;
      if (w.director.phase === 'upgrade' && w.paused) {
        const c = document.querySelector('.card');
        if (c) c.click();
        return;
      }
      const p = w.player;
      let fx = 0, fy = 0;
      for (let i = 0; i < w.eb.count; i++) {
        const dx = p.x - w.eb.x[i], dy = p.y - w.eb.y[i];
        const d2 = dx * dx + dy * dy;
        if (d2 < 100) { fx += dx / (d2 + 0.5); fy += dy / (d2 + 0.5); }
      }
      let tx = 0, best = 1e9;
      for (const e of w.enemies) { if (!e.alive) continue; const d = Math.abs(e.x - p.x); if (d < best) { best = d; tx = e.x; } }
      fx += (tx - p.x) * 0.02; fy += (-32 - p.y) * 0.03;
      const l = Math.hypot(fx, fy);
      w.input.mx = l > 0.02 ? fx / l : 0;
      w.input.my = l > 0.02 ? fy / l : 0;
      if (p.charges >= 2) { w.input.pulse = true; w.input.pulsePerfect = Math.random() < 0.5; }
    }, 33);
  });
  const total = +secs;
  let shot = 0;
  for (let t = 0; t < total; t += 10) {
    await page.waitForTimeout(10000);
    const st = await page.evaluate(() => {
      const w = window.__pulsar.world;
      return w ? { phase: w.director.phase, sector: w.director.sector, wave: w.director.wave, eb: w.eb.count, en: w.enemies.length, score: w.score, boss: w.boss ? Math.round((w.boss.hp / w.boss.maxHp) * 100) : null, fps: null } : null;
    });
    console.log(`t=${t + 10}s`, JSON.stringify(st));
    if (st && (st.eb > 25 || st.boss !== null || t % 30 === 20)) {
      await page.screenshot({ path: `${out}/play-${String(shot++).padStart(2, '0')}-s${st.sector + 1}-${st.phase}.png` });
    }
  }
  console.log('errors:', errors.length ? errors.slice(0, 10).join('\n') : 'none');
  await browser.close();
})();
