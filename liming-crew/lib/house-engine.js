// 三方小屋前端渲染与动画引擎（ESM 模块）：由薄 React 外壳挂载，默认显示真实 crew 数据，点击「演示」可播放六幕剧本。
// 内置 BRIEF-4g 修复后的 WhaleTankController（累加相位 + 低通平滑 + 转身迟滞与冷却，30fps×20s 全模式零抽搐）。

const SPOTS = {
  liDesk:    { x: 22.0, y: 76.0, floor: 1, behindDesk: 'li',  restFlip: false },
  li2Desk:   { x: 83.2, y: 79.4, floor: 1, behindDesk: 'li2', restFlip: false },
  review:    { x: 78.6, y: 79.4, floor: 1, behindDesk: 'li2', restFlip: false },
  reviewLi2: { x: 88.4, y: 79.4, floor: 1, behindDesk: 'li2', restFlip: false },
  dshRug:    { x: 61.8, y: 94.5, floor: 1, behindDesk: null,  restFlip: false },
  sofa:      { x: 16.0, y: 46.8, floor: 2, behindDesk: null,  restFlip: false },
  window:    { x: 50.0, y: 49.5, floor: 2, behindDesk: null,  restFlip: false },
  coolWin:   { x: 48.0, y: 49.5, floor: 2, behindDesk: null,  restFlip: false },
  teaBar:    { x: 82.0, y: 49.5, floor: 2, behindDesk: null,  restFlip: false },
};

const DESK_EXIT = {
  li: {
    back:  { x: 34.4, y: 83.2, floor: 1, behindDesk: 'li' },
    front: { x: 35.2, y: 93.8, floor: 1, behindDesk: null },
  },
  li2: {
    back:  { x: 73.2, y: 83.6, floor: 1, behindDesk: 'li2' },
    front: { x: 72.2, y: 93.8, floor: 1, behindDesk: null },
  },
};

const STAIR_BOT = { x: 66.8, y: 89.0, floor: 1, behindDesk: null };
const STAIR_MID = { x: 68.3, y: 69.5, floor: 1, behindDesk: null };
const STAIR_TOP = { x: 69.6, y: 49.5, floor: 2, behindDesk: null };
const DSH_CENTER = { x: 50.0, y: 68.0 };

const ANIM_MAP = {
  'whale-girl': {
    idle: 'idle',
    idlePool: ['idle-look', 'idle-spout'],
    thinking: 'thinking',
    working: 'typing',
    approval: 'notification',
    happy: 'happy',
    thumbs: 'thumbs-up',
    hearts: 'smile-hearts',
    sleeping: 'sleeping',
    waking: 'waking',
    stopped: 'error',
    offline: 'idle',
    cooldown: 'idle',
    carrying: 'carrying',
    swim: 'swim',
    poke: 'poke-left',
    tickle: 'tickle',
  },
  'pink-fish': {
    idle: 'idle',
    idlePool: ['bubble'],
    thinking: 'think',
    working: 'type',
    approval: 'wave',
    happy: 'happy',
    thumbs: 'happy',
    hearts: 'happy',
    sleeping: 'sleep',
    waking: 'stretch',
    stopped: 'cry',
    offline: 'idle',
    cooldown: 'idle',
    carrying: 'carry',
    swim: 'swim',
    poke: 'poke',
    tickle: 'tickle',
  },
};

