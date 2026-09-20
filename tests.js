/* Acceptance tests for the Carnatic notation engine (node tests.js) */
var E = require('./engine.js');

var pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}
function close(name, actual, expected, tol) {
  tol = tol || 1e-6;
  check(name, Math.abs(actual - expected) < tol, 'got ' + actual + ', expected ' + expected);
}
function section(t) { console.log('\n' + t); }

function parseSwaras(text, raga) {
  return E.parse('[SWARA]\n' + text, { raga: raga || 'Chromatic (all swaras)' });
}

/* -------------------------------------------------- Test 1: commas */
section('Test 1 — commas');
var t1 = parseSwaras('G,,, M, D N');
eq('four events', t1.events.length, 4);
eq('G = 4 note-spaces', t1.events[0].durationInSpaces, 4);
eq('M = 2 note-spaces', t1.events[1].durationInSpaces, 2);
eq('D = 1 note-space', t1.events[2].durationInSpaces, 1);
eq('N = 1 note-space', t1.events[3].durationInSpaces, 1);
eq('no errors', t1.errors.length, 0);

/* -------------------------------------------------- Test 2: Hindolam pitches */
section('Test 2 — Hindolam pitch resolution');
var t2 = parseSwaras("G M D N S'", 'Hindolam');
eq('G -> G2', t2.events[0].resolvedSwara, 'G2');
eq('G2 = 3 semitones', t2.events[0].semitone, 3);
eq('M -> M1', t2.events[1].resolvedSwara, 'M1');
eq('M1 = 5 semitones', t2.events[1].semitone, 5);
eq('D -> D1', t2.events[2].resolvedSwara, 'D1');
eq('D1 = 8 semitones', t2.events[2].semitone, 8);
eq('N -> N2', t2.events[3].resolvedSwara, 'N2');
eq('N2 = 10 semitones', t2.events[3].semitone, 10);
eq('upper S octave', t2.events[4].octave, 1);
var sa = E.keyToFrequency('C', 4);
close('Sa = C4 is 261.63 Hz', Math.round(sa * 100) / 100, 261.63, 0.01);
close('upper S = 2 x Sa', E.frequencyOf(sa, 0, 1), sa * 2);
close('G2 above C4', E.frequencyOf(sa, 3, 0), sa * Math.pow(2, 3 / 12));

section('Test 2b — a swara outside the raga is an error, not a guess');
var t2b = parseSwaras('G P N', 'Hindolam');
check('P in Hindolam is rejected', t2b.errors.some(function (e) { return /P is not part of Hindolam/.test(e.message); }),
  JSON.stringify(t2b.errors));

/* -------------------------------------------------- Test 3: double speed */
section('Test 3 — double speed brackets');
var t3 = parseSwaras("G M [D N] S'");
eq('G = 1', t3.events[0].durationInSpaces, 1);
eq('M = 1', t3.events[1].durationInSpaces, 1);
eq('D = 0.5', t3.events[2].durationInSpaces, 0.5);
eq('N = 0.5', t3.events[3].durationInSpaces, 0.5);
eq('upper S = 1', t3.events[4].durationInSpaces, 1);
eq('total = 4 note-spaces', t3.totalSpaces, 4);
eq('D is flagged inside a speed group', t3.events[2].insideSpeedGroup, true);
eq('same group id', t3.events[2].speedGroupId, t3.events[3].speedGroupId);

section('Test 3b — spacing inside brackets is cosmetic');
var a = parseSwaras('[GMDN]'), b = parseSwaras('[G M D N]');
eq('[GMDN] total', a.totalSpaces, 2);
eq('[G M D N] total', b.totalSpaces, 2);
eq('identical event count', a.events.length, b.events.length);

/* -------------------------------------------------- Test 4: commas inside brackets */
section('Test 4 — commas inside double speed');
var t4 = parseSwaras('[P,DP]');
eq('P + comma = 1 note-space', t4.events[0].durationInSpaces, 1);
eq('D = 0.5', t4.events[1].durationInSpaces, 0.5);
eq('final P = 0.5', t4.events[2].durationInSpaces, 0.5);
eq('total = 2 note-spaces', t4.totalSpaces, 2);

section('Test 4b — G,[MD]');
var t4b = parseSwaras('G,[MD]');
eq('G sustained 2 note-spaces', t4b.events[0].durationInSpaces, 2);
eq('M = 0.5', t4b.events[1].durationInSpaces, 0.5);
eq('D = 0.5', t4b.events[2].durationInSpaces, 0.5);
eq('total = 3', t4b.totalSpaces, 3);

