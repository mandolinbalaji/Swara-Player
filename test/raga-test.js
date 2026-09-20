const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.join(__dirname, 'dist/carnatic-swara-player.html'));
  await p.waitForTimeout(300);
  await p.click('#tab-settings');
  await p.locator('#panel-settings details.adv summary').click();
  await p.waitForTimeout(200);

  // Build Mohanam-like set by ticking variants, save as a raga
  await p.selectOption('#raga', 'Chromatic (all swaras)');
  await p.waitForTimeout(200);
  const rows = p.locator('#ragaTable tr');
  // untick everything, then tick S R2 G3 P D2
  const want = ['S','R2','G3','P','D2'];
  const names = await p.locator('#ragaTable tr td:nth-child(2)').allTextContents();
  for (let i = 0; i < names.length; i++) {
    const cb = rows.nth(i).locator('input[type=checkbox]');
    const on = await cb.isChecked();
    const shouldBe = want.includes(names[i].trim());
    if (on !== shouldBe) { await cb.click(); await p.waitForTimeout(60); }
  }
  await p.fill('#newRagaName', 'Mohanam (mine)');
  await p.click('#btnSaveRaga');
  await p.waitForTimeout(300);
  console.log('note:', await p.textContent('#ragaSaveNote'));
  console.log('selected raga:', await p.inputValue('#raga'));
  console.log('scale line:', await p.textContent('#ragaScale'));

  await p.click('#tab-edit');
  await p.fill('#editor', '[SWARA]\nS R G P D S\n');
  await p.waitForTimeout(400);
  console.log('errors with new raga:', await p.locator('#editMessages li.err').allTextContents());
  console.log('summary:', await p.locator('#editMessages li').first().textContent());

  // a swara outside it must be refused
  await p.fill('#editor', '[SWARA]\nS R G M P\n');
  await p.waitForTimeout(400);
  console.log('M refused:', await p.locator('#editMessages li.err').allTextContents());

  // reload the page: the custom raga should survive in local storage
  await p.reload();
  await p.waitForTimeout(400);
  await p.click('#tab-settings');
  const opts = await p.locator('#raga option').allTextContents();
  console.log('options after reload:', opts.join(' | '));
  await b.close();
  if (errs.length) { console.log('ERRORS', errs); process.exit(1); }
  console.log('no page errors');
})();