function easeInOut(u) {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rectsOverlap(a, b, gap = 3) {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}

function nowHm() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function buildTankFrameSvg() {
  return `<svg class="tank-frame-svg" viewBox="0 0 288 180" aria-hidden="true">
    <defs>
      <linearGradient id="lcTankWood" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--dsh-tank-wood-1)"/>
        <stop offset="100%" stop-color="var(--dsh-tank-wood-2)"/>
      </linearGradient>
    </defs>
    <path fill-rule="evenodd"
          d="M 16 6 H 272 Q 282 6 282 16 V 164 Q 282 174 272 174 H 16 Q 6 174 6 164 V 16 Q 6 6 16 6 Z
             M 24 20 H 264 Q 268 20 268 24 V 152 Q 268 156 264 156 H 24 Q 20 156 20 152 V 24 Q 20 20 24 20 Z"
          fill="url(#lcTankWood)" stroke="var(--dsh-ink)" stroke-width="2.4" stroke-linejoin="round"/>
    <rect x="20" y="20" width="248" height="136" rx="5" fill="none"
          stroke="var(--dsh-ink)" stroke-width="1.5" opacity="0.44"/>
    <path d="M 24 12 L 264 12" stroke="rgba(255, 246, 226, 0.48)" stroke-width="2" stroke-linecap="round"/>
    <rect x="118" y="159.5" width="52" height="11.5" rx="5" fill="var(--dsh-tank-plate)" stroke="var(--dsh-ink)" stroke-width="1.5"/>
    <text x="144" y="168.5" text-anchor="middle" font-size="8.4" font-weight="900" letter-spacing="1.2" fill="var(--dsh-ink)">DSH</text>
  </svg>`;
}

// =========================================================================
// 1. 宠物精灵播放器（从本机 /liming-crew/pets/<id>/ 加载；缺图时退化为可爱剪影）
// =========================================================================
class PetSprite {
  constructor(canvas, petId, petBase, onMissing) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.petId = petId;
    this.petBase = petBase.replace(/\/+$/, '');
    this.onMissing = onMissing;
    this.map = ANIM_MAP[petId];
    this.pack = null;
    this.images = new Map();
    this.fallback = true;
    this.baseAnim = this.map.idle;
    this.curAnim = this.map.idle;
    this.oneShot = false;
    this.frameIdx = 0;
    this.elapsed = 0;
    this.clock = 0;
    this.visibleHeightPx = 56;
    this.drawScale = 1;
    this.nextIdleAt = Date.now() + 8000 + Math.random() * 5000;
    this.disposed = false;
    this._stageHeight = 320;
    this._loadPack();
  }

  async _loadPack() {
    try {
      const res = await fetch(`${this.petBase}/${this.petId}/pack.json`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('pack missing');
      const pack = await res.json();
      if (this.disposed) return;
      if (!pack || !pack.animations || !pack.canvas) throw new Error('invalid pack');
      this.pack = pack;
      const needed = new Set([
        ...Object.values(this.map).flat(),
      ]);
      let loadedAny = false;
      const loads = [];
      for (const animName of needed) {
        const cfg = pack.animations[animName];
        if (!cfg || !cfg.sheet) continue;
        loads.push(new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            if (!this.disposed) {
              this.images.set(animName, img);
              loadedAny = true;
            }
            resolve(true);
          };
          img.onerror = () => resolve(false);
          img.src = `${this.petBase}/${this.petId}/${cfg.sheet}`;
        }));
      }
      const results = await Promise.all(loads);
      if (this.disposed) return;
      if (loadedAny && results.some(Boolean)) {
        this.fallback = false;
        this.resizeWithTargetVisible(this._stageHeight);
        this.drawCurrent();
      } else {
        this.fallback = true;
        if (this.onMissing) this.onMissing(this.petId);
      }
    } catch {
      if (this.disposed) return;
      this.fallback = true;
      if (this.onMissing) this.onMissing(this.petId);
      this.drawFallback();
    }
  }

  destroy() {
    this.disposed = true;
    this.images.clear();
  }

  resizeWithTargetVisible(stageHeight) {
    this._stageHeight = stageHeight || 320;
    const desiredVis = Math.max(46, this._stageHeight * 0.175);
    const whaleK = Math.max(1, Math.min(3, Math.round(desiredVis / 49)));
    const whaleVisH = 49 * whaleK;

    if (!this.pack || this.fallback) {
      const targetH = Math.round(whaleVisH * 1.06);
      const targetW = Math.round(targetH * 1.06);
      const dpr = Math.min(2, window.devicePixelRatio || 2);
      this.canvas.width = Math.round(targetW * dpr);
      this.canvas.height = Math.round(targetH * dpr);
      this.canvas.style.width = `${targetW}px`;
      this.canvas.style.height = `${targetH}px`;
      this.canvas.classList.remove('is-pixel');
      this.visibleHeightPx = whaleVisH;
      this.drawFallback();
      return;
    }

    const cw = this.pack.canvas.w;
    const ch = this.pack.canvas.h;
    if (this.pack.pixelArt) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.canvas.style.width = `${cw * whaleK}px`;
      this.canvas.style.height = `${ch * whaleK}px`;
      this.canvas.classList.add('is-pixel');
      this.drawScale = 1;
      this.visibleHeightPx = whaleVisH;
    } else {
      const targetH = Math.round(whaleVisH / 0.88);
      const dpr = Math.min(2, window.devicePixelRatio || 2);
      const w = Math.round(targetH * (cw / ch));
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(targetH * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${targetH}px`;
      this.canvas.classList.remove('is-pixel');
      this.drawScale = (targetH * dpr) / ch;
      this.visibleHeightPx = whaleVisH;
    }
    this.drawCurrent();
  }

  setStateAnim(animKey) {
    const resolved = this.map[animKey] || this.map.idle;
    if (resolved !== this.baseAnim) {
      this.baseAnim = resolved;
      if (!this.oneShot) this.switchTo(resolved, false);
    }
  }

  playOnce(animKey) {
    const resolved = this.map[animKey] || animKey;
    if (!this.pack || !this.pack.animations[resolved]) return;
    this.switchTo(resolved, true);
  }

  switchTo(animName, oneShot) {
    this.curAnim = animName;
    this.oneShot = oneShot;
    this.frameIdx = 0;
    this.elapsed = 0;
    this.drawCurrent();
  }

  step(dt, now, reduced) {
    if (!reduced) this.clock += Math.min(0.08, dt / 1000);
    if (this.fallback || !this.pack) {
      this.drawFallback();
      return;
    }
    const cfg = this.pack.animations[this.curAnim] || this.pack.animations[this.baseAnim];
    if (!cfg) {
      this.drawFallback();
      return;
    }
    if (reduced) {
      this.frameIdx = 0;
      this.draw(cfg);
      return;
    }
    this.elapsed += dt;
    let frame = cfg.frames[this.frameIdx] || cfg.frames[0];
    while (this.elapsed >= frame.ms) {
      this.elapsed -= frame.ms;
      this.frameIdx++;
      if (this.frameIdx >= cfg.frames.length) {
        if (this.oneShot) {
          this.oneShot = false;
          this.switchTo(this.baseAnim, false);
          break;
        } else if (cfg.loop === false) {
          if (this.curAnim === 'happy' && this.baseAnim === 'happy') {
            this.frameIdx = 0;
          } else {
            this.frameIdx = cfg.frames.length - 1;
            this.elapsed = 0;
            break;
          }
        } else {
          this.frameIdx = 0;
        }
      }
      frame = cfg.frames[this.frameIdx] || cfg.frames[0];
    }
    if (!this.oneShot && this.baseAnim === this.map.idle && this.curAnim === this.map.idle && now >= this.nextIdleAt) {
      const pool = this.map.idlePool;
      if (pool && pool.length) this.switchTo(pool[Math.floor(Math.random() * pool.length)], true);
      this.nextIdleAt = now + 9000 + Math.random() * 6000;
    }
    this.draw(this.pack.animations[this.curAnim] || cfg);
  }

  drawCurrent() {
    if (this.fallback || !this.pack) {
      this.drawFallback();
      return;
    }
    const cfg = this.pack.animations[this.curAnim] || this.pack.animations[this.baseAnim];
    if (cfg) this.draw(cfg);
  }

  draw(cfg) {
    const img = this.images.get(this.curAnim) || this.images.get(this.baseAnim) || this.images.get('idle');
    if (!img || !img.complete || !img.naturalWidth) {
      this.drawFallback();
      return;
    }
    const f = cfg.frames[this.frameIdx] || cfg.frames[0];
    const col = f.i % cfg.cols;
    const row = Math.floor(f.i / cfg.cols);
    const sx = col * cfg.frameW;
    const sy = row * cfg.frameH;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = !this.pack.pixelArt;
    if (!this.pack.pixelArt) ctx.imageSmoothingQuality = 'high';

    const b = cfg.box;
    const s = this.drawScale;
    const dyShift = this.pack.canvas.h - (this.pack.anchor?.baseline || this.pack.canvas.h);
    ctx.drawImage(img, sx, sy, cfg.frameW, cfg.frameH, b.x * s, (b.y + dyShift) * s, b.w * s, b.h * s);
  }

  // 无精灵图时的简洁占位剪影（清晰区分鲸娘蓝 / 小粉鱼粉与睡觉/工作状态）
  drawFallback() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!W || !H) return;
    const isPink = this.petId === 'pink-fish';
    const isSleep = this.baseAnim === 'sleeping' || this.baseAnim === 'sleep';
    const bob = Math.sin(this.clock * 2.2) * (H * 0.02);

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W * 0.5, H * 0.58 + bob);
    const r = Math.min(W, H) * 0.34;
    const main = isPink ? '#f28cb7' : '#63aaf2';
    const belly = isPink ? '#ffe8f2' : '#e6f5ff';
    const ink = '#3c3044';

    // 小尾巴
    ctx.fillStyle = main;
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(2, r * 0.11);
    ctx.beginPath();
    ctx.moveTo(-r * 0.72, 0);
    ctx.lineTo(-r * 1.28, -r * 0.42);
    ctx.lineTo(-r * 1.12, 0);
    ctx.lineTo(-r * 1.28, r * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 圆润剪影身体
    ctx.fillStyle = main;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 肚皮
    ctx.fillStyle = belly;
    ctx.beginPath();
    ctx.ellipse(r * 0.12, r * 0.36, r * 0.62, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    // 眼睛
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = Math.max(2, r * 0.1);
    ctx.lineCap = 'round';
    if (isSleep) {
      ctx.beginPath();
      ctx.arc(r * 0.35, -r * 0.1, r * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(r * 0.36, -r * 0.12, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(r * 0.32, -r * 0.16, r * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// =========================================================================
// 2. DSH 发光鱼缸控制器（BRIEF-4g 修复版：累加相位 + 迟滞冷却 + 平滑倾角）
// =========================================================================
export class WhaleTankController {
  constructor(canvas, buttonEl, wallCausticsEl) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.buttonEl = buttonEl || null;
    this.wallCausticsEl = wallCausticsEl || null;
    this.W = 248;
    this.H = 139;
    this.dpr = 2;
    this.clock = 0;
    this._lastNow = Date.now();
    this._zTimer = 0;
    this._trailTimer = 0;
    this._idleSeq = 0;

    this.w = {
      x: 124, y: 74, vx: 0, vy: 0,
      tx: 124, ty: 74,
      rawTx: 124, rawTy: 74,
      blendFromX: 124, blendFromY: 74,
      blendElapsed: 0.6, blendDur: 0.6,
      prevModeKey: 'idle:patrol',
      facing: 1,
      targetDir: 1,
      turning: false,
      turnFrom: 1,
      turnTo: 1,
      turnElapsed: 0,
      turnDur: 0.40,
      lastTurnAt: -10,
      wantOppositeSince: null,
      speedMul: 1,
      smoothVy: 0,
      scale: 1,
      tilt: 0,
      spin: 0,
      tailPhase: 0,
      tailFreq: 4.9,
      tailAmp: 0.13,
      tailAngle: 0,
      finAngle: 0,
      breathPhase: 0,
      nodPhase: 0,
      puff: 0,
      stopSignY: 168,
      stopActiveUntil: 0,
      mouthCarry: null,
      relayLegDir: 1,
      relayPauseUntil: -1,
      patrolIdx: 0,
      patrolPauseUntil: -1,
      gazeX: 0, gazeY: 0,
      blinkUntil: -1,
      nextBlinkAt: 3.4,
      yawnUntil: -1,
      nextIdlePickAt: 4.2,
      idleMode: 'patrol',
      chaseBubbleIdx: 0,
      chaseLastY: 999,
      spoutUntil: 0,
      celebrateUntil: 0,
      startleUntil: 0,
    };

    this.bubbles = Array.from({ length: 12 }, (_, i) => ({
      x: 24 + ((i * 21) % 202),
      y: 26 + ((i * 19) % 104),
      r: 2.2 + (i % 4) * 1.15,
      vy: 14 + (i % 5) * 4.5,
      phase: i * 0.9,
    }));
    this.trail = [];
    this.splashes = [];
    this.popRings = [];
    this.emotes = [];
    this.mailItems = [];
    if (this.canvas) this.resize(248, 139);
  }

  resize(cssW, cssH) {
    if (!this.canvas) return;
    const dpr = Math.max(2, Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 2));
    const pw = Math.max(248, Math.round((cssW || 180) * dpr));
    const ph = Math.max(139, Math.round((cssH || 100) * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.dpr = pw / this.W;
  }

  _requestTurn(desiredDir, requireHysteresis, dx) {
    const w = this.w;
    if (desiredDir !== 1 && desiredDir !== -1) return;
    if (w.turning) {
      w.wantOppositeSince = null;
      return;
    }
    if (desiredDir === w.targetDir) {
      w.wantOppositeSince = null;
      return;
    }
    if (requireHysteresis) {
      if (Math.abs(dx) <= 22 || dx * w.targetDir >= -22) {
        w.wantOppositeSince = null;
        return;
      }
      if (w.wantOppositeSince === null) {
        w.wantOppositeSince = this.clock;
        return;
      }
      if (this.clock - w.wantOppositeSince < 0.42) return;
    }
    if (this.clock - w.lastTurnAt < 1.55) return;
    w.targetDir = desiredDir;
    w.turning = true;
    w.turnFrom = w.facing >= 0 ? 1 : -1;
    w.turnTo = desiredDir;
    w.turnElapsed = 0;
    w.lastTurnAt = this.clock;
    w.wantOppositeSince = null;
  }

  _beginTargetBlend() {
    const w = this.w;
    w.blendFromX = w.tx;
    w.blendFromY = w.ty;
    w.blendElapsed = 0;
    w.blendDur = 0.60;
  }

  cancelForMachine(targetId) {
    this.mailItems = this.mailItems.filter((it) => it.machine !== targetId);
    if (this.w.mouthCarry && this.w.mouthCarry.machine === targetId) {
      this.w.mouthCarry = null;
    }
  }

  clearMail() {
    this.mailItems = [];
    this.w.mouthCarry = null;
  }

  spawnOutgoingMail(toId, color, onSurfacePop, nowOverride) {
    const toRight = toId !== 'li';
    this._requestTurn(toRight ? 1 : -1, false, 0);
    const sx = Math.max(44, Math.min(204, this.w.x + (toRight ? 28 : -28)));
    const sy = Math.max(44, Math.min(106, this.w.y + 2));
    this.mailItems.push({
      type: 'out',
      machine: toId,
      x: sx,
      y: sy,
      sy,
      tx: toRight ? 166 : 82,
      color: color || '#ef6da4',
      r: 14.5,
      bornAt: nowOverride !== undefined ? nowOverride : this._lastNow,
      age: 0,
      dur: 560,
      onPop: onSurfacePop,
    });
    this._spawnSpout(5);
  }

  spawnIncomingMail(fromId, color, onCaught, relayToId = null, relayColor = null, onRelayPop = null, nowOverride = undefined) {
    const fromLeft = fromId === 'li';
    const entryX = fromLeft ? 74 : 174;
    this._spawnSplash(entryX, 22, 11, '#e8fdff');
    this.popRings.push({ x: entryX, y: 23, r: 4, maxR: 22, age: 0, dur: 420 });
    this.mailItems.push({
      type: relayToId ? 'relay' : 'in',
      machine: relayToId || fromId,
      x: entryX,
      y: 25,
      vy: 34,
      fromLeft,
      toRight: relayToId ? relayToId !== 'li' : !fromLeft,
      color: color || '#4a96ff',
      relayColor: relayColor || color || '#ef6da4',
      r: 13.5,
      stage: 'sink',
      bornAt: nowOverride !== undefined ? nowOverride : this._lastNow,
      age: 0,
      onCaught,
      onPop: onRelayPop,
    });
  }

  triggerCelebrate(now) {
    this.w.celebrateUntil = now + 2600;
    this.w.spoutUntil = now + 1800;
    this.w.spin = 0;
    this._spawnSpout(10);
    for (let i = 0; i < 6; i++) {
      this.emotes.push({
        kind: 'heart',
        x: this.w.x + (Math.random() * 44 - 22),
        y: this.w.y - 12 + (Math.random() * 14 - 7),
        vx: (Math.random() - 0.5) * 26,
        vy: -(24 + Math.random() * 22),
        size: 5 + Math.random() * 3.5,
        age: 0,
        life: 1400 + Math.random() * 500,
      });
    }
  }

  triggerStop(now, durationMs = 3800) {
    this.w.stopActiveUntil = now + durationMs;
    this.w.mouthCarry = null;
    this.w.spin = 0;
  }

  triggerTapStartle(now) {
    this.w.startleUntil = now + 420;
    this._spawnSpout(6);
  }

  _spawnSplash(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI * (0.15 + Math.random() * 0.7);
      const spd = 28 + Math.random() * 54;
      this.splashes.push({
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        r: 1.6 + Math.random() * 2.1,
        color: color || '#e6fcff',
        age: 0,
        life: 360 + Math.random() * 220,
      });
    }
  }

  _spawnSpout(count) {
    const bx = this.w.x + this.w.facing * 6;
    const by = this.w.y - 22;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      this.emotes.push({
        kind: 'drop',
        x: bx,
        y: by,
        vx: side * (12 + Math.random() * 24),
        vy: -(38 + Math.random() * 28),
        size: 2.0 + Math.random() * 1.4,
        age: 0,
        life: 520 + Math.random() * 240,
      });
    }
  }

  step(state, dt, now, reduced, isDark) {
    const dsh = state.dsh || { mode: 'normal', intent: 'idle', lookAt: 'center' };
    const mLi = state.machines.li;
    const mLi2 = state.machines.li2;
    const bothSleeping = mLi.status === 'sleeping' && mLi2.status === 'sleeping';
    const nightIdleSleep = isDark && mLi.status === 'sleeping' && mLi2.status !== 'working' && mLi2.status !== 'approval';
    const isSleeping = dsh.mode === 'sleep' || bothSleeping || nightIdleSleep;
    const isStop = dsh.mode === 'stop' || now < this.w.stopActiveUntil;
    const isWarn = !isStop && (!!state.approval || dsh.mode === 'warn');
    const isGood = !isStop && (dsh.mode === 'good' || now < this.w.celebrateUntil);
    const isThinking = !isStop && !isWarn && dsh.intent === 'thinking';
    const isDispatch = !isStop && !isWarn && dsh.intent === 'dispatch';
    const isStartled = !isStop && now < this.w.startleUntil;

    if (this.buttonEl) this.buttonEl.classList.toggle('mode-sleep', isSleeping);
    if (this.wallCausticsEl) {
      this.wallCausticsEl.classList.toggle('is-dim', isSleeping);
      this.wallCausticsEl.classList.toggle('is-warn', isWarn);
    }

    const sec = Math.min(0.06, Math.max(0.008, dt / 1000));
    this._lastNow = now;
    if (!reduced) this.clock += sec;
    const t = reduced ? 0 : this.clock;
    const w = this.w;

    const activeMail = [];
    for (const it of this.mailItems) {
      const wallElapsed = (it.bornAt !== undefined && now >= it.bornAt && now - it.bornAt < 60000) ? (now - it.bornAt) : 0;
      it.age = Math.max(it.age + dt, wallElapsed);
      if (it.type === 'out') {
        const u = reduced ? 1 : Math.min(1, it.age / it.dur);
        const e = easeInOut(u);
        it.x += (it.tx - it.x) * Math.min(1, sec * 4.8);
        it.y = (it.sy || 76) + (23 - (it.sy || 76)) * e;
        if (it.y <= 24 || u >= 1) {
          this._spawnSplash(it.x, 22, 10, '#ffffff');
          this.popRings.push({ x: it.x, y: 23, r: 4, maxR: 24, age: 0, dur: 380 });
          if (it.onPop) it.onPop(it.x);
          continue;
        }
        activeMail.push(it);
      } else if (it.type === 'in' || it.type === 'relay') {
        if (it.stage === 'sink') {
          const su = Math.min(1, it.age / 900);
          it.y = 25 + 60 * su;
          it.x += reduced ? 0 : Math.sin(it.age * 0.004) * 8 * sec;
          const dist = Math.hypot(w.x - it.x, w.y - it.y);
          if (dist < 28 || it.age > 1100 || reduced) {
            w.nodPhase = 1;
            w.spoutUntil = now + 900;
            this._spawnSpout(6);
            if (it.onCaught) { const fn = it.onCaught; it.onCaught = null; fn(); }
            if (it.type === 'relay') {
              it.stage = 'carry';
              it.bornAt = now;
              it.age = 0;
              w.mouthCarry = { color: it.relayColor, machine: it.machine };
              activeMail.push(it);
            }
            continue;
          }
          activeMail.push(it);
        } else if (it.stage === 'carry') {
          const destX = it.toRight ? 176 : 72;
          const reached = Math.abs(w.x - destX) < 16 || it.age > 2400 || reduced;
          if (reached) {
            w.mouthCarry = null;
            it.stage = 'rise';
            it.bornAt = now;
            it.age = 0;
            it.x = w.x + (it.toRight ? 24 : -24);
            it.y = w.y - 2;
            it.sy = it.y;
            it.tx = it.toRight ? 184 : 64;
            activeMail.push(it);
          } else {
            activeMail.push(it);
          }
        } else if (it.stage === 'rise') {
          const ru = Math.min(1, it.age / 580);
          it.x += (it.tx - it.x) * Math.min(1, sec * 4.8);
          it.y = (it.sy || 74) + (23 - (it.sy || 74)) * easeInOut(ru);
          if (it.y <= 24 || ru >= 1 || reduced) {
            this._spawnSplash(it.x, 22, 10, '#ffffff');
            this.popRings.push({ x: it.x, y: 23, r: 4, maxR: 24, age: 0, dur: 380 });
            if (it.onPop) it.onPop(it.x);
            continue;
          }
          activeMail.push(it);
        }
      }
    }
    this.mailItems = activeMail;

    let targetScale = 1;
    let explicitTilt = null;
    let modeKey = 'idle';
    let rawTx = w.rawTx;
    let rawTy = w.rawTy;
    let desiredDir = null;
    let dirNeedsHysteresis = true;

    const sinkMail = this.mailItems.find((it) => it.stage === 'sink');
    const carryMail = this.mailItems.find((it) => it.stage === 'carry');
    const outMail = this.mailItems.find((it) => it.type === 'out' || it.stage === 'rise');

    if (isStop) {
      modeKey = 'stop';
      rawTx = 84;
      rawTy = 78 + (reduced ? 0 : Math.sin(t * 1.1) * 1.8);
      desiredDir = 1;
      dirNeedsHysteresis = false;
      targetScale = 1.04;
      explicitTilt = 0;
    } else if (isStartled) {
      modeKey = 'startle';
      rawTx = 124;
      rawTy = 74;
      targetScale = 1.20;
      explicitTilt = Math.sin(t * 4.2) * 0.04;
    } else if (carryMail) {
      modeKey = 'carry';
      rawTx = carryMail.toRight ? 178 : 70;
      rawTy = 75 + Math.sin(t * 1.2) * 4;
      w.relayLegDir = carryMail.toRight ? 1 : -1;
      w.relayPauseUntil = t + 2.2;
      desiredDir = carryMail.toRight ? 1 : -1;
      dirNeedsHysteresis = false;
    } else if (sinkMail) {
      modeKey = 'sink';
      rawTx = Math.max(54, Math.min(194, sinkMail.x));
      rawTy = Math.max(48, Math.min(98, sinkMail.y + 4));
      desiredDir = rawTx >= w.x ? 1 : -1;
      dirNeedsHysteresis = true;
    } else if (isWarn) {
      modeKey = 'warn';
      rawTx = 114;
      rawTy = 52 + (reduced ? 0 : Math.sin(t * 1.6) * 2.2);
      desiredDir = 1;
      dirNeedsHysteresis = false;
      explicitTilt = -0.26;
      targetScale = 1.04;
    } else if (isSleeping) {
      modeKey = 'sleep';
      rawTx = 124;
      rawTy = 76 + (reduced ? 0 : Math.sin(t * 0.9) * 3.8);
      desiredDir = 1;
      dirNeedsHysteresis = false;
      explicitTilt = reduced ? 0 : Math.sin(t * 0.9) * 0.035;
      if (!reduced) {
        this._zTimer += sec;
        if (this._zTimer >= 1.7) {
          this._zTimer -= 1.7;
          this.emotes.push({
            kind: 'z',
            x: w.x + 18,
            y: w.y - 16,
            vx: 6 + Math.random() * 6,
            vy: -(16 + Math.random() * 8),
            size: 10 + Math.random() * 4,
            age: 0,
            life: 2100,
          });
        }
      }
    } else if (isGood) {
      modeKey = 'good';
      rawTx = 124 + (reduced ? 0 : Math.sin(t * 0.7) * 20);
      rawTy = 72 - (reduced ? 0 : Math.abs(Math.sin(t * 1.5)) * 7);
      desiredDir = rawTx >= w.x ? 1 : -1;
      dirNeedsHysteresis = true;
      explicitTilt = reduced ? 0 : Math.sin(t * 1.9) * 0.09;
      targetScale = 1.05;
    } else if (outMail || isDispatch) {
      modeKey = 'dispatch';
      const toRight = outMail ? outMail.tx > 124 : dsh.lookAt !== 'li';
      rawTx = toRight ? 108 : 140;
      rawTy = 76 + (reduced ? 0 : Math.sin(t * 1.3) * 3.0);
      desiredDir = toRight ? 1 : -1;
      dirNeedsHysteresis = false;
    } else if (dsh.mode === 'relay') {
      modeKey = 'relay';
      const destX = w.relayLegDir > 0 ? 178 : 70;
      if (!reduced && Math.abs(w.x - destX) < 12) {
        if (w.relayPauseUntil < 0) {
          w.relayPauseUntil = t + 2.2;
        } else if (t >= w.relayPauseUntil) {
          w.relayLegDir = -w.relayLegDir;
          w.relayPauseUntil = -1;
        }
      }
      rawTx = w.relayLegDir > 0 ? 178 : 70;
      rawTy = 75 + (reduced ? 0 : Math.sin(t * 1.1) * 5.0);
      desiredDir = w.relayLegDir;
      dirNeedsHysteresis = false;
    } else {
      if (!reduced && t >= w.nextIdlePickAt) {
        const modes = ['patrol', 'chase', 'patrol', 'glass', 'yawn'];
        w.idleMode = modes[this._idleSeq % modes.length];
        this._idleSeq += 1;
        w.nextIdlePickAt = t + 5.2 + (this._idleSeq % 3) * 0.8;
        if (w.idleMode === 'yawn') w.yawnUntil = t + 1.1;
        if (w.idleMode === 'chase') {
          w.chaseBubbleIdx = (this._idleSeq * 3) % this.bubbles.length;
          w.chaseLastY = this.bubbles[w.chaseBubbleIdx] ? this.bubbles[w.chaseBubbleIdx].y : 999;
        }
      }
      modeKey = 'idle:' + (reduced ? 'static' : w.idleMode);
      if (reduced) {
        rawTx = 124;
        rawTy = 76;
        desiredDir = dsh.lookAt === 'li' ? -1 : 1;
        dirNeedsHysteresis = false;
      } else if (w.idleMode === 'glass') {
        rawTx = 124 + Math.sin(t * 0.65) * 14;
        rawTy = 74 + Math.cos(t * 0.85) * 4.5;
        targetScale = 1.10;
        if (dsh.lookAt === 'li') { desiredDir = -1; dirNeedsHysteresis = false; }
        else if (dsh.lookAt === 'li2') { desiredDir = 1; dirNeedsHysteresis = false; }
      } else if (w.idleMode === 'chase' && this.bubbles[w.chaseBubbleIdx]) {
        const cb = this.bubbles[w.chaseBubbleIdx];
        if (cb.y - w.chaseLastY > 50) this._beginTargetBlend();
        w.chaseLastY = cb.y;
        rawTx = Math.max(54, Math.min(194, cb.x - 16));
        rawTy = Math.max(48, Math.min(100, cb.y + 8));
        desiredDir = rawTx >= w.x ? 1 : -1;
        dirNeedsHysteresis = true;
      } else {
        const patrolPts = [
          { x: 176, y: 64 },
          { x: 72, y: 88 },
          { x: 74, y: 62 },
          { x: 174, y: 88 },
        ];
        const pt = patrolPts[w.patrolIdx % patrolPts.length];
        if (Math.hypot(w.x - pt.x, w.y - pt.y) < 14) {
          if (w.patrolPauseUntil < 0) {
            w.patrolPauseUntil = t + 0.9;
          } else if (t >= w.patrolPauseUntil) {
            w.patrolIdx = (w.patrolIdx + 1) % patrolPts.length;
            w.patrolPauseUntil = -1;
            this._beginTargetBlend();
          }
        }
        const curPt = patrolPts[w.patrolIdx % patrolPts.length];
        rawTx = curPt.x;
        rawTy = curPt.y + Math.sin(t * 1.0) * 3.5;
        desiredDir = rawTx >= w.x ? 1 : -1;
        dirNeedsHysteresis = true;
      }
    }

    if (modeKey !== w.prevModeKey) {
      w.prevModeKey = modeKey;
      if (!reduced) this._beginTargetBlend();
    }
    w.rawTx = rawTx;
    w.rawTy = rawTy;
    if (reduced || w.blendElapsed >= w.blendDur) {
      w.tx = rawTx;
      w.ty = rawTy;
    } else {
      w.blendElapsed = Math.min(w.blendDur, w.blendElapsed + sec);
      const bu = easeInOut(w.blendElapsed / w.blendDur);
      w.tx = w.blendFromX + (rawTx - w.blendFromX) * bu;
      w.ty = w.blendFromY + (rawTy - w.blendFromY) * bu;
    }

    if (reduced) {
      w.x = w.tx; w.y = w.ty; w.vx = 0; w.vy = 0;
      if (desiredDir) { w.targetDir = desiredDir; w.facing = desiredDir; }
      w.turning = false;
      w.speedMul = 1;
      w.smoothVy = 0;
    } else {
      if (desiredDir !== null) {
        this._requestTurn(desiredDir, dirNeedsHysteresis, w.tx - w.x);
      } else {
        w.wantOppositeSince = null;
      }
      if (w.turning) {
        w.turnElapsed = Math.min(w.turnDur, w.turnElapsed + sec);
        const tu = easeInOut(w.turnElapsed / w.turnDur);
        w.facing = w.turnFrom + (w.turnTo - w.turnFrom) * tu;
        if (w.turnElapsed >= w.turnDur) {
          w.facing = w.turnTo;
          w.turning = false;
        }
      }
      const targetSpeedMul = w.turning ? 0.58 : 1.0;
      w.speedMul += (targetSpeedMul - w.speedMul) * (1 - Math.exp(-5.0 * sec));

      const baseMaxSpeed = (carryMail || sinkMail) ? 64 : (isSleeping ? 18 : 46);
      const maxSpeed = baseMaxSpeed * w.speedMul;
      const maxAccel = (carryMail || sinkMail) ? 130 : 88;
      let desVx = (w.tx - w.x) * 2.1;
      let desVy = (w.ty - w.y) * 2.1;
      const desMag = Math.hypot(desVx, desVy);
      if (desMag > maxSpeed && desMag > 0.001) {
        desVx = (desVx / desMag) * maxSpeed;
        desVy = (desVy / desMag) * maxSpeed;
      }
      let dvx = desVx - w.vx;
      let dvy = desVy - w.vy;
      const dvMag = Math.hypot(dvx, dvy);
      const maxDv = maxAccel * sec;
      if (dvMag > maxDv && dvMag > 0.001) {
        dvx = (dvx / dvMag) * maxDv;
        dvy = (dvy / dvMag) * maxDv;
      }
      w.vx += dvx;
      w.vy += dvy;
      const curSpd = Math.hypot(w.vx, w.vy);
      if (curSpd > maxSpeed && curSpd > 0.001) {
        w.vx = (w.vx / curSpd) * maxSpeed;
        w.vy = (w.vy / curSpd) * maxSpeed;
      }
      w.x = Math.max(46, Math.min(202, w.x + w.vx * sec));
      w.y = Math.max(44, Math.min(106, w.y + w.vy * sec));
    }

    const speed = Math.hypot(w.vx, w.vy);
    if (reduced) {
      w.tailAngle = 0;
      w.finAngle = 0;
    } else {
      const speedNorm = Math.min(1, speed / 55);
      const targetTailFreq = isSleeping ? 2.83 : isStop ? 3.8 : (4.90 + speedNorm * 4.84);
      const targetTailAmp = isSleeping ? 0.10 : isStop ? 0.11 : (0.13 + speedNorm * 0.11);
      const freqAlpha = 1 - Math.exp(-3.0 * sec);
      w.tailFreq += (targetTailFreq - w.tailFreq) * freqAlpha;
      w.tailAmp += (targetTailAmp - w.tailAmp) * freqAlpha;
      w.tailPhase += w.tailFreq * sec;
      if (w.tailPhase > Math.PI * 200) w.tailPhase -= Math.PI * 200;
      w.tailAngle = Math.sin(w.tailPhase) * w.tailAmp;
      w.finAngle = Math.sin(w.tailPhase + 1.1) * (w.tailAmp * 0.72);
      const breathFreq = isSleeping ? 1.76 : 2.35;
      w.breathPhase += breathFreq * sec;
      if (w.breathPhase > Math.PI * 200) w.breathPhase -= Math.PI * 200;
    }

    w.smoothVy += (w.vy - w.smoothVy) * (1 - Math.exp(-3.5 * sec));
    const turnLevel = Math.max(0, (Math.abs(w.facing) - 0.35) / 0.65);
    let targetTilt = 0;
    if (!reduced) {
      if (explicitTilt !== null) {
        targetTilt = explicitTilt * (w.turning ? turnLevel : 1);
      } else {
        targetTilt = Math.max(-0.20, Math.min(0.20, w.smoothVy * 0.0052 * w.facing * turnLevel));
      }
      if (w.nodPhase > 0) targetTilt += Math.sin(w.nodPhase * Math.PI) * 0.11 * turnLevel;
    }
    if (reduced) {
      w.tilt = targetTilt;
      w.scale = targetScale;
    } else {
      const desiredTiltStep = (targetTilt - w.tilt) * (1 - Math.exp(-4.0 * sec));
      const maxTiltStep = 0.58 * sec;
      w.tilt += Math.max(-maxTiltStep, Math.min(maxTiltStep, desiredTiltStep));
      w.scale += (targetScale - w.scale) * (1 - Math.exp(-5.0 * sec));
    }

    if (w.nodPhase > 0) w.nodPhase = Math.max(0, w.nodPhase - sec * 1.4);
    const targetPuff = isStop ? 1 : 0;
    const targetSignY = isStop ? 62 : 162;
    if (reduced) {
      w.puff = targetPuff;
      w.stopSignY = targetSignY;
    } else {
      w.puff += (targetPuff - w.puff) * (1 - Math.exp(-(isStop ? 7.5 : 3.0) * sec));
      w.stopSignY += (targetSignY - w.stopSignY) * (1 - Math.exp(-(isStop ? 6.5 : 3.8) * sec));
    }

    if (!reduced && speed > 16 && !isSleeping && !isStop) {
      this._trailTimer += sec;
      if (this._trailTimer >= 0.14) {
        this._trailTimer = 0;
        this.trail.push({
          x: w.x - Math.sign(w.facing || 1) * 32,
          y: w.y + (Math.random() * 8 - 4),
          r: 1.5 + Math.random() * 1.9,
          vy: -(10 + Math.random() * 12),
          age: 0,
          life: 720 + Math.random() * 350,
        });
      }
    }

    let gx = 0; let gy = 0;
    if (state.flights && state.flights.length > 0) {
      const fl = state.flights[state.flights.length - 1];
      const u = Math.min(1, Math.max(0, (now - fl.start) / Math.max(1, fl.duration)));
      const e = easeInOut(u);
      const fx = fl.from.x + (fl.to.x - fl.from.x) * e;
      const fy = fl.from.y + (fl.to.y - fl.from.y) * e;
      gx = Math.max(-1, Math.min(1, (fx - DSH_CENTER.x) / 26));
      gy = Math.max(-1, Math.min(1, (fy - DSH_CENTER.y) / 20));
    } else if (isWarn || dsh.lookAt === 'up') {
      gx = 0.1; gy = -1;
    } else if (isThinking && !reduced) {
      gx = Math.cos(t * 2.2) * 0.85;
      gy = Math.sin(t * 2.2) * 0.75 - 0.15;
    } else if (dsh.lookAt === 'li') {
      gx = -1; gy = 0.15;
    } else if (dsh.lookAt === 'li2') {
      gx = 1; gy = 0.15;
    }
    const gazeAlpha = reduced ? 1 : (1 - Math.exp(-6.5 * sec));
    w.gazeX += (gx - w.gazeX) * gazeAlpha;
    w.gazeY += (gy - w.gazeY) * gazeAlpha;

    if (!reduced && t >= w.nextBlinkAt) {
      w.blinkUntil = t + 0.15;
      w.nextBlinkAt = t + 3.4 + (Math.floor(t * 7) % 22) * 0.1;
    }

    if (!reduced) {
      for (const b of this.bubbles) {
        b.y -= b.vy * sec;
        b.x += Math.sin(t * 2.2 + b.phase) * 8 * sec;
        if (b.y < 23) {
          this.popRings.push({ x: b.x, y: 23, r: 1.5, maxR: b.r * 2.8, age: 0, dur: 280 });
          b.y = 128 + Math.random() * 8;
          b.x = 22 + Math.random() * 204;
        }
      }
    }
    this.trail = this.trail.filter((tr) => {
      tr.age += dt;
      tr.y += tr.vy * sec;
      tr.x += Math.sin(tr.age * 0.008) * 5 * sec;
      return tr.age < tr.life;
    });
    this.splashes = this.splashes.filter((sp) => {
      sp.age += dt;
      sp.x += sp.vx * sec;
      sp.y += sp.vy * sec;
      sp.vy += 180 * sec;
      return sp.age < sp.life;
    });
    this.popRings = this.popRings.filter((pr) => {
      pr.age += dt;
      return pr.age < pr.dur;
    });
    this.emotes = this.emotes.filter((em) => {
      em.age += dt;
      em.x += em.vx * sec;
      em.y += em.vy * sec;
      if (em.kind === 'drop') em.vy += 130 * sec;
      return em.age < em.life;
    });

    if (this.ctx) {
      this.draw({ mode: dsh.mode, isDark, isSleeping, isStop, isWarn, isGood, isThinking, isDispatch, isStartled, now, reduced, speed, t });
    }
  }

  draw(opts) {
    const { isDark, isSleeping, isStop, isWarn, isGood, isThinking, isDispatch, isStartled, now, reduced } = opts;
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;
    const w = this.w;
    const t = reduced ? 0 : this.clock;
    const ink = isDark ? '#2c2236' : '#583d30';

    ctx.save();
    ctx.scale(this.canvas.width / W, this.canvas.height / H);
    ctx.clearRect(0, 0, W, H);

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    if (isSleeping) {
      bg.addColorStop(0, '#2a6584');
      bg.addColorStop(0.55, '#19415e');
      bg.addColorStop(1, '#102940');
    } else if (isDark) {
      bg.addColorStop(0, '#6ce6fc');
      bg.addColorStop(0.45, '#2b8eba');
      bg.addColorStop(1, '#133e63');
    } else {
      bg.addColorStop(0, '#72dcf0');
      bg.addColorStop(0.48, '#3095c2');
      bg.addColorStop(1, '#19547c');
    }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = isSleeping ? 0.08 : (isDark ? 0.24 : 0.20);
    for (let i = 0; i < 4; i++) {
      const rx = 38 + i * 58 + Math.sin(t * 0.9 + i * 1.4) * 14;
      const rw = 26 + Math.sin(t * 1.2 + i) * 6;
      const g = ctx.createLinearGradient(rx, 16, rx - 20, H - 14);
      g.addColorStop(0, 'rgba(235, 254, 255, 0.9)');
      g.addColorStop(0.7, 'rgba(180, 248, 255, 0.25)');
      g.addColorStop(1, 'rgba(180, 248, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(rx - rw * 0.5, 16);
      ctx.lineTo(rx + rw * 0.5, 16);
      ctx.lineTo(rx + rw * 0.2 - 18, H - 12);
      ctx.lineTo(rx - rw * 0.7 - 18, H - 12);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(204, 253, 255, 0.48)';
    for (let i = 0; i < 5; i++) {
      const cx = 32 + i * 48 + Math.sin(t * 1.3 + i * 1.7) * 9;
      const cy = 129 + Math.cos(t * 1.1 + i) * 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 14 + Math.sin(t + i) * 3, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const waveY = (x) => 20 + Math.sin(x * 0.042 + t * 2.1) * 2.2 + Math.cos(x * 0.025 - t * 1.4) * 1.3;
    ctx.save();
    ctx.fillStyle = isSleeping ? 'rgba(16, 38, 58, 0.42)' : 'rgba(218, 250, 255, 0.28)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    for (let x = W; x >= 0; x -= 8) ctx.lineTo(x, waveY(x));
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = isSleeping ? 'rgba(175, 232, 248, 0.4)' : 'rgba(242, 254, 255, 0.82)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 6) {
      const y = waveY(x);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    const sandG = ctx.createLinearGradient(0, 120, 0, H);
    sandG.addColorStop(0, isDark ? '#70919c' : '#d6c5a3');
    sandG.addColorStop(1, isDark ? '#4a6573' : '#b79e7a');
    ctx.fillStyle = sandG;
    ctx.beginPath();
    ctx.moveTo(0, 127);
    ctx.quadraticCurveTo(64, 120, 124, 126);
    ctx.quadraticCurveTo(188, 132, W, 124);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.globalAlpha = 1;

    const pebbles = [
      { x: 46, y: 132, rx: 11, ry: 5, c: isDark ? '#58788a' : '#9eb3b8' },
      { x: 64, y: 134, rx: 7, ry: 3.6, c: isDark ? '#7d7a8d' : '#c6b1a3' },
      { x: 196, y: 133, rx: 12, ry: 5.2, c: isDark ? '#557285' : '#8ea7b0' },
    ];
    for (const pb of pebbles) {
      ctx.fillStyle = pb.c;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(pb.x, pb.y, pb.rx, pb.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    this._drawShell(ctx, 152, 131, 7, isDark ? '#c69aa8' : '#f7cfd6', ink);
    this._drawShell(ctx, 92, 133, 5.5, isDark ? '#a8b8c9' : '#f5e4c3', ink);

    this._drawWeed(ctx, 20, 130, 38, t, 0, '#49c49d', '#24584e');
    this._drawWeed(ctx, 32, 132, 28, t, 1.1, '#72dfb7', '#24584e');
    this._drawWeed(ctx, 226, 130, 40, t, 2.2, '#49c49d', '#24584e');
    this._drawWeed(ctx, 214, 132, 26, t, 3.0, '#72dfb7', '#24584e');

    for (const b of this.bubbles) this._drawBubble(ctx, b.x, b.y, b.r, 0.78);
    for (const tr of this.trail) this._drawBubble(ctx, tr.x, tr.y, tr.r, Math.max(0, 1 - tr.age / tr.life) * 0.72);

    for (const pr of this.popRings) {
      const u = pr.age / pr.dur;
      ctx.save();
      ctx.strokeStyle = 'rgba(240, 254, 255, ' + ((1 - u) * 0.85).toFixed(3) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(pr.x, pr.y, pr.r + (pr.maxR - pr.r) * u, (pr.r + (pr.maxR - pr.r) * u) * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    this._drawWhale(ctx, { t, isSleeping, isStop, isWarn, isGood, isThinking, isDispatch, isStartled, now, reduced, ink });

    for (const it of this.mailItems) {
      if (it.stage === 'carry') continue;
      this._drawMailBubble(ctx, it.x, it.y, it.r, it.color);
    }

    for (const sp of this.splashes) {
      const u = sp.age / sp.life;
      ctx.fillStyle = sp.color;
      ctx.globalAlpha = Math.max(0, 1 - u);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const em of this.emotes) {
      const u = em.age / em.life;
      const alpha = u < 0.15 ? u / 0.15 : Math.max(0, 1 - (u - 0.15) / 0.85);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (em.kind === 'drop') {
        ctx.fillStyle = '#e4fdff';
        ctx.beginPath();
        ctx.arc(em.x, em.y, em.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (em.kind === 'heart') {
        this._drawBubble(ctx, em.x, em.y, em.size + 3.5, 0.75);
        this._drawHeart(ctx, em.x, em.y + 0.5, em.size * 0.85, '#ff7ca8');
      } else if (em.kind === 'z') {
        ctx.font = '900 ' + Math.round(em.size) + 'px sans-serif';
        ctx.fillStyle = '#e6f7ff';
        ctx.strokeStyle = 'rgba(20, 48, 74, 0.6)';
        ctx.lineWidth = 2.4;
        ctx.strokeText('Z', em.x, em.y);
        ctx.fillText('Z', em.x, em.y);
      }
      ctx.restore();
    }

    if (isThinking) {
      const qx = w.x + (w.facing >= 0 ? 22 : -22);
      const qy = w.y - 32 + Math.sin(t * 3.5) * 2.2;
      this._drawBadgeBubble(ctx, qx, qy, 12, '#e6f8ff', '#2c6eb8', '?', '#18447a');
    }
    if (isWarn) {
      const bob = Math.sin(t * 5.2) * 3.0;
      this._drawBadgeBubble(ctx, 186, 46 + bob, 14.5, '#ffd052', '#5b3710', '!', '#3e2206');
    }
    if (w.stopSignY < 154) this._drawStopSign(ctx, 178, w.stopSignY);

    if (isWarn || isGood || isStop || opts.mode === 'relay') {
      const pulse = 0.55 + Math.sin(t * 3.8) * 0.25;
      const pStr = pulse.toFixed(3);
      const rimColor = isStop ? 'rgba(255, 92, 114, ' + pStr + ')'
        : isWarn ? 'rgba(255, 206, 86, ' + pStr + ')'
        : isGood ? 'rgba(88, 245, 192, ' + pStr + ')'
        : 'rgba(116, 224, 255, ' + (pulse * 0.85).toFixed(3) + ')';
      ctx.save();
      ctx.strokeStyle = rimColor;
      ctx.lineWidth = 6.5;
      ctx.strokeRect(3, 3, W - 6, H - 6);
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.beginPath();
    ctx.moveTo(8, 4); ctx.lineTo(58, 4); ctx.lineTo(24, H - 4); ctx.lineTo(8, H - 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawShell(ctx, x, y, r, fill, stroke) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, 0);
    ctx.lineTo(0, r * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _drawWeed(ctx, bx, by, h, t, phase, fill, stroke) {
    const sway = Math.sin(t * 1.9 + phase) * 6;
    const tipX = bx + sway;
    const tipY = by - h;
    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(bx - 4, by);
    ctx.quadraticCurveTo(bx - 8 + sway * 0.5, by - h * 0.52, tipX, tipY);
    ctx.quadraticCurveTo(bx + 7 + sway * 0.5, by - h * 0.52, bx + 4, by);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _drawBubble(ctx, x, y, r, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(232, 253, 255, 0.30)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y - r * 0.32, Math.max(0.8, r * 0.26), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawHeart(ctx, x, y, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.65);
    ctx.bezierCurveTo(-s * 1.1, -s * 0.1, -s * 0.65, -s * 0.95, 0, -s * 0.3);
    ctx.bezierCurveTo(s * 0.65, -s * 0.95, s * 1.1, -s * 0.1, 0, s * 0.65);
    ctx.fill();
    ctx.restore();
  }

  _drawMailBubble(ctx, x, y, r, color) {
    this._drawBubble(ctx, x, y, r, 0.95);
    ctx.save();
    ctx.translate(x, y);
    const ew = r * 1.12;
    const eh = r * 0.76;
    ctx.fillStyle = '#fffbf3';
    ctx.strokeStyle = color || '#ef6da4';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-ew / 2, -eh / 2, ew, eh, 2.5);
    else ctx.rect(-ew / 2, -eh / 2, ew, eh);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-ew / 2 + 1.5, -eh / 2 + 1.5);
    ctx.lineTo(0, 1.5);
    ctx.lineTo(ew / 2 - 1.5, -eh / 2 + 1.5);
    ctx.stroke();
    ctx.restore();
  }

  _drawBadgeBubble(ctx, x, y, r, bg, border, ch, inkColor) {
    ctx.save();
    ctx.fillStyle = bg;
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = '900 ' + Math.round(r * 1.25) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = inkColor;
    ctx.fillText(ch, x, y + 0.5);
    ctx.restore();
  }

  _drawStopSign(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#d49a68';
    ctx.strokeStyle = '#583d30';
    ctx.lineWidth = 1.8;
    ctx.fillRect(-3.5, 22, 7, 90);
    ctx.strokeRect(-3.5, 22, 7, 90);
    ctx.fillStyle = '#e84357';
    ctx.strokeStyle = '#fff7f7';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-27, -23, 54, 46, 10);
    else ctx.rect(-27, -23, 54, 46);
    ctx.fill();
    ctx.stroke();
    ctx.font = '900 26px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('停', 0, 2);
    ctx.restore();
  }

  _drawWhale(ctx, opts) {
    const { t, isSleeping, isStop, isWarn, isGood, isThinking, isDispatch, isStartled, now, reduced, ink } = opts;
    const w = this.w;
    const puff = w.puff;
    const dirSign = w.facing >= 0 ? 1 : -1;
    const absFace = Math.abs(w.facing);
    const sxFace = dirSign * Math.max(0.44, absFace);
    const syTurn = 1 + (1 - absFace) * 0.10;

    const breath = reduced ? 0 : Math.sin(w.breathPhase);
    const stretchX = 1 + breath * 0.014;
    const stretchY = (1 - breath * 0.012) * syTurn;

    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.rotate(w.tilt);
    ctx.scale(w.scale * sxFace * stretchX, w.scale * stretchY);

    const rx = 31 + puff * 6;
    const ry = 22.5 + puff * 8.5;
    const bodyG = ctx.createRadialGradient(8, -10, 4, 0, 2, rx * 1.25);
    if (puff > 0.45) {
      bodyG.addColorStop(0, '#ffd4dc');
      bodyG.addColorStop(0.55, '#ff7d90');
      bodyG.addColorStop(1, '#dc4259');
    } else {
      bodyG.addColorStop(0, '#d8f4ff');
      bodyG.addColorStop(0.52, '#79c8fa');
      bodyG.addColorStop(1, '#4b98df');
    }

    const tailAng = reduced ? 0 : w.tailAngle;
    ctx.save();
    ctx.translate(-rx + 3, 2);
    ctx.rotate(tailAng);
    ctx.fillStyle = puff > 0.45 ? '#ff7d90' : '#65b6f2';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(4, -2);
    ctx.bezierCurveTo(-6, -3, -15, -14, -20, -11);
    ctx.bezierCurveTo(-22, -7, -15, -1, -11, 1);
    ctx.bezierCurveTo(-16, 4, -21, 12, -16, 14);
    ctx.bezierCurveTo(-10, 15, -5, 6, 4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = bodyG;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, rx - 1, ry - 1, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = puff > 0.45 ? '#fff0f2' : '#f7fcff';
    ctx.beginPath();
    ctx.ellipse(6, ry * 0.72, rx * 0.82, ry * 0.52, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
    ctx.beginPath();
    ctx.ellipse(2, -ry * 0.56, rx * 0.52, ry * 0.24, -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    const finAng = reduced ? 0 : w.finAngle;
    ctx.save();
    ctx.translate(1, 9 + puff * 2);
    ctx.rotate(finAng);
    ctx.fillStyle = puff > 0.45 ? '#ffa0ae' : '#8ed6ff';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2, -1);
    ctx.bezierCurveTo(-9, 8, -3, 15, 5, 11);
    ctx.bezierCurveTo(10, 8, 9, 2, 3, -1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (now < w.spoutUntil && !isSleeping && !isStop) {
      const spU = Math.sin(t * 7.5) * 1.8;
      ctx.save();
      ctx.strokeStyle = '#dffcff';
      ctx.lineWidth = 2.3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(4, -ry - 1);
      ctx.quadraticCurveTo(2, -ry - 14 - spU, -8, -ry - 12);
      ctx.moveTo(4, -ry - 1);
      ctx.quadraticCurveTo(8, -ry - 15 + spU, 17, -ry - 11);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = puff > 0.45 ? 'rgba(255, 92, 118, 0.55)' : 'rgba(255, 146, 174, 0.62)';
    ctx.beginPath();
    ctx.ellipse(8, 5, 5.8, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();

    const blinking = !reduced && t < w.blinkUntil && !isSleeping && !isGood && !isStop && !isWarn;
    const yawning = !reduced && t < w.yawnUntil && !isSleeping && !isStop && !isWarn && !isDispatch;
    const ex = 15;
    const ey = -3.5;
    const lgx = Math.max(-1, Math.min(1, w.gazeX * dirSign));
    const lgy = w.gazeY;

    if (isSleeping) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, ey + 1, 5.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else if (blinking) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - 5.5, ey);
      ctx.quadraticCurveTo(ex, ey + 2.5, ex + 5.5, ey);
      ctx.stroke();
    } else if (isStop) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.arc(ex, ey, 6.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#331c28';
      ctx.beginPath();
      ctx.arc(ex + 0.6, ey + 0.8, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex - 1.2, ey - 1.4, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9be8ff';
      ctx.beginPath();
      ctx.arc(ex + 2.4, ey + 3.2, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - 6, ey - 6.5);
      ctx.lineTo(ex + 3, ey - 9.2);
      ctx.stroke();
    } else if (isGood) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, ey + 2, 5.8, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
    } else if (!isWarn && !isDispatch && !isThinking && !isStartled && Math.abs(w.gazeX) < 0.35 && w.idleMode !== 'glass') {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, ey + 2, 5.4, 1.18 * Math.PI, 1.82 * Math.PI);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(ex, ey, isStartled ? 6.6 : 5.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const px = ex + lgx * 2.1;
      const py = ey + lgy * 2.1;
      ctx.fillStyle = '#23324d';
      ctx.beginPath();
      ctx.arc(px, py, isStartled ? 2.6 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px - 1.1, py - 1.3, 1.5, 0, Math.PI * 2);
      ctx.fill();
      if (isDispatch) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ex - 5, ey - 8.5);
        ctx.lineTo(ex + 5.5, ey - 6.5);
        ctx.stroke();
      }
      if (isWarn) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ex - 5.5, ey - 7);
        ctx.lineTo(ex + 3.5, ey - 9.5);
        ctx.stroke();
        ctx.fillStyle = '#9ef2ff';
        ctx.strokeStyle = '#2c689c';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(ex - 11, ey - 10);
        ctx.quadraticCurveTo(ex - 14.5, ey - 3.5, ex - 11, ey - 2);
        ctx.quadraticCurveTo(ex - 7.5, ey - 3.5, ex - 11, ey - 10);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.1;
    ctx.lineCap = 'round';
    if (w.mouthCarry) {
      ctx.save();
      ctx.translate(rx - 1, 5);
      ctx.fillStyle = '#fffbf2';
      ctx.strokeStyle = w.mouthCarry.color || '#ef6da4';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-2, -6, 15, 10.5, 2);
      else ctx.rect(-2, -6, 15, 10.5);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-1, -5); ctx.lineTo(5.5, 0); ctx.lineTo(12, -5);
      ctx.stroke();
      ctx.restore();
    } else if (isStop) {
      ctx.beginPath();
      ctx.arc(23.5, 8.5, 3.6, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
    } else if (yawning || isWarn || isStartled) {
      ctx.fillStyle = '#ff98b2';
      ctx.beginPath();
      ctx.ellipse(23.5, 5.5, yawning ? 4.4 : 2.8, yawning ? 5.2 : 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(19, 5.2);
      ctx.quadraticCurveTo(24, 9.2, 28.5, 4.8);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// =========================================================================
// 3. 初始实时状态与六幕演示剧本（仅点「演示」时启动，点「退出」回真实数据）
// =========================================================================
function createDefaultLiveState() {
  return {
    demoMode: false,
    actIndex: 1,
    actLabel: '连接中…',
    selected: 'li2',
    radialOpenFor: null,
    dshChatOpen: false,
    termModalFor: null,
    webModalUrl: null,
    petMissing: false,
    unreachable: false,
    approval: null,
    dsh: { face: '^‿^', caption: '', mode: 'normal', intent: 'idle', lookAt: 'center' },
    machines: {
      li: { id: 'li', petName: '鲸娘', status: 'idle', spot: 'liDesk', actionTag: '等待数据', offline: false, speech: null, cheerUntil: 0, carryMode: false, cooldownUntil: null, remoteUrl: null },
      li2: { id: 'li2', petName: '小粉鱼', status: 'idle', spot: 'li2Desk', actionTag: '等待数据', offline: false, speech: null, cheerUntil: 0, carryMode: false, cooldownUntil: null, remoteUrl: null },
    },
    terminal: { li: ['（等待拉取 li 终端画面）'], li2: ['（等待拉取 li2 终端画面）'] },
    groupChat: [],
    flights: [],
    confetti: [],
    glowPulses: [],
  };
}

function createDemoState() {
  return {
    demoMode: true,
    actIndex: 1,
    actLabel: '1 · DSH 派活',
    selected: 'li2',
    radialOpenFor: null,
    dshChatOpen: false,
    termModalFor: null,
    webModalUrl: null,
    petMissing: false,
    unreachable: false,
    approval: null,
    dsh: { face: '^‿^', caption: '准备就绪 · 随时派活', mode: 'normal', intent: 'idle', lookAt: 'center' },
    machines: {
      li: { id: 'li', petName: '鲸娘', status: 'idle', spot: 'liDesk', actionTag: '空闲', offline: false, speech: null, cheerUntil: 0, carryMode: false, cooldownUntil: null, remoteUrl: 'https://antigravity.google.com/r/demo-li' },
      li2: { id: 'li2', petName: '小粉鱼', status: 'idle', spot: 'li2Desk', actionTag: '空闲', offline: false, speech: null, cheerUntil: 0, carryMode: false, cooldownUntil: null, remoteUrl: 'https://antigravity.google.com/r/demo-li2' },
    },
    terminal: {
      li: ['● Standing by · /data/workspace/stm32-ctrl'],
      li2: ['● Standing by · /data/workspace/liming-work-site'],
    },
    groupChat: [
      { route: 'DSH · 演示', cls: '', text: '演示模式：三方对话全经 DSH 居中转达，点顶部「退出」回到真实数据。', time: nowHm() },
    ],
    flights: [],
    confetti: [],
    glowPulses: [],
  };
}

function detectHostDark() {
  const docEl = document.documentElement;
  if (docEl.dataset.theme === 'dark' || docEl.classList.contains('dark')) return true;
  if (docEl.dataset.theme === 'light' || docEl.classList.contains('light')) return false;
  if (document.body && document.body.classList.contains('dark')) return true;
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

// =========================================================================
// 4. mount(root, opts)
// =========================================================================
export function mount(root, opts = {}) {
  const layout = opts.layout || 'full'; // 'pane' | 'full'
  const assetBase = (opts.assetBase || '/liming-crew/assets').replace(/\/+$/, '');
  const petBase = (opts.petBase || '/liming-crew/pets').replace(/\/+$/, '');
  const callbacks = opts.callbacks || {};

  const container = document.createElement('div');
  container.className = 'lc-house-root';
  container.dataset.layout = layout;
  container.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-title">三方小屋</span>
          <span class="act-pill" data-el="actPill"><span class="act-dot"></span><span data-el="actText">实时同步</span></span>
          <button type="button" class="exit-demo-btn" data-act="exit-demo" data-el="exitDemoBtn" hidden>退出</button>
        </div>
        <div class="top-btns">
          <button type="button" class="pill-btn" data-act="open-dsh-chat">群聊</button>
          <button type="button" class="pill-btn" data-act="start-demo" data-el="demoBtn">演示</button>
          <button type="button" class="pill-btn" data-act="theme">日/夜</button>
        </div>
      </header>

      <div class="pet-warn-banner" data-el="petWarn" hidden role="status">
        <span>宠物图没下载到，重跑装机脚本即可</span>
      </div>

      <main class="main-grid">
        <section class="house-col">
          <div class="house-frame" data-el="houseFrame">
            <img class="house-img day" data-el="imgDay" alt="白天双层小屋">
            <img class="house-img night" data-el="imgNight" alt="夜晚双层小屋">

            <div class="amb-layer" aria-hidden="true">
              <span class="steam s1"></span>
              <span class="steam s2"></span>
              <span class="steam s3"></span>
              <span class="dust d1"></span>
              <span class="dust d2"></span>
              <span class="dust d3"></span>
              <div class="sleep-dim" data-el="sleepDim"></div>
            </div>

            <div class="mon-back-glow glow-li" data-el="backGlowLi" aria-hidden="true"></div>
            <div class="mon-back-glow glow-li2" data-el="backGlowLi2" aria-hidden="true"></div>

            <button type="button" class="desk-screen-btn mon-li" data-act="open-term" data-machine="li" data-el="monGlowLi" aria-label="查看 li 终端画面" title="点看 li 终端"></button>
            <button type="button" class="desk-screen-btn mon-li2" data-act="open-term" data-machine="li2" data-el="monGlowLi2" aria-label="查看 li2 终端画面" title="点看 li2 终端"></button>

            <div class="tank-wall-caustics" data-el="tankCaustics" aria-hidden="true"></div>

            <button type="button" class="dsh-screen" data-act="open-dsh-chat" data-el="dshScreen" aria-label="点击展开 DSH 三方群聊记录">
              <canvas class="tank-canvas" data-el="tankCanvas"></canvas>
              <span data-el="tankFrameHost" aria-hidden="true"></span>
              <span class="sr-only" data-el="dshFace">^‿^</span>
            </button>

            <div class="dsh-caption" data-el="dshCaption"><span class="dsh-caption-text" data-el="dshCaptionText"></span></div>
            <div class="window-knock" data-el="winKnock" aria-hidden="true"><i></i><i></i></div>

            <div class="actor-wrap is-behind-desk" data-el="wrapLi">
              <div class="actor-anchor">
                <button type="button" class="actor-hit" data-act="pet" data-machine="li" aria-label="操作 li 鲸娘">
                  <div class="actor-shadow"></div>
                  <canvas class="pet-canvas" data-el="canvasLi"></canvas>
                  <div class="face-glow" aria-hidden="true"></div>
                </button>
              </div>
            </div>

            <div class="actor-wrap is-behind-desk" data-el="wrapLi2">
              <div class="actor-anchor">
                <button type="button" class="actor-hit" data-act="pet" data-machine="li2" aria-label="操作 li2 小粉鱼">
                  <div class="actor-shadow"></div>
                  <canvas class="pet-canvas" data-el="canvasLi2"></canvas>
                  <div class="face-glow" aria-hidden="true"></div>
                </button>
              </div>
            </div>

            <img class="house-fg day fg-desk-li" data-el="fgDayLi" alt="" aria-hidden="true">
            <img class="house-fg night fg-desk-li" data-el="fgNightLi" alt="" aria-hidden="true">
            <img class="house-fg day fg-desk-li2" data-el="fgDayLi2" alt="" aria-hidden="true">
            <img class="house-fg night fg-desk-li2" data-el="fgNightLi2" alt="" aria-hidden="true">

            <div class="actor-badge" data-el="badgeLi">li · 空闲</div>
            <div class="actor-badge is-pink" data-el="badgeLi2">li2 · 空闲</div>
            <div class="actor-speech" data-el="speechLi"><span></span></div>
            <div class="actor-speech" data-el="speechLi2"><span></span></div>

            <canvas class="fx-canvas" data-el="fxCanvas"></canvas>
            <div data-el="flightTagLayer" aria-hidden="true"></div>

            <div class="radial-ring" data-el="radialRing" hidden role="menu" aria-label="角色快捷操作">
              <button type="button" class="orb-btn is-primary" data-act="radial-say" data-el="orbSay"><span class="orb-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H6l-3 2 1-4a8 8 0 1 1 17-6Z"/></svg></span><span class="orb-lbl">插话</span></button>
              <button type="button" class="orb-btn" data-act="radial-term" data-el="orbTerm"><span class="orb-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/></svg></span><span class="orb-lbl">终端</span></button>
              <button type="button" class="orb-btn" data-act="radial-stop" data-el="orbStop"><span class="orb-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none"/></svg></span><span class="orb-lbl">叫停</span></button>
              <button type="button" class="orb-btn" data-act="radial-web" data-el="orbWeb"><span class="orb-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg></span><span class="orb-lbl">接管</span></button>
            </div>

            <section class="dsh-chat-overlay" data-el="dshChatOverlay" hidden role="dialog" aria-label="DSH 屏幕三方对话记录">
              <div class="dsh-ov-head">
                <span class="dsh-ov-title"><svg class="ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="13" rx="2.5"/><path d="M8 21h8M12 18v3"/></svg> DSH 鱼缸 · 三方对话记录</span>
                <button type="button" class="dsh-ov-close" data-act="close-dsh-chat">关闭</button>
              </div>
              <ul class="dsh-ov-list" data-el="dshChatList"></ul>
            </section>
          </div>

          <nav class="director-bar" aria-label="演示场景快跳" data-el="directorBar" hidden>
            <button type="button" class="scene-chip is-active" data-act="jump" data-scene="1">1 派活</button>
            <button type="button" class="scene-chip" data-act="jump" data-scene="2">2 汇报</button>
            <button type="button" class="scene-chip" data-act="jump" data-scene="3">3 经DSH转达</button>
            <button type="button" class="scene-chip" data-act="jump" data-scene="4">4 交叉审查</button>
            <button type="button" class="scene-chip" data-act="jump" data-scene="5">5 窗前拍板</button>
            <button type="button" class="scene-chip" data-act="jump" data-scene="6">6 休眠叫醒叫停</button>
          </nav>
        </section>

        <aside class="hub-col">
          <section class="approval-panel" data-el="approvalPanel" hidden aria-live="polite">
            <div class="approval-top">
              <span class="approval-title" data-el="approvalTitle">等你拍板</span>
              <span class="approval-tag" data-el="approvalTag">待审批</span>
            </div>
            <div class="approval-cmd" data-el="approvalCmd"></div>
            <div class="approval-note" data-el="approvalNote"></div>
            <div class="approval-btns" data-el="approvalBtns">
              <button type="button" class="btn btn-deny" data-act="reject">拒绝</button>
              <button type="button" class="btn btn-allow" data-act="approve">批准执行</button>
            </div>
          </section>

          <div class="hub-card" data-el="hubCard">
            <div class="hub-head">
              <span class="hub-title"><svg class="ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="13" rx="2.5"/><path d="M8 21h8M12 18v3"/></svg>DSH 三方群聊</span>
              <span class="hub-rule">全经 DSH 转达</span>
            </div>
            <ul class="chat-feed" data-el="chatFeed"></ul>
          </div>

          <div class="compose-card">
            <div class="target-row">
              <div class="target-switch" role="tablist" aria-label="选择插话对象">
                <button type="button" class="target-tab" data-act="pick-target" data-machine="li" data-el="tabLi">li 鲸娘</button>
                <button type="button" class="target-tab is-pink is-active" data-act="pick-target" data-machine="li2" data-el="tabLi2">li2 小粉鱼</button>
              </div>
              <div class="quick-tools">
                <button type="button" class="mini-tool" data-act="open-sel-term">终端</button>
                <button type="button" class="mini-tool" data-act="stop-sel">叫停</button>
                <button type="button" class="mini-tool" data-act="web-sel">接管</button>
              </div>
            </div>
            <form class="compose-form" data-el="composeForm">
              <input class="compose-input" type="text" maxlength="2000" autocomplete="off" data-el="composeInput" placeholder="经 DSH 给小粉鱼发句话…">
              <button type="submit" class="btn btn-send is-pink" data-el="sendBtn">发送</button>
            </form>
          </div>
        </aside>
      </main>
    </div>

    <div class="modal-backdrop" data-el="termBackdrop" hidden>
      <div class="term-modal" role="dialog" aria-modal="true" aria-label="终端画面">
        <div class="term-bar">
          <span data-el="termTitle">终端画面</span>
          <div class="term-bar-acts">
            <button type="button" class="term-btn" data-act="refresh-term">刷新</button>
            <button type="button" class="term-btn" data-act="copy-term">复制</button>
            <button type="button" class="term-btn" data-act="close-term">关闭</button>
          </div>
        </div>
        <pre class="term-pre" data-el="termPre"></pre>
      </div>
    </div>

    <div class="modal-backdrop" data-el="webBackdrop" hidden>
      <div class="web-modal" role="dialog" aria-modal="true" aria-label="网页接管">
        <div class="web-title">打开 Antigravity 网页接管？</div>
        <div class="web-url" data-el="webUrl"></div>
        <div class="web-acts">
          <button type="button" class="btn" data-act="close-web">取消</button>
          <a class="btn btn-send" data-el="webAnchor" data-act="confirm-web" href="#" target="_blank" rel="noopener noreferrer">打开网页</a>
        </div>
      </div>
    </div>

    <div class="toast" data-el="toast" role="status" aria-live="polite"></div>
  `;

  root.innerHTML = '';
  root.appendChild(container);

  const q = (name) => container.querySelector(`[data-el="${name}"]`);
  const els = {
    actPill: q('actPill'), actText: q('actText'), exitDemoBtn: q('exitDemoBtn'), demoBtn: q('demoBtn'),
    petWarn: q('petWarn'), houseFrame: q('houseFrame'), imgDay: q('imgDay'), imgNight: q('imgNight'),
    sleepDim: q('sleepDim'), backGlowLi: q('backGlowLi'), backGlowLi2: q('backGlowLi2'),
    monGlowLi: q('monGlowLi'), monGlowLi2: q('monGlowLi2'),
    fgDayLi: q('fgDayLi'), fgNightLi: q('fgNightLi'), fgDayLi2: q('fgDayLi2'), fgNightLi2: q('fgNightLi2'),
    tankCaustics: q('tankCaustics'), dshScreen: q('dshScreen'), tankCanvas: q('tankCanvas'),
    tankFrameHost: q('tankFrameHost'), dshFace: q('dshFace'), dshCaption: q('dshCaption'),
    dshCaptionText: q('dshCaptionText'), winKnock: q('winKnock'),
    wrapLi: q('wrapLi'), wrapLi2: q('wrapLi2'), canvasLi: q('canvasLi'), canvasLi2: q('canvasLi2'),
    badgeLi: q('badgeLi'), badgeLi2: q('badgeLi2'), speechLi: q('speechLi'), speechLi2: q('speechLi2'),
    fxCanvas: q('fxCanvas'), flightTagLayer: q('flightTagLayer'), radialRing: q('radialRing'),
    orbSay: q('orbSay'), orbTerm: q('orbTerm'), orbStop: q('orbStop'), orbWeb: q('orbWeb'),
    dshChatOverlay: q('dshChatOverlay'), dshChatList: q('dshChatList'), directorBar: q('directorBar'),
    approvalPanel: q('approvalPanel'), approvalTitle: q('approvalTitle'), approvalTag: q('approvalTag'),
    approvalCmd: q('approvalCmd'), approvalNote: q('approvalNote'), approvalBtns: q('approvalBtns'),
    chatFeed: q('chatFeed'), tabLi: q('tabLi'), tabLi2: q('tabLi2'),
    composeForm: q('composeForm'), composeInput: q('composeInput'), sendBtn: q('sendBtn'),
    termBackdrop: q('termBackdrop'), termTitle: q('termTitle'), termPre: q('termPre'),
    webBackdrop: q('webBackdrop'), webUrl: q('webUrl'), webAnchor: q('webAnchor'),
    toast: q('toast'),
  };

  const dayUrl = `${assetBase}/house-day.jpg`;
  const nightUrl = `${assetBase}/house-night.jpg`;
  els.imgDay.src = dayUrl;
  els.imgNight.src = nightUrl;
  els.fgDayLi.src = dayUrl;
  els.fgNightLi.src = nightUrl;
  els.fgDayLi2.src = dayUrl;
  els.fgNightLi2.src = nightUrl;

  let state = createDefaultLiveState();
  let savedLiveScene = null;
  let manualTheme = null; // null = follow host/system, 'dark' | 'light'
  let toastTimer = 0;
  let rafId = 0;
  let lastTs = 0;
  let lastNow = Date.now();
  let drawnFrames = 0;
  let paused = false;
  let demoTimers = [];
  const lastTapAt = { li: 0, li2: 0 };

  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isDarkMode = () => (manualTheme ? manualTheme === 'dark' : detectHostDark());

  function syncThemeClass() {
    const dark = isDarkMode();
    container.classList.toggle('is-dark', dark);
    els.houseFrame.classList.toggle('is-dark', dark);
  }
  syncThemeClass();

  const onPetMissing = () => {
    state.petMissing = true;
    els.petWarn.hidden = false;
  };
  const sprites = {
    li: new PetSprite(els.canvasLi, 'whale-girl', petBase, onPetMissing),
    li2: new PetSprite(els.canvasLi2, 'pink-fish', petBase, onPetMissing),
  };

  els.tankFrameHost.innerHTML = buildTankFrameSvg();
  const tankCtrl = new WhaleTankController(els.tankCanvas, els.dshScreen, els.tankCaustics);

  const movers = {
    li:  { x: SPOTS.liDesk.x,  y: SPOTS.liDesk.y,  floor: 1, behindDesk: 'li',  path: [], seg: null, flip: false, hopUntil: 0, spotName: 'liDesk',  onStair: false, moveStartedAt: 0, moveElapsed: 0 },
    li2: { x: SPOTS.li2Desk.x, y: SPOTS.li2Desk.y, floor: 1, behindDesk: 'li2', path: [], seg: null, flip: false, hopUntil: 0, spotName: 'li2Desk', onStair: false, moveStartedAt: 0, moveElapsed: 0 },
  };

  function syncLayoutAndSizes() {
    const cw = container.clientWidth || root.clientWidth || 400;
    const isWide = layout !== 'pane' && cw >= 860;
    container.classList.toggle('is-wide', isWide);
    const rect = els.houseFrame.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    sprites.li.resizeWithTargetVisible(rect.height);
    sprites.li2.resizeWithTargetVisible(rect.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    els.fxCanvas.width = Math.round(rect.width * dpr);
    els.fxCanvas.height = Math.round(rect.height * dpr);
    tankCtrl.resize(rect.width * 0.24 * 0.8611, rect.height * 0.198 * 0.7722);
    positionActorsAndOverlays(Date.now());
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncLayoutAndSizes) : null;
  if (ro) {
    ro.observe(container);
    ro.observe(els.houseFrame);
  }
  const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mql && mql.addEventListener) mql.addEventListener('change', syncThemeClass);

  const themeMo = typeof MutationObserver !== 'undefined' ? new MutationObserver(syncThemeClass) : null;
  if (themeMo) {
    themeMo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2400);
  }

  function planMove(id, targetSpotName, instant = false) {
    const mv = movers[id];
    const dest = SPOTS[targetSpotName] || SPOTS.liDesk;
    mv.spotName = targetSpotName;
    if (instant || reducedMotion()) {
      mv.x = dest.x; mv.y = dest.y; mv.floor = dest.floor; mv.behindDesk = dest.behindDesk || null;
      mv.flip = !!dest.restFlip; mv.path = []; mv.seg = null; mv.onStair = false; mv.moveStartedAt = 0; mv.moveElapsed = 0;
      return;
    }
    if (Math.hypot(dest.x - mv.x, dest.y - mv.y) < 1.2) {
      mv.behindDesk = dest.behindDesk || null; mv.flip = !!dest.restFlip; mv.path = []; mv.seg = null; mv.onStair = false;
      return;
    }
    const waypoints = [];
    const startDesk = mv.behindDesk || null;
    const endDesk = dest.behindDesk || null;
    if (startDesk && startDesk !== endDesk) {
      waypoints.push({ ...DESK_EXIT[startDesk].back, stair: false });
      waypoints.push({ ...DESK_EXIT[startDesk].front, stair: false });
    }
    if (mv.floor === 1 && dest.floor === 2) {
      waypoints.push({ ...STAIR_BOT, stair: false }, { ...STAIR_MID, stair: true }, { ...STAIR_TOP, stair: true });
    } else if (mv.floor === 2 && dest.floor === 1) {
      waypoints.push({ ...STAIR_TOP, stair: false }, { ...STAIR_MID, stair: true }, { ...STAIR_BOT, stair: true });
    }
    if (endDesk && startDesk !== endDesk) {
      waypoints.push({ ...DESK_EXIT[endDesk].front, stair: false });
      waypoints.push({ ...DESK_EXIT[endDesk].back, stair: false });
    }
    waypoints.push({ x: dest.x, y: dest.y, floor: dest.floor, behindDesk: endDesk, stair: false });
    mv.path = waypoints;
    mv.seg = null;
    mv.moveStartedAt = Date.now();
    mv.moveElapsed = 0;
  }

  function setFlip(mv, nextFlip, now) {
    if (mv.flip !== nextFlip) {
      mv.flip = nextFlip;
      if (!reducedMotion()) mv.hopUntil = now + 220;
    }
  }

  function stepMover(id, dt, now) {
    const mv = movers[id];
    if (!mv.seg && mv.path.length === 0) {
      mv.onStair = false;
      return false;
    }
    let rem = dt;
    if (mv.moveStartedAt > 0) {
      const expected = Math.max(0, now - mv.moveStartedAt);
      const catchup = Math.max(0, expected - mv.moveElapsed);
      rem = Math.min(8000, Math.max(dt, catchup));
      mv.moveElapsed += rem;
    }
    let moved = false;
    while (rem > 0) {
      if (!mv.seg && mv.path.length > 0) {
        const next = mv.path.shift();
        const dist = Math.hypot(next.x - mv.x, next.y - mv.y);
        const speed = next.stair ? 24 : 31;
        const dur = Math.max(240, (dist / speed) * 1000);
        mv.seg = { x0: mv.x, y0: mv.y, x1: next.x, y1: next.y, floor: next.floor, behindDesk: next.behindDesk || null, stair: !!next.stair, t: 0, dur };
        mv.behindDesk = next.behindDesk || null;
        mv.onStair = !!next.stair;
        if (Math.abs(next.x - mv.x) > 1.8) setFlip(mv, next.x < mv.x, now);
      }
      if (!mv.seg) { mv.onStair = false; break; }
      moved = true;
      const take = Math.min(rem, mv.seg.dur - mv.seg.t);
      mv.seg.t += take;
      rem -= take;
      const u = Math.min(1, mv.seg.t / mv.seg.dur);
      const e = easeInOut(u);
      mv.x = mv.seg.x0 + (mv.seg.x1 - mv.seg.x0) * e;
      mv.y = mv.seg.y0 + (mv.seg.y1 - mv.seg.y0) * e;
      if (u >= 1) {
        mv.x = mv.seg.x1; mv.y = mv.seg.y1; mv.floor = mv.seg.floor; mv.behindDesk = mv.seg.behindDesk;
        mv.seg = null;
        if (mv.path.length === 0) {
          mv.onStair = false; mv.moveStartedAt = 0; mv.moveElapsed = 0;
          const destSpot = SPOTS[mv.spotName];
          setFlip(mv, !!(destSpot && destSpot.restFlip), now);
        }
      }
    }
    return moved || !!mv.seg;
  }

  function positionActorsAndOverlays(now) {
    const fw = els.houseFrame.clientWidth || 380;
    const fh = els.houseFrame.clientHeight || 284;
    const pad = 5;

    const heads = {};
    for (const [id, wrap, canvas] of [['li', els.wrapLi, els.canvasLi], ['li2', els.wrapLi2, els.canvasLi2]]) {
      const mv = movers[id];
      let hopY = 0;
      if (!reducedMotion() && now < mv.hopUntil) {
        const u = 1 - (mv.hopUntil - now) / 220;
        hopY = -Math.sin(u * Math.PI) * 6;
      }
      const bob = (mv.seg && !reducedMotion())
        ? (mv.onStair ? -Math.abs(Math.sin(now * 0.016)) * 3.5 : Math.sin(now * 0.011) * 2.5)
        : 0;
      const px = (mv.x / 100) * fw;
      const py = (mv.y / 100) * fh + bob + hopY;
      const m = state.machines[id];
      const atDesk = !!mv.behindDesk && !mv.seg;
      const litByScreen = atDesk && (m.status === 'working' || m.status === 'thinking');
      wrap.classList.toggle('is-behind-desk', !!mv.behindDesk);
      wrap.classList.toggle('has-screen-glow', litByScreen);
      wrap.classList.toggle('is-offline', !!m.offline);
      wrap.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
      canvas.classList.toggle('flip-x', mv.flip);
      heads[id] = { x: px, topY: py - sprites[id].visibleHeightPx };
    }

    const dshScreenRect = { x: fw * 0.378, y: fh * 0.580, w: fw * 0.244, h: fh * 0.202 };
    const placed = [dshScreenRect];

    if (state.dsh.caption) {
      els.dshCaptionText.textContent = state.dsh.caption;
      els.dshCaption.className = 'dsh-caption show' + (state.dsh.mode !== 'normal' ? ` mode-${state.dsh.mode}` : '');
      els.dshCaption.style.left = '0px';
      els.dshCaption.style.top = '0px';
      const cw = els.dshCaption.offsetWidth || 120;
      const ch = els.dshCaption.offsetHeight || 28;
      const screenCx = fw * 0.5;
      const screenTop = fh * 0.584;
      const screenBot = fh * 0.778;
      const nearWin = ['li', 'li2'].some((id) => movers[id].floor === 2 && Math.abs(movers[id].x - 50) < 20);
      const cx = Math.max(pad, Math.min(fw - cw - pad, Math.round(screenCx - cw / 2)));
      let cy;
      if (nearWin) {
        cy = Math.min(fh - ch - pad, Math.round(screenBot + 7));
        els.dshCaption.classList.add('tail-top');
      } else {
        cy = Math.max(pad, Math.round(screenTop - ch - 7));
        els.dshCaption.classList.remove('tail-top');
      }
      els.dshCaption.style.left = `${cx}px`;
      els.dshCaption.style.top = `${cy}px`;
      els.dshCaption.style.setProperty('--tail-x', `${Math.max(12, Math.min(cw - 12, Math.round(screenCx - cx)))}px`);
      placed.push({ x: cx, y: cy, w: cw, h: ch });
    } else {
      els.dshCaption.className = 'dsh-caption';
    }

    const badgeRects = {};
    for (const [id, el] of [['li', els.badgeLi], ['li2', els.badgeLi2]]) {
      el.style.left = '0px';
      el.style.top = '0px';
      const bw = el.offsetWidth || 68;
      const bh = el.offsetHeight || 20;
      const h = heads[id];
      const clampBX = (vx) => Math.max(pad, Math.min(fw - bw - pad, Math.round(vx)));
      const clampBY = (vy) => Math.max(pad, Math.min(fh - bh - pad, Math.round(vy)));
      const bx = clampBX(h.x - bw / 2);
      const by = clampBY(h.topY - bh - 5);
      const preferLeft = h.x < fw * 0.5;
      const tries = [
        { x: bx, y: by },
        { x: preferLeft ? clampBX(dshScreenRect.x - bw - 5) : clampBX(dshScreenRect.x + dshScreenRect.w + 5), y: by },
        { x: clampBX(bx - bw * 0.55), y: by },
        { x: clampBX(bx + bw * 0.55), y: by },
        { x: bx, y: clampBY(by - bh - 5) },
        { x: preferLeft ? pad : fw - bw - pad, y: clampBY(by - bh - 5) },
      ];
      let chosen = tries[0];
      for (const cand of tries) {
        const r = { x: cand.x, y: cand.y, w: bw, h: bh };
        if (!placed.some((p) => rectsOverlap(r, p, 3))) { chosen = cand; break; }
      }
      el.style.visibility = state.radialOpenFor === id ? 'hidden' : 'visible';
      el.style.left = `${Math.round(chosen.x)}px`;
      el.style.top = `${Math.round(chosen.y)}px`;
      const rect = { x: chosen.x, y: chosen.y, w: bw, h: bh };
      badgeRects[id] = rect;
      placed.push(rect);
    }

    for (const [id, el] of [['li', els.speechLi], ['li2', els.speechLi2]]) {
      const m = state.machines[id];
      if (!m.speech || !m.speech.text || state.radialOpenFor === id) {
        el.className = 'actor-speech';
        continue;
      }
      el.firstElementChild.textContent = m.speech.text;
      el.className = `actor-speech show is-${id}` + (m.speech.tone ? ` is-${m.speech.tone}` : '');
      el.style.left = '0px';
      el.style.top = '0px';
      const sw = el.offsetWidth || 100;
      const sh = el.offsetHeight || 26;
      const br = badgeRects[id];
      const cx = br.x + br.w / 2;
      const onLeftHalf = cx < fw * 0.5;
      const sideX = onLeftHalf ? pad : fw - sw - pad;
      const clampX = (vx) => Math.max(pad, Math.min(fw - sw - pad, Math.round(vx)));
      const clampY = (vy) => Math.max(pad, Math.min(fh - sh - pad, Math.round(vy)));
      const candidates = [
        { x: clampX(cx - sw / 2), y: clampY(br.y - sh - 4) },
        { x: sideX, y: clampY(br.y - sh - 4) },
        { x: sideX, y: clampY(br.y - sh * 2 - 7) },
        { x: sideX, y: pad },
        { x: clampX(cx - sw / 2), y: clampY(br.y + br.h + 5) },
      ];
      let chosen = candidates[0];
      for (const c of candidates) {
        if (!placed.some((p) => rectsOverlap({ x: c.x, y: c.y, w: sw, h: sh }, p, 2))) { chosen = c; break; }
      }
      el.style.left = `${chosen.x}px`;
      el.style.top = `${chosen.y}px`;
      placed.push({ x: chosen.x, y: chosen.y, w: sw, h: sh });
    }

    if (state.radialOpenFor) {
      const id = state.radialOpenFor;
      els.radialRing.hidden = false;
      els.radialRing.className = 'radial-ring' + (id === 'li2' ? ' is-pink' : '');
      const mv = movers[id];
      const radius = Math.max(46, Math.min(62, Math.round(fw * 0.11)));
      const margin = radius + 28;
      const cx = Math.max(margin, Math.min(fw - margin, (mv.x / 100) * fw));
      const cy = Math.max(margin, Math.min(fh - margin, (mv.y / 100) * fh - sprites[id].visibleHeightPx * 0.5));
      const angles = [-135, -45, 45, 135];
      [els.orbSay, els.orbTerm, els.orbStop, els.orbWeb].forEach((orb, idx) => {
        const rad = (angles[idx] * Math.PI) / 180;
        orb.style.left = `${Math.round(cx + Math.cos(rad) * radius)}px`;
        orb.style.top = `${Math.round(cy + Math.sin(rad) * radius)}px`;
      });
    } else {
      els.radialRing.hidden = true;
    }
  }

  function drawFxLayer(now) {
    const ctx = els.fxCanvas.getContext('2d');
    const w = els.fxCanvas.width;
    const h = els.fxCanvas.height;
    const dpr = w / Math.max(1, els.houseFrame.clientWidth);
    ctx.clearRect(0, 0, w, h);

    const alivePulses = [];
    for (const gp of state.glowPulses) {
      const age = (now - gp.start) / 1000;
      if (age > gp.life) continue;
      alivePulses.push(gp);
      const u = age / gp.life;
      ctx.save();
      ctx.strokeStyle = gp.color;
      ctx.globalAlpha = Math.max(0, (1 - u) * 0.85);
      ctx.lineWidth = (3.5 - u * 2) * dpr;
      ctx.beginPath();
      ctx.arc((gp.x / 100) * w, (gp.y / 100) * h, (16 + u * 64) * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    state.glowPulses = alivePulses;

    const aliveFlights = [];
    let tagsHtml = '';
    for (const fl of state.flights) {
      const age = now - fl.start;
      if (age > fl.duration) continue;
      aliveFlights.push(fl);
      const u = reducedMotion() ? 0.5 : Math.min(1, age / fl.duration);
      const e = easeInOut(u);
      const p0 = { x: (fl.from.x / 100) * w, y: (fl.from.y / 100) * h };
      const p2 = { x: (fl.to.x / 100) * w, y: (fl.to.y / 100) * h };
      const mx = (p0.x + p2.x) / 2;
      const my = Math.min(p0.y, p2.y) - h * 0.14;
      const pt = (t) => ({
        x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * mx + t * t * p2.x,
        y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * my + t * t * p2.y,
      });

      ctx.save();
      ctx.strokeStyle = fl.color;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([5 * dpr, 5 * dpr]);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(mx, my, p2.x, p2.y);
      ctx.stroke();
      ctx.restore();

      for (let k = 1; k <= 8; k++) {
        const tp = pt(Math.max(0, e - k * 0.032));
        ctx.save();
        ctx.fillStyle = fl.color;
        ctx.globalAlpha = Math.max(0, 0.76 - k * 0.08);
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, Math.max(1.6, (5.5 - k * 0.45)) * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const cur = pt(e);
      const prev = pt(Math.max(0, e - 0.02));
      const ang = Math.atan2(cur.y - prev.y, cur.x - prev.x) * 0.32;
      ctx.save();
      ctx.translate(cur.x, cur.y);
      ctx.rotate(ang);
      const ew = 19 * dpr;
      const eh = 13 * dpr;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = fl.color;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-ew / 2, -eh / 2, ew, eh, 3 * dpr);
      else ctx.rect(-ew / 2, -eh / 2, ew, eh);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-ew / 2 + 2 * dpr, -eh / 2 + 1.5 * dpr);
      ctx.lineTo(0, 1.5 * dpr);
      ctx.lineTo(ew / 2 - 2 * dpr, -eh / 2 + 1.5 * dpr);
      ctx.stroke();
      ctx.restore();

      const midPt = pt(0.5);
      let txPct = (midPt.x / w) * 100;
      let tyPct = (midPt.y / h) * 100;
      const goRight = (fl.from.x + fl.to.x) * 0.5 >= 50;
      if (txPct > 33 && txPct < 67 && tyPct > 48 && tyPct < 82) {
        txPct = goRight ? 68.5 : 31.5;
        tyPct = 72.0;
      } else if (tyPct >= 46 && tyPct <= 68 && txPct > 25 && txPct < 75) {
        tyPct = 72.0;
        txPct = goRight ? Math.max(txPct, 68.5) : Math.min(txPct, 31.5);
      }
      txPct = Math.max(13, Math.min(87, txPct));
      tyPct = Math.max(11, Math.min(86, tyPct));
      tagsHtml += `<div class="flight-tag ${fl.cls || ''}" style="left:${txPct.toFixed(1)}%; top:${tyPct.toFixed(1)}%;">${escapeHtml(fl.label)}</div>`;
    }
    state.flights = aliveFlights;
    els.flightTagLayer.innerHTML = tagsHtml;

    const aliveConfetti = [];
    for (const c of state.confetti) {
      const age = (now - c.start) / 1000;
      if (age > c.life) continue;
      aliveConfetti.push(c);
      const cx = (c.x / 100) * w + c.vx * age * dpr;
      const cy = (c.y / 100) * h + (c.vy * age + 110 * age * age) * dpr;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(c.rot + age * c.spin);
      ctx.globalAlpha = Math.max(0, 1 - Math.pow(age / c.life, 1.4));
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.size * dpr, -c.size * 0.45 * dpr, c.size * 2 * dpr, c.size * 0.9 * dpr);
      ctx.restore();
    }
    state.confetti = aliveConfetti;
  }

  function tankWaterWorld(tankX) {
    return { x: 39.67 + (tankX / 248) * 20.66, y: 60.2 };
  }

  function launchExternalFlight(fromPt, toPt, label, color, cls, machine, duration = 1050, onLand = null) {
    const fl = { from: fromPt, to: toPt, color, label, cls, machine, start: Date.now(), duration };
    state.flights.push(fl);
    if (onLand) {
      setTimeout(() => { if (!fl.cancelled) onLand(); }, duration);
    }
    return fl;
  }

  function sendFlight(fromId, toId, label, tone = '', extra = {}) {
    const isPink = fromId === 'li2' || toId === 'li2';
    const color = tone === 'good' ? '#25c98d' : tone === 'warn' ? '#f09e26' : (isPink ? '#ef6da4' : '#4a96ff');
    const cls = tone ? `is-${tone}` : (isPink ? 'is-pink' : '');
    if (fromId === 'dsh') {
      tankCtrl.spawnOutgoingMail(toId, color, (popX) => {
        launchExternalFlight(tankWaterWorld(popX), { x: movers[toId].x, y: movers[toId].y - 9 }, label, color, cls, toId, 1000, extra.onArrive || null);
      });
    } else if (toId === 'dsh') {
      const fromPt = { x: movers[fromId].x, y: movers[fromId].y - 9 };
      const entryTankX = fromId === 'li' ? 74 : 174;
      launchExternalFlight(fromPt, tankWaterWorld(entryTankX), label, color, cls, fromId, 920, () => {
        const relayTo = extra.relayTo || null;
        const relayColor = relayTo === 'li2' ? '#ef6da4' : '#4a96ff';
        const relayCls = relayTo === 'li2' ? 'is-pink' : '';
        tankCtrl.spawnIncomingMail(
          fromId, color, extra.onCaught || null, relayTo, relayColor,
          relayTo ? (popX) => {
            launchExternalFlight(tankWaterWorld(popX), { x: movers[relayTo].x, y: movers[relayTo].y - 9 }, extra.relayLabel || `DSH 转 → ${relayTo}`, relayColor, relayCls, relayTo, 1000, extra.onRelayArrive || null);
          } : null
        );
      });
    }
  }

  function burstCelebration() {
    if (reducedMotion()) return;
    const colors = ['#ff6fb0', '#5eb8ff', '#3de8a4', '#ffd046', '#c084fc', '#ffffff'];
    const now = Date.now();
    for (const org of [{ x: 50, y: 66, count: 36 }, { x: movers.li.x, y: movers.li.y - 10, count: 20 }, { x: movers.li2.x, y: movers.li2.y - 10, count: 20 }]) {
      state.glowPulses.push({ x: org.x, y: org.y, color: '#ffd452', life: 1.1, start: now });
      for (let i = 0; i < org.count; i++) {
        const angle = (-Math.PI * 0.1) - Math.random() * (Math.PI * 0.8);
        const speed = 65 + Math.random() * 140;
        state.confetti.push({
          x: org.x, y: org.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 9,
          size: 4 + Math.random() * 3, life: 1.7 + Math.random() * 0.7, color: colors[i % colors.length], start: now,
        });
      }
    }
  }

  function chatItemHtml(item, overlayMode) {
    return `
      <li class="${overlayMode ? 'dsh-ov-item' : `chat-msg${item.relay ? ' is-relay' : ''}${item.tone ? ` is-${item.tone}` : ''}`}">
        <div class="chat-meta">
          <span class="route-tag ${item.cls || ''}">${escapeHtml(item.route)}</span>
          <span class="chat-time">${escapeHtml(item.time || '--:--')}</span>
        </div>
        <div class="chat-body">${escapeHtml(item.text)}</div>
      </li>
    `;
  }

  function renderView(nextState) {
    state = nextState;
    const mLi = state.machines.li;
    const mLi2 = state.machines.li2;
    const sel = state.machines[state.selected] || mLi2;

    els.petWarn.hidden = !state.petMissing;
    els.exitDemoBtn.hidden = !state.demoMode;
    els.demoBtn.hidden = state.demoMode;
    els.directorBar.hidden = !state.demoMode;

    if (state.demoMode) {
      els.actPill.className = 'act-pill is-demo' + (state.approval ? ' is-warn' : '');
      els.actText.textContent = `演示中 · ${state.actLabel}`;
    } else if (state.approval) {
      els.actPill.className = 'act-pill is-warn';
      els.actText.textContent = `${state.approval.machine} 等拍板`;
    } else if (state.unreachable) {
      els.actPill.className = 'act-pill is-offline';
      els.actText.textContent = '连不上 crew';
    } else {
      els.actPill.className = 'act-pill';
      els.actText.textContent = `li ${mLi.actionTag} · li2 ${mLi2.actionTag}`;
    }

    els.directorBar.querySelectorAll('.scene-chip').forEach((b) => {
      b.classList.toggle('is-active', Number(b.dataset.scene) === state.actIndex);
    });

    els.dshScreen.className = 'dsh-screen' + (state.dsh.mode !== 'normal' ? ` mode-${state.dsh.mode}` : '');
    els.dshFace.textContent = state.dsh.face || '^‿^';
    els.sleepDim.classList.toggle('is-on', mLi.status === 'sleeping' || mLi2.status === 'sleeping');
    els.winKnock.classList.toggle('is-on', !!state.approval);

    for (const [id, m, ledEl, backEl] of [
      ['li', mLi, els.monGlowLi, els.backGlowLi],
      ['li2', mLi2, els.monGlowLi2, els.backGlowLi2],
    ]) {
      const activeAtDesk = (m.status === 'working' || m.status === 'thinking') && (m.spot === `${id}Desk` || m.spot === 'reviewLi2');
      const isOff = m.status === 'sleeping' || m.status === 'cooldown' || m.offline;
      ledEl.className = `desk-screen-btn mon-${id}` + (m.status === 'approval' ? ' is-warn' : '') + (m.status === 'stopped' ? ' is-stop' : '');
      backEl.className = `mon-back-glow glow-${id}`
        + (activeAtDesk ? ' is-active' : '')
        + (isOff ? ' is-off' : '')
        + (m.status === 'approval' ? ' is-warn' : '')
        + (m.status === 'stopped' ? ' is-stop' : '');
    }

    for (const [id, m, badgeEl, wrapEl] of [
      ['li', mLi, els.badgeLi, els.wrapLi],
      ['li2', mLi2, els.badgeLi2, els.wrapLi2],
    ]) {
      if (movers[id].spotName !== m.spot) planMove(id, m.spot, false);
      wrapEl.classList.toggle('is-front', state.selected === id || m.status === 'approval');
      badgeEl.textContent = `${m.id} · ${m.actionTag}`;
      badgeEl.className = 'actor-badge'
        + (id === 'li2' ? ' is-pink' : '')
        + (m.status === 'approval' ? ' is-warn' : '')
        + (m.status === 'sleeping' ? ' is-sleep' : '')
        + (m.status === 'offline' ? ' is-offline' : '')
        + (m.status === 'cooldown' ? ' is-cool' : '')
        + (m.status === 'stopped' ? ' is-stop' : '');
    }

    if (state.approval) {
      els.approvalPanel.hidden = false;
      els.approvalTitle.textContent = state.approval.title || `${state.approval.machine} 等你拍板`;
      els.approvalTag.textContent = state.approval.isSetupPrompt ? '需手工处理' : '待审批';
      els.approvalCmd.textContent = state.approval.cmd || state.approval.command || '';
      els.approvalNote.textContent = state.approval.note || '';
      els.approvalBtns.hidden = !!state.approval.isSetupPrompt;
    } else {
      els.approvalPanel.hidden = true;
    }

    const chatHtml = state.groupChat.length
      ? state.groupChat.slice().reverse().map((it) => chatItemHtml(it, false)).join('')
      : '<li class="chat-empty">暂无队内消息，可直接在下方经 DSH 发消息</li>';
    els.chatFeed.innerHTML = chatHtml;
    els.dshChatOverlay.hidden = !state.dshChatOpen;
    if (state.dshChatOpen) {
      els.dshChatList.innerHTML = state.groupChat.length
        ? state.groupChat.slice().reverse().map((it) => chatItemHtml(it, true)).join('')
        : '<li class="chat-empty">暂无对话记录</li>';
    }

    els.tabLi.classList.toggle('is-active', state.selected === 'li');
    els.tabLi2.classList.toggle('is-active', state.selected === 'li2');
    els.sendBtn.className = 'btn btn-send' + (state.selected === 'li2' ? ' is-pink' : '');
    els.composeInput.placeholder = sel.status === 'sleeping'
      ? `经 DSH 叫醒沙发上的 ${sel.petName}…`
      : `经 DSH 给 ${sel.petName} (${sel.id}) 发句话…`;

    if (state.termModalFor) {
      const tm = state.machines[state.termModalFor];
      els.termBackdrop.hidden = false;
      els.termTitle.textContent = `${tm.id} · ${tm.petName} 终端画面`;
      const lines = state.terminal[tm.id] || [];
      els.termPre.textContent = lines.length ? lines.join('\n') : '（暂无终端输出）';
    } else {
      els.termBackdrop.hidden = true;
    }

    if (state.webModalUrl && state.webModalUrl.startsWith('https://')) {
      els.webBackdrop.hidden = false;
      els.webUrl.textContent = state.webModalUrl;
      els.webAnchor.href = state.webModalUrl;
    } else {
      els.webBackdrop.hidden = true;
      els.webAnchor.href = '#';
    }

    positionActorsAndOverlays(Date.now());
  }

  // 将 sceneFromCrew 的实时结果合入当前界面状态（演示期间不覆盖）
  function applyLiveScene(scene, petsAvailable) {
    savedLiveScene = { scene, petsAvailable };
    if (state.demoMode) return;

    const petMissing = petsAvailable
      ? (!petsAvailable['whale-girl'] || !petsAvailable['pink-fish'])
      : state.petMissing;

    const next = {
      ...state,
      demoMode: false,
      petMissing: petMissing || sprites.li.fallback || sprites.li2.fallback,
      unreachable: !!scene.unreachable,
      approval: scene.approval || null,
      dsh: { face: '^‿^', ...scene.dsh },
      machines: {
        li: { ...state.machines.li, ...scene.machines.li },
        li2: { ...state.machines.li2, ...scene.machines.li2 },
      },
      terminal: {
        li: scene.terminal?.li || state.terminal.li,
        li2: scene.terminal?.li2 || state.terminal.li2,
      },
      groupChat: Array.isArray(scene.chat) ? scene.chat : state.groupChat,
    };
    renderView(next);

    // 仅给新事件放飞信/叫停动画
    if (Array.isArray(scene.animations)) {
      for (const anim of scene.animations) {
        if (anim.kind === 'flight') {
          sendFlight(anim.from, anim.to, anim.label, '');
        } else if (anim.kind === 'stop') {
          tankCtrl.triggerStop(Date.now(), 3800);
        }
      }
    }
  }

  // =========================================================================
  // 5. 六幕演示模式（按需触发，点「退出」彻底清理定时器并切回实时数据）
  // =========================================================================
  function clearDemoTimers() {
    demoTimers.forEach((id) => clearTimeout(id));
    demoTimers = [];
  }

  function demoAfter(ms, fn) {
    const id = setTimeout(() => {
      if (state.demoMode) fn();
    }, ms);
    demoTimers.push(id);
  }

  function runDemoAct(startAct = 1) {
    clearDemoTimers();
    tankCtrl.clearMail();
    const fresh = createDemoState();
    fresh.petMissing = sprites.li.fallback || sprites.li2.fallback;
    renderView(fresh);
    planMove('li', 'liDesk', true);
    planMove('li2', 'li2Desk', true);

    const offsets = { 1: 0, 2: 11000, 3: 20000, 4: 33000, 5: 44000, 6: 56000 };
    const base = offsets[startAct] || 0;
    const at = (ms, fn) => {
      if (ms < base) return;
      demoAfter(ms - base, fn);
    };

    const demoChat = (entry) => {
      state.groupChat.push(entry);
      if (state.groupChat.length > 24) state.groupChat.shift();
      renderView(state);
    };

    at(800, () => {
      state.actIndex = 1; state.actLabel = '1 · DSH 派活';
      state.dsh = { face: '^‿^', caption: '派活给 li2：卡片改两列开 PR', mode: 'normal', intent: 'dispatch', lookAt: 'li2' };
      sendFlight('dsh', 'li2', 'DSH → li2');
      demoChat({ route: 'DSH → li2', cls: 'r-li2', relay: true, text: '派活：把卡片改成两列，跑测试后开 PR', time: nowHm() });
    });
    at(2800, () => {
      state.machines.li2.status = 'working'; state.machines.li2.actionTag = '改 styles.css';
      state.machines.li2.speech = { text: '收到！开工改两列～', tone: '' };
      renderView(state);
    });
    at(11200, () => {
      state.actIndex = 2; state.actLabel = '2 · 主动汇报';
      state.machines.li2.carryMode = true; state.machines.li2.spot = 'dshRug'; state.machines.li2.actionTag = '抱文件汇报';
      state.machines.li2.speech = { text: '拿进展给 DSH 看！', tone: '' };
      renderView(state);
    });
    at(14200, () => {
      sendFlight('li2', 'dsh', 'li2 → DSH', 'good');
      demoChat({ route: 'li2 → DSH', cls: 'r-li2', text: '汇报：两列已改好，测试全绿', time: nowHm() });
      state.machines.li2.carryMode = false; state.machines.li2.spot = 'li2Desk'; state.machines.li2.actionTag = '跑测试';
      renderView(state);
    });
    at(20200, () => {
      state.actIndex = 3; state.actLabel = '3 · 经 DSH 转达';
      state.dsh = { face: '⇄', caption: '经 DSH 转达：字段用 baudRate', mode: 'relay', intent: 'relay', lookAt: 'li' };
      state.machines.li.status = 'thinking'; state.machines.li.actionTag = '问字段名';
      state.machines.li.speech = { text: '问问 DSH：用 baud 还是 rate？', tone: '' };
      sendFlight('li', 'dsh', 'li → DSH', '', { relayTo: 'li2', relayLabel: 'DSH 转 → li2' });
      demoChat({ route: 'li → DSH', cls: 'r-li', relay: true, text: '串口字段用 baud 还是 baudRate？', time: nowHm() });
      demoChat({ route: 'DSH → li2', cls: 'r-li2', relay: true, text: '转达 li：串口字段用 baud 还是 baudRate？', time: nowHm() });
      renderView(state);
    });
    at(33200, () => {
      state.actIndex = 4; state.actLabel = '4 · 交叉审查';
      state.machines.li.spot = 'review'; state.machines.li.status = 'working'; state.machines.li.actionTag = '审查 PR';
      state.machines.li2.spot = 'reviewLi2'; state.machines.li2.status = 'idle'; state.machines.li2.actionTag = '待审查';
      state.machines.li.speech = { text: '交叉审查通过，可以提 PR！', tone: 'good' };
      state.machines.li2.speech = null;
      state.dsh = { face: '^‿^', caption: 'li 正在交叉审查 li2 的改动', mode: 'normal', intent: 'idle', lookAt: 'li2' };
      renderView(state);
    });
    at(44200, () => {
      state.actIndex = 5; state.actLabel = '5 · 窗前拍板';
      state.machines.li.spot = 'liDesk'; state.machines.li.actionTag = '空闲'; state.machines.li.status = 'idle'; state.machines.li.speech = null;
      state.machines.li2.spot = 'window'; state.machines.li2.status = 'approval'; state.machines.li2.actionTag = '等审批';
      state.machines.li2.speech = { text: '站长～要 push 啦，请拍板！', tone: 'warn' };
      state.approval = {
        machine: 'li2', petName: '小粉鱼', isSetupPrompt: false,
        title: '小粉鱼 (li2) 在二楼敲玻璃 · 等你拍板',
        cmd: 'git push origin li2/cards',
        note: '演示审批：点「批准执行」或「拒绝」可直接体验互动效果。',
      };
      state.dsh = { face: '!', caption: 'li2 等你拍板 git push', mode: 'warn', intent: 'warn', lookAt: 'up' };
      renderView(state);
    });
    at(56200, () => {
      state.actIndex = 6; state.actLabel = '6 · 休眠叫醒叫停';
      state.approval = null;
      state.machines.li.spot = 'sofa'; state.machines.li.status = 'sleeping'; state.machines.li.actionTag = '睡着';
      state.machines.li2.spot = 'sofa'; state.machines.li2.status = 'sleeping'; state.machines.li2.actionTag = '睡着';
      state.machines.li2.speech = null;
      state.dsh = { face: 'zZ', caption: '两台都休眠了，省额度', mode: 'sleep', intent: 'sleep', lookAt: 'center' };
      renderView(state);
    });
    at(65000, () => runDemoAct(1));
  }

  function enterDemo() {
    if (callbacks.onDemoChange) callbacks.onDemoChange(true);
    runDemoAct(1);
    showToast('已进入演示模式，点顶部「退出」回真实数据');
  }

  function exitDemo() {
    clearDemoTimers();
    tankCtrl.clearMail();
    state.demoMode = false;
    state.flights = [];
    state.confetti = [];
    state.approval = null;
    if (savedLiveScene) {
      applyLiveScene(savedLiveScene.scene, savedLiveScene.petsAvailable);
    } else {
      const live = createDefaultLiveState();
      live.petMissing = sprites.li.fallback || sprites.li2.fallback;
      renderView(live);
    }
    if (callbacks.onDemoChange) callbacks.onDemoChange(false);
    showToast('已退出演示，恢复真实数据');
  }

  // =========================================================================
  // 6. 交互事件（实时模式下调真实后端回调，演示模式下本地演示）
  // =========================================================================
  async function openTerminalModal(machineId) {
    state.termModalFor = machineId;
    state.radialOpenFor = null;
    renderView(state);
    if (!state.demoMode && callbacks.onOpenScreen) {
      const lines = await callbacks.onOpenScreen(machineId);
      if (Array.isArray(lines) && lines.length) {
        state.terminal[machineId] = lines;
        renderView(state);
      }
    }
  }

  function openWebModal(machineId) {
    const url = state.machines[machineId]?.remoteUrl;
    if (!url || !url.startsWith('https://')) {
      showToast(`${machineId} 还没有远程接管网页链接`);
      return;
    }
    state.webModalUrl = url;
    renderView(state);
  }

  async function doStop(machineId) {
    tankCtrl.triggerStop(Date.now(), 3800);
    if (state.demoMode) {
      state.machines[machineId].status = 'stopped';
      state.machines[machineId].actionTag = '刚叫停';
      state.machines[machineId].speech = { text: '唔！立刻停手！', tone: 'warn' };
      state.dsh = { face: '!', caption: `已叫停 ${machineId}`, mode: 'stop', intent: 'stop', lookAt: machineId };
      renderView(state);
      showToast(`演示：已叫停 ${machineId}`);
      return;
    }
    showToast(`正在叫停 ${machineId}…`);
    if (callbacks.onStop) {
      const res = await callbacks.onStop(machineId);
      showToast(res?.ok ? (res.message || `已叫停 ${machineId}`) : (res?.error || `叫停 ${machineId} 失败`));
    }
  }

  async function doApprove(decision) {
    const ap = state.approval;
    if (!ap || ap.isSetupPrompt) return;
    if (state.demoMode) {
      state.approval = null;
      if (decision === 'yes') {
        burstCelebration();
        tankCtrl.triggerCelebrate(Date.now());
        state.machines[ap.machine].spot = ap.machine === 'li' ? 'liDesk' : 'li2Desk';
        state.machines[ap.machine].status = 'working';
        state.machines[ap.machine].actionTag = '推送中';
        state.dsh = { face: '★‿★', caption: '放行成功！彩带庆祝', mode: 'good', intent: 'good', lookAt: 'center' };
        showToast('演示：已批准执行');
      } else {
        state.machines[ap.machine].status = 'idle';
        state.machines[ap.machine].actionTag = '已拒绝';
        state.dsh = { face: '^‿^', caption: '已拒绝本次操作', mode: 'normal', intent: 'idle', lookAt: ap.machine };
        showToast('演示：已拒绝');
      }
      renderView(state);
      return;
    }
    showToast(decision === 'yes' ? `正在允许 ${ap.machine}…` : `正在拒绝 ${ap.machine}…`);
    if (callbacks.onApprove) {
      const res = await callbacks.onApprove(ap.machine, decision);
      if (res?.ok && decision === 'yes') {
        burstCelebration();
        tankCtrl.triggerCelebrate(Date.now());
      }
      showToast(res?.ok ? (res.message || '操作已完成') : (res?.error || '审批操作失败'));
    }
  }

  container.addEventListener('click', (e) => {
    if (e.target === els.termBackdrop) { state.termModalFor = null; renderView(state); return; }
    if (e.target === els.webBackdrop) { state.webModalUrl = null; renderView(state); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) {
      if (state.radialOpenFor && !e.target.closest('.radial-ring')) {
        state.radialOpenFor = null;
        renderView(state);
      }
      return;
    }
    const act = btn.dataset.act;
    if (act === 'pet') {
      const id = btn.dataset.machine;
      state.selected = id;
      state.radialOpenFor = state.radialOpenFor === id ? null : id;
      const now = Date.now();
      const isDouble = now - lastTapAt[id] < 650;
      lastTapAt[id] = now;
      if (state.machines[id].status !== 'sleeping') {
        sprites[id].playOnce(isDouble ? 'tickle' : 'poke');
      }
      renderView(state);
    } else if (act === 'radial-say') {
      state.selected = state.radialOpenFor || state.selected;
      state.radialOpenFor = null;
      renderView(state);
      els.composeInput.focus();
    } else if (act === 'radial-term') {
      openTerminalModal(state.radialOpenFor || state.selected);
    } else if (act === 'radial-stop') {
      const id = state.radialOpenFor || state.selected;
      state.radialOpenFor = null;
      renderView(state);
      doStop(id);
    } else if (act === 'radial-web') {
      const id = state.radialOpenFor || state.selected;
      state.radialOpenFor = null;
      openWebModal(id);
    } else if (act === 'open-term') {
      openTerminalModal(btn.dataset.machine);
    } else if (act === 'open-sel-term') {
      openTerminalModal(state.selected);
    } else if (act === 'refresh-term') {
      if (state.termModalFor) openTerminalModal(state.termModalFor);
    } else if (act === 'close-term') {
      state.termModalFor = null;
      renderView(state);
    } else if (act === 'copy-term') {
      const id = state.termModalFor || state.selected;
      const text = (state.terminal[id] || []).join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      showToast('已复制终端画面');
    } else if (act === 'open-dsh-chat') {
      state.radialOpenFor = null;
      if (state.dshChatOpen) {
        state.dshChatOpen = false;
        renderView(state);
      } else if (btn.classList.contains('dsh-screen') && !reducedMotion()) {
        tankCtrl.triggerTapStartle(Date.now());
        setTimeout(() => { state.dshChatOpen = true; renderView(state); }, 300);
      } else {
        state.dshChatOpen = true;
        renderView(state);
      }
    } else if (act === 'close-dsh-chat') {
      state.dshChatOpen = false;
      renderView(state);
    } else if (act === 'pick-target') {
      state.selected = btn.dataset.machine;
      renderView(state);
    } else if (act === 'stop-sel') {
      doStop(state.selected);
    } else if (act === 'web-sel') {
      openWebModal(state.selected);
    } else if (act === 'close-web') {
      state.webModalUrl = null;
      renderView(state);
    } else if (act === 'confirm-web') {
      state.webModalUrl = null;
      renderView(state);
    } else if (act === 'approve') {
      doApprove('yes');
    } else if (act === 'reject') {
      doApprove('no');
    } else if (act === 'start-demo') {
      enterDemo();
    } else if (act === 'exit-demo') {
      exitDemo();
    } else if (act === 'jump') {
      if (state.demoMode) runDemoAct(Number(btn.dataset.scene));
    } else if (act === 'theme') {
      manualTheme = isDarkMode() ? 'light' : 'dark';
      syncThemeClass();
      showToast(manualTheme === 'dark' ? '切到夜晚暖灯小屋' : '切到白天阳光小屋');
    }
  });

  els.composeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = els.composeInput.value.trim();
    if (!text) {
      showToast('先写一句话再经 DSH 发送');
      els.composeInput.focus();
      return;
    }
    const target = state.selected;
    els.composeInput.value = '';
    if (state.demoMode) {
      sendFlight('dsh', target, `DSH → ${target}`);
      state.groupChat.push({ route: `DSH → ${target}`, cls: target === 'li' ? 'r-li' : 'r-li2', relay: true, text, time: nowHm() });
      state.machines[target].speech = { text: '收到！马上照办～', tone: 'good' };
      renderView(state);
      showToast(`演示：经 DSH 发给 ${target}`);
      return;
    }
    showToast(`正在经 DSH 发给 ${target}…`);
    sendFlight('dsh', target, `DSH → ${target}`);
    if (callbacks.onSend) {
      const res = await callbacks.onSend(target, text);
      showToast(res?.ok ? (res.message || `已发给 ${target}`) : (res?.error || `发给 ${target} 失败`));
    }
  });

  function loop(ts) {
    if (paused) return;
    rafId = requestAnimationFrame(loop);
    if (!lastTs) lastTs = ts;
    const rafDt = Math.max(0, ts - lastTs);
    const now = Date.now();
    const wallDt = Math.max(0, now - lastNow);
    if (drawnFrames > 0 && rafDt < 30 && wallDt < 30) return;
    lastTs = ts;
    lastNow = now;
    drawnFrames++;

    const animDt = Math.min(120, Math.max(rafDt, wallDt, 16));
    const moveDt = Math.min(8000, Math.max(rafDt, wallDt, 16));
    const rm = reducedMotion();

    for (const id of ['li', 'li2']) {
      const m = state.machines[id];
      const moving = stepMover(id, moveDt, now);
      const cheering = now < m.cheerUntil;
      if (moving) sprites[id].setStateAnim(m.carryMode ? 'carrying' : 'swim');
      else if (cheering) sprites[id].setStateAnim(id === 'li' ? 'hearts' : 'happy');
      else sprites[id].setStateAnim(m.status);
      sprites[id].step(animDt, now, rm);
    }

    tankCtrl.step(state, animDt, now, rm, isDarkMode());
    positionActorsAndOverlays(now);
    drawFxLayer(now);
  }

  const onVisChange = () => {
    if (document.hidden) {
      paused = true;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    } else {
      paused = false;
      lastTs = 0;
      lastNow = Date.now();
      if (!rafId) rafId = requestAnimationFrame(loop);
    }
  };
  document.addEventListener('visibilitychange', onVisChange);

  rafId = requestAnimationFrame(loop);
  syncLayoutAndSizes();
  renderView(state);

  return {
    render: renderView,
    applyLiveScene,
    enterDemo,
    exitDemo,
    showToast,
    setTheme(mode) {
      manualTheme = mode;
      syncThemeClass();
    },
    destroy() {
      paused = true;
      clearDemoTimers();
      clearTimeout(toastTimer);
      if (rafId) cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisChange);
      if (mql && mql.removeEventListener) mql.removeEventListener('change', syncThemeClass);
      if (ro) ro.disconnect();
      if (themeMo) themeMo.disconnect();
      sprites.li.destroy();
      sprites.li2.destroy();
      root.innerHTML = '';
    },
  };
}
