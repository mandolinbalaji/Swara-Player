/* Headless browser smoke test of the built single-file app. */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const file = 'file://' + path.join(__dirname, '..', 'index.html');
  await page.goto(file);
  await page.waitForTimeout(400);

  const report = {};
  report.swaraCells = await page.locator('.cell.swara').count();
  report.sahityaCells = await page.locator('.cell.sahitya[data-token]').count();
  report.speedCells = await page.locator('.cell.swara.speed').count();
  report.bars = await page.locator('.cell.bar').count();
  report.messages = await page.locator('#messages li').allTextContents();

  // no horizontal page overflow at 390px, nor at 320px
  const overflow390 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.waitForTimeout(150);
  const overflow320 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  report.overflow = { at390: overflow390, at320: overflow320 };

  // transport visible and touch-sized
  const box = await page.locator('#btnPlay').boundingBox();
  report.playButton = box ? { w: Math.round(box.width), h: Math.round(box.height) } : null;

  // alignment: swara row and sahitya row have equal total width in each passage
  report.alignment = await page.evaluate(() => {
    return [...document.querySelectorAll('.passage-inner')].map(p => {
      const a = p.querySelector('.line-swara'), b = p.querySelector('.line-sahitya');
      return b ? Math.abs(a.scrollWidth - b.scrollWidth) : 0;
    });
  });

  // play and confirm the highlight advances
  await page.click('#btnPlay');
  await page.waitForTimeout(900);
  const firstActive = await page.evaluate(() => {
    const el = document.querySelector('.cell.swara.active');
    return el ? el.dataset.index : null;
  });
  await page.waitForTimeout(1400);
  const laterActive = await page.evaluate(() => {
    const el = document.querySelector('.cell.swara.active');
    return el ? el.dataset.index : null;
  });
  report.playhead = { first: firstActive, later: laterActive };
  report.readout = await page.locator('#readout .stat').allTextContents();
  await page.click('#btnStop');

  // error handling: nested brackets must block playback
  await page.click('#tab-edit');
  await page.fill('#editor', '[SWARA]\nG [M [D N]]\n');
  await page.waitForTimeout(400);
  report.nestedErrors = await page.locator('#editMessages li.err').allTextContents();

  // tab switching works
  await page.click('#tab-settings');
  report.settingsVisible = await page.locator('#panel-settings').isVisible();

  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) { console.log('\nERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('\nno page errors');
})();
