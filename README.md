# Swara Player

A browser-based player for Carnatic swara notation with aligned sahitya. It parses swaras,
resolves their pitches through the selected raga, plays them with a synthesised piano voice
through the Web Audio API, keeps tala with a metronome, and highlights each swara and its
syllable as it plays. Sahitya is displayed and highlighted but never sounded.

Everything runs in the browser: no backend, no build step to use it, no external request. The
whole application is a single self-contained HTML file.

## Using it

Open `index.html` — that file is the application. For a hosted copy, upload it anywhere that
serves static files, or turn on GitHub Pages for this repository (Settings → Pages → deploy
from the default branch, root folder) and the app is served at
`https://mandolinbalaji.github.io/Swara-Player/`.

To put it on a site under your own menu, upload `index.html` into a folder such as
`/swara-player/` and link the menu item to `https://your-site/swara-player/`. On WordPress the
Media Library rejects `.html`, so upload by FTP or cPanel File Manager and add a *Custom Link*
menu item; alternatively embed it in a page:

```html
<iframe src="/swara-player/index.html" style="width:100%;height:1200px;border:0"
        title="Carnatic Swara Player"></iframe>
```

Serve over HTTPS. Sound starts on the first Play press, which satisfies every browser's
gesture requirement.

## Writing notation

```
[SECTION: Pallavi]
[SWARA]
G,,,    | M,,,    | G,   M,   ||
[SAHITYA]
go        var       dha  ni
```

Only `[SWARA]` rows make sound. The `[SAHITYA]` row beneath is text: letters such as S, R, G,
M, P, D and N inside a lyric never become swaras. Alignment is read from the columns of the raw
text, so keep each syllable under the swara it belongs to; the app preserves your spacing
exactly and never rewrites it.

| Symbol | Meaning |
| --- | --- |
| `G` | one note-space, resolved through the selected raga |
| `G,` `G,,` | each comma adds a note-space and sustains the same swara — one continuous sound, no retrigger |
| `[G M D N]` | double speed: every swara and comma inside takes half a note-space |
| `.N` or `Ṇ` | lower octave (−12 semitones) |
| `N'` or `Ṅ` | upper octave (+12 semitones) |
| `G2`, `M1` | explicit variant, overriding the raga's default for that letter |
| `\|` `\|\|` | bar lines — displayed, silent, and they consume no time |
| `[SECTION: …]`, `[TITLE: …]` | labels — displayed, never played |

Imported text without `[SWARA]`/`[SAHITYA]` markers is never played on a guess: the Notation tab
shows each row with the role it was given, for you to confirm or correct.

## Ragas

### Changing a raga's notes in the app

Settings → *Raga swara positions (editable)* holds one row per swara variant — S, R1, R2, R3,
G1, G2, G3, M1, M2, P, D1, D2, D3, N1, N2, N3.

The **Use** column decides which variants the raga contains. A bare letter in the notation
resolves to the ticked variant, so with Hindolam's S G2 M1 D1 N2 ticked, `G M D N` plays G2 M1
D1 N2. A letter the raga does not contain is reported as an error with its line and column
rather than guessed — a `P` written in Hindolam stops playback and says why.

The **Semitones** column is that variant's distance above Sa. The values are editable and
accept fractions, so `G2` at 2.9 instead of 3 shifts every G2 in the piece; this is how to move
away from equal temperament for a particular swara. *Reset to preset* restores both the tick
marks and the standard semitone table.

The **Bare letter** column appears when a raga holds two variants of the same letter — Bhairavi
with D1 and D2, say. Choose which one a bare `D` means, or leave it unset and write `D1` and
`D2` explicitly in the notation; an unresolvable bare letter is an error, never a silent
choice.

### Adding a raga in the app

Tick the variants you want, set the bare-letter defaults if the raga needs them, type a name
into the box below the table and press **Save as raga**. It joins the dropdown marked *(yours)*,
is kept in that browser's local storage, and travels inside *Save Project*, so a project JSON
opened on another machine brings its ragas with it. **Delete this raga** removes a saved raga;
built-in ragas cannot be deleted.

This is the route to prefer: it survives updates to the app, and it needs no code.

### Adding a raga in the code