section('Test 4c — [G,] sustains for one note-space');
var t4c = parseSwaras('[G,]');
eq('G = 1 note-space', t4c.events[0].durationInSpaces, 1);
eq('one event only (comma does not retrigger)', t4c.events.length, 1);

/* -------------------------------------------------- Test 5: timing math */
section('Test 5 — timing calculation');
var t5 = parseSwaras('[GMDN]');
var time5 = E.timing(t5, { bpm: 60, subdivisionsPerBeat: 4, beatsPerCycle: 3 });
close('one note-space = 0.25 s', time5.secondsPerNoteSpace, 0.25);
close('one bracketed swara = 0.125 s', time5.schedule[0].duration, 0.125);
close('[GMDN] lasts 0.5 s', time5.totalSeconds, 0.5);
var t5b = parseSwaras('G,,, M, D N');
var time5b = E.timing(t5b, { bpm: 120, subdivisionsPerBeat: 4, beatsPerCycle: 3 });
close('at 120 bpm a note-space is 0.125 s', time5b.secondsPerNoteSpace, 0.125);
close('G starts at 0', time5b.schedule[0].startTime, 0);
close('M starts after 4 spaces', time5b.schedule[1].startTime, 0.5);

section('Test 5b — tala grid');
var grid = E.metronomeGrid(12, { subdivisionsPerBeat: 4, beatsPerCycle: 3, beatGroups: [1, 2] });
eq('12 ticks', grid.length, 12);
eq('first tick is a cycle accent', grid[0].kind, 'cycle');
eq('second beat is a group accent', grid[4].kind, 'group');
eq('off-beat is a subdivision', grid[1].kind, 'sub');

/* -------------------------------------------------- Test 6: sahitya safety */
section('Test 6 — sahitya never sounds');
var src6 = '[SWARA]\nG,,,    M,      G M\n[SAHITYA]\ngovardhana      giridhari\n';
var t6 = E.parse(src6, { raga: 'Hindolam' });
eq('only 4 swara events', t6.events.length, 4);
eq('no errors', t6.errors.length, 0);
check('no event came from the sahitya line',
  t6.events.every(function (e) { return e.sourceLine === 1; }),
  JSON.stringify(t6.events.map(function (e) { return e.sourceLine; })));
eq('two sahitya syllables', t6.sahityaTokens.length, 2);
eq('first syllable anchors to the first swara', t6.sahityaTokens[0].anchorIndex, 0);
eq('"govardhana" sustains over G', t6.events[0].sahitya, 'govardhana');
eq('"giridhari" starts at the third swara', t6.sahityaTokens[1].anchorIndex, 2);
eq('third event carries giridhari', t6.events[2].sahitya, 'giridhari');
eq('fourth event still carries giridhari', t6.events[3].sahitya, 'giridhari');

/* -------------------------------------------------- Test 7: invalid brackets */
section('Test 7 — invalid brackets');
var t7 = parseSwaras('G [M [D N]]');
check('nested brackets blocked', t7.errors.some(function (e) { return /Nested square brackets/.test(e.message); }),
  JSON.stringify(t7.errors));
var t7b = parseSwaras('G [M D');
check('unmatched bracket blocked', t7b.errors.some(function (e) { return /Unmatched/.test(e.message); }),
  JSON.stringify(t7b.errors));
var t7c = parseSwaras('G M] D');
check('stray closing bracket blocked', t7c.errors.some(function (e) { return /no opening bracket/.test(e.message); }),
  JSON.stringify(t7c.errors));
var t7d = parseSwaras(', G M');
check('comma with no preceding swara blocked', t7d.errors.some(function (e) { return /comma must follow/.test(e.message); }),
  JSON.stringify(t7d.errors));
check('errors carry line and column',
  t7.errors[0].line === 1 && typeof t7.errors[0].column === 'number',
  JSON.stringify(t7.errors[0]));

/* -------------------------------------------------- Test 8: round trip */
section('Test 8 — text round trip and Unicode preservation');
var src8 = [
  '[TITLE: Govardhana]',
  '[SECTION: Pallavi 1]',
  '[SWARA]',
  "G,,,    M,      G, M,M,     [MGM,]N,   | .N  S'  ||",
  '[SAHITYA]',
  'go      vard    dhana gi     ri        ṭhā  śrī',
  ''
].join('\n');
var t8 = E.parse(src8, { raga: 'Hindolam' });
eq('source stored untouched', t8.source, src8);
check('repeated whitespace preserved', /G,,,    M,/.test(t8.source), 'whitespace collapsed');
var t8again = E.parse(t8.source, { raga: 'Hindolam' });
eq('reparse gives the same event count', t8again.events.length, t8.events.length);
eq('reparse gives the same total duration', t8again.totalSpaces, t8.totalSpaces);
check('diacritics survive', t8.source.indexOf('ṭhā') !== -1 && t8.source.indexOf('śrī') !== -1, 'diacritics lost');
eq('title parsed', t8.title, 'Govardhana');
eq('section captured', t8.sections[0].name, 'Pallavi 1');
check('bar lines recorded', t8.marks.length === 2 && t8.marks[1].type === 'doublebar',
  JSON.stringify(t8.marks));
