/* ============================================================================
   Carnatic Swara Notation Engine
   Pure logic: parsing, timing, pitch/raga resolution, sahitya alignment.
   No DOM, no audio. Runnable in Node (tests) and in the browser.
   ========================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CarnaticEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------------------
     Swara positions (12-TET semitones above Sa)
     --------------------------------------------------------------------- */
  var DEFAULT_POSITIONS = {
    S: 0,
    R1: 1, R2: 2, R3: 3,
    G1: 2, G2: 3, G3: 4,
    M1: 5, M2: 6,
    P: 7,
    D1: 8, D2: 9, D3: 10,
    N1: 9, N2: 10, N3: 11
  };

  var ALL_SWARA_NAMES = ['S', 'R1', 'R2', 'R3', 'G1', 'G2', 'G3', 'M1', 'M2', 'P', 'D1', 'D2', 'D3', 'N1', 'N2', 'N3'];

  /* Ragas: the list of swara variants each raga admits.
     A bare letter in the notation is resolved through this list.       */
  var RAGAS = {
    'Chromatic (all swaras)': {
      swaras: ALL_SWARA_NAMES.slice(),
      // bare-letter defaults when every variant is available
      defaults: { R: 'R2', G: 'G3', M: 'M1', D: 'D2', N: 'N3' },
      arohana: 'S R2 G3 M1 P D2 N3 Ṡ',
      avarohana: 'Ṡ N3 D2 P M1 G3 R2 S'
    },
    'Hindolam': {
      swaras: ['S', 'G2', 'M1', 'D1', 'N2'],
      arohana: 'S G2 M1 D1 N2 Ṡ',
      avarohana: 'Ṡ N2 D1 M1 G2 S'
    },
    'Mayamalavagowla': {
      swaras: ['S', 'R1', 'G3', 'M1', 'P', 'D1', 'N3'],
      arohana: 'S R1 G3 M1 P D1 N3 Ṡ',
      avarohana: 'Ṡ N3 D1 P M1 G3 R1 S'
    },
    'Shankarabharanam': {
      swaras: ['S', 'R2', 'G3', 'M1', 'P', 'D2', 'N3'],
      arohana: 'S R2 G3 M1 P D2 N3 Ṡ',
      avarohana: 'Ṡ N3 D2 P M1 G3 R2 S'
    },
    'Kalyani': {
      swaras: ['S', 'R2', 'G3', 'M2', 'P', 'D2', 'N3'],
      arohana: 'S R2 G3 M2 P D2 N3 Ṡ',
      avarohana: 'Ṡ N3 D2 P M2 G3 R2 S'
    },
    'Kharaharapriya': {
      swaras: ['S', 'R2', 'G2', 'M1', 'P', 'D2', 'N2'],
      arohana: 'S R2 G2 M1 P D2 N2 Ṡ',
      avarohana: 'Ṡ N2 D2 P M1 G2 R2 S'
    },
    'Hanumatodi': {
      swaras: ['S', 'R1', 'G2', 'M1', 'P', 'D1', 'N2'],
      arohana: 'S R1 G2 M1 P D1 N2 Ṡ',
      avarohana: 'Ṡ N2 D1 P M1 G2 R1 S'
    },
    'Mohanam': {
      swaras: ['S', 'R2', 'G3', 'P', 'D2'],
      arohana: 'S R2 G3 P D2 Ṡ',
      avarohana: 'Ṡ D2 P G3 R2 S'
    },
    'Abhogi': {
      swaras: ['S', 'R2', 'G2', 'M1', 'D2'],
      arohana: 'S R2 G2 M1 D2 Ṡ',
      avarohana: 'Ṡ D2 M1 G2 R2 S'
    },
    'Sriranjani': {
      swaras: ['S', 'R2', 'G2', 'M1', 'D2', 'N2'],
      arohana: 'S R2 G2 M1 D2 N2 Ṡ',
      avarohana: 'Ṡ N2 D2 M1 G2 R2 S'
    },
    'Madhyamavati': {
      swaras: ['S', 'R2', 'M1', 'P', 'N2'],
      arohana: 'S R2 M1 P N2 Ṡ',
      avarohana: 'Ṡ N2 P M1 R2 S'
    },
    'Hamsadhwani': {
      swaras: ['S', 'R2', 'G3', 'P', 'N3'],
      arohana: 'S R2 G3 P N3 Ṡ',
      avarohana: 'Ṡ N3 P G3 R2 S'
    }
  };

  /* Tala presets: beat groups (laghu/drutam structure expressed as counts). */
  var TALAS = {
    'Adi (8)':        { groups: [4, 2, 2], subdivisions: 4 },
    'Rupaka (3)':     { groups: [1, 2],    subdivisions: 4 },
    'Rupaka (6)':     { groups: [2, 4],    subdivisions: 4 },
    'Misra Chapu (7)':{ groups: [3, 2, 2], subdivisions: 2 },
    'Khanda Chapu (5)':{groups: [2, 3],    subdivisions: 2 },
    'Triputa (7)':    { groups: [3, 2, 2], subdivisions: 4 },
    'Jhampa (10)':    { groups: [7, 1, 2], subdivisions: 4 },
    'Ata (14)':       { groups: [5, 5, 2, 2], subdivisions: 4 },
    'Dhruva (14)':    { groups: [4, 2, 4, 4], subdivisions: 4 },
    'Eka (4)':        { groups: [4],       subdivisions: 4 },
    'Free / no tala': { groups: [4],       subdivisions: 4 }
  };

  /* Western key names → semitones above C */
  var KEY_SEMITONES = {
    'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
    'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11
  };

  function keyToFrequency(key, octave) {
    // A4 = 440 Hz. MIDI note = 12*(octave+1) + semitone.
    var semitone = KEY_SEMITONES[key];
    if (semitone === undefined) return 261.6255653005986;
    var midi = 12 * (octave + 1) + semitone;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function frequencyOf(saFrequency, semitone, octave) {
    return saFrequency * Math.pow(2, (semitone + 12 * octave) / 12);
  }

  /* ---------------------------------------------------------------------
     Character analysis: base letter + octave marks, column-preserving
     --------------------------------------------------------------------- */
  var COMBINING_ABOVE = '̇';   // dot above
  var COMBINING_BELOW = '̣';   // dot below

  function isCombining(ch) {
    var code = ch.charCodeAt(0);
    return (code >= 0x0300 && code <= 0x036F);
  }

  /* Decompose a single character so precomposed letters such as Ṡ (S with dot
     above) or Ṣ (S with dot below) are recognised without changing columns. */
  function analyseChar(ch) {
    var d = ch.normalize ? ch.normalize('NFD') : ch;
    var base = d.charAt(0);
    var above = d.indexOf(COMBINING_ABOVE) > 0;
    var below = d.indexOf(COMBINING_BELOW) > 0;
    return { base: base, above: above, below: below };
  }

  function isSwaraLetter(ch) {
    return 'SRGMPDN'.indexOf(ch.toUpperCase()) !== -1;
  }

  /* ---------------------------------------------------------------------
     Raga resolution
     --------------------------------------------------------------------- */
  /* Register or replace a raga at runtime. Custom ragas saved in the app land
     here, so they behave exactly like the built-in ones. */
  function registerRaga(name, def) {
    if (!name || !def || !def.swaras || !def.swaras.length) return false;
    RAGAS[name] = {
      swaras: def.swaras.slice(),
      defaults: def.defaults || null,
      arohana: def.arohana || def.swaras.join(' ') + ' Ṡ',
      avarohana: def.avarohana || 'Ṡ ' + def.swaras.slice().reverse().join(' '),
      custom: true
    };
    return true;
  }
  function unregisterRaga(name) {
    if (RAGAS[name] && RAGAS[name].custom) { delete RAGAS[name]; return true; }
    return false;
  }

  function buildRagaContext(ragaName, positions, customSwaras, customDefaults) {
    var raga = RAGAS[ragaName] || RAGAS['Chromatic (all swaras)'];
    var swaras = customSwaras && customSwaras.length ? customSwaras : raga.swaras;
    var byLetter = {};
    swaras.forEach(function (name) {
      var letter = name.charAt(0);
      if (!byLetter[letter]) byLetter[letter] = [];
      byLetter[letter].push(name);
    });
    var defaults = null;
    if (raga.defaults || customDefaults) {
      defaults = Object.assign({}, raga.defaults || {}, customDefaults || {});
      // a default only counts if the raga actually contains that variant
      Object.keys(defaults).forEach(function (letter) {
        if (swaras.indexOf(defaults[letter]) === -1) delete defaults[letter];
      });
      if (!Object.keys(defaults).length) defaults = null;
    }
    return {
      name: ragaName,
      swaras: swaras,
      byLetter: byLetter,
      defaults: defaults,
      positions: positions || DEFAULT_POSITIONS,
      arohana: raga.arohana || '',
      avarohana: raga.avarohana || ''
    };
  }

  /* Resolve a written swara (letter + optional variant digit) to a named
     swara and a semitone. Returns { name, semitone, error, warning }. */
  function resolveSwara(letter, digit, ctx) {
    letter = letter.toUpperCase();
    if (digit) {
      var explicit = letter + digit;
      if (ctx.positions[explicit] === undefined) {
        return { error: 'Unknown swara "' + explicit + '"' };
      }
      var known = ctx.swaras.indexOf(explicit) !== -1;
      return {
        name: explicit,
        semitone: ctx.positions[explicit],
        warning: known ? null : explicit + ' is not part of ' + ctx.name
      };
    }
    // Bare letter: S and P have no variants.
    if (letter === 'S' || letter === 'P') {
      if (ctx.swaras.indexOf(letter) === -1) {
        return { error: letter + ' is not part of ' + ctx.name + '. Add it to the raga or correct the notation.' };
      }
      return { name: letter, semitone: ctx.positions[letter] };
    }
    var candidates = ctx.byLetter[letter];
    if (!candidates || candidates.length === 0) {
      if (ctx.defaults && ctx.defaults[letter]) {
        var def = ctx.defaults[letter];
        return { name: def, semitone: ctx.positions[def] };
      }
      return { error: letter + ' is not part of ' + ctx.name + '. Assign its position or correct the notation.' };
    }
    if (candidates.length > 1) {
      if (ctx.defaults && ctx.defaults[letter] && candidates.indexOf(ctx.defaults[letter]) !== -1) {
        var d = ctx.defaults[letter];
        return { name: d, semitone: ctx.positions[d] };
      }
      return { error: letter + ' is ambiguous in ' + ctx.name + ' (' + candidates.join(', ') + '). Write the variant explicitly.' };
    }
    return { name: candidates[0], semitone: ctx.positions[candidates[0]] };
  }

  /* ---------------------------------------------------------------------
     Line classification
     --------------------------------------------------------------------- */
  var RE_SECTION = /^\s*\[\s*SECTION\s*:?\s*(.*?)\s*\]\s*$/i;
  var RE_SWARA_MARK = /^\s*\[\s*SWARA\s*\]\s*$/i;
  var RE_SAHITYA_MARK = /^\s*\[\s*SAHITYA\s*\]\s*$/i;
  var RE_COMMENT = /^\s*(#|\/\/)/;
  var RE_TITLE = /^\s*\[\s*TITLE\s*:?\s*(.*?)\s*\]\s*$/i;

  /* Heuristic used only when the text carries no [SWARA]/[SAHITYA] markers.
     It never starts playback on its own — the UI shows the assignment for
     review. */
  function looksLikeSwaraRow(text) {
    var stripped = text.replace(/[\s,|\[\]'.̀-ͯ0-9]/g, '');
    if (stripped.length === 0) return text.replace(/\s/g, '').length > 0;
    var swaraChars = 0;
    for (var i = 0; i < stripped.length; i++) {
      var a = analyseChar(stripped.charAt(i));
      if (isSwaraLetter(a.base)) swaraChars++;
    }
    return swaraChars === stripped.length;
  }

  function classifyLines(source, overrides) {
    overrides = overrides || {};
    var lines = source.split('\n');
    var out = [];
    var pendingRole = null;      // set by an explicit [SWARA] / [SAHITYA] marker
    var currentSection = '';
    var title = null;
    var hasMarkers = /\[\s*SWARA\s*\]/i.test(source);

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var entry = { index: i, text: raw, role: 'blank', section: currentSection, auto: true };

      var mTitle = raw.match(RE_TITLE);
      var mSection = raw.match(RE_SECTION);

      if (mTitle) {
        title = mTitle[1];
        entry.role = 'meta';
      } else if (mSection) {
        currentSection = mSection[1];
        entry.role = 'section';
        entry.section = currentSection;
      } else if (RE_SWARA_MARK.test(raw)) {
        entry.role = 'marker';
        pendingRole = 'swara';
      } else if (RE_SAHITYA_MARK.test(raw)) {
        entry.role = 'marker';
        pendingRole = 'sahitya';
      } else if (RE_COMMENT.test(raw)) {
        entry.role = 'comment';
      } else if (raw.trim() === '') {
        entry.role = 'blank';
      } else if (pendingRole) {
        entry.role = pendingRole;
        entry.auto = false;
      } else if (!hasMarkers) {
        entry.role = looksLikeSwaraRow(raw) ? 'swara' : 'sahitya';
        entry.needsReview = true;
      } else {
        entry.role = 'comment';
      }

      if (overrides[i]) { entry.role = overrides[i]; entry.auto = false; entry.needsReview = false; }
      out.push(entry);
    }
    return { lines: out, title: title, hasMarkers: hasMarkers };
  }

  /* ---------------------------------------------------------------------
     Swara row parsing
     --------------------------------------------------------------------- */
  function parseSwaraRow(text, lineIndex, ctx, state, errors, warnings) {
    var events = [];
    var marks = [];           // bar lines etc, for display
    var i = 0;
    var speedGroupOpenAt = -1;
    var speedGroupId = null;
    var groupCounter = state.groupCounter;

    /* Every message carries the exact character range it covers, so the editor
       can highlight the offending text rather than just naming a line. */
    function pushError(col, message, severity, endCol) {
      (severity === 'warning' ? warnings : errors).push({
        line: lineIndex,
        column: col,
        endColumn: (typeof endCol === 'number' && endCol > col) ? endCol : col + 1,
        message: message,
        severity: severity || 'error'
      });
    }

    while (i < text.length) {
      var ch = text.charAt(i);

      if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }

      if (ch === '[') {
        if (speedGroupOpenAt !== -1) {
          pushError(i, 'Nested square brackets are not allowed.');
          return { events: events, marks: marks, groupCounter: groupCounter, fatal: true };
        }
        speedGroupOpenAt = i;
        groupCounter++;
        speedGroupId = 'group-' + groupCounter;
        i++;
        continue;
      }

      if (ch === ']') {
        if (speedGroupOpenAt === -1) {
          pushError(i, 'Closing bracket with no opening bracket.');
          return { events: events, marks: marks, groupCounter: groupCounter, fatal: true };
        }
        speedGroupOpenAt = -1;
        speedGroupId = null;
        i++;
        continue;
      }

      if (ch === '|') {
        var double = text.charAt(i + 1) === '|';
        marks.push({
          type: double ? 'doublebar' : 'bar',
          line: lineIndex,
          column: i,
          atSpace: state.space
        });
        i += double ? 2 : 1;
        continue;
      }

      if (ch === ',') {
        var last = state.lastEvent;
        if (!last) {
          pushError(i, 'A comma must follow a swara.');
          i++;
          continue;
        }
        var add = speedGroupOpenAt !== -1 ? 0.5 : 1;
        last.durationInSpaces += add;
        last.commaCount += 1;
        last.sourceEndColumn = (last.sourceLine === lineIndex) ? i + 1 : last.sourceEndColumn;
        state.space += add;
        i++;
        continue;
      }

      var info = analyseChar(ch);

      // Leading dot = lower octave, e.g. .N
      var lowerByDot = false;
      var startCol = i;
      if (ch === '.') {
        var nextInfo = i + 1 < text.length ? analyseChar(text.charAt(i + 1)) : null;
        if (nextInfo && isSwaraLetter(nextInfo.base)) {
          lowerByDot = true;
          i++;
          ch = text.charAt(i);
          info = analyseChar(ch);
        } else {
          pushError(i, 'Stray "." — a lower-octave dot must sit before a swara.');
          i++;
          continue;
        }
      }

      if (!isSwaraLetter(info.base)) {
        /* A stray word in a swara row — usually a sahitya line that was not
           marked as one — is reported once, over the whole word, rather than
           once per character. */
        if (/[\p{L}]/u.test(info.base)) {
          var wordStart = i;
          while (i < text.length) {
            var wc = analyseChar(text.charAt(i));
            if (/[\p{L}\p{N}]/u.test(wc.base) || isCombining(text.charAt(i))) i++;
            else break;
          }
          var word = text.slice(wordStart, i);
          pushError(wordStart,
            '"' + word + '" is not a swara. Swara rows use S R G M P D N with optional variant numbers — ' +
            'if this is lyric text, mark the row as sahitya.',
            'error', i);
          continue;
        }
        pushError(i, 'Unexpected character "' + ch + '" in a swara row. ' +
          'Swara rows take S R G M P D N, commas, square brackets and bar lines.', 'error', i + 1);
        i++;
        continue;
      }

      var letter = info.base.toUpperCase();
      var above = info.above;
      var below = info.below || lowerByDot;
      i++;

      // combining marks written as separate characters
      while (i < text.length && isCombining(text.charAt(i))) {
        var mark = text.charAt(i);
        if (mark === COMBINING_ABOVE) above = true;
        else if (mark === COMBINING_BELOW) below = true;
        i++;
      }

      // variant digit
      var digit = '';
      if (i < text.length && /[1-3]/.test(text.charAt(i))) {
        digit = text.charAt(i);
        i++;
      }

      // apostrophe forms: N' = upper, N'' = two octaves up, N_ = lower
      while (i < text.length && (text.charAt(i) === "'" || text.charAt(i) === '’')) {
        above = above ? 'double' : true;
        i++;
      }
      while (i < text.length && text.charAt(i) === '_') {
        below = below ? 'double' : true;
        i++;
      }

      /* A swara letter glued to a non-swara letter is a word, not notation:
         "govardhana" in a swara row is reported once, over the whole word. */
      if (i < text.length) {
        var nextInfo2 = analyseChar(text.charAt(i));
        if (/[\p{L}]/u.test(nextInfo2.base) && !isSwaraLetter(nextInfo2.base)) {
          var wStart = startCol;
          while (i < text.length) {
            var wc2 = analyseChar(text.charAt(i));
            if (/[\p{L}\p{N}]/u.test(wc2.base) || isCombining(text.charAt(i))) i++;
            else break;
          }
          pushError(wStart,
            '"' + text.slice(wStart, i) + '" is not a swara. Swara rows use S R G M P D N with optional variant ' +
            'numbers — if this is lyric text, mark the row as sahitya.',
            'error', i);
          continue;
        }
      }

      var tokenEnd = i;
      if (above && below) {
        pushError(startCol, 'Ambiguous octave mark on "' + letter + '" — it has both an upper and a lower mark.',
          'error', tokenEnd);
      }

      var octave = 0;
      if (above) octave = above === 'double' ? 2 : 1;
      else if (below) octave = below === 'double' ? -2 : -1;

      var resolved = resolveSwara(letter, digit, ctx);
      if (resolved.error) pushError(startCol, resolved.error, 'error', tokenEnd);
      if (resolved.warning) pushError(startCol, resolved.warning, 'warning', tokenEnd);

      var inGroup = speedGroupOpenAt !== -1;
      var duration = inGroup ? 0.5 : 1;

      var event = {
        id: 'e' + state.eventCounter++,
        swara: letter + digit,
        resolvedSwara: resolved.name || (letter + digit),
        semitone: resolved.semitone !== undefined ? resolved.semitone : null,
        valid: !resolved.error,
        error: resolved.error || null,
        warning: resolved.warning || null,
        octave: octave,
        durationInSpaces: duration,
        commaCount: 0,
        speed: inGroup ? 2 : 1,
        insideSpeedGroup: inGroup,
        speedGroupId: inGroup ? speedGroupId : null,
        section: state.section,
        sahitya: null,
        startSpace: state.space,
        sourceLine: lineIndex,
        sourceStartColumn: startCol,
        sourceEndColumn: i
      };
      state.space += duration;
      state.lastEvent = event;
      events.push(event);
    }

    if (speedGroupOpenAt !== -1) {
      pushError(speedGroupOpenAt, 'Unmatched "[" — the double-speed phrase is never closed.');
      return { events: events, marks: marks, groupCounter: groupCounter, fatal: true };
    }

    return { events: events, marks: marks, groupCounter: groupCounter, fatal: false };
  }

  /* ---------------------------------------------------------------------
     Sahitya tokenising and linking
     --------------------------------------------------------------------- */
  function tokeniseSahitya(text, lineIndex) {
    var tokens = [];
    var re = /\S+/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      tokens.push({
        id: 'sy' + lineIndex + '_' + m.index,
        text: m[0],
        line: lineIndex,
        startColumn: m.index,
        endColumn: m.index + m[0].length,
        offset: 0,
        anchorEventId: null,
        anchorIndex: -1
      });
    }
    return tokens;
  }

  /* Attach each sahitya token to the swara event it sits beneath. */
  function linkSahitya(tokens, events, links) {
    if (!events.length) return;
    tokens.forEach(function (token) {
      if (links && links[token.id]) {
        var forced = null;
        for (var k = 0; k < events.length; k++) if (events[k].id === links[token.id]) forced = events[k];
        if (forced) {
          token.anchorEventId = forced.id;
          return;
        }
      }
      var best = events[0];
      for (var j = 0; j < events.length; j++) {
        if (events[j].sourceStartColumn <= token.startColumn) best = events[j];
        else break;
      }
      token.anchorEventId = best.id;
    });
  }

  /* ---------------------------------------------------------------------
     Full document parse
     --------------------------------------------------------------------- */
  function parse(source, options) {
    options = options || {};
    var ctx = buildRagaContext(
      options.raga || 'Chromatic (all swaras)',
      options.positions || DEFAULT_POSITIONS,
      options.ragaSwaras,
      options.ragaDefaults
    );
    var classified = classifyLines(source, options.roleOverrides);
    var errors = [];
    var warnings = [];
    var events = [];
    var marks = [];
    var sahityaTokens = [];
    var rows = [];               // display rows: swara row + its sahitya row
    var sections = [];

    var state = {
      space: 0,
      eventCounter: 0,
      groupCounter: 0,
      lastEvent: null,
      section: ''
    };

    var pendingSwaraRow = null;
    var lines = classified.lines;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      state.section = line.section;

      if (line.role === 'section') {
        sections.push({ name: line.section, atSpace: state.space, line: i });
        if (pendingSwaraRow) { rows.push(pendingSwaraRow); pendingSwaraRow = null; }
        rows.push({ type: 'section', name: line.section, line: i });
        continue;
      }

      if (line.role === 'swara') {
        if (pendingSwaraRow) { rows.push(pendingSwaraRow); pendingSwaraRow = null; }
        var res = parseSwaraRow(line.text, i, ctx, state, errors, warnings);
        state.groupCounter = res.groupCounter;
        events = events.concat(res.events);
        marks = marks.concat(res.marks);
        pendingSwaraRow = {
          type: 'passage',
          section: line.section,
          swaraLine: i,
          swaraText: line.text,
          events: res.events,
          marks: res.marks,
          sahityaLine: null,
          sahityaText: null,
          sahityaTokens: []
        };
        continue;
      }

      if (line.role === 'sahitya') {
        var tokens = tokeniseSahitya(line.text, i);
        if (pendingSwaraRow) {
          linkSahitya(tokens, pendingSwaraRow.events, options.sahityaLinks);
          pendingSwaraRow.sahityaLine = i;
          pendingSwaraRow.sahityaText = line.text;
          pendingSwaraRow.sahityaTokens = tokens;
          sahityaTokens = sahityaTokens.concat(tokens);
          rows.push(pendingSwaraRow);
          pendingSwaraRow = null;
        } else {
          rows.push({ type: 'text', role: 'sahitya', text: line.text, line: i });
        }
        continue;
      }

      if (line.role === 'comment' || line.role === 'meta') {
        if (pendingSwaraRow) { rows.push(pendingSwaraRow); pendingSwaraRow = null; }
        if (line.text.trim() !== '') rows.push({ type: 'text', role: line.role, text: line.text, line: i });
      }
    }
    if (pendingSwaraRow) rows.push(pendingSwaraRow);

    // index sahitya anchors against the global event order
    var indexOf = {};
    events.forEach(function (e, idx) { indexOf[e.id] = idx; });
    sahityaTokens.forEach(function (t) {
      t.anchorIndex = t.anchorEventId !== null && indexOf[t.anchorEventId] !== undefined ? indexOf[t.anchorEventId] : -1;
    });
    // Give every event the syllable sounding over it. A syllable is carried
    // forward only inside its own passage, never across a passage boundary.
    rows.forEach(function (row) {
      if (row.type !== 'passage') return;
      var byAnchor = {};
      row.sahityaTokens.forEach(function (t) { if (t.anchorEventId) byAnchor[t.anchorEventId] = t; });
      var current = null;
      row.events.forEach(function (e) {
        if (byAnchor[e.id]) current = byAnchor[e.id];
        if (current) { e.sahitya = current.text; e.sahityaId = current.id; }
      });
    });

    var totalSpaces = state.space;

    return {
      source: source,
      title: classified.title,
      lines: lines,
      rows: rows,
      events: events,
      marks: marks,
      sections: sections,
      sahityaTokens: sahityaTokens,
      errors: errors,
      warnings: warnings,
      totalSpaces: totalSpaces,
      raga: ctx,
      needsReview: lines.some(function (l) { return l.needsReview; })
    };
  }

  /* ---------------------------------------------------------------------
     Timing
     --------------------------------------------------------------------- */
  function timing(parsed, config) {
    var bpm = config.bpm || 60;
    var subdivisions = config.subdivisionsPerBeat || 4;
    var beatsPerCycle = config.beatsPerCycle || 8;
    var secondsPerBeat = 60 / bpm;
    var secondsPerNoteSpace = secondsPerBeat / subdivisions;

    var schedule = parsed.events.map(function (e) {
      return {
        event: e,
        startSpace: e.startSpace,
        startTime: e.startSpace * secondsPerNoteSpace,
        duration: e.durationInSpaces * secondsPerNoteSpace,
        beat: Math.floor(e.startSpace / subdivisions),
        cycle: Math.floor(e.startSpace / (subdivisions * beatsPerCycle)),
        beatInCycle: Math.floor(e.startSpace / subdivisions) % beatsPerCycle,
        subdivision: e.startSpace % subdivisions
      };
    });

    var totalSeconds = parsed.totalSpaces * secondsPerNoteSpace;
    var spacesPerCycle = subdivisions * beatsPerCycle;
    var cycleFit = parsed.totalSpaces % spacesPerCycle;

    return {
      secondsPerBeat: secondsPerBeat,
      secondsPerNoteSpace: secondsPerNoteSpace,
      spacesPerCycle: spacesPerCycle,
      totalSeconds: totalSeconds,
      schedule: schedule,
      cycleRemainder: cycleFit
    };
  }

  /* Metronome grid over the whole piece. */
  function metronomeGrid(totalSpaces, config) {
    var subdivisions = config.subdivisionsPerBeat || 4;
    var beatsPerCycle = config.beatsPerCycle || 8;
    var groups = config.beatGroups && config.beatGroups.length ? config.beatGroups : null;
    var accents = {};
    if (groups) {
      var at = 0;
      groups.forEach(function (g) { accents[at] = true; at += g; });
    }
    var ticks = [];
    for (var space = 0; space < totalSpaces; space++) {
      var isBeat = space % subdivisions === 0;
      var beat = space / subdivisions;
      if (isBeat) {
        var beatInCycle = beat % beatsPerCycle;
        var kind = beatInCycle === 0 ? 'cycle' : (accents[beatInCycle] ? 'group' : 'beat');
        ticks.push({ space: space, kind: kind, beat: beat, beatInCycle: beatInCycle });
      } else {
        ticks.push({ space: space, kind: 'sub' });
      }
    }
    return ticks;
  }

  /* ---------------------------------------------------------------------
     Display normalisation of octave marks
     --------------------------------------------------------------------- */
  function displaySwara(event) {
    var text = event.swara;
    if (event.octave > 0) text = text.charAt(0) + COMBINING_ABOVE + text.slice(1);
    else if (event.octave < 0) text = text.charAt(0) + COMBINING_BELOW + text.slice(1);
    return text;
  }

  /* ---------------------------------------------------------------------
     Text export
     --------------------------------------------------------------------- */
  function safeFilename(title) {
    var base = (title || '').trim();
    if (!base) return 'Carnatic_Notation.txt';
    return base.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 80) + '.txt';
  }

  return {
    DEFAULT_POSITIONS: DEFAULT_POSITIONS,
    ALL_SWARA_NAMES: ALL_SWARA_NAMES,
    RAGAS: RAGAS,
    TALAS: TALAS,
    KEY_SEMITONES: KEY_SEMITONES,
    keyToFrequency: keyToFrequency,
    frequencyOf: frequencyOf,
    buildRagaContext: buildRagaContext,
    registerRaga: registerRaga,
    unregisterRaga: unregisterRaga,
    resolveSwara: resolveSwara,
    classifyLines: classifyLines,
    parse: parse,
    timing: timing,
    metronomeGrid: metronomeGrid,
    displaySwara: displaySwara,
    safeFilename: safeFilename
  };
});
