const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await p.waitForTimeout(400);

  // gutter shows a number per line
  await p.click('#tab-edit');
  const src = await p.inputValue('#editor');
  const gutter = await p.locator('#editorGutter b').allTextContents();
  console.log('lines in source:', src.split('\n').length, 'gutter numbers:', gutter.length, 'last:', gutter[gutter.length-1]);

  // introduce a stray word and a wrong note
  await p.fill('#editor', '[SWARA]\nG M govardhana D\nG M P N\n');
  await p.waitForTimeout(400);
  const marks = await p.evaluate(() => [...document.querySelectorAll('#editorHighlight mark')]
    .map(m => ({ text: m.textContent, kind: m.className })));
  console.log('marked ranges:', JSON.stringify(marks));
  const flagged = await p.evaluate(() => [...document.querySelectorAll('#editorGutter b')]
    .map((b,i) => b.className ? (i+1)+':'+b.className : null).filter(Boolean));
  console.log('flagged gutter lines:', flagged.join(', '));
  console.log('messages:', await p.locator('#editMessages li.err').allTextContents());

  // highlight overlay must line up with the textarea metrics
  const metrics = await p.evaluate(() => {
    const ta = getComputedStyle(document.getElementById('editor'));
    const hl = getComputedStyle(document.getElementById('editorHighlight'));
    const keys = ['fontFamily','fontSize','lineHeight','paddingLeft','paddingTop','letterSpacing','tabSize','whiteSpace'];
    return keys.map(k => `${k}:${ta[k]}|${hl[k]}|${ta[k]===hl[k]?'ok':'MISMATCH'}`);
  });
  console.log('metrics:', metrics.join('\n          '));

  // clicking a message jumps to the offending characters
  await p.click('#tab-play');
  await p.locator('#messages li.clickable').first().click();
  await p.waitForTimeout(250);
  const sel = await p.evaluate(() => {
    const ta = document.getElementById('editor');
    return { visible: !document.getElementById('panel-edit').hidden,
             selected: ta.value.slice(ta.selectionStart, ta.selectionEnd) };
  });
  console.log('jump:', JSON.stringify(sel));

  // scroll sync
  await p.evaluate(() => { const ta = document.getElementById('editor'); ta.scrollTop = 40; ta.dispatchEvent(new Event('scroll')); });
  const synced = await p.evaluate(() => ({
    hl: document.getElementById('editorHighlight').scrollTop,
    g: document.getElementById('editorGutter').scrollTop }));
  console.log('scroll sync:', JSON.stringify(synced));

  // play view: line numbers and an invalid cell
  await p.click('#tab-play');
  await p.waitForTimeout(200);
  console.log('lineno cells:', await p.locator('.cell.lineno').allTextContents());
  const invalid = await p.evaluate(() => {
    const c = document.querySelector('.cell.swara.invalid');
    return c ? { text: c.textContent.trim(), title: c.title } : null;
  });
  console.log('invalid cell:', JSON.stringify(invalid));
  await p.screenshot({ path: '/tmp/shots-errors-play.png', fullPage: true });
  await p.click('#tab-edit');
  await p.screenshot({ path: '/tmp/shots-errors-edit.png' });

  await b.close();
  if (errs.length) { console.log('ERRORS', errs); process.exit(1); }
  console.log('no page errors');
})();