Built-in ragas live in the `RAGAS` table near the top of `engine.js` (in the deployed
`index.html`, search for `var RAGAS`). Each entry lists the variants the raga contains:

```js
'Kambhoji': {
  swaras: ['S', 'R2', 'G3', 'M1', 'P', 'D2', 'N2'],
  arohana: 'S R2 G3 M1 P D2 Ṡ',
  avarohana: 'Ṡ N2 D2 P M1 G3 R2 S'
},
```

For a raga carrying two variants of one letter, add the `defaults` map that says what a bare
letter means:

```js
'Bhairavi': {
  swaras: ['S', 'R2', 'G2', 'M1', 'P', 'D1', 'D2', 'N2'],
  defaults: { D: 'D2', N: 'N2' },
  arohana: 'S G2 R2 G2 M1 P D2 N2 Ṡ',
  avarohana: 'Ṡ N2 D1 P M1 G2 R2 S'
},
```

`arohana` and `avarohana` are display strings only — the parser reads `swaras` and `defaults`.
Rebuild with `npm run build` afterwards. The same shape can be registered at runtime without
touching the table:

```js
CarnaticEngine.registerRaga('Kambhoji', { swaras: [...], defaults: {...} });
```

Semitone values for the sixteen variants sit in `DEFAULT_POSITIONS` in the same file; editing
them changes the tuning everywhere, whereas the Settings table changes it for the current
project only.

## Timing

```
secondsPerBeat      = 60 / BPM
secondsPerNoteSpace = secondsPerBeat / noteSpacesPerBeat
```

At 60 BPM with 4 note-spaces to the beat, one note-space is 0.25 s and a bracketed swara is
0.125 s, so `[GMDN]` lasts half a second. Brackets shorten the events only: the tala and
metronome continue at the original tempo, and bracketed swaras generate no extra clicks unless
the per-note-space click is switched on.

Tala is set by beats per cycle, note-spaces per beat and beat groups (`4+2+2` for Adi, `1+2`
for Rupaka). The first beat of a cycle takes the strongest click and the start of each group a
lighter one. Presets cover Adi, Rupaka, Misra and Khanda Chapu, Triputa, Jhampa, Ata, Dhruva
and Eka, and every value stays editable.

## Playing

Tap any swara to start from there; shift-tap a second swara to mark a passage and loop it. Loop
can also follow the whole song or the current section. *Link syllable* relinks a syllable to a
different swara when the imported spacing doesn't place it where you want, and *Reset alignment*
returns to the spacing in the text. Keyboard: space plays or pauses, S stops, R restarts, M
toggles the click, arrow keys move the tempo by 2 BPM.

*Download Text* saves the notation exactly as typed — spacing, commas, brackets, bar lines,
octave dots and diacritics — as UTF-8 with a byte-order mark, so it reopens character-for-character
identical. *Save Project* writes JSON carrying the notation plus raga (including any you
defined), tonic, tala, tempo, audio settings, syllable links and the parsed events; loading it
restores the session.

## Repository layout

```
index.html            the built application — this is what you deploy
src/index.html        page shell
src/app.js            audio scheduler, rendering, controls
src/app.css           styling
engine.js             parser, timing model, raga and pitch resolution, sahitya linking
build.js              inlines src + engine into index.html
tests.js              97 engine assertions, runs in Node with no dependencies
test/                 headless-browser checks (Playwright)
samples/              example notation
```

```
npm test              engine assertions: durations, raga mapping, brackets, Unicode, round trip
npm run build         rebuild index.html from src/
npm install && npm run test:browser
                      browser checks: rendering, playback, downloads, raga editor
```

`engine.js` is pure logic with no DOM or audio, which is why it can be tested in Node. The audio
scheduler uses Web Audio look-ahead: a 25 ms polling loop queues notes and clicks a quarter of a
second ahead with exact `AudioContext` timestamps, so musical timing never depends on timer
accuracy. Pause records the position in song seconds and resume re-anchors to it.

## Known limits

The voice is a synthesised piano rather than a sampled one. Sahitya editing covers relinking a
syllable to a swara and resetting, but not splitting or merging syllables. Gamaka are not
modelled: pitches are 12-tone equal temperament, with every swara position editable if you want
to tune them differently.

## Licence

None yet — all rights reserved. The code is public to read; ask before reusing it.
