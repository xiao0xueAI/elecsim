// ==================== Section 11: Recording System ====================
// === Pure-JS MP4 faststart: relocate MOOV atom to front of file ===
// MediaRecorder produces MP4 with MOOV at the end → players can't seek.
// This walks the box tree, lifts the MOOV, and rewrites stco/co64 offsets
// in-place. No external dependencies.
function fastStartMp4(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const decoder = new TextDecoder('ascii');
  const FOURCC = (i) => decoder.decode(buf.slice(i, i + 4));

  // Parse boxes at the top level, return array of {type, header, start, end}
  function parseBoxes(start, end) {
    const boxes = [];
    let off = start;
    while (off + 8 <= end) {
      let size = view.getUint32(off);
      const type = FOURCC(off + 4);
      let hdrSize = 8;
      if (size === 1) {
        // 64-bit size
        const hi = view.getUint32(off + 8);
        const lo = view.getUint32(off + 12);
        size = hi * 2 ** 32 + lo;
        hdrSize = 16;
      } else if (size === 0) {
        size = end - off; // extends to EOF
      }
      if (size < hdrSize || off + size > end) break;
      boxes.push({ type, header: hdrSize, start: off, end: off + size });
      off += size;
    }
    return boxes;
  }

  // Recursively rewrite chunk offsets in stco (32-bit) and co64 (64-bit) boxes
  function rewriteOffsets(box, delta) {
    if (box.type === 'stco') {
      const count = view.getUint32(box.start + box.header + 4);
      for (let i = 0; i < count; i++) {
        const p = box.start + box.header + 8 + i * 4;
        const old = view.getUint32(p);
        view.setUint32(p, old + delta);
      }
    } else if (box.type === 'co64') {
      const count = view.getUint32(box.start + box.header + 4);
      for (let i = 0; i < count; i++) {
        const p = box.start + box.header + 8 + i * 8;
        const hi = view.getUint32(p);
        const lo = view.getUint32(p + 4);
        const old = hi * 2 ** 32 + lo;
        const nw = old + delta;
        view.setUint32(p, Math.floor(nw / 2 ** 32));
        view.setUint32(p + 4, nw >>> 0);
      }
    } else {
      // Recurse into container boxes
      const kids = parseBoxes(box.start + box.header, box.end);
      for (const k of kids) rewriteOffsets(k, delta);
    }
  }

  const top = parseBoxes(0, buf.length);
  const moov = top.find(b => b.type === 'moov');
  if (!moov) throw new Error('No MOOV box found');
  if (moov.start === 0) {
    // MOOV already at front
    return buf;
  }

  // The MDAT comes after MOOV; everything after MDAT (other boxes) goes between
  // MOOV and MDAT. Layout: [FTYP][MOOV][MDAT][others] -> [FTYP][MOOV][others][MDAT]
  // We move MOOV to right after FTYP, before everything else.

  // Find ftyp box (may be absent)
  const ftyp = top.find(b => b.type === 'ftyp');
  const ftypEnd = ftyp ? ftyp.end : 0;

  // Reassemble: everything before MOOV (ftyp) + MOOV + everything between ftypEnd and moov.start (excluding MOOV) + everything after MOOV
  const beforeMoov = buf.slice(0, moov.start);
  const moovData = buf.slice(moov.start, moov.end);
  const betweenFtypAndMoov = ftypEnd < moov.start ? buf.slice(ftypEnd, moov.start) : new Uint8Array(0);
  const afterMoov = buf.slice(moov.end);

  // Recompose
  const out = new Uint8Array(buf.length);
  let off = 0;
  out.set(beforeMoov, off); off += beforeMoov.length;        // ftyp
  out.set(moovData, off); off += moovData.length;            // moov (now at front)
  out.set(betweenFtypAndMoov, off); off += betweenFtypAndMoov.length;  // any other pre-moov boxes
  out.set(afterMoov, off);                                    // mdat + others

  // Now rewrite all stco/co64 offsets that pointed into the pre-moov region
  // The shift = new_position_of_mdat_or_other - old_position
  // For each chunk offset that was > moov.end, subtract moov.size - betweenFtypAndMoov.length
  // Simpler: rewrite offsets in MOOV by subtracting (moov.size - betweenFtypAndMoov.length)
  // from any offset that is > moov.end (i.e., shifted left)
  const shift = betweenFtypAndMoov.length;  // positive = content after moov moved left by this much
  if (shift > 0) {
    // Update view to point at the new MOOV in the output
    const newView = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const newMoovStart = beforeMoov.length;
    // Recurse to find all stco/co64 and shift their offsets by -shift
    function shiftOffsets(box, delta) {
      if (box.type === 'stco') {
        const count = newView.getUint32(box.start + box.header + 4);
        for (let i = 0; i < count; i++) {
          const p = box.start + box.header + 8 + i * 4;
          const old = newView.getUint32(p);
          if (old > moov.end) newView.setUint32(p, old - delta);
        }
      } else if (box.type === 'co64') {
        const count = newView.getUint32(box.start + box.header + 4);
        for (let i = 0; i < count; i++) {
          const p = box.start + box.header + 8 + i * 8;
          const hi = newView.getUint32(p);
          const lo = newView.getUint32(p + 4);
          const old = hi * 2 ** 32 + lo;
          if (old > moov.end) {
            const nw = old - delta;
            newView.setUint32(p, Math.floor(nw / 2 ** 32));
            newView.setUint32(p + 4, nw >>> 0);
          }
        }
      } else {
        const kids = parseBoxesInView(newView, box.start + box.header, box.end);
        for (const k of kids) shiftOffsets(k, delta);
      }
    }
    function parseBoxesInView(v, start, end) {
      const boxes = [];
      let off2 = start;
      while (off2 + 8 <= end) {
        let size = v.getUint32(off2);
        const type = decoder.decode(out.slice(off2 + 4, off2 + 8));
        let hdrSize = 8;
        if (size === 1) { size = v.getUint32(off2 + 8) * 2 ** 32 + v.getUint32(off2 + 12); hdrSize = 16; }
        else if (size === 0) { size = end - off2; }
        if (size < hdrSize || off2 + size > end) break;
        boxes.push({ type, header: hdrSize, start: off2, end: off2 + size });
        off2 += size;
      }
      return boxes;
    }
    const newMoovEnd = newMoovStart + moovData.length;
    // Parse top-level boxes in the new view
    const newTop = parseBoxesInView(newView, 0, out.length);
    const newMoovBox = newTop.find(b => b.type === 'moov');
    if (newMoovBox) shiftOffsets(newMoovBox, shift);
  }

  return out;
}

