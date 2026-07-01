const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let W, H;

let _renderPending = false;
function requestRender() {
  if (!_renderPending) {
    _renderPending = true;
    requestAnimationFrame(() => {
      _renderPending = false;
      _SR_render();
    });
  }
}

function resize() {
  const r = window.devicePixelRatio || 1;
  const area = document.getElementById('canvasArea');
  W = area.clientWidth; H = area.clientHeight;
  canvas.width = W * r; canvas.height = H * r;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(r, 0, 0, r, 0, 0);
  requestRender();
}
window.addEventListener('resize', resize);

function screenToCanvas(sx, sy) {
  return { x: (sx - S.pan.x) / S.zoom, y: (sy - S.pan.y) / S.zoom };
}

// _SR_render: direct synchronous render (used by animation loop & recording only)
function _SR_render() { Renderer.render(); }

const Renderer = {
  render() {
    S.animTick++;
    ctx.clearRect(0, 0, W, H);
    // Recording mode: same dark background as normal view
    if (S.recording) {
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(S.pan.x, S.pan.y);
      ctx.scale(S.zoom, S.zoom);
      // Grid: same subtle white grid as normal mode
      const g = S.grid;
      const startX = Math.floor(-S.pan.x / S.zoom / g) * g;
      const startY = Math.floor(-S.pan.y / S.zoom / g) * g;
      const endX = startX + W / S.zoom + g * 2;
      const endY = startY + H / S.zoom + g * 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let x = startX; x < endX; x += g) { ctx.moveTo(x, startY); ctx.lineTo(x, endY); }
      for (let y = startY; y < endY; y += g) { ctx.moveTo(startX, y); ctx.lineTo(endX, y); }
      ctx.stroke();
      // Draw wires and components
      WireRouter.drawWires();
      this.drawComponents();
      if (WireRouter.isActive()) WireRouter.drawTempWire();
      ctx.restore();
      this.updateCounts();
      return;
    }
    ctx.save();
    ctx.translate(S.pan.x, S.pan.y);
    ctx.scale(S.zoom, S.zoom);
    this.drawGrid();
    WireRouter.drawWires();
    this.drawComponents();
    if (WireRouter.isActive()) WireRouter.drawTempWire();
    ctx.restore();
    this.updateCounts();
  },

  drawGrid() {
    const g = S.grid;
    const startX = Math.floor(-S.pan.x / S.zoom / g) * g;
    const startY = Math.floor(-S.pan.y / S.zoom / g) * g;
    const endX = startX + W / S.zoom + g * 2;
    const endY = startY + H / S.zoom + g * 2;
    const isXray = false;

    ctx.strokeStyle = isXray ? 'rgba(57,210,192,0.06)' : 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = startX; x < endX; x += g) { ctx.moveTo(x, startY); ctx.lineTo(x, endY); }
    for (let y = startY; y < endY; y += g) { ctx.moveTo(startX, y); ctx.lineTo(endX, y); }
    ctx.stroke();

    if (isXray) {
      ctx.strokeStyle = 'rgba(57,210,192,0.1)';
      ctx.beginPath();
      for (let x = startX; x < endX; x += g * 5) { ctx.moveTo(x, startY); ctx.lineTo(x, endY); }
      for (let y = startY; y < endY; y += g * 5) { ctx.moveTo(startX, y); ctx.lineTo(endX, y); }
      ctx.stroke();
    }
  },

  drawComponents() {
    S.components.forEach(c => {
      const sel = S.selected === c.id;
      const catColor = Config.categoryColors[c.cat] || '#58a6ff';
      const isXray = false;

      ctx.save();
      ctx.translate(c.x, c.y);

      const bw = c.w || 100, bh = c.h || 56;

      // === AC SOURCE: custom layout (plug image at top, lead wires + pins at bottom) ===
      if (c.type === 'ac_source' && c.image) {
        const imgAR = 396 / 600;  // webp actual aspect ratio (396x600)
        const plugW = bw;
        const plugH = plugW / imgAR;
        const plugTopY = -bh / 2;
        const plugBottomY = plugTopY + plugH;
        // Cable exits at x≈275 in 396-wide image (not image center 198!)
        // Offset the DRAW so the cable aligns with component center, not the whole image
        const cableFrac = 275 / 396;  // cable X in image coords (fraction)
        const cableOffsetX = (cableFrac - 0.5) * plugW;
        // Selection glow
        if (sel) { ctx.shadowColor = catColor; ctx.shadowBlur = 14; }
        try {
          const cacheKey = '_imgCache';
          let img = c[cacheKey];
          if (!img || img.src !== c.image) {
            img = Registry.preloadImage(c.image);
            c[cacheKey] = img;
          }
          if (img.complete && img.naturalWidth > 0) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.globalAlpha = isXray ? 0.3 : 1.0;
            // Shift image LEFT by cableOffsetX so the CABLE lands at x=0 (component center)
            ctx.drawImage(img, -plugW / 2 - cableOffsetX, plugTopY, plugW, plugH);
            ctx.globalAlpha = 1;
          }
        } catch(e) {}
        // Pins centered on cable (now at x=0 after offset)
        ctx.restore();
        this._drawPinsForComponent(c);
        return;
      }

      // === IMAGE-BASED COMPONENTS (frameless realist style) ===
      if (c.image) {
        // Selection glow
        if (sel) { ctx.shadowColor = catColor; ctx.shadowBlur = 14; }

        // Draw image full-bleed (no dark box, no padding) — with SHARED image cache
        try {
          const lampLit = c.type === 'lamp' && S.simRunning && c.simCurrent > 0;
          const remote2kLit = c.type === 'rf_remote_2key' && (c.props.pressed1 || c.props.pressed2);
          const wantOn = (c.props.closed || c.props.pressed || lampLit || remote2kLit) && c.imageOn;
          const imgSrc = wantOn ? c.imageOn : c.image;
          const cacheKey = wantOn ? '_imgOnCache' : '_imgCache';
          let img = c[cacheKey];
          if (!img || img.src !== imgSrc) {
            // Use shared Registry cache so component placement is instant
            // (no new Image() per component, no reload from network)
            img = Registry.preloadImage(imgSrc);
            c[cacheKey] = img;
          }
          if (img.complete && img.naturalWidth > 0) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.globalAlpha = isXray ? 0.3 : 1.0;
            // Preserve natural aspect ratio (fit inside bw x bh)
            const imgAR = img.naturalWidth / img.naturalHeight;
            const boxAR = bw / bh;
            let drawW, drawH;
            if (imgAR > boxAR) {
              drawW = bw;
              drawH = bw / imgAR;
            } else {
              drawH = bh;
              drawW = bh * imgAR;
            }
            ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.globalAlpha = 1;
          }
        } catch(e) {}

        // === 12V电池: 主体居中，引线从端子球引到pin ===
        if (c.type === 'battery_12v' && c.pins && c.pins.length >= 2) {
          // 主体bbox (相对原图): x=[293,1814] y=[791,1656], 主体宽1522, 高866
          // 主体AR ≈ 1.758
          const bodyW = bw;
          const bodyH = bodyW / 1.758;
          // 引线：从端子球位置 → pin (相距5px)
          for (const pin of c.pins) {
            const isPos = pin.label === '+';
            const color = isPos ? '#e53935' : '#00bcd4';
            ctx.strokeStyle = color;
            ctx.lineWidth = 3.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(pin.dx, pin.dy);
            ctx.lineTo(pin.dx, pin.dy - 5);
            ctx.stroke();
          }
        }

        // === AC Source: draw lead wires from image bottom down to pin positions ===
        if (c.type === 'ac_source' && c.pins && c.pins.length >= 2) {
          const wireTopY = bh / 2 - 5;        // just below the image (plug cable end)
          const leadLen = 18;                  // length of visible lead wire
          const pinSpacing = 30;               // horizontal distance between L and N pin dots
          for (const pin of c.pins) {
            const isL = pin.label === 'L';
            const x = pin.dx;
            const color = isL ? '#e53935' : '#1e88e5'; // L=red, N=blue
            ctx.strokeStyle = color;
            ctx.lineWidth = 3.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x, wireTopY);
            ctx.lineTo(x, pin.dy - 6);
            ctx.stroke();
          }
        }

        // Glow effects on top of image — screen blend for realistic light emission
        if (c.type === 'lamp' && S.simRunning && c.simCurrent > 0) {
          // lamp_on image already has baked-in warm glow;
          // keep a subtle pulsing halo for extra realism
          const intensity = Math.min(c.simCurrent / 1.5, 1);
          const cx = 0, cy = -55;
          const r = 77;

          ctx.globalCompositeOperation = 'screen';

          const grd = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
          grd.addColorStop(0, `rgba(255,255,220,${0.15 * intensity})`);
          grd.addColorStop(1, 'transparent');
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();

          ctx.globalCompositeOperation = 'source-over';
        }

        if (c.type === 'led' && S.simRunning && c.simCurrent > 0) {
          const color = c.props.color || '#ff4444';
          const intensity = Math.min(c.simCurrent / 10, 1);
          const glowR = 18 + intensity * 12 + Math.sin(Date.now() / 300) * 3;
          const grd = ctx.createRadialGradient(0, 0, 2, 0, 0, glowR);
          grd.addColorStop(0, color);
          grd.addColorStop(0.5, color + '66');
          grd.addColorStop(1, 'transparent');
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(0, 0, glowR, 0, Math.PI * 2);
          ctx.fill();
        }

        if ((c.type === 'motor_dc') && S.simRunning && c.simCurrent > 0) {
          const speed = Math.min(c.simCurrent / 5, 1);
          const angle = Date.now() / (200 - speed * 150);
          ctx.strokeStyle = 'rgba(240,136,62,0.6)';
          ctx.lineWidth = 2;
          for (let i = 0; i < 3; i++) {
            const a = angle + i * Math.PI * 2 / 3;
            ctx.beginPath();
            ctx.arc(0, -2, 14, a, a + 0.8);
            ctx.stroke();
          }
        }

        if (c.type === 'buzzer' && S.simRunning && c.simCurrent > 0) {
          ctx.translate(Math.sin(Date.now() / 50) * 1.5, Math.sin(Date.now() / 50) * 1.5);
          const ripplePhase = (Date.now() / 300) % 1;
          const rippleR = 15 + ripplePhase * 15;
          ctx.strokeStyle = `rgba(88,166,255,${0.4 * (1 - ripplePhase)})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, rippleR, -0.5, 0.5);
          ctx.stroke();
          const ripplePhase2 = ((Date.now() / 300) + 0.5) % 1;
          const rippleR2 = 15 + ripplePhase2 * 15;
          ctx.strokeStyle = `rgba(88,166,255,${0.3 * (1 - ripplePhase2)})`;
          ctx.beginPath();
          ctx.arc(0, 0, rippleR2, -0.5, 0.5);
          ctx.stroke();
        }

        // === SPST: near-vertical wires + offset contacts + seesaw arm ===
        if (c.type === 'spst') {
          const closed = c.props.closed;
          const halfH = bh / 2;  // 80
          const pinR = 9;

          // Terminal positions: outside panel edge (half=80, 3px outside)
          const termTopY = -85;
          const termBotY =  85;

          // Contacts: arm ~66px, wire ~43px
          const redX  = 0,  redY  = -33;
          const greenX = 0,  greenY =  33;

          function drawPinDisc(x, y, r, fillColor, strokeColor, label) {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 2;
            ctx.stroke();
            if (label) {
              ctx.font = 'bold 14px Arial';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = fillColor;
              ctx.fillText(label, x + r + 4, y);
            }
          }

          // Draw terminals
          drawPinDisc(0, termTopY, pinR, '#f85149', '#c02222', 'L');
          drawPinDisc(0, termBotY, pinR, '#22c55e', '#166534', 'L1');

          // Thick wires (almost vertical, only 3px horizontal offset)
          ctx.lineCap = 'round';
          ctx.lineWidth = 7;

          ctx.strokeStyle = '#e53e3e';
          ctx.beginPath();
          ctx.moveTo(0, termTopY + pinR);
          ctx.lineTo(redX, redY);
          ctx.stroke();

          ctx.strokeStyle = '#22c55e';
          ctx.beginPath();
          ctx.moveTo(0, termBotY - pinR);
          ctx.lineTo(greenX, greenY);
          ctx.stroke();

          // Contact dots
          ctx.fillStyle = '#c0392b';
          ctx.beginPath();
          ctx.arc(redX, redY, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#27ae60';
          ctx.beginPath();
          ctx.arc(greenX, greenY, 3.5, 0, Math.PI * 2);
          ctx.fill();

          // Seesaw arm — pivots at RED contact dot
          const pivotX = redX, pivotY = redY;
          const armWidth = 6;

          // Arm length = distance from red dot to green dot
          const dx = greenX - redX;   // 0
          const dy = greenY - redY;   // 66
          const armLen = Math.sqrt(dx*dx + dy*dy);  // 66

          if (closed) {
            // ON: arm reaches green contact dot
            ctx.strokeStyle = '#8B6914';
            ctx.lineWidth = armWidth;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(pivotX, pivotY);
            ctx.lineTo(greenX, greenY);
            ctx.stroke();

            ctx.fillStyle = '#FFD700';
            ctx.beginPath();
            ctx.arc(greenX, greenY, 3, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // OFF: same length, tilt 12° left-down from straight-down
            const angle = -18 * Math.PI / 180;
            const endX = pivotX + armLen * Math.sin(angle);   // -3 + 65.3*(-0.208) ≈ -16.6
            const endY = pivotY + armLen * Math.cos(angle);   // -35 + 65.3*0.978 ≈ +28.9

            ctx.strokeStyle = '#8B6914';
            ctx.lineWidth = armWidth;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(pivotX, pivotY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
          }
        }

        // === 自回弹开关: vertical wires + offset contacts + spring-loaded seesaw arm ===
        if (c.type === 'spst_momentary') {
          const closed = c.props.closed;
          const pinR = 9;

          // Terminal positions: outside panel edge (half=80, 5px outside for bigger pins)
          const termTopY = -85;
          const termBotY =  85;

          // Contacts: arm ~56px, wire ~27px (scaled for 160×160)
          const redX  = 0,  redY  = -28;
          const greenX = 0,  greenY =  28;

          function drawPinDisc(x, y, r, fillColor, strokeColor, label) {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 2;
            ctx.stroke();
            if (label) {
              ctx.font = 'bold 14px Arial';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = fillColor;
              ctx.fillText(label, x + r + 4, y);
            }
          }

          // Draw terminals (red L at top, green L1 at bottom)
          drawPinDisc(0, termTopY, pinR, '#f85149', '#c02222', 'L');
          drawPinDisc(0, termBotY, pinR, '#22c55e', '#166534', 'L1');

          // Vertical wires from terminals to internal contact points
          ctx.lineCap = 'round';
          ctx.lineWidth = 7;

          ctx.strokeStyle = '#e53e3e';
          ctx.beginPath();
          ctx.moveTo(0, termTopY + pinR);
          ctx.lineTo(redX, redY);
          ctx.stroke();

          ctx.strokeStyle = '#22c55e';
          ctx.beginPath();
          ctx.moveTo(0, termBotY - pinR);
          ctx.lineTo(greenX, greenY);
          ctx.stroke();

          // Contact dots
          ctx.fillStyle = '#c0392b';
          ctx.beginPath();
          ctx.arc(redX, redY, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#27ae60';
          ctx.beginPath();
          ctx.arc(greenX, greenY, 3.5, 0, Math.PI * 2);
          ctx.fill();

          // Spring-loaded seesaw arm — pivots at RED contact, reaches GREEN when pressed
          const pivotX = redX, pivotY = redY;
          const armWidth = 6;
          const dy = greenY - redY;   // 56
          const armLen = dy;          // contacts vertically aligned

          if (closed) {
            // PRESSED: arm connects red → green (circuit closes)
            ctx.strokeStyle = '#8B6914';
            ctx.lineWidth = armWidth;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(pivotX, pivotY);
            ctx.lineTo(greenX, greenY);
            ctx.stroke();

            ctx.fillStyle = '#FFD700';
            ctx.beginPath();
            ctx.arc(greenX, greenY, 3, 0, Math.PI * 2);
            ctx.fill();

          } else {
            // RELEASED: arm springs away (tilts left, spring-back)
            const angle = -22 * Math.PI / 180;
            const endX = pivotX + armLen * Math.sin(angle);
            const endY = pivotY + armLen * Math.cos(angle);

            ctx.strokeStyle = '#8B6914';
            ctx.lineWidth = armWidth;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(pivotX, pivotY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
          }
        }

        // === bell_dc: auto-ring when powered (sound only, no overlay animation on photo) ===
        if (c.type === 'bell_dc') {
          const isRinging = S.simRunning && c.simCurrent > 0;
          if (isRinging && !c._ringing) {
            c._ringing = true;
            BellAudio.ring(c.id);
          } else if (!isRinging && c._ringing) {
            c._ringing = false;
            BellAudio.stop();
          }
        }

        ctx.restore();  // restore outer save (back to global coords)

        // Draw floating pins for other image-based components
        if (c.type !== 'spst' && c.type !== 'spst_momentary') {
          this._drawPinsForComponent(c);
        } else if (!isXray && WireRouter.isActive() && WireRouter.startPin) {
          // SPST routing pin highlights (drawn manually since spst bypasses _drawPinsForComponent)
          for (const pin of c.pins) {
            const px = c.x + pin.dx, py = c.y + pin.dy;
            const pinR = 9;
            const isStart = (WireRouter.startPin.comp === c.id && WireRouter.startPin.pin === pin.id);
            const wp = WireRouter.wireType || 'live';
            const hc = WireRouter.WireColors[wp] || '#e53935';
            const pulse = isStart
              ? (0.35 + Math.sin(Date.now() / 400) * 0.25)
              : (0.18 + Math.sin(Date.now() / 500) * 0.12);
            ctx.save();
            ctx.globalAlpha = pulse;
            ctx.beginPath();
            ctx.arc(px, py, pinR + 5, 0, Math.PI * 2);
            ctx.strokeStyle = hc;
            ctx.lineWidth = isStart ? 3 : 2.5;
            ctx.setLineDash(isStart ? [] : [3, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }
        }
        return;
      }

      // === ICON-BASED COMPONENTS (original dark-box style) ===
      // Selection glow
      if (sel) { ctx.shadowColor = catColor; ctx.shadowBlur = 14; }

      const grad = ctx.createLinearGradient(-bw / 2, -bh / 2, bw / 2, bh / 2);
      if (isXray) {
        grad.addColorStop(0, hexToRGBA(catColor, 0.06));
        grad.addColorStop(1, hexToRGBA(catColor, 0.12));
      } else {
        grad.addColorStop(0, '#1c2333');
        grad.addColorStop(1, '#252d3a');
      }
      ctx.fillStyle = grad;
      ctx.strokeStyle = sel ? catColor : (isXray ? hexToRGBA(catColor, 0.25) : '#30363d');
      ctx.lineWidth = sel ? 2 : 1;
      roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 8);
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;

      // Internal structure
      if (S.showInternal || isXray) this.drawInternal(c, isXray, catColor);

      // Icon
      ctx.fillStyle = isXray ? hexToRGBA(catColor, 0.9) : '#e6edf3';
      ctx.font = '18px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.icon, 0, -4);

      // Name
      ctx.font = '9px system-ui';
      ctx.fillStyle = isXray ? hexToRGBA(catColor, 0.6) : '#8b949e';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.name, 0, 14);

      // Value label
      let valStr = this.getValueLabel(c);
      if (valStr) {
        ctx.font = '8px monospace';
        ctx.fillStyle = isXray ? hexToRGBA(catColor, 0.4) : '#484f58';
        ctx.fillText(valStr, 0, 26);
      }

      ctx.restore();

      // Draw pins
      this._drawPinsForComponent(c);
    });
  },


  _drawPinsForComponent(c) {
    const isXray = false;
    c.pins.forEach(pin => {
      const px = c.x + pin.dx, py = c.y + pin.dy;
      const connected = WireRouter.isPinConnected(c.id, pin.id);
      const pinWireType = connected ? WireRouter.getPinWireType(c.id, pin.id) : null;
      const wireColor = pinWireType ? WireRouter.WireColors[pinWireType] : null;
      const pinR = (c.type === 'lamp' || c.type === 'spst' || c.type === 'spst_momentary') ? 9 : (c.type === 'battery_12v' ? 10 : 8.5);

      if (connected && wireColor && !isXray) {
        drawCrimp3D(px, py, wireColor, (c.type === 'lamp' || c.type === 'spst' || c.type === 'spst_momentary') ? 9 : (c.type === 'battery_12v' ? 10 : 8));
      } else {
        ctx.beginPath();
        ctx.arc(px, py, pinR, 0, Math.PI * 2);
        if (isXray) {
          ctx.fillStyle = connected ? '#39d2c0' : 'rgba(57,210,192,0.4)';
        } else {
          const lbl = pin.label ? pin.label.toUpperCase() : '';
          const isL = lbl === 'L';
          const isL1 = lbl === 'L1';
          const isN = lbl === 'N' || lbl === 'L2';
          if (isL || isL1 || isN) {
            // L=red (live), L1=green (output), N/L2=blue (neutral)
            if (isL) {
              ctx.fillStyle = '#f85149'; ctx.strokeStyle = '#c02222';
            } else if (isL1) {
              ctx.fillStyle = '#22c55e'; ctx.strokeStyle = '#166534';
            } else {
              ctx.fillStyle = '#58a6ff'; ctx.strokeStyle = '#2266cc';
            }
          } else if (lbl === 'NO' || lbl === 'COM' || lbl === 'NC') {
            // 干接点输出端子 → 黄色，匹配PCB黄圈
            ctx.fillStyle = '#f0c040'; ctx.strokeStyle = '#c09020';
          } else {
            const grd = ctx.createRadialGradient(px - 1, py - 1, 0, px, py, pinR);
            grd.addColorStop(0, '#484f58');
            grd.addColorStop(1, '#2d333b');
            ctx.fillStyle = grd;
            ctx.strokeStyle = '#6e7681';
          }
        }
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      if (pin.label) {
        ctx.font = (c.type === 'battery_12v') ? 'bold 40px Arial' : (c.type === 'bell_dc') ? 'bold 28px Arial' : (c.type === 'lamp') ? 'bold 22px Arial' : (c.type === 'dry_relay') ? 'bold 24px Arial' : 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lbl = pin.label.toUpperCase();
        const isLive = lbl === 'L' || lbl === '+';
        const isL1 = lbl === 'L1';
        const isNeutral = lbl === 'N';
        const isNeg = lbl === '-';
        if (isLive) {
          ctx.fillStyle = '#f85149';
        } else if (isL1) {
          ctx.fillStyle = '#22c55e';
        } else if (isNeg) {
          ctx.fillStyle = '#00bcd4';
        } else if (isNeutral) {
          ctx.fillStyle = '#58a6ff';
        } else if (wireColor && !isXray) {
          ctx.fillStyle = wireColor;
        } else if (isXray) {
          ctx.fillStyle = 'rgba(57,210,192,0.9)';
        } else {
          ctx.fillStyle = '#c9d1d9';
        }
        let lx = px, ly = py;
        // Use explicit label offset if defined (lo=offsetX, ld=offsetY from pin center)
        if (pin.lo !== undefined || pin.ld !== undefined) {
          lx = px + (pin.lo || 0);
          ly = py + (pin.ld || 0);
        } else {
          const adx = Math.abs(pin.dx), ady = Math.abs(pin.dy);
          if (adx > ady) {
            ly = py + (pin.dy >= 0 ? 20 : -20);
            if (ady > 0) ly = py + (pin.dy > 0 ? 20 : -20);
            else ly = py - 17;
          } else {
            lx = px + (pin.dx > 0 ? 23 : (pin.dx < 0 ? -23 : 0));
            ly = py + (ady > 0 ? (pin.dy > 0 ? 20 : -20) : 0);
          }
        }
        ctx.fillText(pin.label, lx, ly);
      }

      // === Highlight valid target pins during routing ===
      if (!isXray && WireRouter.isActive() && WireRouter.startPin) {
        const isStart = (WireRouter.startPin.comp === c.id && WireRouter.startPin.pin === pin.id);
        if (isStart) {
          // Bright pulsing ring on start pin
          const pulse = 0.35 + Math.sin(Date.now() / 400) * 0.25;
          ctx.save();
          ctx.globalAlpha = pulse;
          ctx.beginPath();
          ctx.arc(px, py, pinR + 6, 0, Math.PI * 2);
          const wp = WireRouter.wireType || 'live';
          ctx.strokeStyle = WireRouter.WireColors[wp] || '#e53935';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();
        } else {
          const wp = WireRouter.wireType || 'live';
          const hc = WireRouter.WireColors[wp] || '#e53935';
          const pulse = 0.18 + Math.sin(Date.now() / 500) * 0.12;
          ctx.save();
          ctx.globalAlpha = pulse;
          ctx.beginPath();
          ctx.arc(px, py, pinR + 5, 0, Math.PI * 2);
          ctx.strokeStyle = hc;
          ctx.lineWidth = 2.5;
          ctx.setLineDash([3, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    });

    // 故障指示已通过故障面板文字显示，不在元件上画红色虚线框
  },
  getValueLabel(c) {
    if (c.type === 'resistor') return formatR(c.props.resistance);
    if (c.type === 'capacitor') return c.props.capacitance + 'μF';
    if (c.type === 'inductor') return c.props.inductance + 'mH';
    if (c.type === 'battery' || c.type === 'ac_source' || c.type === 'battery_12v') return c.props.voltage + 'V';
    if (c.type === 'dc_dc') return c.props.inputV + '→' + c.props.outputV + 'V';
    if (c.type === 'led') return c.props.forwardV + 'V';
    if (c.type === 'switch' || c.type === 'breaker') return c.props.closed ? 'ON' : 'OFF';
    if (c.type === 'spdt') return '→' + c.props.position;
    if (c.type === 'rotary') return '→' + c.props.position;
    if (c.type === 'push_no' || c.type === 'push_nc') return c.props.pressed ? '按下' : '释放';
    if (c.type === 'fuse') return c.props.blown ? '熔断!' : c.props.rating + 'A';
    if (c.type === 'relay5' || c.type === 'relay8' || c.type === 'contactor' || c.type === 'dry_relay') return c.props.energized ? '吸合' : '释放';
    if (c.type === 'motor_dc') return c.props.voltage + 'V';
    if (c.type === 'buzzer') return c.props.voltage + 'V';
    if (c.type === 'solenoid') return c.props.voltage + 'V';
    if (c.type === 'bell_dc') return S.simRunning && c.simCurrent > 0 ? '叮~叮~' : c.props.voltage + 'V';
    if (c.type === 'lamp') return c.props.wattage + 'W';
    if (c.type === 'diode') return c.props.forwardV + 'V';
    if (c.type === 'npn') return 'β=' + c.props.beta;
    if (c.props.behavior === 'relay') return c.props.energized ? 'ON' : 'OFF';
    return '';
  },

  drawInternal(c, isXray, style) {
    ctx.globalAlpha = isXray ? 0.6 : 0.3;
    ctx.strokeStyle = style; ctx.lineWidth = 0.8; ctx.fillStyle = style;

    if (c.type === 'resistor') {
      ctx.beginPath();
      ctx.moveTo(-22, -3); ctx.lineTo(-18, -7); ctx.lineTo(-10, 7); ctx.lineTo(-2, -7);
      ctx.lineTo(6, 7); ctx.lineTo(14, -7); ctx.lineTo(18, 3);
      ctx.stroke();
    } else if (c.type === 'capacitor') {
      ctx.beginPath(); ctx.moveTo(-6, -10); ctx.lineTo(-6, 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, -10); ctx.lineTo(6, 10); ctx.stroke();
    } else if (c.type === 'inductor') {
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(-12 + i * 8, 0, 4, Math.PI, 0); ctx.stroke(); }
    } else if (c.type === 'led') {
      const isOn = S.simRunning && c.simCurrent > 0;
      const ledColor = isOn ? (c.props.color || '#ff4444') : style;
      if (isOn) {
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = ledColor; ctx.fillStyle = ledColor;
      }
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4, -5); ctx.lineTo(5, 0); ctx.lineTo(-4, 5); ctx.closePath();
      if (isOn) ctx.fill(); else ctx.stroke();
    } else if (c.type === 'battery' || c.type === 'ac_source') {
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10, -8); ctx.lineTo(-10, 8); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-4, -5); ctx.lineTo(-4, 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4, -8); ctx.lineTo(4, 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(10, -5); ctx.lineTo(10, 5); ctx.stroke();
      ctx.font = '7px monospace'; ctx.textAlign = 'center';
      ctx.fillText('+', 12, -4); ctx.fillText('-', -14, -4);
    } else if (c.type === 'switch' || c.type === 'spst') {
      // =========================================================
      // 真实跷跷板开关 (Seesaw/Rocker Switch)
      // 特点: ON/OFF状态直观、端子颜色编码(L1红=相线入/L2蓝=相线出)
      // =========================================================
      const closed = c.props.closed;
      const plateW = 70, plateH = 54;        // 开关面板尺寸
      const plateX = -35, plateY = -27;      // 面板左上角位置
      const rockerW = 54, rockerH = 44;      // 跷跷板摇键尺寸
      const tiltAngle = closed ? -0.28 : 0.28; // 倾斜角度 (rad)

      // --- 画线连接端子与开关面板 ---
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 2;
      // L1 (左, 红) → 面板左侧
      ctx.beginPath();
      ctx.moveTo(-58, 0);
      ctx.lineTo(-plateX - 4, 0);
      ctx.stroke();
      // 面板右侧 → L2 (右, 蓝)
      ctx.beginPath();
      ctx.moveTo(plateX + plateW + 4, 0);
      ctx.lineTo(58, 0);
      ctx.stroke();

      // --- 开关面板底座 (3D效果) ---
      ctx.save();
      ctx.translate(0, 0);

      // 底座阴影
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.roundRect(plateX + 2, plateY + 3, plateW, plateH, 6);
      ctx.fill();

      // 面板主体 (深灰金属质感)
      const plateGrad = ctx.createLinearGradient(plateX, plateY, plateX, plateY + plateH);
      plateGrad.addColorStop(0, '#4a4a4a');
      plateGrad.addColorStop(0.3, '#3a3a3a');
      plateGrad.addColorStop(1, '#2a2a2a');
      ctx.fillStyle = plateGrad;
      ctx.beginPath();
      ctx.roundRect(plateX, plateY, plateW, plateH, 6);
      ctx.fill();

      // 面板边框
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1;
      ctx.stroke();

      // --- 跷跷板摇键 ( rocker ) ---
      ctx.save();
      ctx.translate(plateW / 2 + plateX, plateH / 2 + plateY);
      ctx.rotate(tiltAngle);

      // 摇键阴影
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.roundRect(-rockerW / 2 + 1, -rockerH / 2 + 2, rockerW, rockerH, 5);
      ctx.fill();

      // 摇键主体 (浅灰塑料)
      const rockerGrad = ctx.createLinearGradient(-rockerW / 2, -rockerH / 2, rockerW / 2, rockerH / 2);
      if (closed) {
        // ON: 偏暖白色
        rockerGrad.addColorStop(0, '#e8e8e8');
        rockerGrad.addColorStop(1, '#c8c8c8');
      } else {
        // OFF: 偏冷灰色
        rockerGrad.addColorStop(0, '#b0b0b0');
        rockerGrad.addColorStop(1, '#909090');
      }
      ctx.fillStyle = rockerGrad;
      ctx.beginPath();
      ctx.roundRect(-rockerW / 2, -rockerH / 2, rockerW, rockerH, 5);
      ctx.fill();

      // 摇键边框
      ctx.strokeStyle = closed ? '#888' : '#666';
      ctx.lineWidth = 1;
      ctx.stroke();

      // --- ON/OFF 标签 ---
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // ON 文字 (上侧)
      ctx.fillStyle = closed ? '#1a8a1a' : '#aaa';
      ctx.fillText('ON', 0, -rockerH / 2 + 12);
      // OFF 文字 (下侧)
      ctx.fillStyle = closed ? '#aaa' : '#8a2a2a';
      ctx.fillText('OFF', 0, rockerH / 2 - 12);

      // 中线 (指示当前状态)
      ctx.strokeStyle = closed ? 'rgba(40,160,40,0.6)' : 'rgba(160,40,40,0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(-rockerW / 2 + 4, 0);
      ctx.lineTo(rockerW / 2 - 4, 0);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.restore();

      // --- 状态指示灯 LED (右上角) ---
      const ledX = plateX + plateW - 10, ledY = plateY + 10;
      const ledOn = closed;
      if (ledOn) {
        // LED发光效果
        ctx.shadowColor = '#00ff44';
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.arc(ledX, ledY, 4, 0, Math.PI * 2);
      ctx.fillStyle = ledOn ? '#00ff44' : '#333';
      ctx.fill();
      if (ledOn) {
        ctx.beginPath();
        ctx.arc(ledX, ledY, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#aaffaa';
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      ctx.restore();

      // --- 端子圆点 + 颜色编码 ---
      // L1 (左, 红色 = 相线/火线)
      ctx.beginPath();
      ctx.arc(-58, 0, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#cc2222'; // 红色端子
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();

      // L1 标签
      ctx.font = 'bold 8px sans-serif';
      ctx.fillStyle = '#cc2222';
      ctx.textAlign = 'center';
      ctx.fillText('L1', -58, 11);

      // L2 (右, 蓝色 = 零线)
      ctx.beginPath();
      ctx.arc(58, 0, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#2255cc'; // 蓝色端子
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();

      // L2 标签
      ctx.font = 'bold 8px sans-serif';
      ctx.fillStyle = '#2255cc';
      ctx.textAlign = 'center';
      ctx.fillText('L2', 58, 11);
    } else if (c.type === 'spdt' || c.type === 'rotary') {
      ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(0, 0);
      const tgt = c.props.position === 1 ? -15 : 15;
      ctx.lineTo(14, tgt); ctx.stroke();
      ctx.beginPath(); ctx.arc(14, -15, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(14, 15, 2.5, 0, Math.PI * 2); ctx.fill();
    } else if (c.type === 'relay5' || c.type === 'relay8' || c.type === 'contactor' || c.type === 'dry_relay') {
      // Coil
      ctx.beginPath(); ctx.arc(-20, 0, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '7px monospace'; ctx.textAlign = 'center'; ctx.fillText('C', -20, 3);
      // Contacts
      const comY = c.type === 'relay5' ? -10 : -15;
      ctx.beginPath(); ctx.moveTo(15, comY); ctx.lineTo(15, comY);
      if (c.props.energized) { ctx.lineTo(25, comY - 8); }
      else { ctx.lineTo(25, comY + 8); }
      ctx.stroke();
    } else if (c.type === 'motor_dc') {
      ctx.beginPath(); ctx.arc(0, -2, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('M', 0, -2);
    } else if (c.type === 'diode') {
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-3, -5); ctx.lineTo(5, 0); ctx.lineTo(-3, 5); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(5, -5); ctx.lineTo(5, 5); ctx.stroke();
    } else if (c.type === 'lamp') {
      const isOn = S.simRunning && c.simCurrent > 0;
      if (isOn) {
        // Glowing bulb glass area
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = '#ffcc00';
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath(); ctx.arc(0, -37, 14, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(0, -37, 18, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-8, 6); ctx.lineTo(8, 6); ctx.stroke();
      }
    } else if (c.type === 'fuse') {
      ctx.beginPath(); ctx.moveTo(-15, -3); ctx.lineTo(15, -3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-15, 3); ctx.lineTo(15, 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-5, -6); ctx.lineTo(-5, 6); ctx.stroke();
    } else if (c.type === 'npn') {
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(-10, -12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(-10, 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-12, 10); ctx.lineTo(-12, 15); ctx.stroke();
    } else if (c.type === 'bell_dc') {
      // 无实物图时绘制完整电铃（兜底）
      const isRinging = S.simRunning && c.simCurrent > 0;
      const hammerX = 10, hammerY = -18;
      ctx.beginPath();
      ctx.arc(0, -5, 28, Math.PI, 0, false);
      ctx.lineTo(28, 8); ctx.lineTo(-28, 8);
      ctx.closePath();
      ctx.fillStyle = '#c9a800'; ctx.fill();
      ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-28, 8); ctx.lineTo(28, 8);
      ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(10, -18); ctx.lineTo(hammerX, hammerY);
      ctx.strokeStyle = '#666'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(hammerX, hammerY, 4, 0, Math.PI*2);
      ctx.fillStyle = '#888'; ctx.fill();
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5; ctx.stroke();
      // 触发音效（兜底路径）
      if (isRinging && !c._ringing) {
        c._ringing = true;
        BellAudio.ring(c.id);
      } else if (!isRinging && c._ringing) {
        c._ringing = false;
        BellAudio.stop();
      }
    } else if (c.type === 'rf_remote') {
      // 433MHz 无线遥控器：中央大按钮 + 信号发射动画
      // 图片 200×268，PIL精确测量：按钮中心 x=62(31.0%), y=130(48.5%)
      const btnImgY = 130;  // 实物图上按钮中心的y (PIL精确测量)
      const btnImgX = 62;   // 实物图上按钮中心的x (按钮偏左)
      const imgH = 268; const imgW = 200;
      const localBtnY = (btnImgY / imgH - 0.5) * c.h;  // ≈ -4 (c.h=273)
      const localBtnX = (btnImgX / imgW - 0.5) * c.w;  // ≈ -38 (按钮在左侧)
      const cx = localBtnX, cy = localBtnY;
      const btnR = 28; // 大按钮（按比例缩放）
      const isPressed = S.simRunning && c.props.pressed;

      // === 信号发射图标（按下时在遥控器上方显示，脉冲动画）===
      if (isPressed && c.signalImage) {
        let sigImg = c._sigImg;
        if (!sigImg || sigImg.src !== c.signalImage) {
          sigImg = Registry.preloadImage(c.signalImage);
          c._sigImg = sigImg;
        }
        if (sigImg.complete && sigImg.naturalWidth > 0) {
          const sigW = sigImg.naturalWidth;
          const sigH = sigImg.naturalHeight;
          const sigDrawH = 36; // 固定显示高度
          const sigDrawW = (sigW / sigH) * sigDrawH;
          const sigY = -bh / 2 - sigDrawH - 6; // 遥控器上方
          // 脉冲动画：opacity 和 scale 随时间变化
          const pulseT = (Date.now() % 800) / 800;
          const pulseAlpha = 0.5 + 0.5 * Math.sin(pulseT * Math.PI * 2);
          const scale = 1 + 0.15 * Math.sin(pulseT * Math.PI * 2);
          ctx.save();
          ctx.globalAlpha = 0.4 + pulseAlpha * 0.6;
          ctx.translate(cx, sigY + sigDrawH / 2);
          ctx.scale(scale, scale);
          // 外圈光晕
          ctx.shadowColor = 'rgba(255, 80, 20, 0.6)';
          ctx.shadowBlur = 12 + pulseAlpha * 8;
          ctx.drawImage(sigImg, -sigDrawW / 2, -sigDrawH / 2, sigDrawW, sigDrawH);
          ctx.shadowBlur = 0;
          ctx.restore();
        }
      }

      // 按压光晕（强）
      if (isPressed) {
        ctx.beginPath();
        ctx.arc(cx, cy, btnR + 20, 0, Math.PI * 2);
        const glowGrad = ctx.createRadialGradient(cx, cy, btnR, cx, cy, btnR + 20);
        glowGrad.addColorStop(0, 'rgba(255, 120, 40, 0.6)');
        glowGrad.addColorStop(1, 'rgba(255, 80, 40, 0)');
        ctx.fillStyle = glowGrad;
        ctx.fill();
      }
      // 按钮外圈（金属环）
      ctx.beginPath();
      ctx.arc(cx, cy, btnR + 5, 0, Math.PI * 2);
      ctx.fillStyle = '#3a3a3a';
      ctx.fill();
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // 按钮本体
      const btnGrad = ctx.createRadialGradient(cx - 5, cy - 5, 3, cx, cy, btnR);
      if (isPressed) {
        btnGrad.addColorStop(0, '#ff6040');
        btnGrad.addColorStop(0.7, '#cc3020');
        btnGrad.addColorStop(1, '#8a1a0a');
      } else {
        btnGrad.addColorStop(0, '#5a5a5a');
        btnGrad.addColorStop(0.7, '#3a3a3a');
        btnGrad.addColorStop(1, '#1a1a1a');
      }
      ctx.beginPath();
      ctx.arc(cx, cy, btnR, 0, Math.PI * 2);
      ctx.fillStyle = btnGrad;
      ctx.fill();
      ctx.strokeStyle = isPressed ? '#ffaa44' : '#555';
      ctx.lineWidth = 2;
      ctx.stroke();
      // "发射" 文字在按钮内
      ctx.fillStyle = isPressed ? '#fff' : '#ccc';
      ctx.font = 'bold 13px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isPressed ? '发射中' : '发射', cx, cy);
      // 按钮下方提示文字
      ctx.fillStyle = '#999';
      ctx.font = '10px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('按下发射', cx, cy + btnR + 14);
      // 无线波纹（按下时扩散）
      if (isPressed) {
        const t = (Date.now() % 900) / 900;
        for (let i = 0; i < 4; i++) {
          const phase = (t + i * 0.25) % 1;
          const r = btnR + 10 + phase * 45;
          const alpha = (1 - phase) * 0.6;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 168, 0, ${alpha})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      // 底部小字 "433MHz"
      ctx.fillStyle = '#888';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('433MHz', 0, bh / 2 - 12);
    } else if (c.type === 'rf_remote_2key') {
      // 433MHz 两键遥控器：实物图 366×500 (w=200, h=273)
      // PIL边缘检测精确坐标: ON img(110,102) 30.1%/20.5%, OFF img(130,226) 35.5%/45.1%
      const ledY_pct = 0.080;   // LED指示灯位置比例（顶部）
      const ledCY = (ledY_pct - 0.5) * c.h;  // LED Y 相对组件中心

      const isPressed1 = S.simRunning && c.props.pressed1;
      const isPressed2 = S.simRunning && c.props.pressed2;
      const anyPressed = isPressed1 || isPressed2;

      // === 信号发射图标（任一按钮按下时显示）===
      if (anyPressed && c.signalImage) {
        let sigImg = c._sigImg;
        if (!sigImg || sigImg.src !== c.signalImage) {
          sigImg = Registry.preloadImage(c.signalImage);
          c._sigImg = sigImg;
        }
        if (sigImg.complete && sigImg.naturalWidth > 0) {
          const sigW = sigImg.naturalWidth, sigH = sigImg.naturalHeight;
          const sigDrawH = 36, sigDrawW = (sigW / sigH) * sigDrawH;
          const sigY = -c.h / 2 - sigDrawH - 6;
          const pulseT = (Date.now() % 800) / 800;
          const pulseAlpha = 0.5 + 0.5 * Math.sin(pulseT * Math.PI * 2);
          const scale = 1 + 0.15 * Math.sin(pulseT * Math.PI * 2);
          ctx.save();
          ctx.globalAlpha = 0.4 + pulseAlpha * 0.6;
          ctx.translate(0, sigY + sigDrawH / 2);
          ctx.scale(scale, scale);
          ctx.shadowColor = 'rgba(255, 80, 20, 0.6)';
          ctx.shadowBlur = 12 + pulseAlpha * 8;
          ctx.drawImage(sigImg, -sigDrawW / 2, -sigDrawH / 2, sigDrawW, sigDrawH);
          ctx.shadowBlur = 0;
          ctx.restore();
        }
      }

      // === LED 红色指示灯（按压时闪烁）=== 
      // 仅叠加红色光晕，不遮挡实物图
      if (anyPressed) {
        const pulseT = (Date.now() % 600) / 600;
        const alpha = 0.3 + 0.7 * Math.abs(Math.sin(pulseT * Math.PI * 2));
        // LED 发光光晕
        const glowR = 10;
        ctx.beginPath();
        ctx.arc(0, ledCY, glowR, 0, Math.PI * 2);
        const glowGrad = ctx.createRadialGradient(0, ledCY, 2, 0, ledCY, glowR);
        glowGrad.addColorStop(0, `rgba(255, 30, 20, ${alpha})`);
        glowGrad.addColorStop(0.5, `rgba(255, 0, 0, ${alpha * 0.6})`);
        glowGrad.addColorStop(1, 'rgba(255, 0, 0, 0)');
        ctx.fillStyle = glowGrad;
        ctx.fill();
        // LED 中心亮点
        ctx.beginPath();
        ctx.arc(0, ledCY, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 60, 40, ${alpha})`;
        ctx.fill();
      }

      // === RF 无线波纹（按压时从本体扩散）===
      if (anyPressed) {
        const t = (Date.now() % 900) / 900;
        for (let i = 0; i < 4; i++) {
          const phase = (t + i * 0.25) % 1;
          const r = 30 + phase * 70;
          const alpha = (1 - phase) * 0.45;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 168, 0, ${alpha})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // === 底部标识文字 ===
      ctx.fillStyle = '#999';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('433MHz', 0, c.h / 2 - 10);
      ctx.fillText('ON / OFF', 0, c.h / 2 - 1);
      // 干接点控制器：模式文字（顶部大号）+ 模式按钮（底部矩形）
      const mode = c.props.mode || 'none';
      const modeText = mode === 'momentary' ? '点动' : mode === 'toggle' ? '自锁' : mode === 'interlock' ? '互锁' : '纯线圈';
      const nextMode = mode === 'none' ? '点动' : mode === 'momentary' ? '自锁' : mode === 'toggle' ? '互锁' : '纯线圈';
      const isPowered = true; // always allow mode switching (RF modes don't need coil current)
      // 顶部大号模式文字
      const modeColor = mode === 'none' ? '#ff5252' : '#4caf50';
      ctx.fillStyle = modeColor;
      ctx.font = 'bold 24px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('模式: ' + modeText, 0, -bh / 2 + 2);
      // 底部矩形模式切换按钮
      const btnW = 90, btnH = 28;
      const btnX = 0, btnY = bh / 2 - btnH - 6;
      const rx = 6; // 圆角
      // 按钮背景
      ctx.beginPath();
      ctx.moveTo(btnX - btnW/2 + rx, btnY);
      ctx.lineTo(btnX + btnW/2 - rx, btnY);
      ctx.arcTo(btnX + btnW/2, btnY, btnX + btnW/2, btnY + rx, rx);
      ctx.lineTo(btnX + btnW/2, btnY + btnH - rx);
      ctx.arcTo(btnX + btnW/2, btnY + btnH, btnX + btnW/2 - rx, btnY + btnH, rx);
      ctx.lineTo(btnX - btnW/2 + rx, btnY + btnH);
      ctx.arcTo(btnX - btnW/2, btnY + btnH, btnX - btnW/2, btnY + btnH - rx, rx);
      ctx.lineTo(btnX - btnW/2, btnY + rx);
      ctx.arcTo(btnX - btnW/2, btnY, btnX - btnW/2 + rx, btnY, rx);
      ctx.closePath();
      ctx.fillStyle = isPowered ? '#ffa800' : '#555';
      ctx.fill();
      ctx.strokeStyle = isPowered ? '#ffd000' : '#444';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // 按钮文字: 点击切换为 XXX
      ctx.fillStyle = isPowered ? '#1a1a1a' : '#aaa';
      ctx.font = 'bold 13px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('切换:' + nextMode, btnX, btnY + btnH / 2);
      // 保存按钮包围盒供点击检测
      c._modeBtnX = btnX;
      c._modeBtnY = btnY;
      c._modeBtnR = Math.max(btnW / 2, btnH / 2); // 检测半径用对角线一半
      c._modeBtnW = btnW;
      c._modeBtnH = btnH;
    }
    ctx.globalAlpha = 1;
  },

  addComponent(def, x, y) {
    if (S.components.length >= Config.maxComponents) { UI.toast('元件数量已达上限', 'warning'); return; }
    const comp = Registry.createInstance(def, x, y);
    S.components.push(comp);
    S.selected = comp.id;
    S.dirty = true;
    History.push({ type: 'add', comp: { ...comp } });
    UI.showProps(comp);
    UI.toast('已添加: ' + comp.name, 'success');
    requestRender();
  },

  addComponentSilent(def, x, y) {
    const comp = Registry.createInstance(def, x, y);
    S.components.push(comp);
    return comp;
  },

  updateCounts() {
    document.getElementById('compCount').textContent = S.components.length;
    document.getElementById('wireCount').textContent = S.wires.length;
  }
};

