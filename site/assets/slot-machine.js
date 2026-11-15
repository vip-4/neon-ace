/*
 * Neon Ace — 原生 HTML5 Canvas 老虎機滾輪範例（3 列 × 5 輪）
 * ------------------------------------------------------------------
 * 架構分層（高內聚、低耦合）：
 *   OutcomeProvider  -> 結果來源（展示用腳本 / 正式用後端 API）
 *   Reel             -> 單輪物理：加速 → 勻速 → easeOutBack 回彈停止
 *   CoinPool         -> 預配置的金幣粒子池，渲染迴圈內零配置
 *   BigWinFX         -> 全螢幕慶祝：暗化 + 拋物線金幣 + 數字 tween
 *   ViewManager      -> DPR / 尺寸 / 邏輯座標與實體像素分離
 *   SlotMachine      -> 狀態機 + 固定時間步長（fixed timestep）主迴圈
 *
 * ⚠️ 資安邊界：前端「不計算」中獎與派彩。展示用的 DemoOutcomeProvider
 *    只播放預先寫好的演出腳本；正式上線請換成 ServerOutcomeProvider，
 *    由後端產生 RNG、派彩與簽章，前端只負責把結果演出來。
 *
 * 本檔不使用任何 inline script / eval / 第三方函式庫，符合 strict CSP。
 */
