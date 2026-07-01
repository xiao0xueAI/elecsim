// ==================== Section 14: Helpers ====================
function getComp(id) { return S.components.find(c => c.id === id); }
function getPinPos(comp, pinId) {
  const p = comp.pins.find(pp => pp.id === pinId);
  return p ? { x: comp.x + p.dx, y: comp.y + p.dy } : null;
}
function findPinAt(cx, cy) {
  for (const c of S.components) {
    for (const pin of c.pins) {
      const px = c.x + pin.dx, py = c.y + pin.dy;
      if (Math.hypot(cx - px, cy - py) < Config.pinHitRadius) return { comp: c.id, pin: pin.id };
    }
  }
  return null;
}
function findCompAt(cx, cy) {
  for (let i = S.components.length - 1; i >= 0; i--) {
    const c = S.components[i];
    if (Math.abs(cx - c.x) < (c.w || 100) / 2 && Math.abs(cy - c.y) < (c.h || 56) / 2) return c;
  }
  return null;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
function formatR(r) { return r >= 1e6 ? (r / 1e6) + 'MΩ' : r >= 1e3 ? (r / 1e3) + 'kΩ' : r + 'Ω'; }
function getPointOnPath(points, dist) {
  let remaining = dist;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x, dy = points[i + 1].y - points[i].y;
    const segLen = Math.hypot(dx, dy);
    if (remaining <= segLen) {
      const t = remaining / Math.max(segLen, 0.01);
      return { x: points[i].x + dx * t, y: points[i].y + dy * t };
    }
    remaining -= segLen;
  }
  return points[points.length - 1];
}
function hexToRGBA(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Draw a 3D pipe along an orthogonal polyline path
// All layers are center-aligned (zero offset) to ensure grid alignment
function drawPipe3D(points, color, width, alpha) {
  if (points.length < 2) return;
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const a = alpha || 1;

  const path = () => {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  };

  // Layer 1: Outer shadow (darker, wider, semi-transparent)
  ctx.save();
  ctx.globalAlpha = a * 0.3;
  ctx.strokeStyle = `rgba(${Math.max(0,r-70)},${Math.max(0,g-70)},${Math.max(0,b-70)},1)`;
  ctx.lineWidth = width + 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  path(); ctx.stroke();
  ctx.restore();

  // Layer 2: Main body (full color)
  ctx.save();
  ctx.globalAlpha = a;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  path(); ctx.stroke();
  ctx.restore();

  // Layer 3: Inner highlight (lighter, thinner, center-aligned)
  ctx.save();
  ctx.globalAlpha = a * 0.35;
  ctx.strokeStyle = `rgba(${Math.min(255,r+80)},${Math.min(255,g+80)},${Math.min(255,b+80)},1)`;
  ctx.lineWidth = Math.max(1, width * 0.45);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  path(); ctx.stroke();
  ctx.restore();

  // Layer 4: Specular highlight (white, thinnest, center-aligned)
  ctx.save();
  ctx.globalAlpha = a * 0.15;
  ctx.strokeStyle = `rgba(255,255,255,1)`;
  ctx.lineWidth = Math.max(0.5, width * 0.15);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  path(); ctx.stroke();
  ctx.restore();
}

// Draw a 3D "crimp" connector at endpoint (pin junction)
function drawCrimp3D(x, y, color, radius) {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const cr = radius || 4.5;

  // Shadow ring
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, cr + 1, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${Math.max(0,r-60)},${Math.max(0,g-60)},${Math.max(0,b-60)},0.5)`;
  ctx.fill();
  ctx.restore();

  // Main body - radial gradient for 3D sphere effect
  ctx.save();
  const grad = ctx.createRadialGradient(x - cr*0.3, y - cr*0.3, 0, x, y, cr);
  grad.addColorStop(0, `rgba(${Math.min(255,r+70)},${Math.min(255,g+70)},${Math.min(255,b+70)},1)`);
  grad.addColorStop(0.6, color);
  grad.addColorStop(1, `rgba(${Math.max(0,r-40)},${Math.max(0,g-40)},${Math.max(0,b-40)},1)`);
  ctx.beginPath();
  ctx.arc(x, y, cr, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // Specular dot
  ctx.save();
  ctx.beginPath();
  ctx.arc(x - cr*0.25, y - cr*0.25, cr * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fill();
  ctx.restore();

  // Metallic rim
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, cr, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,255,255,0.15)`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function getCircuitBounds() {
  if (S.components.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  S.components.forEach(c => {
    minX = Math.min(minX, c.x - (c.w || 100) / 2 - 20);
    minY = Math.min(minY, c.y - (c.h || 56) / 2 - 20);
    maxX = Math.max(maxX, c.x + (c.w || 100) / 2 + 20);
    maxY = Math.max(maxY, c.y + (c.h || 56) / 2 + 20);
  });
  return { minX, minY, maxX, maxY };
}
function zoomToFit() {
  const bounds = getCircuitBounds();
  if (!bounds) return;
  const padding = 60;
  const scaleX = (W - padding * 2) / (bounds.maxX - bounds.minX);
  const scaleY = (H - padding * 2) / (bounds.maxY - bounds.minY);
  S.zoom = Math.min(scaleX, scaleY, 2);
  S.pan.x = W / 2 - (bounds.minX + bounds.maxX) / 2 * S.zoom;
  S.pan.y = H / 2 - (bounds.minY + bounds.maxY) / 2 * S.zoom;
  document.getElementById('zoomLevel').textContent = Math.round(S.zoom * 100);
  requestRender();
}

// Union-Find data structure
class UnionFind {
  constructor() { this.parent = new Map(); this.rank = new Map(); }
  make(x) { if (!this.parent.has(x)) { this.parent.set(x, x); this.rank.set(x, 0); } }
  has(x) { return this.parent.has(x); }
  find(x) {
    if (!this.parent.has(x)) return x;
    if (this.parent.get(x) !== x) this.parent.set(x, this.find(this.parent.get(x)));
    return this.parent.get(x);
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    if (this.rank.get(ra) < this.rank.get(rb)) this.parent.set(ra, rb);
    else if (this.rank.get(ra) > this.rank.get(rb)) this.parent.set(rb, ra);
    else { this.parent.set(rb, ra); this.rank.set(ra, this.rank.get(ra) + 1); }
  }
  connected(a, b) { return this.find(a) === this.find(b); }
}

