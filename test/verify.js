const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 900, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.join(__dirname, 'dist/carnatic-swara-player.html'));
  await p.waitForTimeout(300);

  const original = await p.inputValue('#editor');

  // Download Text round trip
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btnDownloadText')]);
  const tmp = '/tmp/dl.txt'; await dl.saveAs(tmp);
  const raw = fs.readFileSync(tmp, 'utf8');
  const stripped = raw.replace(/^﻿/, '');
  console.log('filename:', dl.suggestedFilename());
  console.log('round trip identical:', stripped === original);
  console.log('has BOM:', raw.charCodeAt(0) === 0xFEFF);

  // Re-upload the downloaded file
  await p.click('#tab-edit');
  await p.setInputFiles('#fileText', tmp);
  await p.waitForTimeout(400);
  const reloaded = await p.inputValue('#editor');
  console.log('reupload identical:', reloaded === original);
  const cells = await p.locator('.cell.swara').count();
  console.log('swara cells after reupload:', cells);

  // Project JSON save + load
  const [dj] = await Promise.all([p.waitForEvent('download'), p.click('#btnSaveJson')]);
  const jf = '/tmp/proj.json'; await dj.saveAs(jf);
  const proj = JSON.parse(fs.readFileSync(jf, 'utf8'));
  console.log('json keys:', Object.keys(proj).join(','));
  console.log('json events:', proj.events.length, 'tokens:', proj.sahityaTokens.length, 'source ok:', proj.source === original);
  await p.click('#tab-edit');
  await p.fill('#editor', 'G M D N');
  await p.waitForTimeout(250);
  await p.setInputFiles('#fileJson', jf);
  await p.waitForTimeout(400);
  console.log('project restored:', (await p.inputValue('#editor')) === original);

  // active highlight + double-speed styling during playback
  await p.click('#tab-play');
  await p.click('#btnPlay');
  await p.waitForTimeout(600);
  const act = await p.evaluate(() => {
    const s = document.querySelector('.cell.swara.active');
    const y = document.querySelector('.cell.sahitya.active');
    return { swara: s && s.textContent.trim(), syl: y && y.textContent.trim(),
             bg: s && getComputedStyle(s).backgroundColor };
  });
  console.log('active:', JSON.stringify(act));
  await p.screenshot({ path: 'shots/playing.png' });
  await p.click('#btnStop');

  // seek by clicking a swara in the third passage
  await p.locator('.cell.swara').nth(15).click();
  await p.waitForTimeout(500);
  const seeked = await p.evaluate(() => { const s = document.querySelector('.cell.swara.active'); return s && s.dataset.index; });
  console.log('seeked to index:', seeked);
  await p.click('#btnStop');

  await b.close();
  if (errs.length) { console.log('ERRORS', errs); process.exit(1); }
  console.log('no page errors');
})();
