/* ============================================================================
   Carnatic Swara Player — application layer
   Audio scheduling, rendering, controls. Engine logic lives in CarnaticEngine.
   ========================================================================= */
(function () {
  'use strict';
  var E = window.CarnaticEngine;
  var $ = function (id) { return document.getElementById(id); };

  /* Hindolam, three cycles of Rupaka written as 3 beats x 4 note-spaces.
     Every passage is exactly one cycle of 12 note-spaces. */
  var SAMPLE = [
    '[TITLE: Hindolam Sample]',
    '[SECTION: Pallavi]',
    '[SWARA]',
    'G,,,    | M,,,    | G,   M,   ||',
    '[SAHITYA]',
    'go        var       dha  ni',
    '',
    '[SECTION: Anupallavi]',
    '[SWARA]',
    "S',,,   | N,   D,   | M,   G,   ||",
    '[SAHITYA]',
    'ā         nan  da     ku   mā',
    '',
    '[SECTION: Chittaswaram]',
    '[SWARA]',
    "[G M D N] S',,  | .N   S,   | [S'N D M] G,   ||",
    '[SAHITYA]',
    'ā         nan     da           śrī      hā',
    ''
  ].join('\n');

  /* ------------------------------------------------------------------ state */
  var state = {
    title: 'Hindolam Sample',
    source: SAMPLE,
    bpm: 60,
    subdivisionsPerBeat: 4,
    beatsPerCycle: 3,
    beatGroups: [1, 2],
    talaPreset: 'Rupaka (3)',
    metronome: true,
    subClick: false,
    countIn: false,
    loopMode: 'off',
    tonicKey: 'C',
    tonicOctave: 4,
    tonicHz: 261.63,
    raga: 'Hindolam',
    positions: Object.assign({}, E.DEFAULT_POSITIONS),
    ragaSwaras: null,
    ragaDefaults: {},
    customRagas: {},
    volMaster: 0.85,
    volPiano: 0.8,
    volClick: 0.5,
    sahityaLinks: {},
    roleOverrides: {},
    selection: { start: null, end: null },
    ignoreErrors: false
  };

  var parsed = null, timingInfo = null, ticks = [], linkPick = null;

  /* ------------------------------------------------------------------ audio */
  var actx = null, busMaster = null, busPiano = null, busClick = null;
  var voices = [];

  function ensureAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return actx; }
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { flash('This browser has no Web Audio support, so playback is unavailable.', 'err'); return null; }
    actx = new Ctor();
    busMaster = actx.createGain();
    busPiano = actx.createGain();
    busClick = actx.createGain();
    busPiano.connect(busMaster);
    busClick.connect(busMaster);
    busMaster.connect(actx.destination);
    applyVolumes();
    return actx;
  }
  function applyVolumes() {
    if (!actx) return;
    busMaster.gain.value = state.volMaster;
    busPiano.gain.value = state.volPiano;
    busClick.gain.value = state.volClick * 0.6;
  }

  var HARMONICS = [
    { ratio: 1, gain: 1.0, type: 'triangle' },
    { ratio: 2, gain: 0.42, type: 'sine' },
    { ratio: 3, gain: 0.2, type: 'sine' },
    { ratio: 4.01, gain: 0.1, type: 'sine' },
    { ratio: 6, gain: 0.04, type: 'sine' }
  ];

  function playNote(freq, when, dur) {
    if (!actx || !isFinite(freq) || freq <= 0) return;
    var start = Math.max(when, actx.currentTime + 0.001);
    var length = Math.max(0.06, dur - (start - when));
    var out = actx.createGain();
    var filt = actx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 0.6;
    filt.frequency.setValueAtTime(Math.min(9000, freq * 9), start);
    filt.frequency.exponentialRampToValueAtTime(Math.max(700, freq * 3), start + Math.min(1.2, length * 0.8) + 0.05);
    filt.connect(out);
    out.connect(busPiano);

    var peak = 0.32;
    var g = out.gain;
    g.setValueAtTime(0.0001, start);
    g.linearRampToValueAtTime(peak, start + 0.012);
    g.exponentialRampToValueAtTime(peak * 0.55, start + Math.min(0.45, length * 0.6));
    g.setTargetAtTime(peak * 0.34, start + Math.min(0.45, length * 0.6), 0.6);
    var release = start + length;
    g.setTargetAtTime(0.0001, release, 0.05);

    var oscs = [];
    HARMONICS.forEach(function (h) {
      var osc = actx.createOscillator();
      osc.type = h.type;
      osc.frequency.setValueAtTime(freq * h.ratio, start);
      var hg = actx.createGain();
      hg.gain.value = h.gain;
      osc.connect(hg); hg.connect(filt);
      osc.start(start);
      osc.stop(release + 0.35);
      oscs.push(osc);
    });
    voices.push({ out: out, oscs: oscs, end: release + 0.35 });
    if (voices.length > 64) voices = voices.filter(function (v) { return v.end > actx.currentTime - 0.5; });
  }

  var CLICKS = {
    cycle: { freq: 1500, gain: 0.5, len: 0.055 },
    group: { freq: 1100, gain: 0.34, len: 0.045 },
    beat: { freq: 900, gain: 0.26, len: 0.04 },
    sub: { freq: 640, gain: 0.1, len: 0.028 }
  };
  function playClick(kind, when) {
    if (!actx) return;
    var c = CLICKS[kind] || CLICKS.beat;
    var start = Math.max(when, actx.currentTime + 0.001);
    var osc = actx.createOscillator();
    var g = actx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(c.freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(c.gain, start + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, start + c.len);
    osc.connect(g); g.connect(busClick);
    osc.start(start); osc.stop(start + c.len + 0.02);
  }

  function stopAllVoices() {
    if (!actx) return;
    var now = actx.currentTime;
    voices.forEach(function (v) {
      try {
        v.out.gain.cancelScheduledValues(now);
        v.out.gain.setTargetAtTime(0.0001, now, 0.015);
        v.oscs.forEach(function (o) { try { o.stop(now + 0.1); } catch (e) {} });
      } catch (e) {}
    });
    voices = [];
  }

  /* -------------------------------------------------------------- transport */
  var transport = {
    status: 'stopped',
    origin: 0,          // audio-context time of song second 0
    uiOrigin: 0,
    pendingOrigins: [],
    eventPtr: 0,
    tickPtr: 0,
    pausedAt: 0,
    startFrom: 0,
    timer: null,
    raf: null,
    endAt: null
  };
  var LOOKAHEAD = 0.25, INTERVAL = 25;

  function schedule() { return timingInfo ? timingInfo.schedule : []; }

  function loopBounds() {
    var sch = schedule();
    if (!sch.length) return null;
    var sps = timingInfo.secondsPerNoteSpace;
    if (state.loopMode === 'song') return { start: 0, end: parsed.totalSpaces * sps };
    if (state.loopMode === 'selection' && state.selection.start !== null) {
      var a = Math.min(state.selection.start, state.selection.end === null ? state.selection.start : state.selection.end);
      var b = Math.max(state.selection.start, state.selection.end === null ? state.selection.start : state.selection.end);
      return { start: sch[a].startTime, end: sch[b].startTime + sch[b].duration };
    }
    if (state.loopMode === 'section') {
      var idx = Math.min(transport.eventPtr, sch.length - 1);
      var sec = sch[idx] ? sch[idx].event.section : '';
      var first = null, last = null;
      sch.forEach(function (s, i) { if (s.event.section === sec) { if (first === null) first = i; last = i; } });
      if (first === null) return null;
      return { start: sch[first].startTime, end: sch[last].startTime + sch[last].duration };
    }
    return null;
  }

  function firstEventAtOrAfter(t) {
    var sch = schedule();
    for (var i = 0; i < sch.length; i++) if (sch[i].startTime >= t - 1e-9) return i;
    return sch.length;
  }
  function firstTickAtOrAfter(t) {
    for (var i = 0; i < ticks.length; i++) if (ticks[i].time >= t - 1e-9) return i;
    return ticks.length;
  }

  function buildTicks() {
    ticks = [];
    if (!parsed || !timingInfo) return;
    var grid = E.metronomeGrid(Math.ceil(parsed.totalSpaces), {
      subdivisionsPerBeat: state.subdivisionsPerBeat,
      beatsPerCycle: state.beatsPerCycle,
      beatGroups: state.beatGroups
    });
    var sps = timingInfo.secondsPerNoteSpace;
    grid.forEach(function (t) { ticks.push({ time: t.space * sps, kind: t.kind, space: t.space }); });
  }

  function play(fromIndex) {
    if (!parsed || !schedule().length) { flash('Nothing to play yet — add some notation.', 'warn'); return; }
    if (parsed.errors.length && !state.ignoreErrors) { setTab('edit'); flash('Fix the blocking errors first, or choose "Play anyway".', 'err'); return; }
    if (!ensureAudio()) return;
    if (transport.status === 'playing') return;

    var sch = schedule();
    var startTime;
    if (transport.status === 'paused') {
      startTime = transport.pausedAt;
    } else {
      var idx = typeof fromIndex === 'number' ? fromIndex : (state.selection.start !== null ? state.selection.start : 0);
      idx = Math.max(0, Math.min(idx, sch.length - 1));
      startTime = sch[idx].startTime;
    }
    var countInSeconds = (state.countIn && transport.status !== 'paused')
      ? state.beatsPerCycle * timingInfo.secondsPerBeat : 0;

    transport.origin = actx.currentTime + 0.12 + countInSeconds - startTime;
    transport.uiOrigin = transport.origin;
    transport.pendingOrigins = [];
    transport.eventPtr = 0;
    var sIdx = 0;
    for (var i = 0; i < sch.length; i++) { if (sch[i].startTime + sch[i].duration > startTime + 1e-9) { sIdx = i; break; } sIdx = sch.length; }
    transport.eventPtr = sIdx;
    transport.tickPtr = firstTickAtOrAfter(startTime);
    transport.endAt = null;
    transport.status = 'playing';

    if (countInSeconds > 0) {
      for (var b = 0; b < state.beatsPerCycle; b++) {
        playClick(b === 0 ? 'cycle' : 'beat', actx.currentTime + 0.12 + b * timingInfo.secondsPerBeat);
      }
    }
    transport.timer = setInterval(schedulerTick, INTERVAL);
    schedulerTick();
    startUiLoop();
    syncTransportUi();
  }

  function schedulerTick() {
    if (transport.status !== 'playing') return;
    var sch = schedule();
    var horizon = actx.currentTime + LOOKAHEAD;
    var loop = state.loopMode !== 'off' ? loopBounds() : null;
    var endT = loop ? loop.end : timingInfo.totalSeconds;
    var guard = 0;

    while (guard++ < 200) {
      while (transport.eventPtr < sch.length &&
             sch[transport.eventPtr].startTime < endT - 1e-9 &&
             transport.origin + sch[transport.eventPtr].startTime < horizon) {
        var s = sch[transport.eventPtr];
        if (s.event.valid && (!state.ignoreErrors || s.event.semitone !== null)) {
          var freq = E.frequencyOf(state.tonicHz, s.event.semitone, s.event.octave);
          playNote(freq, transport.origin + s.startTime, s.duration);
        }
        transport.eventPtr++;
      }
      while (transport.tickPtr < ticks.length &&
             ticks[transport.tickPtr].time < endT - 1e-9 &&
             transport.origin + ticks[transport.tickPtr].time < horizon) {
        var tk = ticks[transport.tickPtr];
        if (state.metronome && (tk.kind !== 'sub' || state.subClick)) {
          playClick(tk.kind, transport.origin + tk.time);
        }
        transport.tickPtr++;
      }
      var eventsDone = transport.eventPtr >= sch.length || sch[transport.eventPtr].startTime >= endT - 1e-9;
      var ticksDone = transport.tickPtr >= ticks.length || ticks[transport.tickPtr].time >= endT - 1e-9;
      if (eventsDone && ticksDone && transport.origin + endT < horizon) {
        if (loop) {
          var applyAt = transport.origin + endT;
          transport.origin += (endT - loop.start);
          transport.pendingOrigins.push({ applyAt: applyAt, origin: transport.origin });
          transport.eventPtr = firstEventAtOrAfter(loop.start);
          transport.tickPtr = firstTickAtOrAfter(loop.start);
          continue;
        }
        transport.endAt = transport.origin + endT + 0.35;
        break;
      }
      break;
    }

    if (transport.endAt !== null && actx.currentTime >= transport.endAt) stop(true);
  }

  function pause() {
    if (transport.status !== 'playing') return;
    transport.pausedAt = actx.currentTime - transport.uiOrigin;
    clearInterval(transport.timer); transport.timer = null;
    stopAllVoices();
    transport.status = 'paused';
    syncTransportUi();
  }

  function stop(ended) {
    clearInterval(transport.timer); transport.timer = null;
    if (transport.raf) cancelAnimationFrame(transport.raf);
    transport.raf = null;
    stopAllVoices();
    transport.status = 'stopped';
    transport.pausedAt = 0;
    transport.endAt = null;
    transport.pendingOrigins = [];
    clearHighlights();
    updateReadout(null);
    $('nowPlaying').textContent = ended ? 'Finished' : 'Stopped';
    syncTransportUi();
  }

  function restart() {
    var wasPlaying = transport.status === 'playing';
    stop();
    state.selection.start = state.selection.start !== null ? state.selection.start : null;
    if (wasPlaying || true) play(0);
  }

  function syncTransportUi() {
    var playing = transport.status === 'playing';
    var btn = $('btnPlay');
    btn.textContent = playing ? '❚❚ Pause' : (transport.status === 'paused' ? '▶ Resume' : '▶ Play');
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('btnMetro').classList.toggle('on', state.metronome);
    $('btnMetro').setAttribute('aria-pressed', state.metronome ? 'true' : 'false');
  }

  /* ------------------------------------------------------------- UI updates */
  var lastActive = -1, lastPassageEl = null;

  function startUiLoop() {
    if (transport.raf) cancelAnimationFrame(transport.raf);
    var frame = function () {
      if (transport.status !== 'playing') return;
      while (transport.pendingOrigins.length && actx.currentTime >= transport.pendingOrigins[0].applyAt) {
        transport.uiOrigin = transport.pendingOrigins.shift().origin;
      }
      var songTime = actx.currentTime - transport.uiOrigin;
      updateFromTime(songTime);
      transport.raf = requestAnimationFrame(frame);
    };
    transport.raf = requestAnimationFrame(frame);
  }

  function updateFromTime(songTime) {
    var sch = schedule();
    if (songTime < 0) {
      $('nowPlaying').textContent = 'Count-in…';
      return;
    }
    var idx = -1;
    for (var i = 0; i < sch.length; i++) {
      if (sch[i].startTime <= songTime + 1e-6 && songTime < sch[i].startTime + sch[i].duration - 1e-9) { idx = i; break; }
      if (sch[i].startTime > songTime) break;
    }
    if (idx === -1 && sch.length) {
      for (var j = sch.length - 1; j >= 0; j--) { if (sch[j].startTime <= songTime) { idx = j; break; } }
    }
    if (idx !== lastActive) { highlight(idx); lastActive = idx; }
    updateReadout(idx, songTime);
  }

  function clearHighlights() {
    var nodes = document.querySelectorAll('.cell.active');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('active');
    lastActive = -1;
  }

  function highlight(idx) {
    clearHighlights();
    if (idx < 0) return;
    var cell = document.querySelector('.cell.swara[data-index="' + idx + '"]');
    if (!cell) return;
    cell.classList.add('active');
    var ev = schedule()[idx].event;
    if (ev.sahityaId) {
      var syl = document.querySelector('.cell.sahitya[data-token="' + ev.sahityaId + '"]');
      if (syl) syl.classList.add('active');
    }
    var container = cell.closest('.passage');
    if (container) {
      var target = cell.offsetLeft - container.clientWidth / 2 + cell.offsetWidth / 2;
      var smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      try { container.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' }); }
      catch (e) { container.scrollLeft = target; }
      if (container !== lastPassageEl) {
        lastPassageEl = container;
        var r = container.getBoundingClientRect();
        if (r.top < 60 || r.bottom > window.innerHeight - 110) {
          container.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
        }
      }
    }
  }

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function updateReadout(idx, songTime) {
    var box = $('readout');
    var sch = schedule();
    var total = timingInfo ? timingInfo.totalSeconds : 0;
    var s = idx !== null && idx >= 0 && sch[idx] ? sch[idx] : null;
    var ev = s ? s.event : null;
    var freq = ev && ev.semitone !== null ? E.frequencyOf(state.tonicHz, ev.semitone, ev.octave) : null;
    var octName = ev ? (ev.octave > 0 ? 'Upper' : ev.octave < 0 ? 'Lower' : 'Middle') : '—';
    var stats = [
      ['Section', ev && ev.section ? ev.section : '—'],
      ['Cycle', s ? (s.cycle + 1) : '—'],
      ['Beat', s ? (s.beatInCycle + 1) + '/' + state.beatsPerCycle : '—'],
      ['Subdivision', s ? (Math.floor(s.subdivision) + 1) + '/' + state.subdivisionsPerBeat : '—'],
      ['Swara', ev ? E.displaySwara(ev) + ' → ' + ev.resolvedSwara : '—'],
      ['Octave', octName],
      ['Frequency', freq ? freq.toFixed(2) + ' Hz' : '—'],
      ['Elapsed', fmtTime(songTime || 0) + ' / ' + fmtTime(total)]
    ];
    box.innerHTML = stats.map(function (p) {
      return '<div class="stat"><b>' + p[0] + '</b><span>' + escapeHtml(String(p[1])) + '</span></div>';
    }).join('');
    var pct = total > 0 ? Math.max(0, Math.min(100, ((songTime || 0) / total) * 100)) : 0;
    $('progressBar').style.width = pct + '%';
    if (ev) $('nowPlaying').textContent = E.displaySwara(ev) + '  ' + (ev.sahitya || '');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* ------------------------------------------------------------- rendering */
  var UNIT = 48;   // px per note-space

  function renderScore() {
    var host = $('score');
    host.innerHTML = '';
    if (!parsed || !parsed.rows.length) {
      host.innerHTML = '<p class="note">No notation yet. Open the Notation tab and paste or upload a song.</p>';
      return;
    }
    var globalIndex = {};
    parsed.events.forEach(function (e, i) { globalIndex[e.id] = i; });
    var loop = state.selection.start !== null && state.selection.end !== null
      ? { a: Math.min(state.selection.start, state.selection.end), b: Math.max(state.selection.start, state.selection.end) } : null;

    parsed.rows.forEach(function (row) {
      if (row.type === 'section') {
        var h = document.createElement('div');
        h.className = 'passage-label';
        h.textContent = row.name;
        host.appendChild(h);
        return;
      }
      if (row.type === 'text') {
        if (row.role === 'meta') return;      // [TITLE: …] is shown in the header
        var p = document.createElement('div');
        p.className = 'plain-line';
        p.textContent = row.text;
        host.appendChild(p);
        return;
      }

      // passage
      var columns = [];
      row.events.forEach(function (e) { columns.push({ kind: 'event', at: e.sourceStartColumn, event: e }); });
      row.marks.forEach(function (m) { columns.push({ kind: 'bar', at: m.column, mark: m }); });
      columns.sort(function (a, b) { return a.at - b.at; });

      var tokenByEvent = {};
      row.sahityaTokens.forEach(function (t) { if (t.anchorEventId) tokenByEvent[t.anchorEventId] = t; });

      var wrapEl = document.createElement('div');
      wrapEl.className = 'passage';
      var inner = document.createElement('div');
      inner.className = 'passage-inner';
      var swaraLine = document.createElement('div');
      swaraLine.className = 'line-swara';
      var sahityaLine = document.createElement('div');
      sahityaLine.className = 'line-sahitya';

      /* Source line numbers, pinned to the left while the passage scrolls. */
      var lineErrors = messagesByLine();
      var swaraNo = document.createElement('div');
      swaraNo.className = 'cell lineno' + (lineErrors[row.swaraLine] ? ' has-error' : '');
      swaraNo.textContent = String(row.swaraLine + 1);
      swaraNo.title = 'Swara row — line ' + (row.swaraLine + 1) + ' of the notation';
      swaraLine.appendChild(swaraNo);
      var sahityaNo = document.createElement('div');
      sahityaNo.className = 'cell lineno';
      sahityaNo.textContent = row.sahityaLine === null ? '' : String(row.sahityaLine + 1);
      if (row.sahityaLine !== null) sahityaNo.title = 'Sahitya row — line ' + (row.sahityaLine + 1);
      sahityaLine.appendChild(sahityaNo);

      var groups = [];       // sahitya grouping mirroring the columns
      var current = null;

      columns.forEach(function (col) {
        var width;
        if (col.kind === 'bar') {
          var bar = document.createElement('div');
          bar.className = 'cell bar';
          bar.textContent = col.mark.type === 'doublebar' ? '‖' : '|';
          width = 14;
          swaraLine.appendChild(bar);
        } else {
          var e = col.event;
          var gi = globalIndex[e.id];
          var cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'cell swara' + (e.insideSpeedGroup ? ' speed' : '') +
            (e.valid ? (e.warning ? ' warned' : '') : ' invalid');
          if (e.error || e.warning) cell.title = (e.error || e.warning) + ' (line ' + (e.sourceLine + 1) + ')';
          if (state.selection.start === gi) cell.classList.add('sel-start');
          if (state.selection.end === gi) cell.classList.add('sel-end');
          if (loop && gi >= loop.a && gi <= loop.b) cell.classList.add('in-loop');
          cell.dataset.index = gi;
          cell.textContent = E.displaySwara(e) + (e.commaCount ? ','.repeat(e.commaCount) : '');
          width = Math.max(30, e.durationInSpaces * UNIT);
          cell.style.width = width + 'px';
          if (e.insideSpeedGroup) cell.style.fontSize = '0.92rem';
          cell.setAttribute('aria-label',
            'Swara ' + e.resolvedSwara + (e.octave ? (e.octave > 0 ? ' upper octave' : ' lower octave') : '') +
            ', ' + e.durationInSpaces + ' note-spaces' + (e.sahitya ? ', syllable ' + e.sahitya : '') +
            (e.error ? '. Error: ' + e.error : '') + '. Line ' + (e.sourceLine + 1) + '. Tap to play from here.');
          swaraLine.appendChild(cell);
          if (tokenByEvent[e.id]) current = tokenByEvent[e.id];
        }
        var owner = current;
        if (groups.length && groups[groups.length - 1].token === owner) groups[groups.length - 1].width += width;
        else groups.push({ token: owner, width: width });
      });

      var seen = {};
      groups.forEach(function (g) {
        var cell = document.createElement('div');
        cell.className = 'cell sahitya';
        cell.style.width = g.width + 'px';
        if (g.token && !seen[g.token.id]) {
          cell.textContent = g.token.text;
          cell.dataset.token = g.token.id;
          seen[g.token.id] = true;
          cell.tabIndex = 0;
          cell.setAttribute('role', 'button');
          cell.setAttribute('aria-label', 'Syllable ' + g.token.text + '. Select to relink it to a swara.');
        } else {
          cell.innerHTML = '&nbsp;';
        }
        sahityaLine.appendChild(cell);
      });

      inner.appendChild(swaraLine);
      if (row.sahityaTokens.length) inner.appendChild(sahityaLine);
      wrapEl.appendChild(inner);
      host.appendChild(wrapEl);
    });
  }

  /* ------------------------------------------------- editor gutter + marks */
  function messagesByLine() {
    var byLine = {};
    function add(m, kind) {
      if (!byLine[m.line]) byLine[m.line] = [];
      byLine[m.line].push({
        column: m.column,
        endColumn: m.endColumn || m.column + 1,
        message: m.message,
        kind: kind
      });
    }
    if (parsed) {
      parsed.errors.forEach(function (m) { add(m, 'err'); });
      parsed.warnings.forEach(function (m) { add(m, 'warn'); });
    }
    Object.keys(byLine).forEach(function (k) {
      byLine[k].sort(function (a, b) { return a.column - b.column; });
    });
    return byLine;
  }

  function renderEditorDecorations() {
    var lines = state.source.split('\n');
    var byLine = messagesByLine();

    // line numbers, marked where the parser found something
    var gutter = $('editorGutter');
    gutter.innerHTML = '';
    lines.forEach(function (text, i) {
      var b = document.createElement('b');
      b.textContent = String(i + 1);
      var ms = byLine[i];
      if (ms) {
        b.className = ms.some(function (m) { return m.kind === 'err'; }) ? 'has-error' : 'has-warning';
        b.title = ms.map(function (m) { return m.message; }).join('\n');
      }
      b.addEventListener('click', function () { selectRange(i, 0, text.length); });
      gutter.appendChild(b);
    });

    // shaded ranges under the text
    var html = lines.map(function (text, i) {
      var ms = byLine[i];
      if (!ms || !ms.length) return escapeHtml(text);
      var out = '', cursor = 0;
      ms.forEach(function (m) {
        var from = Math.max(m.column, cursor);
        var to = Math.max(m.endColumn, from + 1);
        if (from < cursor) return;
        out += escapeHtml(text.slice(cursor, from));
        var slice = text.slice(from, to);
        if (!slice) slice = ' ';                       // mark past the end of the line
        out += '<mark class="' + m.kind + '">' + escapeHtml(slice) + '</mark>';
        cursor = from + slice.length;
      });
      out += escapeHtml(text.slice(cursor));
      return out;
    }).join('\n');
    $('editorHighlight').innerHTML = html + '\n';
    syncEditorScroll();
  }

  function syncEditorScroll() {
    var ta = $('editor');
    $('editorHighlight').scrollTop = ta.scrollTop;
    $('editorHighlight').scrollLeft = ta.scrollLeft;
    $('editorGutter').scrollTop = ta.scrollTop;
  }

  function offsetOf(line, column) {
    var lines = state.source.split('\n');
    var at = 0;
    for (var i = 0; i < line && i < lines.length; i++) at += lines[i].length + 1;
    return at + Math.min(column, (lines[line] || '').length);
  }

  /* Put the caret on a problem and show it, from anywhere in the app. */
  function selectRange(line, column, endColumn) {
    setTab('edit');
    var ta = $('editor');
    var from = offsetOf(line, column);
    var to = offsetOf(line, endColumn === undefined ? column + 1 : endColumn);
    ta.focus();
    try { ta.setSelectionRange(from, to); } catch (e) {}
    // bring the line into view: scroll by line height
    var lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 26;
    var target = Math.max(0, (line * lineHeight) - ta.clientHeight / 2);
    ta.scrollTop = target;
    syncEditorScroll();
  }

  function renderMessages() {
    var items = [];
    function locator(m, kind) {
      return '<li class="' + kind + ' clickable" role="button" tabindex="0" data-line="' + m.line +
        '" data-col="' + m.column + '" data-end="' + (m.endColumn || m.column + 1) + '" ' +
        'title="Go to this line"><span class="pos">line ' + (m.line + 1) + ', col ' + (m.column + 1) +
        '</span> — ' + escapeHtml(m.message) + '</li>';
    }
    if (parsed) {
      parsed.errors.forEach(function (e) { items.push(locator(e, 'err')); });
      parsed.warnings.forEach(function (w) { items.push(locator(w, 'warn')); });
      if (timingInfo && timingInfo.cycleRemainder > 1e-9 && state.loopMode !== 'off') {
        items.push('<li class="warn">The notation is ' + parsed.totalSpaces + ' note-spaces, which does not divide evenly into cycles of ' +
          timingInfo.spacesPerCycle + '. Looping will start the next cycle mid-avarta.</li>');
      } else if (timingInfo && timingInfo.cycleRemainder > 1e-9) {
        items.push('<li class="warn">' + parsed.totalSpaces + ' note-spaces do not fill whole cycles of ' + timingInfo.spacesPerCycle +
          ' (' + timingInfo.cycleRemainder + ' left over).</li>');
      }
      if (!items.length && parsed.events.length) {
        items.push('<li class="ok">' + parsed.events.length + ' swaras · ' + parsed.totalSpaces + ' note-spaces · ' +
          fmtTime(timingInfo.totalSeconds) + ' at ' + state.bpm + ' BPM</li>');
      }
      if (parsed.errors.length) {
        items.push('<li class="warn">Playback is blocked. <button class="btn small" id="btnIgnore" type="button">' +
          (state.ignoreErrors ? 'Stop ignoring errors' : 'Play anyway (skip invalid swaras)') + '</button></li>');
      }
    }
    var html = items.length ? '<ul class="messages">' + items.join('') + '</ul>' : '';
    $('messages').innerHTML = html;
    $('editMessages').innerHTML = html;
    var ig = document.querySelectorAll('#btnIgnore');
    for (var i = 0; i < ig.length; i++) {
      ig[i].addEventListener('click', function (ev) {
        ev.stopPropagation();
        state.ignoreErrors = !state.ignoreErrors;
        rebuild();
      });
    }
    var jump = document.querySelectorAll('ul.messages li.clickable');
    for (var j = 0; j < jump.length; j++) {
      var go = function (ev) {
        var li = ev.currentTarget;
        selectRange(parseInt(li.dataset.line, 10), parseInt(li.dataset.col, 10), parseInt(li.dataset.end, 10));
      };
      jump[j].addEventListener('click', go);
      jump[j].addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(ev); }
      });
    }
  }

  function renderReview() {
    var card = $('reviewCard');
    if (!parsed || !parsed.needsReview) { card.hidden = true; return; }
    card.hidden = false;
    var host = $('reviewRows');
    host.innerHTML = '';
    parsed.lines.forEach(function (line) {
      if (line.role === 'blank' || line.text.trim() === '') return;
      var wrapEl = document.createElement('div');
      wrapEl.className = 'row';
      wrapEl.style.borderBottom = '1px solid var(--line)';
      wrapEl.style.padding = '6px 0';
      var sel = document.createElement('select');
      ['swara', 'sahitya', 'comment'].forEach(function (r) {
        var o = document.createElement('option');
        o.value = r; o.textContent = r.charAt(0).toUpperCase() + r.slice(1);
        if (line.role === r) o.selected = true;
        sel.appendChild(o);
      });
      sel.setAttribute('aria-label', 'Role for line ' + (line.index + 1));
      sel.style.minHeight = '40px';
      sel.addEventListener('change', function () {
        state.roleOverrides[line.index] = sel.value;
        rebuild();
      });
      var no = document.createElement('div');
      no.className = 'review-line';
      no.textContent = String(line.index + 1);
      var pre = document.createElement('div');
      pre.className = 'plain-line';
      pre.style.flex = '1 1 auto';
      pre.style.overflowX = 'auto';
      pre.textContent = line.text;
      wrapEl.appendChild(no);
      wrapEl.appendChild(sel);
      wrapEl.appendChild(pre);
      host.appendChild(wrapEl);
    });
  }

  /* ------------------------------------------------------------- rebuilding */
  function rebuild() {
    var selectedSwaras = state.ragaSwaras && state.ragaSwaras.length ? state.ragaSwaras : null;
    parsed = E.parse(state.source, {
      raga: state.raga,
      positions: state.positions,
      ragaSwaras: selectedSwaras,
      ragaDefaults: state.ragaDefaults,
      sahityaLinks: state.sahityaLinks,
      roleOverrides: state.roleOverrides
    });
    timingInfo = E.timing(parsed, {
      bpm: state.bpm,
      subdivisionsPerBeat: state.subdivisionsPerBeat,
      beatsPerCycle: state.beatsPerCycle
    });
    buildTicks();
    if (parsed.title && !state.titleTouched) { state.title = parsed.title; $('songTitle').value = parsed.title; }
    renderScore();
    renderMessages();
    renderEditorDecorations();
    renderReview();
    updateReadout(null);
    saveLocal();
  }

  /* ------------------------------------------------------------- flash msgs */
  function flash(msg, kind) {
    var el = document.createElement('div');
    el.className = 'card';
    el.style.borderColor = kind === 'err' ? 'var(--err)' : 'var(--warn)';
    el.style.background = kind === 'err' ? 'var(--err-soft)' : 'var(--warn-soft)';
    el.style.marginTop = '10px';
    el.textContent = msg;
    $('messages').prepend(el);
    setTimeout(function () { el.remove(); }, 6000);
  }

  /* ------------------------------------------------------------------ files */
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function downloadText() {
    var text = state.source;
    var blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, E.safeFilename(state.title));
  }

  function projectJson() {
    return {
      format: 'carnatic-swara-player',
      version: 1,
      savedAt: new Date().toISOString(),
      title: state.title,
      source: state.source,
      settings: {
        bpm: state.bpm, subdivisionsPerBeat: state.subdivisionsPerBeat, beatsPerCycle: state.beatsPerCycle,
        beatGroups: state.beatGroups, talaPreset: state.talaPreset, metronome: state.metronome,
        subClick: state.subClick, countIn: state.countIn, loopMode: state.loopMode,
        tonicKey: state.tonicKey, tonicOctave: state.tonicOctave, tonicHz: state.tonicHz,
        raga: state.raga, positions: state.positions, ragaSwaras: state.ragaSwaras,
        ragaDefaults: state.ragaDefaults, customRagas: state.customRagas,
        volMaster: state.volMaster, volPiano: state.volPiano, volClick: state.volClick
      },
      sahityaLinks: state.sahityaLinks,
      roleOverrides: state.roleOverrides,
      selection: state.selection,
      events: parsed ? parsed.events : [],
      sahityaTokens: parsed ? parsed.sahityaTokens : [],
      sections: parsed ? parsed.sections : []
    };
  }

  function saveProject() {
    var blob = new Blob([JSON.stringify(projectJson(), null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, E.safeFilename(state.title).replace(/\.txt$/, '') + '.json');
  }

  function loadProject(obj) {
    if (!obj || obj.format !== 'carnatic-swara-player') { flash('That file is not a Carnatic Swara Player project.', 'err'); return; }
    state.title = obj.title || '';
    state.source = obj.source || '';
    var s = obj.settings || {};
    Object.keys(s).forEach(function (k) { if (s[k] !== undefined && s[k] !== null) state[k] = s[k]; });
    state.sahityaLinks = obj.sahityaLinks || {};
    state.roleOverrides = obj.roleOverrides || {};
    state.selection = obj.selection || { start: null, end: null };
    state.customRagas = state.customRagas || {};
    state.ragaDefaults = state.ragaDefaults || {};
    registerCustomRagas();
    state.titleTouched = true;
    syncControlsFromState();
    rebuild();
    flash('Project loaded.', 'ok');
  }

  /* ---------------------------------------------------------- local storage */
  var LS_KEY = 'carnatic-swara-player-v1';
  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(projectJson())); } catch (e) {}
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      var obj = JSON.parse(raw);
      if (!obj || !obj.source) return false;
      state.title = obj.title || state.title;
      state.source = obj.source;
      var s = obj.settings || {};
      Object.keys(s).forEach(function (k) { if (s[k] !== undefined && s[k] !== null) state[k] = s[k]; });
      state.sahityaLinks = obj.sahityaLinks || {};
      state.roleOverrides = obj.roleOverrides || {};
      state.customRagas = state.customRagas || {};
      state.ragaDefaults = state.ragaDefaults || {};
      registerCustomRagas();
      state.titleTouched = true;
      return true;
    } catch (e) { return false; }
  }

  /* ---------------------------------------------------------------- controls */
  function setTab(name) {
    ['play', 'edit', 'settings', 'help'].forEach(function (t) {
      $('tab-' + t).setAttribute('aria-selected', t === name ? 'true' : 'false');
      $('panel-' + t).hidden = (t !== name);
    });
  }

  function populateSelects() {
    var tala = $('talaPreset');
    Object.keys(E.TALAS).forEach(function (name) {
      var o = document.createElement('option'); o.value = name; o.textContent = name; tala.appendChild(o);
    });
    var custom = document.createElement('option'); custom.value = 'Custom'; custom.textContent = 'Custom'; tala.appendChild(custom);

    var key = $('tonicKey');
    Object.keys(E.KEY_SEMITONES).forEach(function (k) {
      var o = document.createElement('option'); o.value = k; o.textContent = k; key.appendChild(o);
    });
    var cu = document.createElement('option'); cu.value = 'Custom'; cu.textContent = 'Custom (Hz)'; key.appendChild(cu);

    var oct = $('tonicOctave');
    [2, 3, 4, 5].forEach(function (n) {
      var o = document.createElement('option'); o.value = String(n); o.textContent = String(n); oct.appendChild(o);
    });
  }

  function activeSwaras() {
    if (state.ragaSwaras && state.ragaSwaras.length) return state.ragaSwaras;
    return E.RAGAS[state.raga] ? E.RAGAS[state.raga].swaras : E.ALL_SWARA_NAMES;
  }

  function effectiveDefaults() {
    var preset = (E.RAGAS[state.raga] && E.RAGAS[state.raga].defaults) || {};
    return Object.assign({}, preset, state.ragaDefaults || {});
  }

  function renderRagaTable() {
    var body = $('ragaTable');
    body.innerHTML = '';
    var active = activeSwaras();
    var defaults = effectiveDefaults();
    var countByLetter = {};
    active.forEach(function (n) { countByLetter[n.charAt(0)] = (countByLetter[n.charAt(0)] || 0) + 1; });
    E.ALL_SWARA_NAMES.forEach(function (name) {
      var tr = document.createElement('tr');
      var tdUse = document.createElement('td');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = active.indexOf(name) !== -1;
      cb.setAttribute('aria-label', 'Include ' + name + ' in the raga');
      cb.addEventListener('change', function () {
        var set = (state.ragaSwaras && state.ragaSwaras.length ? state.ragaSwaras.slice() : active.slice());
        var at = set.indexOf(name);
        if (cb.checked && at === -1) set.push(name);
        if (!cb.checked && at !== -1) set.splice(at, 1);
        set.sort(function (a, b) { return E.ALL_SWARA_NAMES.indexOf(a) - E.ALL_SWARA_NAMES.indexOf(b); });
        state.ragaSwaras = set;
        rebuild();
        renderRagaTable();
        renderRagaScale();
      });
      tdUse.appendChild(cb);
      var tdName = document.createElement('td');
      tdName.textContent = name;
      var tdPos = document.createElement('td');
      var num = document.createElement('input');
      num.type = 'number'; num.min = '-12'; num.max = '24'; num.step = '1';
      num.value = state.positions[name];
      num.setAttribute('aria-label', 'Semitones above Sa for ' + name);
      num.addEventListener('change', function () {
        var v = parseFloat(num.value);
        if (isFinite(v)) { state.positions[name] = v; rebuild(); }
      });
      tdPos.appendChild(num);

      var tdBare = document.createElement('td');
      var letter = name.charAt(0);
      if (countByLetter[letter] > 1 && active.indexOf(name) !== -1) {
        var radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'bare-' + letter;
        radio.style.width = '20px'; radio.style.height = '20px';
        radio.checked = defaults[letter] === name;
        radio.setAttribute('aria-label', 'A bare ' + letter + ' means ' + name);
        radio.addEventListener('change', function () {
          state.ragaDefaults[letter] = name;
          rebuild(); renderRagaScale();
        });
        tdBare.appendChild(radio);
      } else {
        tdBare.textContent = (countByLetter[letter] === 1 && active.indexOf(name) !== -1) ? letter : '';
        tdBare.style.color = 'var(--ink-soft)';
      }

      tr.appendChild(tdUse); tr.appendChild(tdName); tr.appendChild(tdPos); tr.appendChild(tdBare);
      body.appendChild(tr);
    });
  }

  function refreshRagaOptions(select) {
    var sel = $('raga');
    sel.innerHTML = '';
    Object.keys(E.RAGAS).forEach(function (name) {
      var o = document.createElement('option');
      o.value = name;
      o.textContent = name + (E.RAGAS[name].custom ? ' (yours)' : '');
      sel.appendChild(o);
    });
    sel.value = E.RAGAS[select || state.raga] ? (select || state.raga) : 'Chromatic (all swaras)';
    state.raga = sel.value;
    $('btnDeleteRaga').disabled = !(E.RAGAS[state.raga] && E.RAGAS[state.raga].custom);
  }

  function registerCustomRagas() {
    Object.keys(state.customRagas || {}).forEach(function (name) {
      E.registerRaga(name, state.customRagas[name]);
    });
  }

  function renderRagaScale() {
    var r = E.RAGAS[state.raga];
    var active = activeSwaras();
    var txt = 'Swaras in use: ' + active.join('  ');
    if (r && r.arohana) txt += '  ·  Arohana ' + r.arohana + '  ·  Avarohana ' + r.avarohana;
    var defs = effectiveDefaults();
    var pairs = Object.keys(defs).filter(function (k) { return active.indexOf(defs[k]) !== -1; })
      .map(function (k) { return k + ' = ' + defs[k]; });
    if (pairs.length) txt += '  ·  Bare letters: ' + pairs.join(', ');
    $('ragaScale').textContent = txt;
  }

  function syncControlsFromState() {
    $('songTitle').value = state.title;
    $('editor').value = state.source;
    $('bpm').value = state.bpm;
    $('bpmRange').value = state.bpm;
    $('bpmMini').value = state.bpm;
    $('talaPreset').value = E.TALAS[state.talaPreset] ? state.talaPreset : 'Custom';
    $('beatsPerCycle').value = state.beatsPerCycle;
    $('subdivisions').value = state.subdivisionsPerBeat;
    $('beatGroups').value = state.beatGroups.join('+');
    $('loopMode').value = state.loopMode;
    $('metronome').checked = state.metronome;
    $('subClick').checked = state.subClick;
    $('countIn').checked = state.countIn;
    $('tonicKey').value = state.tonicKey;
    $('tonicOctave').value = String(state.tonicOctave);
    $('tonicHz').value = Number(state.tonicHz).toFixed(2);
    refreshRagaOptions(state.raga);
    $('volMaster').value = state.volMaster;
    $('volPiano').value = state.volPiano;
    $('volClick').value = state.volClick;
    renderRagaTable();
    renderRagaScale();
    syncTransportUi();
  }

  function setBpm(v) {
    v = Math.max(20, Math.min(300, Math.round(v || 60)));
    state.bpm = v;
    $('bpm').value = v; $('bpmRange').value = v; $('bpmMini').value = v;
    var wasPlaying = transport.status === 'playing';
    var at = wasPlaying ? (actx.currentTime - transport.uiOrigin) : null;
    rebuild();
    if (wasPlaying) {
      var idx = firstEventAtOrAfter(at);
      pause(); transport.status = 'stopped';
      play(Math.max(0, Math.min(idx, schedule().length - 1)));
    }
  }

  function wire() {
    ['play', 'edit', 'settings', 'help'].forEach(function (t) {
      $('tab-' + t).addEventListener('click', function () { setTab(t); });
    });

    $('btnFiles').addEventListener('click', function () {
      var open = $('topActions').classList.toggle('open');
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    $('songTitle').addEventListener('input', function () { state.title = this.value; state.titleTouched = true; saveLocal(); });

    var editTimer = null;
    $('editor').addEventListener('input', function () {
      state.source = this.value;
      state.roleOverrides = {};
      renderEditorDecorations();          // keep the gutter in step with typing
      clearTimeout(editTimer);
      editTimer = setTimeout(rebuild, 180);
    });
    $('editor').addEventListener('scroll', syncEditorScroll);
    window.addEventListener('resize', syncEditorScroll);

    $('btnSample').addEventListener('click', function () {
      state.source = SAMPLE; state.raga = 'Hindolam'; state.talaPreset = 'Rupaka (3)';
      state.beatsPerCycle = 3; state.subdivisionsPerBeat = 4; state.beatGroups = [1, 2];
      state.ragaSwaras = null; state.ragaDefaults = {}; state.sahityaLinks = {}; state.roleOverrides = {};
      state.titleTouched = false;
      syncControlsFromState(); rebuild(); setTab('play');
    });
    $('btnClear').addEventListener('click', function () {
      state.source = ''; state.sahityaLinks = {}; state.roleOverrides = {};
      $('editor').value = ''; rebuild();
    });

    // transport
    $('btnPlay').addEventListener('click', function () {
      if (transport.status === 'playing') pause(); else play();
    });
    $('btnStop').addEventListener('click', function () { stop(); });
    $('btnRestart').addEventListener('click', function () { stop(); play(0); });
    $('btnMetro').addEventListener('click', function () {
      state.metronome = !state.metronome;
      $('metronome').checked = state.metronome;
      syncTransportUi(); saveLocal();
    });
    $('bpmMini').addEventListener('change', function () { setBpm(parseInt(this.value, 10)); });

    // settings
    $('bpm').addEventListener('change', function () { setBpm(parseInt(this.value, 10)); });
    $('bpmRange').addEventListener('input', function () { setBpm(parseInt(this.value, 10)); });
    $('talaPreset').addEventListener('change', function () {
      var t = E.TALAS[this.value];
      state.talaPreset = this.value;
      if (t) {
        state.beatGroups = t.groups.slice();
        state.beatsPerCycle = t.groups.reduce(function (a, b) { return a + b; }, 0);
        state.subdivisionsPerBeat = t.subdivisions;
        $('beatsPerCycle').value = state.beatsPerCycle;
        $('subdivisions').value = state.subdivisionsPerBeat;
        $('beatGroups').value = state.beatGroups.join('+');
      }
      rebuild();
    });
    $('beatsPerCycle').addEventListener('change', function () {
      state.beatsPerCycle = Math.max(1, parseInt(this.value, 10) || 1);
      state.talaPreset = 'Custom'; $('talaPreset').value = 'Custom';
      rebuild();
    });
    $('subdivisions').addEventListener('change', function () {
      state.subdivisionsPerBeat = Math.max(1, parseInt(this.value, 10) || 1);
      state.talaPreset = 'Custom'; $('talaPreset').value = 'Custom';
      rebuild();
    });
    $('beatGroups').addEventListener('change', function () {
      var parts = this.value.split(/[+,\s]+/).map(function (p) { return parseInt(p, 10); }).filter(function (n) { return n > 0; });
      if (parts.length) {
        state.beatGroups = parts;
        state.beatsPerCycle = parts.reduce(function (a, b) { return a + b; }, 0);
        $('beatsPerCycle').value = state.beatsPerCycle;
        state.talaPreset = 'Custom'; $('talaPreset').value = 'Custom';
      }
      rebuild();
    });
    $('loopMode').addEventListener('change', function () { state.loopMode = this.value; saveLocal(); renderMessages(); });
    $('metronome').addEventListener('change', function () { state.metronome = this.checked; syncTransportUi(); saveLocal(); });
    $('subClick').addEventListener('change', function () { state.subClick = this.checked; saveLocal(); });
    $('countIn').addEventListener('change', function () { state.countIn = this.checked; saveLocal(); });

    function updateTonicFromKey() {
      if (state.tonicKey === 'Custom') return;
      state.tonicHz = E.keyToFrequency(state.tonicKey, state.tonicOctave);
      $('tonicHz').value = state.tonicHz.toFixed(2);
      saveLocal();
    }
    $('tonicKey').addEventListener('change', function () { state.tonicKey = this.value; updateTonicFromKey(); });
    $('tonicOctave').addEventListener('change', function () { state.tonicOctave = parseInt(this.value, 10); updateTonicFromKey(); });
    $('tonicHz').addEventListener('change', function () {
      var v = parseFloat(this.value);
      if (isFinite(v) && v > 20) { state.tonicHz = v; state.tonicKey = 'Custom'; $('tonicKey').value = 'Custom'; saveLocal(); }
    });
    $('raga').addEventListener('change', function () {
      state.raga = this.value; state.ragaSwaras = null; state.ragaDefaults = {};
      $('btnDeleteRaga').disabled = !(E.RAGAS[state.raga] && E.RAGAS[state.raga].custom);
      $('ragaSaveNote').textContent = '';
      renderRagaTable(); renderRagaScale(); rebuild();
    });
    $('btnResetRaga').addEventListener('click', function () {
      state.ragaSwaras = null;
      state.ragaDefaults = {};
      state.positions = Object.assign({}, E.DEFAULT_POSITIONS);
      renderRagaTable(); renderRagaScale(); rebuild();
      $('ragaSaveNote').textContent = 'Back to the preset for ' + state.raga + '.';
    });

    $('btnSaveRaga').addEventListener('click', function () {
      var name = ($('newRagaName').value || '').trim();
      if (!name) { $('ragaSaveNote').textContent = 'Give the raga a name first.'; $('newRagaName').focus(); return; }
      if (E.RAGAS[name] && !E.RAGAS[name].custom) {
        $('ragaSaveNote').textContent = '"' + name + '" is a built-in raga. Choose another name.';
        return;
      }
      var swaras = activeSwaras().slice();
      if (swaras.indexOf('S') === -1) swaras.unshift('S');
      var defs = {};
      var defaults = effectiveDefaults();
      Object.keys(defaults).forEach(function (k) { if (swaras.indexOf(defaults[k]) !== -1) defs[k] = defaults[k]; });
      var def = { swaras: swaras, defaults: Object.keys(defs).length ? defs : null };
      E.registerRaga(name, def);
      state.customRagas[name] = def;
      state.raga = name;
      state.ragaSwaras = null;
      state.ragaDefaults = {};
      $('newRagaName').value = '';
      refreshRagaOptions(name);
      renderRagaTable(); renderRagaScale(); rebuild();
      $('ragaSaveNote').textContent = 'Saved "' + name + '" — ' + swaras.join(' ') +
        '. It stays in this browser and travels inside Save Project.';
    });

    $('btnDeleteRaga').addEventListener('click', function () {
      var name = state.raga;
      if (!E.RAGAS[name] || !E.RAGAS[name].custom) return;
      E.unregisterRaga(name);
      delete state.customRagas[name];
      state.raga = 'Chromatic (all swaras)';
      state.ragaSwaras = null; state.ragaDefaults = {};
      refreshRagaOptions(state.raga);
      renderRagaTable(); renderRagaScale(); rebuild();
      $('ragaSaveNote').textContent = 'Deleted "' + name + '".';
    });

    $('volMaster').addEventListener('input', function () { state.volMaster = parseFloat(this.value); applyVolumes(); saveLocal(); });
    $('volPiano').addEventListener('input', function () { state.volPiano = parseFloat(this.value); applyVolumes(); saveLocal(); });
    $('volClick').addEventListener('input', function () { state.volClick = parseFloat(this.value); applyVolumes(); saveLocal(); });

    // files
    $('btnDownloadText').addEventListener('click', downloadText);
    $('btnSaveJson').addEventListener('click', saveProject);
    $('btnUpload').addEventListener('click', function () { $('fileText').click(); });
    $('btnLoadJson').addEventListener('click', function () { $('fileJson').click(); });
    $('fileText').addEventListener('change', function () {
      var f = this.files && this.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        state.source = String(reader.result).replace(/^﻿/, '');
        state.roleOverrides = {}; state.sahityaLinks = {};
        state.title = f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
        state.titleTouched = false;
        $('editor').value = state.source;
        rebuild();
        setTab(parsed && parsed.needsReview ? 'edit' : 'play');
      };
      reader.readAsText(f, 'utf-8');
      this.value = '';
    });
    $('fileJson').addEventListener('change', function () {
      var f = this.files && this.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try { loadProject(JSON.parse(String(reader.result))); }
        catch (e) { flash('That JSON could not be read.', 'err'); }
      };
      reader.readAsText(f, 'utf-8');
      this.value = '';
    });

    $('btnTheme').addEventListener('click', function () {
      var root = document.documentElement;
      var now = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', now);
      try { localStorage.setItem('csp-theme', now); } catch (e) {}
    });

    // score interaction
    $('score').addEventListener('click', function (ev) {
      var swara = ev.target.closest ? ev.target.closest('.cell.swara') : null;
      var syl = ev.target.closest ? ev.target.closest('.cell.sahitya[data-token]') : null;

      if (syl && linkPick === null && $('btnLinkMode').getAttribute('aria-pressed') === 'true') {
        linkPick = syl.dataset.token;
        var picks = document.querySelectorAll('.cell.sahitya.picking');
        for (var i = 0; i < picks.length; i++) picks[i].classList.remove('picking');
        syl.classList.add('picking');
        return;
      }
      if (!swara) return;
      var idx = parseInt(swara.dataset.index, 10);
      var target = parsed.events[idx];
      if (target && !target.valid && linkPick === null && !ev.shiftKey) {
        // an unplayable swara: take the user to it in the editor instead
        selectRange(target.sourceLine, target.sourceStartColumn, target.sourceEndColumn);
        return;
      }

      if (linkPick !== null) {
        state.sahityaLinks[linkPick] = parsed.events[idx].id;
        linkPick = null;
        rebuild();
        return;
      }
      if (ev.shiftKey && state.selection.start !== null) {
        state.selection.end = idx;
        if (state.loopMode === 'off') { state.loopMode = 'selection'; $('loopMode').value = 'selection'; }
        renderScore(); renderMessages();
        return;
      }
      state.selection.start = idx;
      state.selection.end = null;
      renderScore();
      if (transport.status === 'playing') { stop(); play(idx); }
      else { stop(); play(idx); }
    });

    $('btnClearSelection').addEventListener('click', function () {
      state.selection = { start: null, end: null };
      if (state.loopMode === 'selection') { state.loopMode = 'off'; $('loopMode').value = 'off'; }
      renderScore();
    });
    $('btnLinkMode').addEventListener('click', function () {
      var on = this.getAttribute('aria-pressed') === 'true';
      this.setAttribute('aria-pressed', on ? 'false' : 'true');
      this.classList.toggle('on', !on);
      linkPick = null;
      var picks = document.querySelectorAll('.cell.sahitya.picking');
      for (var i = 0; i < picks.length; i++) picks[i].classList.remove('picking');
    });
    $('btnResetLinks').addEventListener('click', function () {
      state.sahityaLinks = {}; linkPick = null; rebuild();
    });

    // keyboard
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === ' ') { e.preventDefault(); if (transport.status === 'playing') pause(); else play(); }
      else if (e.key === 's' || e.key === 'S') { stop(); }
      else if (e.key === 'r' || e.key === 'R') { stop(); play(0); }
      else if (e.key === 'm' || e.key === 'M') { $('btnMetro').click(); }
      else if (e.key === 'ArrowLeft') { setBpm(state.bpm - 2); }
      else if (e.key === 'ArrowRight') { setBpm(state.bpm + 2); }
    });

    // keep playback position across orientation changes
    window.addEventListener('orientationchange', function () {
      setTimeout(function () { if (lastActive >= 0) highlight(lastActive); }, 250);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && transport.status === 'playing') pause();
    });
  }

  /* ------------------------------------------------------------------- init */
  function init() {
    try {
      var th = localStorage.getItem('csp-theme');
      if (th) document.documentElement.setAttribute('data-theme', th);
      else document.documentElement.removeAttribute('data-theme');
    } catch (e) {}
    if (window.matchMedia('(min-width: 681px)').matches) $('readoutBox').open = true;
    populateSelects();
    loadLocal();
    syncControlsFromState();
    wire();
    rebuild();
    setTab('play');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