check('bar lines add no duration', t8.totalSpaces === t8.events.reduce(function (s, e) { return s + e.durationInSpaces; }, 0),
  'bar line consumed time');
eq('safe filename from title', E.safeFilename('Govardhana Swara Sahitya'), 'Govardhana_Swara_Sahitya.txt');
eq('blank title fallback', E.safeFilename(''), 'Carnatic_Notation.txt');

section('Test 8b — octave marks');
var t8b = parseSwaras(".N N N' Ṡ Ṣ", 'Chromatic (all swaras)');
eq('.N is lower octave', t8b.events[0].octave, -1);
eq('N is middle', t8b.events[1].octave, 0);
eq("N' is upper", t8b.events[2].octave, 1);
eq('precomposed dot-above is upper', t8b.events[3].octave, 1);
eq('combining dot-below is lower', t8b.events[4].octave, -1);
eq('display normalises to a dot above', E.displaySwara(t8b.events[2]), 'Ṅ');
var t8c = parseSwaras(".N'");
check('conflicting octave marks flagged', t8c.errors.some(function (e) { return /Ambiguous octave/.test(e.message); }),
  JSON.stringify(t8c.errors));

section('Test 8c — sahitya letters never parse as swaras');
var t8d = E.parse('[SWARA]\nG M\n[SAHITYA]\nsarigama padanisa\n', {});
eq('two events only', t8d.events.length, 2);

section('Test 9 — unlabelled import is flagged for review');
var t9 = E.parse('G,,, M, D N\ngo vard dha na\n', {});
check('review requested', t9.needsReview === true, 'no review flag');
var t9b = E.parse('G,,, M, D N\ngo vard dha na\n', { roleOverrides: { 0: 'swara', 1: 'sahitya' } });
eq('override respected', t9b.events.length, 4);

section('Test 10 — custom ragas');
E.registerRaga('Bhairavi (janya)', {
  swaras: ['S', 'R2', 'G2', 'M1', 'P', 'D1', 'D2', 'N2'],
  defaults: { D: 'D2', N: 'N2' }
});
var t10 = parseSwaras('S R G M P D N', 'Bhairavi (janya)');
eq('registered raga is usable', t10.errors.length, 0);
eq('bare D takes the declared default', t10.events[5].resolvedSwara, 'D2');
eq('bare N resolves', t10.events[6].resolvedSwara, 'N2');
var t10b = parseSwaras('D1 D2', 'Bhairavi (janya)');
eq('explicit variants still win', t10b.events[0].resolvedSwara, 'D1');
eq('no warning for an in-raga variant', t10b.warnings.length, 0);

section('Test 10b — an ambiguous bare letter is refused, not guessed');
E.registerRaga('Two Dhaivatas', { swaras: ['S', 'R2', 'G3', 'M1', 'P', 'D1', 'D2', 'N3'] });
var t10c = parseSwaras('S D', 'Two Dhaivatas');
check('ambiguous D reported', t10c.errors.some(function (e) { return /ambiguous/i.test(e.message); }),
  JSON.stringify(t10c.errors));
var t10d = E.parse('[SWARA]\nS D\n', { raga: 'Two Dhaivatas', ragaDefaults: { D: 'D1' } });
eq('a supplied default resolves it', t10d.events[1].resolvedSwara, 'D1');
eq('and clears the error', t10d.errors.length, 0);

section('Test 10c — editable swara positions');
var shifted = Object.assign({}, E.DEFAULT_POSITIONS, { G2: 2.5 });
var t10e = E.parse('[SWARA]\nG\n', { raga: 'Hindolam', positions: shifted });
eq('G2 takes the edited position', t10e.events[0].semitone, 2.5);
check('frequency follows the edited position',
  Math.abs(E.frequencyOf(240, 2.5, 0) - 240 * Math.pow(2, 2.5 / 12)) < 1e-9, 'bad frequency');
eq('custom raga can be removed', E.unregisterRaga('Two Dhaivatas'), true);
eq('built-in ragas cannot be removed', E.unregisterRaga('Hindolam'), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
