// ==================== Section 5: Canvas & Rendering ====================
// --- 直流电铃音效模块 (HTML5 Audio 真实铃声音频) ---
// ==================== BellAudio: 可靠方案 ====================
// 核心思路：
// 1. unlock() 中用 AudioContext.resume() 解锁（按 AudioContext，不按元素）
// 2. ring() 中用同一个 ctx 的 BufferSourceNode.start(0) 播放（解锁后永不失败）
// 3. file:// 协议下 fetch bell.mp3 会失败 → 用 OscillatorNode 生成电铃声 fallback
const BellAudio = {
  ctx: null,
  buffer: null,
  source: null,
  _activeBellId: null,
  _useFallback: false, // fetch 失败时走 OscillatorNode 方案

  preload() {
    if (this.ctx) return;
    const CTX = window.AudioContext || window.webkitAudioContext;
    if (!CTX) return;
    try { this.ctx = new CTX(); } catch(e) { return; }
    // 尝试加载 bell.mp3
    fetch('images/bell.mp3')
      .then(r => { if (!r.ok) throw new Error(); return r.arrayBuffer(); })
      .then(buf => this.ctx.decodeAudioData(buf))
      .then(ab => { this.buffer = ab; })
      .catch(() => { this._useFallback = true; });
  },

  init() { this.preload(); },

  // 解锁 AudioContext —— 必须在用户手势内调用（同步，100% 成功）
  unlock() {
    this.preload();
    if (this.ctx && this.ctx.state === 'suspended') {
      try { this.ctx.resume(); } catch(e) {}
    }
  },

  resume() { this.unlock(); },

  // 用 OscillatorNode 生成电铃声（fallback，当 bell.mp3 加载失败时）
  _playFallback(loop) {
    if (!this.ctx) return;
    this._stopSource();
    this._stopFallback();  // clean up any previous fallback
    // 电铃声："叮~" 高频衰减正弦波，每 200ms 重复一次
    const now = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.connect(this.ctx.destination);
    // 用两个振荡器模拟"叮~叮~"
    const playDing = (offset) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now + offset);
      osc.frequency.exponentialRampToValueAtTime(800, now + offset + 0.08);
      g.gain.setValueAtTime(0.6, now + offset);
      g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.12);
      osc.connect(g);
      g.connect(gain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.15);
    };
    // 循环播放：每 200ms 一次"叮~"
    this._fallbackOscs = [];
    for (let i = 0; i < (loop ? 50 : 1); i++) {
      playDing(i * 0.2);
    }
    this._fallbackGain = gain;
  },

  _stopFallback() {
    try { if (this._fallbackGain) { this._fallbackGain.disconnect(); this._fallbackGain = null; } } catch(e) {}
  },

  _stopSource() {
    if (!this.source) return;
    try { this.source.stop(0); } catch(e) {}
    try { this.source.disconnect(); } catch(e) {}
    this.source = null;
  },

  // 开始响铃（通电即循环播放）
  ring(bellId) {
    this.preload();
    if (!this.ctx) { setTimeout(() => this.ring(bellId), 80); return; }
    // 确保 AudioContext 处于 running 状态
    if (this.ctx.state !== 'running') {
      try { this.ctx.resume(); } catch(e) {}
    }
    this._activeBellId = bellId;
    if (this._useFallback || !this.buffer) {
      // fallback：OscillatorNode 生成电铃声
      this._playFallback(true);
    } else {
      // 正常：AudioBufferSourceNode 播放 bell.mp3
      this._stopSource();
      this._stopFallback();
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.loop = true;
      src.connect(this.ctx.destination);
      try {
        src.start(0);
        this.source = src;
      } catch(e) {
        // AudioBufferSourceNode 失败 → 回退到 OscillatorNode
        this._useFallback = true;
        this._playFallback(true);
      }
    }
  },

  // 停止响铃（断电即停）
  stop() {
    this._activeBellId = null;
    this._stopSource();
    this._stopFallback();
  },

  // 测试音（点击电铃触发，用户手势内必然成功）
  playTestTone() {
    this.unlock();
    this.preload();
    if (!this.ctx) return;
    if (this._useFallback || !this.buffer) {
      this._playFallback(false);
    } else {
      this._stopSource();
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.loop = false;
      src.connect(this.ctx.destination);
      try { src.start(0); this.source = src; } catch(e) {}
    }
  }
};
