/* =========================================================
   Block Puzzle — script.js
   - 8x8 maydon, 3 ta blok, sudrab joylashtirish (sichqoncha / sensor)
   - To‘lgan qator va ustunlar yo‘qoladi, combo tizimi
   - Ovozlar Web Audio API orqali yaratiladi (tashqi fayl kerak emas)
   - Rekord va o‘yin holati localStorage da saqlanadi
   ========================================================= */
   (() => {
    'use strict';
  
    /* ---------------------------------------------------------
       1. Sozlamalar va ma'lumotlar
       --------------------------------------------------------- */
    const SIZE = 8;
    const KEYS = {
      best: 'blockpuzzle.best',
      sound: 'blockpuzzle.sound',
      save: 'blockpuzzle.save',
    };
    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  
    const COLORS = [
      { cls: 'c-red',    hex: '#ff5468' },
      { cls: 'c-orange', hex: '#ff9a2e' },
      { cls: 'c-yellow', hex: '#ffd83a' },
      { cls: 'c-green',  hex: '#4fd24a' },
      { cls: 'c-cyan',   hex: '#2ec4ec' },
      { cls: 'c-blue',   hex: '#5b83f2' },
      { cls: 'c-purple', hex: '#a566ee' },
      { cls: 'c-pink',   hex: '#f35bb4' },
    ];
    const HEX = Object.fromEntries(COLORS.map(c => [c.cls, c.hex]));
    const COLOR_CLASSES = new Set(COLORS.map(c => c.cls));
  
    // '#' = blok, '.' = bo‘sh
    const SHAPE_DEFS = [
      ['#'],
      ['##'], ['#', '#'],
      ['###'], ['#', '#', '#'],
      ['####'], ['#', '#', '#', '#'],
      ['#####'], ['#', '#', '#', '#', '#'],
      ['##', '##'],
      ['###', '###', '###'],
      ['##', '#.'], ['##', '.#'], ['#.', '##'], ['.#', '##'],
      ['#..', '#..', '###'], ['..#', '..#', '###'], ['###', '#..', '#..'], ['###', '..#', '..#'],
      ['#.', '#.', '##'], ['.#', '.#', '##'], ['##', '#.', '#.'], ['##', '.#', '.#'],
      ['###', '#..'], ['###', '..#'], ['#..', '###'], ['..#', '###'],
      ['.#.', '###'], ['###', '.#.'], ['#.', '##', '#.'], ['.#', '##', '.#'],
      ['.##', '##.'], ['##.', '.##'], ['#.', '##', '.#'], ['.#', '##', '#.'],
    ];
  
    const SHAPES = SHAPE_DEFS.map(def => {
      const cells = [];
      def.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') cells.push([r, c]); }));
      return { cells, h: def.length, w: def[0].length };
    });
  
    /* ---------------------------------------------------------
       2. Yordamchi funksiyalar
       --------------------------------------------------------- */
    const $ = id => document.getElementById(id);
  
    const store = {
      get(key, fallback) {
        try {
          const v = localStorage.getItem(key);
          return v === null ? fallback : JSON.parse(v);
        } catch { return fallback; }
      },
      set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
      },
      del(key) {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
      },
    };
  
    const buzz = ms => { if (navigator.vibrate) navigator.vibrate(ms); };
  
    /* ---------------------------------------------------------
       3. Ovoz (Web Audio API)
       --------------------------------------------------------- */
    const Sound = (() => {
      let ctx = null;
      let master = null;
      let noiseBuf = null;
      let on = store.get(KEYS.sound, true);
  
      // Pentatonik shkala (C major)
      const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0, 2093.0];
  
      function unlock() {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ctx = new AC();
          master = ctx.createGain();
          master.gain.value = 0.6;
          const comp = ctx.createDynamicsCompressor();
          master.connect(comp);
          comp.connect(ctx.destination);
  
          noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
          const data = noiseBuf.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
      }
  
      function tone({ f = 440, to = null, type = 'sine', t = 0, dur = 0.15, vol = 0.25, attack = 0.005 }) {
        if (!on || !ctx) return;
        const now = ctx.currentTime + t;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(f, now);
        if (to) osc.frequency.exponentialRampToValueAtTime(to, now + dur);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(vol, now + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + dur + 0.03);
      }
  
      function noise({ t = 0, dur = 0.1, vol = 0.2, from = 2000, to = 500, q = 1, type = 'lowpass' }) {
        if (!on || !ctx) return;
        const now = ctx.currentTime + t;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.Q.value = q;
        filter.frequency.setValueAtTime(from, now);
        filter.frequency.exponentialRampToValueAtTime(to, now + dur);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        src.start(now);
        src.stop(now + dur + 0.03);
      }
  
      return {
        unlock,
        isOn: () => on,
        setOn(v) { on = v; store.set(KEYS.sound, v); },
  
        pick() {
          tone({ f: 440, to: 700, type: 'sine', dur: 0.09, vol: 0.14 });
          tone({ f: 880, type: 'sine', t: 0.04, dur: 0.06, vol: 0.06 });
        },
        place() {
          tone({ f: 230, to: 105, type: 'triangle', dur: 0.15, vol: 0.38 });
          noise({ dur: 0.07, vol: 0.18, from: 1400, to: 300 });
        },
        invalid() {
          tone({ f: 170, to: 90, type: 'sawtooth', dur: 0.18, vol: 0.1 });
        },
        clear(lines, combo) {
          const steps = Math.min(3 + lines, 9);
          const shift = Math.min(combo - 1, 3);
          for (let i = 0; i < steps; i++) {
            const f = SCALE[Math.min(i + shift, SCALE.length - 1)];
            tone({ f, type: 'triangle', t: i * 0.06, dur: 0.38, vol: 0.2 });
            tone({ f: f * 2, type: 'sine', t: i * 0.06, dur: 0.26, vol: 0.07 });
          }
          noise({ dur: 0.38, vol: 0.13, from: 500, to: 7000, q: 2, type: 'bandpass' });
        },
        combo(level) {
          const base = Math.min(level, 6);
          [0, 2, 4].forEach((n, i) => {
            tone({ f: SCALE[Math.min(base + n, SCALE.length - 1)] * 2, type: 'sine', t: 0.22 + i * 0.07, dur: 0.3, vol: 0.12 });
          });
        },
        record() {
          [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => {
            tone({ f, type: 'triangle', t: i * 0.09, dur: 0.4, vol: 0.22 });
            tone({ f: f * 2, type: 'sine', t: i * 0.09, dur: 0.3, vol: 0.07 });
          });
        },
        gameOver() {
          [392, 349.23, 293.66, 261.63].forEach((f, i) => {
            tone({ f, to: f * 0.97, type: 'triangle', t: i * 0.2, dur: 0.45, vol: 0.24 });
          });
          tone({ f: 130.81, type: 'sine', t: 0.8, dur: 0.9, vol: 0.28 });
        },
        click() {
          tone({ f: 720, to: 520, type: 'sine', dur: 0.07, vol: 0.12 });
        },
      };
    })();
  
    /* ---------------------------------------------------------
       4. Zarrachalar (particles)
       --------------------------------------------------------- */
    const FX = (() => {
      const canvas = $('fx');
      const g = canvas.getContext('2d');
      let W = 0, H = 0, parts = [], raf = 0;
  
      function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
  
      function burst(x, y, hex, count = 8, power = 1) {
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = (2 + Math.random() * 5) * power;
          parts.push({
            x, y,
            vx: Math.cos(a) * s,
            vy: Math.sin(a) * s - 2,
            life: 1,
            decay: 0.017 + Math.random() * 0.02,
            size: 3 + Math.random() * 6,
            rot: Math.random() * 6,
            vr: (Math.random() - 0.5) * 0.4,
            hex,
          });
        }
        if (!raf) raf = requestAnimationFrame(loop);
      }
  
      function loop() {
        g.clearRect(0, 0, W, H);
        parts = parts.filter(p => p.life > 0);
        for (const p of parts) {
          p.vy += 0.22;
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.985;
          p.life -= p.decay;
          p.rot += p.vr;
          g.save();
          g.globalAlpha = Math.max(p.life, 0);
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillStyle = p.hex;
          g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          g.restore();
        }
        if (parts.length) {
          raf = requestAnimationFrame(loop);
        } else {
          raf = 0;
          g.clearRect(0, 0, W, H);
        }
      }
  
      window.addEventListener('resize', resize);
      resize();
      return { burst };
    })();
  
    /* ---------------------------------------------------------
       5. O‘yin holati
       --------------------------------------------------------- */
    const state = {
      grid: [],            // SIZE x SIZE, null yoki rang klassi
      pieces: [null, null, null],
      score: 0,
      best: store.get(KEYS.best, 0),
      bestAtStart: 0,
      recordAnnounced: false,
      combo: 0,
      since: 0,            // oxirgi qator yo‘qotishdan beri qo‘yilgan bloklar
      busy: false,
      over: false,
      preview: null,
    };
  
    const boardEl = $('board');
    const trayEl = $('tray');
    const popsEl = $('pops');
    const scoreEl = $('score');
    const bestEl = $('best');
    const slots = [...trayEl.querySelectorAll('.slot')];
    const cellEls = [];
    const L = { cell: 40, pitch: 44, k: 0.5 };
  
    const emptyGrid = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  
    function makePiece(id, color) {
      return { id, color, ...SHAPES[id] };
    }
    function randomPiece() {
      const id = Math.floor(Math.random() * SHAPES.length);
      const color = COLORS[Math.floor(Math.random() * COLORS.length)].cls;
      return makePiece(id, color);
    }
  
    function canPlaceAt(piece, r, c) {
      return piece.cells.every(([dr, dc]) => {
        const rr = r + dr, cc = c + dc;
        return rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && !state.grid[rr][cc];
      });
    }
    function fitsAnywhere(piece) {
      for (let r = 0; r <= SIZE - piece.h; r++) {
        for (let c = 0; c <= SIZE - piece.w; c++) {
          if (canPlaceAt(piece, r, c)) return true;
        }
      }
      return false;
    }
  
    function dealPieces() {
      let set;
      for (let t = 0; t < 60; t++) {
        set = [randomPiece(), randomPiece(), randomPiece()];
        if (set.some(fitsAnywhere)) break;   // kamida bittasi sig‘ishi kerak
      }
      state.pieces = set;
    }
  
    /* ---------------------------------------------------------
       6. Chizish
       --------------------------------------------------------- */
    function buildBoard() {
      boardEl.innerHTML = '';
      for (let r = 0; r < SIZE; r++) {
        cellEls[r] = [];
        for (let c = 0; c < SIZE; c++) {
          const el = document.createElement('div');
          el.className = 'cell';
          boardEl.appendChild(el);
          cellEls[r][c] = el;
        }
      }
    }
  
    function layout() {
      const a = cellEls[0][0].getBoundingClientRect();
      const b = cellEls[0][1].getBoundingClientRect();
      L.cell = a.width;
      L.pitch = b.left - a.left;
      const slotW = boardEl.getBoundingClientRect().width / 3;
      L.k = Math.min(0.62, (slotW * 0.9) / (5 * L.pitch));
      trayEl.style.setProperty('--k', L.k);
      trayEl.style.setProperty('--slot-h', (5 * L.pitch * L.k) + 'px');
    }
  
    const dims = p => ({
      width: (p.w - 1) * L.pitch + L.cell,
      height: (p.h - 1) * L.pitch + L.cell,
    });
  
    function buildPieceEl(p) {
      const { width, height } = dims(p);
      const el = document.createElement('div');
      el.className = 'piece ' + p.color;
      el.style.width = width + 'px';
      el.style.height = height + 'px';
      for (const [r, c] of p.cells) {
        const b = document.createElement('i');
        b.className = 'block';
        b.style.cssText = `left:${c * L.pitch}px;top:${r * L.pitch}px;width:${L.cell}px;height:${L.cell}px`;
        el.appendChild(b);
      }
      return el;
    }
  
    function renderTray(animate) {
      slots.forEach((slot, i) => {
        slot.innerHTML = '';
        slot.classList.remove('dragging');
        const p = state.pieces[i];
        if (!p) return;
        const el = buildPieceEl(p);
        if (animate) {
          el.classList.add('enter');
          el.style.setProperty('--ed', i * 80 + 'ms');
        }
        slot.appendChild(el);
      });
      updateFit();
    }
  
    function updateFit() {
      slots.forEach((slot, i) => {
        const p = state.pieces[i];
        slot.classList.toggle('stuck', !!p && !fitsAnywhere(p));
      });
    }
  
    function paintCell(r, c) {
      const el = cellEls[r][c];
      const k = r * SIZE + c;
      const v = state.grid[r][c];
      const pv = state.preview;
      let cls = 'cell';
      if (pv && pv.will.has(k)) cls += ` filled ${pv.color} will-clear`;
      else if (v) cls += ` filled ${v}`;
      else if (pv && pv.cells.has(k)) cls += ` preview ${pv.color}`;
      if (el.className !== cls) el.className = cls;
    }
  
    function paintAll() {
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) paintCell(r, c);
    }
  
    function computePreview(piece, r0, c0) {
      const cells = new Set(piece.cells.map(([dr, dc]) => (r0 + dr) * SIZE + (c0 + dc)));
      const full = (r, c) => state.grid[r][c] || cells.has(r * SIZE + c);
      const will = new Set();
      for (let r = 0; r < SIZE; r++) {
        let all = true;
        for (let c = 0; c < SIZE; c++) if (!full(r, c)) { all = false; break; }
        if (all) for (let c = 0; c < SIZE; c++) will.add(r * SIZE + c);
      }
      for (let c = 0; c < SIZE; c++) {
        let all = true;
        for (let r = 0; r < SIZE; r++) if (!full(r, c)) { all = false; break; }
        if (all) for (let r = 0; r < SIZE; r++) will.add(r * SIZE + c);
      }
      return { cells, will, color: piece.color };
    }
  
    /* ---------------------------------------------------------
       7. Ball, yozuvlar
       --------------------------------------------------------- */
    let shownScore = 0;
    let tweenRaf = 0;
  
    function tweenScore(target) {
      cancelAnimationFrame(tweenRaf);
      const from = shownScore;
      const t0 = performance.now();
      const dur = Math.min(700, 200 + Math.abs(target - from) * 2);
      const step = now => {
        const k = Math.min(1, (now - t0) / dur);
        shownScore = Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3)));
        scoreEl.textContent = shownScore.toLocaleString('en-US');
        if (k < 1) tweenRaf = requestAnimationFrame(step);
      };
      tweenRaf = requestAnimationFrame(step);
      scoreEl.classList.remove('bump');
      void scoreEl.offsetWidth;
      scoreEl.classList.add('bump');
    }
  
    function setScoreInstant(v) {
      cancelAnimationFrame(tweenRaf);
      shownScore = v;
      scoreEl.textContent = v.toLocaleString('en-US');
    }
  
    function pop(main, sub) {
      const el = document.createElement('div');
      el.className = 'pop';
      const b = document.createElement('b');
      b.textContent = main;
      el.appendChild(b);
      if (sub) {
        const s = document.createElement('small');
        s.textContent = sub;
        el.appendChild(s);
      }
      popsEl.appendChild(el);
      setTimeout(() => el.remove(), 1200);
    }
  
    function floatText(x, y, text) {
      const el = document.createElement('div');
      el.className = 'float';
      el.textContent = text;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1000);
    }
  
    function addScore(v) {
      if (!v) return;
      state.score += v;
      if (state.score > state.best) {
        if (!state.recordAnnounced && state.bestAtStart > 0) {
          state.recordAnnounced = true;
          setTimeout(() => { pop('Yangi rekord!'); Sound.record(); }, 650);
        }
        state.best = state.score;
        store.set(KEYS.best, state.best);
        bestEl.textContent = state.best.toLocaleString('en-US');
      }
      tweenScore(state.score);
    }
  
    /* ---------------------------------------------------------
       8. Saqlash va yuklash
       --------------------------------------------------------- */
    function saveGame() {
      if (state.over) { store.del(KEYS.save); return; }
      store.set(KEYS.save, {
        grid: state.grid,
        pieces: state.pieces.map(p => (p ? { id: p.id, color: p.color } : null)),
        score: state.score,
        combo: state.combo,
        since: state.since,
      });
    }
  
    function loadSave() {
      const s = store.get(KEYS.save, null);
      if (!s || !Array.isArray(s.grid) || s.grid.length !== SIZE) return false;
      if (!Array.isArray(s.pieces) || s.pieces.length !== 3) return false;
      for (const row of s.grid) {
        if (!Array.isArray(row) || row.length !== SIZE) return false;
        if (!row.every(v => v === null || COLOR_CLASSES.has(v))) return false;
      }
      for (const p of s.pieces) {
        if (p === null) continue;
        if (!Number.isInteger(p.id) || p.id < 0 || p.id >= SHAPES.length || !COLOR_CLASSES.has(p.color)) return false;
      }
      if (typeof s.score !== 'number') return false;
  
      state.grid = s.grid;
      state.pieces = s.pieces.map(p => (p ? makePiece(p.id, p.color) : null));
      if (state.pieces.every(p => !p)) dealPieces();
      state.score = s.score;
      state.combo = s.combo || 0;
      state.since = s.since || 0;
      return !state.pieces.every(p => !p || !fitsAnywhere(p)) ? true : false;
    }
  
    /* ---------------------------------------------------------
       9. O‘yinni boshlash va tugatish
       --------------------------------------------------------- */
    function resetCommon() {
      state.over = false;
      state.busy = false;
      state.preview = null;
      state.recordAnnounced = false;
      state.bestAtStart = state.best;
      boardEl.classList.remove('dead');
      cellEls.flat().forEach(el => el.style.removeProperty('--d'));
      $('gameOver').classList.remove('show');
      bestEl.textContent = state.best.toLocaleString('en-US');
    }
  
    function newGame() {
      state.grid = emptyGrid();
      state.score = 0;
      state.combo = 0;
      state.since = 0;
      resetCommon();
      dealPieces();
      setScoreInstant(0);
      paintAll();
      renderTray(true);
      saveGame();
    }
  
    function resumeGame() {
      resetCommon();
      setScoreInstant(state.score);
      paintAll();
      renderTray(true);
    }
  
    function gameOver() {
      state.over = true;
      state.busy = true;
      store.del(KEYS.save);
      Sound.gameOver();
      buzz([60, 40, 120]);
  
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          cellEls[r][c].style.setProperty('--d', (r * 45 + c * 12) + 'ms');
        }
      }
      boardEl.classList.add('dead');
  
      setTimeout(() => {
        $('finalScore').textContent = state.score.toLocaleString('en-US');
        $('finalBest').textContent = state.best.toLocaleString('en-US');
        $('recordBadge').classList.toggle('show', state.score > state.bestAtStart && state.score > 0);
        $('gameOver').classList.add('show');
        $('againBtn').focus({ preventScroll: true });
      }, 1000);
    }
  
    function afterMove() {
      state.busy = false;
      if (state.pieces.every(p => !p)) {
        dealPieces();
        renderTray(true);
      }
      updateFit();
      saveGame();
      if (!state.pieces.some(p => p && fitsAnywhere(p))) gameOver();
    }
  
    /* ---------------------------------------------------------
       10. Blokni joylashtirish
       --------------------------------------------------------- */
    function place(d, r0, c0) {
      const { i, piece } = d;
      state.busy = true;
      d.ghost.remove();
      state.preview = null;
  
      const placed = [];
      for (const [dr, dc] of piece.cells) {
        state.grid[r0 + dr][c0 + dc] = piece.color;
        placed.push([r0 + dr, c0 + dc]);
      }
      state.pieces[i] = null;
      renderTray(false);
      paintAll();
      placed.forEach(([r, c]) => cellEls[r][c].classList.add('placed'));
  
      Sound.place();
      buzz(12);
      addScore(piece.cells.length);
  
      // To‘lgan qator va ustunlarni topamiz
      const rows = [], cols = [];
      for (let r = 0; r < SIZE; r++) if (state.grid[r].every(Boolean)) rows.push(r);
      for (let c = 0; c < SIZE; c++) if (state.grid.every(row => row[c])) cols.push(c);
      const lines = rows.length + cols.length;
  
      if (!lines) {
        state.since++;
        if (state.since >= 3) state.combo = 0;
        afterMove();
        return;
      }
  
      const clearMap = new Map();
      rows.forEach(r => { for (let c = 0; c < SIZE; c++) clearMap.set(r * SIZE + c, [r, c]); });
      cols.forEach(c => { for (let r = 0; r < SIZE; r++) clearMap.set(r * SIZE + c, [r, c]); });
  
      state.combo++;
      state.since = 0;
  
      const centerR = r0 + (piece.h - 1) / 2;
      const centerC = c0 + (piece.w - 1) / 2;
      let maxDelay = 0, sx = 0, sy = 0;
  
      clearMap.forEach(([r, c]) => {
        const el = cellEls[r][c];
        const hex = HEX[state.grid[r][c]];
        const delay = Math.hypot(r - centerR, c - centerC) * 38;
        maxDelay = Math.max(maxDelay, delay);
  
        el.style.setProperty('--d', delay + 'ms');
        el.classList.remove('placed');
        el.classList.add('clearing');
  
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        sx += x; sy += y;
        setTimeout(() => FX.burst(x, y, hex, REDUCED ? 2 : 7, 1 + lines * 0.12), delay + 120);
  
        state.grid[r][c] = null;
      });
  
      // Ball hisoblash
      const mult = 1 + (state.combo - 1) * 0.5;
      let points = Math.round(lines * lines * 10 * mult);
      const boardEmpty = state.grid.every(row => row.every(v => !v));
      if (boardEmpty) points += 300;
      addScore(points);
  
      floatText(sx / clearMap.size, sy / clearMap.size, '+' + points);
  
      const praise = lines >= 4 ? 'Mukammal!' : lines === 3 ? 'Ajoyib!' : lines === 2 ? 'Zo‘r!' : '';
      const comboText = state.combo >= 2 ? `Combo x${state.combo}` : '';
      if (boardEmpty) pop('Maydon tozalandi!', '+300');
      else if (praise) pop(praise, comboText);
      else if (comboText) pop(comboText);
  
      Sound.clear(lines, state.combo);
      if (state.combo >= 2) Sound.combo(state.combo);
      buzz(lines >= 2 ? [20, 30, 40] : 25);
  
      if (lines >= 3 && !REDUCED) {
        boardEl.classList.remove('shake');
        void boardEl.offsetWidth;
        boardEl.classList.add('shake');
      }
  
      setTimeout(() => {
        clearMap.forEach(([r, c]) => {
          const el = cellEls[r][c];
          el.classList.remove('clearing');
          el.style.removeProperty('--d');
        });
        paintAll();
        afterMove();
      }, maxDelay + 450);
    }
  
    /* ---------------------------------------------------------
       11. Sudrab olib borish (drag & drop)
       --------------------------------------------------------- */
    let drag = null;
  
    function startDrag(e, i) {
      if (state.over || state.busy || drag) return;
      const piece = state.pieces[i];
      if (!piece) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
  
      Sound.unlock();
      Sound.pick();
      buzz(8);
  
      const ghost = document.createElement('div');
      ghost.className = 'ghost';
      const inner = buildPieceEl(piece);
      inner.style.transform = `scale(${L.k})`;
      ghost.appendChild(inner);
      document.body.appendChild(ghost);
      slots[i].classList.add('dragging');
  
      drag = {
        i, piece, ghost, inner,
        pointerId: e.pointerId,
        lift: e.pointerType === 'touch' ? L.pitch * 1.9 : L.pitch * 0.5,
        target: null,
        key: '',
      };
  
      moveDrag(e);
      requestAnimationFrame(() => { if (drag) drag.inner.style.transform = 'scale(1)'; });
  
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    }
  
    function moveDrag(e) {
      const { width, height } = dims(drag.piece);
      const left = e.clientX - width / 2;
      const top = e.clientY - drag.lift - height / 2;
      drag.ghost.style.transform = `translate(${left}px, ${top}px)`;
  
      const origin = cellEls[0][0].getBoundingClientRect();
      const col = Math.round((left - origin.left) / L.pitch);
      const row = Math.round((top - origin.top) / L.pitch);
      const key = row + ',' + col;
      if (key === drag.key) return;
      drag.key = key;
  
      if (canPlaceAt(drag.piece, row, col)) {
        drag.target = { r: row, c: col };
        state.preview = computePreview(drag.piece, row, col);
      } else {
        drag.target = null;
        state.preview = null;
      }
      paintAll();
    }
  
    function endDrag() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      const d = drag;
      drag = null;
      state.preview = null;
      paintAll();
      return d;
    }
  
    function returnGhost(d) {
      const rect = slots[d.i].getBoundingClientRect();
      const { width, height } = dims(d.piece);
      d.ghost.classList.add('returning');
      d.ghost.style.transform = `translate(${rect.left + rect.width / 2 - width / 2}px, ${rect.top + rect.height / 2 - height / 2}px)`;
      d.inner.style.transform = `scale(${L.k})`;
      setTimeout(() => {
        d.ghost.remove();
        slots[d.i].classList.remove('dragging');
      }, 270);
    }
  
    function onMove(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      e.preventDefault();
      moveDrag(e);
    }
  
    function onUp(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const target = drag.target;
      const b = boardEl.getBoundingClientRect();
      const overBoard = e.clientX > b.left && e.clientX < b.right && e.clientY - drag.lift > b.top - L.pitch && e.clientY - drag.lift < b.bottom;
      const d = endDrag();
      if (target) {
        place(d, target.r, target.c);
      } else {
        if (overBoard) { Sound.invalid(); buzz(30); }
        returnGhost(d);
      }
    }
  
    function onCancel(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      returnGhost(endDrag());
    }
  
    /* ---------------------------------------------------------
       12. Boshlash
       --------------------------------------------------------- */
    function updateSoundBtn() {
      const btn = $('soundBtn');
      btn.classList.toggle('off', !Sound.isOn());
      btn.setAttribute('aria-pressed', String(Sound.isOn()));
    }
  
    function init() {
      buildBoard();
      layout();
  
      slots.forEach((slot, i) => slot.addEventListener('pointerdown', e => startDrag(e, i)));
  
      $('soundBtn').addEventListener('click', () => {
        Sound.unlock();
        Sound.setOn(!Sound.isOn());
        updateSoundBtn();
        Sound.click();
      });
  
      $('restartBtn').addEventListener('click', () => {
        Sound.unlock();
        if (state.score > 0 && !state.over && !window.confirm('Yangi o‘yin boshlansinmi? Joriy o‘yin yo‘qoladi.')) return;
        Sound.click();
        newGame();
      });
  
      $('againBtn').addEventListener('click', () => {
        Sound.unlock();
        Sound.click();
        newGame();
      });
  
      window.addEventListener('pointerdown', Sound.unlock);
      document.addEventListener('contextmenu', e => e.preventDefault());
  
      let resizeTimer = 0;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (drag) return;
          layout();
          renderTray(false);
        }, 120);
      });
  
      updateSoundBtn();
      state.grid = emptyGrid();
      if (loadSave()) resumeGame();
      else newGame();
    }
  
    init();
  })();