const Recorder = {
  isRecording: false,
  isPaused: false,
  mediaRecorder: null,
  stream: null,
  chunks: [],
  rafId: null,
  startTime: 0,
  elapsedTime: 0,
  pauseTime: 0,        // accumulated time before last pause
  timerInterval: null,

  // Panel visibility
  panelVisible: false,

  // Settings
  format: 'mp4',
  fps: 30,
  qualityMap: { high: 8000000, medium: 4000000, low: 1000000 },
  quality: 4000000,

  // Preview blob
  currentBlob: null,
  currentUrl: null,

  // Toggle the floating settings panel
  togglePanel() {
    const panel = document.getElementById('recPanel');
    const collapsed = document.getElementById('recPanelCollapsed');
    const expanded = document.getElementById('recPanelExpanded');

    if (!this.panelVisible) {
      // Panel was hidden — show it
      this.panelVisible = true;
      panel.style.display = 'flex';
      if (this.isRecording) {
        // During recording: start in collapsed (minimal) view
        collapsed.style.display = 'flex';
        expanded.style.display = 'none';
      } else {
        // Not recording: show full settings
        collapsed.style.display = 'none';
        expanded.style.display = 'flex';
      }
    } else {
      // Panel was visible — toggle between collapsed/expanded (if recording), or hide (if not)
      if (this.isRecording) {
        if (collapsed.style.display === 'flex') {
          // Currently collapsed → expand
          collapsed.style.display = 'none';
          expanded.style.display = 'flex';
        } else {
          // Currently expanded → collapse
          collapsed.style.display = 'flex';
          expanded.style.display = 'none';
        }
      } else {
        // Not recording → hide panel
        this.panelVisible = false;
        panel.style.display = 'none';
      }
    }
  },

  showPanel() {
    this.panelVisible = true;
    const panel = document.getElementById('recPanel');
    panel.style.display = 'flex';
    document.getElementById('recPanelCollapsed').style.display = 'none';
    document.getElementById('recPanelExpanded').style.display = 'flex';
    if (!this.isRecording) this._setStatus('准备就绪', '');
  },

  hidePanel() {
    this.panelVisible = false;
    document.getElementById('recPanel').style.display = 'none';
  },

  setFormat(fmt) {
    this.format = 'mp4';
  },

  setFps(val) { this.fps = parseInt(val); },

  setQuality(val) {
    this.quality = this.qualityMap[val] || 4000000;
  },

  start() {
    if (this.isRecording) return;

    // Stop any previous preview
    this._revokeUrl();

    const fps = this.fps;

    // Create a hidden canvas that we render the circuit into, then capture from it.
    // (video elements don't have getContext('2d') — only canvas elements do)
    let recCanvas = document.getElementById('recCanvas');
    if (!recCanvas) {
      recCanvas = document.createElement('canvas');
      recCanvas.id = 'recCanvas';
      recCanvas.style.display = 'none';
      document.body.appendChild(recCanvas);
    }

    // Size the recording canvas to match the main canvas
    recCanvas.width = canvas.width;
    recCanvas.height = canvas.height;

    // Get 2D context for the recording canvas (canvas, not video!)
    const recCtx = recCanvas.getContext('2d');

    // Continuous render RAF loop — runs at ~60fps to continuously:
    // 1. Force-render the circuit canvas (bypassing dirty flag so canvas pixels always update)
    // 2. Copy the freshly rendered canvas to our recording canvas
    // 3. captureStream() on the recording canvas then emits each new frame
    let lastRenderTime = 0;
    const doRender = (timestamp) => {
      if (!this.isRecording) return;
      try {
        if (timestamp - lastRenderTime >= 16) { // ~60fps
          lastRenderTime = timestamp;
          // Force render the circuit canvas so it always has fresh content
          Renderer.render();
          // Copy freshly rendered canvas to recording canvas
          // Use explicit W/H to ensure 1:1 pixel copy (no interpolation artifacts)
          recCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height);
        }
      } catch(e) { /* silent — canvas may not be ready yet */ }
      this._renderRafId = requestAnimationFrame(doRender);
    };
    this._renderRafId = requestAnimationFrame(doRender);

    // Draw one frame synchronously BEFORE starting captureStream
    // so the stream has an initial frame to emit
    try {
      Renderer.render();
      recCtx.drawImage(canvas, 0, 0);
    } catch(e) {}

    // Build capture stream from the recording canvas (not the video element)
    let stream;
    try {
      stream = recCanvas.captureStream(fps);
    } catch(e) {
      cancelAnimationFrame(this._renderRafId);
      UI.toast('当前浏览器不支持录屏', 'error');
      return;
    }

    // MP4 only
    let mimeType = 'video/mp4';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      UI.toast('当前浏览器不支持 MP4 录制', 'error');
      cancelAnimationFrame(this._renderRafId);
      return;
    }

    this.chunks = [];
    this.stream = stream;
    this.startTime = Date.now();
    this.elapsedTime = 0;
    this.pauseTime = 0;
    this.isPaused = false;

    this.isRecording = true;
    S.recording = true; // Enable pure-white/no-grid recording mode

    const bitrate = this.quality;
    try {
      this.mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
    } catch(e) {
      this.mediaRecorder = new MediaRecorder(stream, { mimeType });
    }
    this.mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    // Note: onstop is NOT set here; stop() uses setTimeout to call _onVideoStop
    // after a 200ms delay to ensure the final chunk is collected (MOOV atom fix)
    this.mediaRecorder.start(100);

    // Auto-collapse panel so it doesn't block the canvas
    this._collapsePanel();

    // Show floating recording indicator in toolbar
    this._updateUI(true);
    this._startTimer();

    // Show pause/stop/re-record in toolbar, hide start
    document.getElementById('recPauseBtn').style.display = 'inline-flex';
    document.getElementById('recStopBtn').style.display = 'inline-flex';
    document.getElementById('recReRecordBtn').style.display = 'inline-flex';
    document.getElementById('recStartBtn').style.display = 'none';

    UI.toast('后台录制已开始，可正常操作画布', 'success');
  },

  pause() {
    if (!this.isRecording || this.isPaused) return;
    this.isPaused = true;
    this.pauseTime = Date.now();
    if (this.format === 'gif') {
      cancelAnimationFrame(this.rafId);
    } else {
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.pause();
      }
    }
    clearInterval(this.timerInterval);
    document.getElementById('recPauseBtn').innerHTML = '&#9654; 继续';
    document.getElementById('recIndicator').classList.remove('recording');
    document.getElementById('recIndicator').classList.add('paused');
    // Switch to collapsed (minimal) view so paused status is visible
    document.getElementById('recPanelCollapsed').style.display = 'flex';
    document.getElementById('recPanelExpanded').style.display = 'none';
    this._setStatus('已暂停 ' + this._fmtTime(this.elapsedTime), '#d29922');
  },

  resume() {
    if (!this.isRecording || !this.isPaused) return;
    this.isPaused = false;
    // Adjust startTime to account for pause duration
    this.startTime += (Date.now() - this.pauseTime);
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
    }
    this._startTimer();
    document.getElementById('recPauseBtn').innerHTML = '&#10074;&#10074; 暂停';
    document.getElementById('recIndicator').classList.add('recording');
    document.getElementById('recIndicator').classList.remove('paused');
    this._setStatus('录制中', '#f85149');
  },

  stop() {
    if (!this.isRecording) return;
    this.isRecording = false;
    S.recording = false; // Restore normal render mode
    this.isPaused = false;

    // Stop continuous render loop
    if (this._renderRafId) {
      cancelAnimationFrame(this._renderRafId);
      this._renderRafId = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      if (this.mediaRecorder.state === 'paused') this.mediaRecorder.resume();
      this.mediaRecorder.stop();
      // Wait for final ondataavailable chunk before assembling blob
      // Without this delay, the last chunk may not be collected → MOOV atom missing → can't seek
      clearInterval(this.timerInterval);
      const recorder = this.mediaRecorder;
      const self = this;
      setTimeout(() => { self._onVideoStop(); }, 200);
      return;
    }
    clearInterval(this.timerInterval);

    // Restore toolbar buttons: show start + re-record, hide pause/stop
    document.getElementById('recStartBtn').style.display = 'inline-flex';
    document.getElementById('recReRecordBtn').style.display = 'inline-flex';
    document.getElementById('recPauseBtn').style.display = 'none';
    document.getElementById('recPauseBtn').innerHTML = '&#10074;&#10074; 暂停';
    document.getElementById('recStopBtn').style.display = 'none';

    this._updateUI(false);
    document.getElementById('recIndicator').classList.remove('paused');

    // Auto-show panel on stop (for preview/export)
    this.showPanel();
    document.getElementById('recPanelCollapsed').style.display = 'none';
    document.getElementById('recPanelExpanded').style.display = 'flex';
    this._setStatus('录制完成，点击导出', '#3fb950');
  },

  toggle() {
    if (this.isRecording) {
      if (this.isPaused) {
        this.resume();
      } else {
        this.pause();
      }
    } else {
      this.start();
    }
  },

  async _onVideoStop() {
    if (this.chunks.length === 0) {
      UI.toast('录制失败，请重试', 'error');
      return;
    }
    const mp4Blob = new Blob(this.chunks, { type: 'video/mp4' });
    await this._convertToMp4(mp4Blob);
  },

  // Pure-JS MP4 faststart: rewrite the file so the MOOV atom is at the front
  // (MediaRecorder puts MOOV at the end → video plays but progress bar is unseekable)
  async _convertToMp4(mp4Blob) {
    this._setStatus('正在优化 MP4 (faststart)...', '');
    try {
      const buf = await mp4Blob.arrayBuffer();
      const fixed = fastStartMp4(new Uint8Array(buf));
      this.currentBlob = new Blob([fixed], { type: 'video/mp4' });
      this._showPreview();
      this._setStatus('MP4 优化完成，可拖动进度条', '#3fb950');
    } catch(e) {
      console.error('MP4 faststart 失败:', e);
      UI.toast('MP4 优化失败，将导出原始文件', 'error');
      this.currentBlob = mp4Blob;
      this._showPreview();
    }
  },

  _showPreview() {
    this._revokeUrl();
    this.currentUrl = URL.createObjectURL(this.currentBlob);

    const hint = document.getElementById('recPreviewHint');
    const video = document.getElementById('recPreviewVideo');
    hint.style.display = 'none';
    video.style.display = 'block';
    video.src = this.currentUrl;

    document.getElementById('recExportBtn').disabled = false;
    const sizeKB = Math.round(this.currentBlob.size / 1024);
    const sizeStr = sizeKB > 1024 ? (sizeKB / 1024).toFixed(1) + ' MB' : sizeKB + ' KB';
    this._setStatus('录制完成 (' + this._fmtTime(this.elapsedTime) + ', ' + sizeStr + ')', '#3fb950');

    // Show the preview modal
    document.getElementById('previewModal').classList.add('show');
    document.getElementById('prevVideo').src = this.currentUrl;
    const prevSize = document.getElementById('prevSize');
    if (prevSize) prevSize.textContent = sizeStr;
    const prevDur = document.getElementById('prevDur');
    if (prevDur) prevDur.textContent = this._fmtTime(this.elapsedTime);
  },

  exportCurrent() {
    if (!this.currentBlob) return;
    const a = document.createElement('a');
    a.href = this.currentUrl || URL.createObjectURL(this.currentBlob);
    a.download = 'ElecSim_' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.mp4';
    a.click();
    UI.toast('已导出: ' + a.download, 'success');
  },

  closePreview() {
    document.getElementById('previewModal').classList.remove('show');
    document.getElementById('prevVideo').src = '';
    this._revokeUrl();
  },

  // Re-record: close preview and reset state for a fresh recording
  reRecord() {
    // Stop current recording if active
    if (this.isRecording) {
      clearInterval(this.timerInterval);
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
      this.isRecording = false;
      S.recording = false;
      cancelAnimationFrame(this._renderRafId);
      this.chunks = [];
    }

    this.closePreview();
    this.currentBlob = null;
    this.currentUrl = null;
    this.elapsedTime = 0;
    this._setStatus('准备就绪', '');
    document.getElementById('recExportBtn').disabled = true;
    document.getElementById('recTime').textContent = '00:00';
    const t2 = document.getElementById('recTime2');
    if (t2) t2.textContent = '00:00';

    // Toolbar: show start, hide pause/stop/re-record
    document.getElementById('recStartBtn').style.display = 'inline-flex';
    document.getElementById('recPauseBtn').style.display = 'none';
    document.getElementById('recStopBtn').style.display = 'none';
    document.getElementById('recReRecordBtn').style.display = 'none';
  },

  close() {
    if (this.isRecording) this.stop();
    this.closePreview();
    this.hidePanel();
    document.getElementById('recPreviewHint').style.display = '';
    document.getElementById('recPreviewHint').textContent = '点击「开始录制」后将实时预览';
    document.getElementById('recPreviewVideo').style.display = 'none';
    document.getElementById('recPreviewVideo').src = '';
    document.getElementById('recExportBtn').disabled = true;
    this._setStatus('准备就绪', '');
  },

  _collapsePanel() {
    // During recording: show only minimal collapsed view
    document.getElementById('recPanelCollapsed').style.display = 'flex';
    document.getElementById('recPanelExpanded').style.display = 'none';
  },

  _startTimer() {
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (!this.isPaused) {
        this.elapsedTime = Date.now() - this.startTime;
      }
      const t = this._fmtTime(this.elapsedTime);
      document.getElementById('recTime').textContent = t;
      const t2 = document.getElementById('recTime2');
      if (t2) t2.textContent = t;
      this._setStatus('录制中 ' + t, '#f85149');
    }, 100);
  },

  _setStatus(text, color) {
    const el = document.getElementById('recPanelStatus');
    if (el) { el.textContent = text; if (color) el.style.color = color; }
    const exp = document.getElementById('recPanelStatusExp');
    if (exp) { exp.textContent = text; if (color) exp.style.color = color; }
  },

  _fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  },

  _updateUI(recording) {
    const ind = document.getElementById('recIndicator');
    if (recording) {
      ind.classList.add('recording');
      ind.style.display = 'inline-flex';
      this._setStatus('录制中 00:00', '#f85149');
    } else {
      ind.classList.remove('recording');
      ind.style.display = 'none';
    }
  },

  _revokeUrl() {
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  },

  // Called by the render RAF loop to force a render during recording
  _forceRender() {
    if (this.isRecording && !this.isPaused) {
      Renderer.render();
    }
  },

  // Remux WebM -> seekable MP4 via mp4muxer
  async _remuxToSeekableMp4(webmBlob) {
    try {
      this._setStatus('loading remux libs...', '');
      const { Mp4Demuxer, Mp4Muxer } = await import('https://cdn.jsdelivr.net/npm/mp4muxer@4.2.1/dist/esm/mp4_muxer.js');

      this._setStatus('remuxing to seekable MP4...', '');
      let muxer = null;
      const demuxer = new Mp4Demuxer({
        onConfig: (config) => {
          muxer = new Mp4Muxer({
            target: 'container',
            videoCodec: config.codec.substring(0, 3) === 'avc' ? 'avc' : 'hevc',
            width: config.width,
            height: config.height,
            fastStart: 'in-memory',   // place moov at file start for seekable playback
          });
        },
        onSamples: (samples) => {
          if (muxer) muxer.addVideoChunk({ samples });
        },
      });

      const buf = await webmBlob.arrayBuffer();
      demuxer.appendBuffer(buf);
      demuxer.flush();

      const { buffer } = muxer.finalize();
      return new Blob([buffer], { type: 'video/mp4' });
    } catch(e) {
      console.error('Remux failed:', e);
      return webmBlob;
    }
  },

};