(function () {
  'use strict';

  // ============================================================
  // 1. 常數：全部以「邏輯像素 / 秒」為單位，與 DPR 無關
  // ============================================================
  var CFG = {
    REELS: 5,
    ROWS: 3,
    CELL: 84,                 // 單格邏輯邊長
    GAP: 10,                  // 格距
    PAD: 14,                  // 機台內邊距
    SYMBOL_COUNT: 8,
    MAX_V: 19,                // 勻速階段：每秒捲過幾個符號
    ACCEL_T: 0.55,            // 加速耗時
    MIN_SPIN_T: 1.05,         // 最短勻速時間（等後端結果也靠它撐住畫面）
    STOP_STAGGER: 0.17,       // 依序停止的間隔
    STOP_T: 0.80,             // 單輪回彈停止耗時
    FIXED_DT: 1 / 120,        // 固定物理步長
    MAX_FRAME_DT: 0.05,       // 單幀最大 dt：切回分頁時不讓動畫暴衝
    MAX_SUBSTEPS: 8,          // 防止「死亡螺旋」
    MAX_DPR: 2.5,             // Retina 上限：3x 螢幕降到 2.5x 換效能
    COINS: 200,               // 粒子池容量（絕不動態 new）
    GRAVITY: 1500,            // px/s²
    FX_DURATION: 3.6
  };

  var BOARD_W = CFG.PAD * 2 + CFG.REELS * CFG.CELL + (CFG.REELS - 1) * CFG.GAP;
  var BOARD_H = CFG.PAD * 2 + CFG.ROWS * CFG.CELL + (CFG.ROWS - 1) * CFG.GAP;
  var STEP = CFG.CELL + CFG.GAP;

  // 八種符號：用離屏精靈圖集（sprite atlas）一次畫好，之後只 drawImage
  var SYMBOLS = [
    { label: '7',    bg: '#f5efe2', fg: '#b3261e', rim: '#e8c879' },
    { label: 'BAR',  bg: '#123b2e', fg: '#e8c879', rim: '#f5efe2' },
    { label: '◆',    bg: '#10233f', fg: '#7fc4ff', rim: '#c9e6ff' },
    { label: '●',    bg: '#2b0f14', fg: '#ff7b7b', rim: '#ffc2c2' },
    { label: '★',    bg: '#3a2a06', fg: '#ffd75e', rim: '#fff0b8' },
    { label: '♠',    bg: '#0d2a21', fg: '#f5efe2', rim: '#9fd8c0' },
    { label: '♣',    bg: '#111c33', fg: '#b9a8ff', rim: '#ded6ff' },
    { label: '♥',    bg: '#33101a', fg: '#ff9ab0', rim: '#ffd2dd' }
  ];

  // ============================================================
  // 2. 小工具
  // ============================================================
  function mod(n, m) { return ((n % m) + m) % m; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // 三次 ease-in：像滾輪「被馬達拉起來」的前段，速度從 0 平滑爬升
  function easeInCubic(t) { return t * t * t; }

  // easeOutBack：c1 控制回彈幅度。t≈0.7 時會 > 1，
  // 也就是滾輪「衝過定位線再盪回來」——這就是賭場機台那股卡榫感。
  function easeOutBack(t) {
    var c1 = 1.70158, c3 = c1 + 1;
    var u = t - 1;
    return 1 + c3 * u * u * u + c1 * u * u;
  }
  function easeOutCubic(t) { var u = 1 - t; return 1 - u * u * u; }

  // 建立離屏表面；優先 OffscreenCanvas，舊 Safari 退回一般 canvas
  function makeSurface(w, h) {
    var c;
    if (typeof OffscreenCanvas !== 'undefined') {
      try { c = new OffscreenCanvas(w, h); } catch (e) { c = null; }
    }
    if (!c) { c = document.createElement('canvas'); c.width = w; c.height = h; }
    return c;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  var numberFormat = new Intl.NumberFormat('en-US');

  // ============================================================
  // 3. 結果來源（Server-authoritative 邊界）
  // ============================================================

  // 展示用：預先寫好的「演出腳本」。注意這裡沒有任何機率或派彩運算，
  // 前端只是把後端會給的資料結構原樣播出來。
  var DEMO_SCRIPT = [
    { requestId: 'demo-01', stops: [0, 2, 5, 3, 6], win: 0,     bigWin: false },
    { requestId: 'demo-02', stops: [1, 1, 4, 7, 2], win: 750,   bigWin: false },
    { requestId: 'demo-03', stops: [0, 0, 0, 0, 0], win: 48250, bigWin: true  },
    { requestId: 'demo-04', stops: [3, 6, 1, 4, 5], win: 0,     bigWin: false },
    { requestId: 'demo-05', stops: [4, 4, 4, 4, 4], win: 18800, bigWin: true  },
    { requestId: 'demo-06', stops: [2, 7, 0, 6, 3], win: 320,   bigWin: false }
  ];

  function DemoOutcomeProvider() { this.cursor = 0; }
  DemoOutcomeProvider.prototype.requestSpin = function (/* bet */) {
    var o = DEMO_SCRIPT[this.cursor % DEMO_SCRIPT.length];
    this.cursor += 1;
    // 模擬一次網路往返；真實環境應在按下 Spin 的同時就發出請求
    return new Promise(function (resolve) { setTimeout(function () { resolve(o); }, 90); });
  };

  // 正式環境用：RNG / 派彩 / 餘額全在後端，回傳值建議附 signature 供客戶端驗章
  function ServerOutcomeProvider(url) { this.url = url; }
  ServerOutcomeProvider.prototype.requestSpin = function (bet) {
    return fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ bet: bet })
    }).then(function (r) {
      if (!r.ok) { throw new Error('spin request failed: ' + r.status); }
      return r.json();
    });
  };

  // ============================================================
  // 4. 精靈圖集與金幣貼圖（依 DPR 重建，避免 Retina 模糊）
  // ============================================================
  function buildAtlas(dpr) {
    var px = Math.round(CFG.CELL * dpr);
    var surface = makeSurface(px * CFG.SYMBOL_COUNT, px);
    var c = surface.getContext('2d');
    for (var i = 0; i < CFG.SYMBOL_COUNT; i++) {
      var s = SYMBOLS[i], x = i * px;
      c.save();
      c.translate(x, 0);
      c.scale(dpr, dpr);
      c.fillStyle = s.bg;
      roundRect(c, 2, 2, CFG.CELL - 4, CFG.CELL - 4, 14);
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = s.rim;
      c.stroke();
      c.fillStyle = s.fg;
      c.font = '700 ' + (s.label.length > 1 ? 26 : 44) + 'px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(s.label, CFG.CELL / 2, CFG.CELL / 2 + 2);
      c.restore();
    }
    return { canvas: surface, px: px };
  }

  function buildCoin(dpr) {
    var size = 26, px = Math.round(size * dpr);
    var surface = makeSurface(px, px);
    var c = surface.getContext('2d');
    c.scale(dpr, dpr);
    var g = c.createRadialGradient(size * 0.35, size * 0.3, 1, size / 2, size / 2, size / 2);
    g.addColorStop(0, '#fff3b0');
    g.addColorStop(0.55, '#f0c04a');
    g.addColorStop(1, '#a9741a');
    c.fillStyle = g;
    c.beginPath();
    c.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = '#7d5310';
    c.stroke();
    c.fillStyle = '#8a5c12';
    c.font = '700 13px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('$', size / 2, size / 2 + 1);
    return { canvas: surface, size: size };
  }

  // ============================================================
  // 5. Reel：單輪狀態（accel / spin / stopping / settled）
  // ============================================================
  function Reel(index) {
    this.index = index;
    this.offset = index * 1.37;   // 初始錯位，讓五輪不會長得一模一樣
    this.v = 0;
    this.t = 0;
    this.phase = 'settled';
    this.from = 0;
    this.distance = 0;
    this.target = 0;
    this.scheduleStop = 0;
  }
  Reel.prototype.startAccel = function () {
    this.phase = 'accel';
    this.t = 0;
    this.v = 0;
  };
  Reel.prototype.beginStop = function (stopSymbol) {
    // 中央列（row 1）顯示的符號 = (floor(offset) + 1) % N
    // 反推最終整數 offset 必須落在 desired 這個餘數上
    var desired = mod(stopSymbol - 1, CFG.SYMBOL_COUNT);
    var ceil = Math.ceil(this.offset);
    this.target = ceil + mod(desired - mod(ceil, CFG.SYMBOL_COUNT), CFG.SYMBOL_COUNT);
    if (this.target - this.offset < 2) { this.target += CFG.SYMBOL_COUNT; } // 至少再滾一圈
    this.from = this.offset;
    this.distance = this.target - this.from;
    this.t = 0;
    this.phase = 'stopping';
  };
  Reel.prototype.update = function (dt, speedScale) {
    if (this.phase === 'accel') {
      this.t += dt;
      var a = clamp(this.t / (CFG.ACCEL_T * speedScale), 0, 1);
      this.v = CFG.MAX_V * easeInCubic(a);
      this.offset += this.v * dt;
      if (a >= 1) { this.phase = 'spin'; this.v = CFG.MAX_V; }
    } else if (this.phase === 'spin') {
      this.offset += this.v * dt;
    } else if (this.phase === 'stopping') {
      this.t += dt;
      var p = clamp(this.t / (CFG.STOP_T * speedScale), 0, 1);
      this.offset = this.from + this.distance * easeOutBack(p);
      if (p >= 1) { this.offset = this.target; this.phase = 'settled'; }
    }
  };
  Reel.prototype.normalize = function () {
    // 長時間運轉後 offset 會持續累加；靜止時取模可避免浮點精度劣化
    this.offset = mod(this.offset, CFG.SYMBOL_COUNT);
  };

  // ============================================================
  // 6. CoinPool：物件池，渲染/更新迴圈內不產生任何新物件
  // ============================================================
  function CoinPool(capacity) {
    this.items = new Array(capacity);
    for (var i = 0; i < capacity; i++) {
      this.items[i] = {
        active: false, x: 0, y: 0, vx: 0, vy: 0,
        rot: 0, vr: 0, size: 0, alpha: 1, spin: 0
      };
    }
    this.capacity = capacity;
    this.cursor = 0;
  }
  CoinPool.prototype.emit = function (n, w, h, reduced) {
    var count = reduced ? Math.min(n, 24) : n;
    for (var k = 0; k < count; k++) {
      var p = null, tries = 0;
      while (tries < this.capacity) {
        var cand = this.items[this.cursor];
        this.cursor = (this.cursor + 1) % this.capacity;
        tries += 1;
        if (!cand.active) { p = cand; break; }
      }
      if (!p) { return; } // 池已滿：直接放棄，絕不 new
      // 由螢幕下方中央往外噴；角度落在上半圓，形成拋物線
      var ang = (0.18 + Math.random() * 0.64) * Math.PI;
      var speed = 620 + Math.random() * 620;
      p.active = true;
      p.x = w * 0.5 + (Math.random() - 0.5) * w * 0.35;
      p.y = h + 12 + Math.random() * 30;
      p.vx = Math.cos(ang) * speed * (Math.random() < 0.5 ? -1 : 1);
      p.vy = -Math.sin(ang) * speed;
      p.rot = Math.random() * Math.PI * 2;
      p.vr = (Math.random() - 0.5) * 12;
      p.size = 16 + Math.random() * 14;
      p.alpha = 1;
      p.spin = 0.55 + Math.random() * 0.45;
    }
  };
  CoinPool.prototype.update = function (dt, w, h) {
    for (var i = 0; i < this.capacity; i++) {
      var p = this.items[i];
      if (!p.active) { continue; }
      p.vy += CFG.GRAVITY * dt;         // 重力 → 拋物線
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.vy > 0) { p.alpha = clamp(1 - (p.y - h * 0.72) / (h * 0.42), 0, 1); }
      // 邊界用實際視窗寬 w；舊寫法誤用 h*3 會讓寬螢幕的粒子晚回收
      if (p.y > h + 60 || p.x < -80 || p.x > w + 80) { p.active = false; }
    }
  };
  CoinPool.prototype.clear = function () {
    for (var i = 0; i < this.capacity; i++) { this.items[i].active = false; }
  };

  // ============================================================
  // 7. 音效：AudioContext 必須由使用者手勢解鎖，延遲才低
  // ============================================================
  var Sound = (function () {
    var ac = null, enabled = true;
    function unlock() {
      if (!ac) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { return; }
        ac = new AC();
      }
      if (ac.state === 'suspended') { ac.resume(); }
    }
    function tone(freq, delay, dur, vol) {
      if (!ac || !enabled) { return; }
      var t = ac.currentTime + delay;
      var osc = ac.createOscillator(), gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.connect(gain);
      gain.connect(ac.destination);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    }
    return {
      unlock: unlock,
      spin: function () { tone(320, 0, 0.10, 0.05); },
      stop: function (i) { tone(520 + i * 90, 0, 0.09, 0.045); },
      bigWin: function () {
        [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.09, 0.34, 0.055); });
      },
      setEnabled: function (v) { enabled = v; if (v) { unlock(); } },
      isEnabled: function () { return enabled; }
    };
  }());

  // ============================================================
  // 8. BigWinFX：全螢幕暗化 + 金幣 + 數字 tween
  // ============================================================
  function BigWinFX(canvas, onDone) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onDone = onDone;
    this.active = false;
    this.t = 0;
    this.amount = 0;
    this.wave = 0;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.pool = new CoinPool(CFG.COINS);
    this.coin = null;
    this.reduced = false;
  }
  BigWinFX.prototype.resize = function (w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    var pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw; this.canvas.height = ph;
    }
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.coin = buildCoin(dpr);   // 貼圖隨 DPR 重建
  };
  BigWinFX.prototype.start = function (amount, reduced) {
    this.active = true;
    this.t = 0;
    this.wave = 0;
    this.amount = amount;
    this.reduced = reduced;
    this.pool.clear();
    this.canvas.setAttribute('aria-hidden', 'false');
    Sound.bigWin();
  };
  // 新一局開始時完整收掉上一場特效，避免 aria-hidden 與粒子狀態殘留
  BigWinFX.prototype.cancel = function () {
    this.active = false;
    this.t = 0;
    this.wave = 0;
    this.pool.clear();
    this.canvas.setAttribute('aria-hidden', 'true');
  };
  BigWinFX.prototype.update = function (dt) {
    if (!this.active) { return; }
    this.t += dt;
    // 三波噴發，用時間點判斷而非 setTimeout，避免計時器與暫停不同步
    var waveTimes = [0.05, 0.42, 0.85];
    while (this.wave < waveTimes.length && this.t >= waveTimes[this.wave]) {
      this.pool.emit(this.reduced ? 20 : 70, this.w, this.h, this.reduced);
      this.wave += 1;
    }
    this.pool.update(dt, this.w, this.h);
    if (this.t >= CFG.FX_DURATION) {
      this.active = false;
      this.pool.clear();
      this.canvas.setAttribute('aria-hidden', 'true');
      if (this.onDone) { this.onDone(); }
    }
  };
  BigWinFX.prototype.render = function () {
    var c = this.ctx;
    // 每幀重設 transform，因為金幣繪製會改寫它
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    if (!this.active) { return; }

    var fadeIn = clamp(this.t / 0.28, 0, 1);
    var fadeOut = clamp((CFG.FX_DURATION - this.t) / 0.55, 0, 1);
    var alpha = Math.min(fadeIn, fadeOut);

    // (a) 背景暗化
    c.fillStyle = 'rgba(3, 10, 8, ' + (0.80 * alpha).toFixed(3) + ')';
    c.fillRect(0, 0, this.w, this.h);

    // (b) 金幣：用 setTransform 直接做旋轉，省掉 200 次 save/restore
    var sprite = this.coin.canvas, items = this.pool.items;
    for (var i = 0; i < items.length; i++) {
      var p = items[i];
      if (!p.active) { continue; }
      var cos = Math.cos(p.rot) * this.dpr, sin = Math.sin(p.rot) * this.dpr;
      c.globalAlpha = p.alpha * alpha;
      c.setTransform(cos, sin, -sin, cos, p.x * this.dpr, p.y * this.dpr);
      c.drawImage(sprite, -p.size / 2, -p.size / 2, p.size, p.size);
    }
    c.globalAlpha = 1;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // (c) 標題 + 動態遞增數字
    var pop = easeOutBack(clamp(this.t / 0.55, 0, 1));
    var cx = this.w / 2, cy = this.h * 0.38;
    c.save();
    c.translate(cx, cy);
    c.scale(pop, pop);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.globalAlpha = alpha;
    c.shadowColor = 'rgba(232, 200, 121, 0.85)';
    c.shadowBlur = 26;
    c.fillStyle = '#f5efe2';
    c.font = '800 ' + Math.min(56, this.w * 0.11) + 'px system-ui, sans-serif';
    c.fillText('BIG WIN', 0, -46);
    c.restore();

    // 數字 tween：easeOutCubic 讓前面衝快、尾端慢慢補到定位
    var numP = easeOutCubic(clamp(this.t / 1.7, 0, 1));
    var shown = Math.round(this.amount * numP);
    c.save();
    c.globalAlpha = alpha;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = 'rgba(240, 192, 74, 0.9)';
    c.shadowBlur = 30;
    c.fillStyle = '#f0c04a';
    c.font = '800 ' + Math.min(74, this.w * 0.14) + 'px system-ui, sans-serif';
    c.fillText(numberFormat.format(shown), cx, cy + 42);
    c.restore();
    c.shadowBlur = 0;
    c.globalAlpha = 1;
  };

  // ============================================================
  // 9. SlotMachine：狀態機 + DPR + 固定時間步長
  // ============================================================
  var STATE = {
    IDLE: 'IDLE',
    SPINNING: 'SPINNING',
    STOPPING: 'STOPPING',
    SETTLE: 'SETTLE',
    WIN_PRESENTATION: 'WIN_PRESENTATION'
  };

  function SlotMachine(opts) {
    this.reelCanvas = opts.reelCanvas;
    this.fxCanvas = opts.fxCanvas;
    this.statusEl = opts.statusEl;
    this.winEl = opts.winEl;
    this.spinBtn = opts.spinBtn;
    this.muteBtn = opts.muteBtn;
    this.container = opts.container;

    this.ctx = this.reelCanvas.getContext('2d');
    this.reels = [];
    for (var i = 0; i < CFG.REELS; i++) { this.reels.push(new Reel(i)); }

    // 展示用；正式環境改成 new ServerOutcomeProvider('/api/spin')
    this.provider = new DemoOutcomeProvider();

    this.state = STATE.IDLE;
    this.elapsed = 0;
    this.outcome = null;
    this.atlas = null;
    this.dpr = 1;
    this.scale = 1;
    this.cssW = 0;
    this.cssH = 0;
    this.reduced = false;
    this.reelVisible = true;

    this.lastTime = 0;
    this.accumulator = 0;
    this.rafId = 0;
    this.running = false;
    this.destroyed = false;

    this.fx = new BigWinFX(this.fxCanvas, this.onPresentationDone.bind(this));

    this.bindEvents();
    this.readMotionPreference();
    this.resize();
    this.setStatus('Ready. Press Spin to start.');
    this.start();
  }

  SlotMachine.prototype.readMotionPreference = function () {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = mq.matches;
    var self = this;
    if (mq.addEventListener) {
      mq.addEventListener('change', function (e) { self.reduced = e.matches; });
    }
    // 減少動態時把演出時間壓短，但保留完整狀態流程
    this.speedScale = this.reduced ? 0.45 : 1;
  };

  // ---- DPR 適配 -------------------------------------------------
  SlotMachine.prototype.resize = function () {
    // (1) DPR 上限：iPhone 的 3x 全解析度會讓 backing store 變成 9 倍像素，
    //     填滿率（fill rate）直接吃掉幀率，故鉗制在 2.5x。
    var dpr = Math.min(window.devicePixelRatio || 1, CFG.MAX_DPR);
    var available = this.container.clientWidth || 600;
    var cssW = Math.min(available, 620);
    var scale = cssW / BOARD_W;
    var cssH = BOARD_H * scale;

    // (2) 邏輯座標 → 實體像素：只有 backing store 用 dpr，繪圖仍然用邏輯單位
    var pw = Math.max(1, Math.round(cssW * dpr)), ph = Math.max(1, Math.round(cssH * dpr));
    if (this.reelCanvas.width !== pw || this.reelCanvas.height !== ph) {
      this.reelCanvas.width = pw; this.reelCanvas.height = ph;
    }
    this.reelCanvas.style.width = cssW + 'px';
    this.reelCanvas.style.height = cssH + 'px';

    this.dpr = dpr; this.scale = scale; this.cssW = cssW; this.cssH = cssH;
    if (!this.atlas || this.atlasDpr !== dpr) {
      this.atlas = buildAtlas(dpr);
      this.atlasDpr = dpr;
    }
    this.fx.resize(window.innerWidth, window.innerHeight, dpr);
  };

  SlotMachine.prototype.watchDpr = function () {
    // 把視窗拖到不同 DPI 的螢幕時 devicePixelRatio 會變，用 matchMedia 監聽
    var self = this;
    if (this.dprQuery && this.dprQuery.removeEventListener) {
      this.dprQuery.removeEventListener('change', this.dprHandler);
    }
    this.dprQuery = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
    this.dprHandler = function () { self.resize(); self.watchDpr(); };
    if (this.dprQuery.addEventListener) {
      this.dprQuery.addEventListener('change', this.dprHandler);
    }
  };

  // ---- 事件綁定 -------------------------------------------------
  SlotMachine.prototype.bindEvents = function () {
    var self = this;

    this.spinBtn.addEventListener('click', function () {
      Sound.unlock();
      self.spin();
    });
    this.muteBtn.addEventListener('click', function () {
      var next = !Sound.isEnabled();
      Sound.setEnabled(next);
      self.muteBtn.setAttribute('aria-pressed', String(!next));
      self.muteBtn.textContent = next ? 'Sound on' : 'Sound off';
    });

    // 鍵盤快捷鍵：只在焦點位於示範區內才攔截，避免干擾整頁捲動
    this.container.addEventListener('keydown', function (e) {
      if (e.key === 's' || e.key === 'S') {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') { return; }
        e.preventDefault();
        Sound.unlock();
        self.spin();
      }
    });

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { self.resize(); self.watchDpr(); }, 120);
    });
    this.watchDpr();

    // 分頁切回來時重設時間基準，這是「動畫暴衝」的根因修復
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { self.pause(); } else { self.resume(); }
    });
    window.addEventListener('pagehide', function () { self.pause(); });
    window.addEventListener('pageshow', function () { self.resume(); });

    // 滾出視野就略過機台繪製（狀態照跑），省電
    if (typeof IntersectionObserver !== 'undefined') {
      var io = new IntersectionObserver(function (entries) {
        self.reelVisible = entries[0].isIntersecting;
      }, { threshold: 0.01 });
      io.observe(this.reelCanvas);
    }
  };

  SlotMachine.prototype.pause = function () {
    this.running = false;
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
    this.lastTime = 0;        // 關鍵：不讓累積的牆鐘時間灌進下一幀
    this.accumulator = 0;
  };
  SlotMachine.prototype.resume = function () {
    if (this.destroyed || this.running) { return; }
    this.lastTime = 0;
    this.accumulator = 0;
    this.start();
  };
  SlotMachine.prototype.start = function () {
    if (this.running) { return; }
    this.running = true;
    var self = this;
    this.rafId = requestAnimationFrame(function (t) { self.frame(t); });
  };

  // ---- 主迴圈：固定時間步長 + 單幀 dt 鉗制 ----------------------
  SlotMachine.prototype.frame = function (now) {
    if (!this.running) { return; }
    if (this.lastTime === 0) { this.lastTime = now; }
    var dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // 切回分頁 / 長時間 GC 後 dt 可能是數秒；鉗制後物理不會一次跳完
    if (dt > CFG.MAX_FRAME_DT) { dt = CFG.MAX_FRAME_DT; }
    if (dt < 0) { dt = 0; }

    this.accumulator += dt;
    var steps = 0;
    while (this.accumulator >= CFG.FIXED_DT && steps < CFG.MAX_SUBSTEPS) {
      this.update(CFG.FIXED_DT);
      this.accumulator -= CFG.FIXED_DT;
      steps += 1;
    }
    if (steps === CFG.MAX_SUBSTEPS) { this.accumulator = 0; } // 避免死亡螺旋

    this.render();
    var self = this;
    this.rafId = requestAnimationFrame(function (t) { self.frame(t); });
  };

  // ---- 狀態機 ---------------------------------------------------
  SlotMachine.prototype.setStatus = function (text) {
    if (this.statusEl) { this.statusEl.textContent = text; }
  };

  SlotMachine.prototype.spin = function () {
    if (this.state !== STATE.IDLE) { return; }
    this.state = STATE.SPINNING;
    this.elapsed = 0;
    this.outcome = null;
    this.fx.cancel();
    for (var i = 0; i < this.reels.length; i++) { this.reels[i].startAccel(); }
    this.spinBtn.disabled = true;
    this.setStatus('Reels accelerating…');
    if (this.winEl) { this.winEl.textContent = '0'; }
    Sound.spin();

    var self = this;
    // 結果請求與視覺演出並行：後端慢也不會讓轉輪先停下來
    this.provider.requestSpin(1).then(function (o) {
      self.outcome = o;
    }).catch(function () {
      // 請求失敗時不中獎，絕不在前端「自己補一個結果」
      self.outcome = { requestId: 'error', stops: [0, 0, 0, 0, 0], win: 0, bigWin: false };
      self.setStatus('Result request failed; no payout this round.');
    });
  };

  SlotMachine.prototype.update = function (dt) {
    var i, r;
    this.elapsed += dt;

    for (i = 0; i < this.reels.length; i++) {
      this.reels[i].update(dt, this.speedScale);
    }
    this.fx.update(dt);

    if (this.state === STATE.SPINNING) {
      var ready = this.elapsed >= (CFG.ACCEL_T + CFG.MIN_SPIN_T) * this.speedScale;
      if (ready && this.outcome) {
        this.state = STATE.STOPPING;
        this.setStatus('Stopping reels left to right…');
        for (i = 0; i < this.reels.length; i++) {
          this.reels[i].scheduleStop = this.elapsed + i * CFG.STOP_STAGGER * this.speedScale;
        }
      }
    } else if (this.state === STATE.STOPPING) {
      for (i = 0; i < this.reels.length; i++) {
        r = this.reels[i];
        if (r.phase === 'spin' && this.elapsed >= r.scheduleStop) {
          r.beginStop(this.outcome.stops[i]);
          Sound.stop(i);
        }
      }
      var allSettled = true;
      for (i = 0; i < this.reels.length; i++) {
        if (this.reels[i].phase !== 'settled') { allSettled = false; break; }
      }
      if (allSettled) {
        this.state = STATE.SETTLE;
        this.settle();
      }
    }
  };

  SlotMachine.prototype.settle = function () {
    for (var i = 0; i < this.reels.length; i++) { this.reels[i].normalize(); }
    var o = this.outcome;
    if (o.win > 0) { this.winEl.textContent = numberFormat.format(o.win); }

    if (o.bigWin) {
      // 只有大獎才播全螢幕慶祝；小額中獎只更新數字，避免「每次都放大招」的疲乏感
      this.state = STATE.WIN_PRESENTATION;
      this.setStatus('Big Win! Celebration playing.');
      this.fx.start(o.win, this.reduced);
    } else {
      this.state = STATE.IDLE;
      this.spinBtn.disabled = false;
      this.setStatus(o.win > 0 ? 'Small win credited. Press Spin again.' : 'No win. Press Spin again.');
    }
  };

  SlotMachine.prototype.onPresentationDone = function () {
    this.state = STATE.IDLE;
    this.spinBtn.disabled = false;
    this.setStatus('Presentation finished. Press Spin again.');
  };

  // ---- 繪製 -----------------------------------------------------
  SlotMachine.prototype.render = function () {
    // FX 永遠要畫（即使機台滾出視野）
    this.fx.render();
    if (!this.reelVisible || !this.atlas) { return; }

    var c = this.ctx;
    var m = this.dpr * this.scale;
    // 每幀重設 transform（canvas.width 變動或 FX 共用時才不會殘留）
    c.setTransform(m, 0, 0, m, 0, 0);
    c.clearRect(0, 0, BOARD_W, BOARD_H);

    // 機台外框
    c.fillStyle = '#07120f';
    roundRect(c, 0, 0, BOARD_W, BOARD_H, 18);
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = '#e8c879';
    c.stroke();

    var atlas = this.atlas;
    for (var i = 0; i < CFG.REELS; i++) {
      var r = this.reels[i];
      var x = CFG.PAD + i * STEP;

      c.save();
      c.beginPath();
      c.rect(x, CFG.PAD, CFG.CELL, CFG.ROWS * STEP - CFG.GAP);
      c.clip();

      // 每輪底色
      c.fillStyle = '#0d2a21';
      c.fillRect(x, CFG.PAD, CFG.CELL, CFG.ROWS * STEP - CFG.GAP);

      var base = Math.floor(r.offset);
      var frac = r.offset - base;
      // 多畫上下各一格，捲動時才不會露出空白
      for (var j = -1; j <= CFG.ROWS; j++) {
        var idx = mod(base + j, CFG.SYMBOL_COUNT);
        var y = CFG.PAD + j * STEP - frac * STEP;
        c.drawImage(
          atlas.canvas,
          idx * atlas.px, 0, atlas.px, atlas.px,
          x, y, CFG.CELL, CFG.CELL
        );
      }

      // 高速時加一層淡霧，營造速度感（成本極低）
      if (r.phase === 'spin' || r.phase === 'accel') {
        c.fillStyle = 'rgba(245, 239, 226, 0.06)';
        c.fillRect(x, CFG.PAD, CFG.CELL, 3);
        c.fillRect(x, CFG.PAD + STEP, CFG.CELL, 3);
        c.fillRect(x, CFG.PAD + STEP * 2, CFG.CELL, 3);
      }
      c.restore();

      // 輪框
      c.lineWidth = 1;
      c.strokeStyle = 'rgba(232, 200, 121, 0.35)';
      c.strokeRect(x + 0.5, CFG.PAD + 0.5, CFG.CELL - 1, CFG.ROWS * STEP - CFG.GAP - 1);
    }

    // 中央派彩線
    var lineY = CFG.PAD + STEP + CFG.CELL / 2;
    c.strokeStyle = 'rgba(240, 192, 74, 0.9)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(CFG.PAD - 6, lineY);
    c.lineTo(BOARD_W - CFG.PAD + 6, lineY);
    c.stroke();

    if (this.reduced) {
      // 減少動態時給一個明確的靜態提示，而不是完全沒有回饋
      c.fillStyle = 'rgba(245, 239, 226, 0.75)';
      c.font = '600 12px system-ui, sans-serif';
      c.textAlign = 'left';
      c.fillText('REDUCED MOTION', CFG.PAD, BOARD_H - 4);
    }
  };

  // ============================================================
  // 10. 啟動
  // ============================================================
  function boot() {
    var reelCanvas = document.getElementById('slot-canvas');
    if (!reelCanvas) { return; }
    var machine = new SlotMachine({
      reelCanvas: reelCanvas,
      fxCanvas: document.getElementById('fx-canvas'),
      container: document.getElementById('slot-demo'),
      statusEl: document.getElementById('slot-status'),
      winEl: document.getElementById('slot-win'),
      spinBtn: document.getElementById('spin-btn'),
      muteBtn: document.getElementById('mute-btn')
    });
    window.__neonAceSlots = machine; // 方便主控台檢視狀態機（正式環境可移除）
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
