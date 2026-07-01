// ==================== Section 6: Wiring System (Segmented Orthogonal) ====================
const WireRouter = {
  active: false,
  phase: 'idle',        // 'idle' | 'routing'
  startPin: null,        // { comp, pin } - the pin where routing started
  junctionRef: null,     // { x, y } - route started from a wire tap junction
  tapWireId: null,       // wire ID being tapped (when junctionRef is set)
  wireType: 'live',
  routeWaypoints: [],    // accumulated waypoints during routing (snapped to grid)
  lastDir: null,         // 'h' | 'v' - direction of last committed segment
  deleteMode: false,     // wire deletion mode

  WireColors: { live:'#e53935', neutral:'#1e88e5', ground:'#43a047', signal:'#ffa800', dc_pos:'#ff6d00', dc_neg:'#00bcd4', purple:'#ab47bc', cyan:'#00bcd4', pink:'#ec407a', gold:'#ffc107' },
  WireWidth: 5,

  isActive() { return this.active; },

  setWireType(type) {
    this.wireType = type;
    const colorMap = { live:'#e53935', neutral:'#1e88e5', ground:'#43a047', signal:'#ffa800', dc_pos:'#ff6d00', dc_neg:'#00bcd4', purple:'#ab47bc', cyan:'#00bcd4', pink:'#ec407a', gold:'#ffc107' };
    document.querySelectorAll('#wireTypeBar .wire-type-btn').forEach(b => {
      const isActive = b.dataset.wtype === type;
      b.classList.toggle('active', isActive);
      const c = colorMap[b.dataset.wtype];
      b.style.background = isActive ? c : 'transparent';
      b.style.color = isActive ? '#fff' : c;
    });
    requestRender();
  },

  detectWireType(pinLabel) {
    const l = (pinLabel || '').toUpperCase();
    if (l.includes('GND') || l === 'PE' || l === 'E') return 'ground';
    if (l === 'N' || l.includes('NEUTRAL')) return 'neutral';
    if (l === '+' || l.includes('POS') || l === 'P') return 'dc_pos';
    if (l === '-' || l.includes('NEG')) return 'dc_neg';
    return 'live';
  },

  // Resolve best wire type considering both start and end pin labels
  // Priority: dc_pos/dc_neg > neutral > live (DC-aware inference)
  resolveWireType(startLabel, endLabel, startType) {
    const endType = this.detectWireType(endLabel);
    // If both ends agree on a specific type, use it
    if (startType === endType && startType !== 'live') return startType;
    // If one end is DC positive and the other is DC or live, use DC positive
    if (startType === 'dc_pos' || endType === 'dc_pos') return 'dc_pos';
    if (startType === 'dc_neg' || endType === 'dc_neg') return 'dc_neg';
    // If either end is neutral, use neutral
    if (startType === 'neutral' || endType === 'neutral') return 'neutral';
    // If either end is ground, use ground
    if (startType === 'ground' || endType === 'ground') return 'ground';
    // Fallback: keep original type
    return startType;
  },

  // Get the position of the current "drawing head" (last waypoint or start pin/junction)
  _getHeadPos() {
    if (this.routeWaypoints.length > 0) {
      return this.routeWaypoints[this.routeWaypoints.length - 1];
    }
    if (this.junctionRef) return { x: this.junctionRef.x, y: this.junctionRef.y };
    if (!this.startPin) return null;
    const c = getComp(this.startPin.comp);
    const pin = c ? c.pins.find(p => p.id === this.startPin.pin) : null;
    if (!c || !pin) return null;
    return getPinPos(c, this.startPin.pin);
  },

  // Snap a point to the grid
  _snap(pt) {
    const g = S.grid;
    return { x: Math.round(pt.x / g) * g, y: Math.round(pt.y / g) * g };
  },

  // Constrain mouse: horizontal or vertical only, follow mouse direction
  // No forced alternation — continuous horizontal or vertical segments allowed
  _constrainOrtho(head, mouse) {
    const snapped = this._snap(mouse);
    const dx = Math.abs(snapped.x - head.x);
    const dy = Math.abs(snapped.y - head.y);

    if (dx >= dy) {
      return { x: snapped.x, y: head.y, dir: 'h' };
    } else {
      return { x: head.x, y: snapped.y, dir: 'v' };
    }
  },

  start(pin) {
    this.active = true;
    this.phase = 'routing';
    this.startPin = { comp: pin.comp, pin: pin.pin };
    this.junctionRef = null;
    this.tapWireId = null;
    this.routeWaypoints = [];
    this.lastDir = null;
    this.pinNaturalDir = null; // will be set below

    const comp = getComp(pin.comp);
    const pinDef = comp ? comp.pins.find(p => p.id === pin.pin) : null;
    if (pinDef) {
      this.wireType = this.detectWireType(pinDef.label);
      // Determine pin's natural direction from its dx/dy
      if (Math.abs(pinDef.dx) >= Math.abs(pinDef.dy)) {
        this.pinNaturalDir = 'h'; // horizontal pin (left/right edge)
      } else {
        this.pinNaturalDir = 'v'; // vertical pin (top/bottom edge)
      }
    }
    this.setWireType(this.wireType);
    document.getElementById('wireHint').style.display = 'flex';
  },

  // Start routing from a wire tap point (for parallel branch/T-junction)
  startAtJunction(x, y, wireId) {
    this.active = true;
    this.phase = 'routing';
    this.startPin = null;
    this.junctionRef = { x, y };
    this.tapWireId = wireId;
    this.routeWaypoints = [];
    this.lastDir = null;
    this.pinNaturalDir = 'h'; // default for junction
    this.wireType = 'live';
    // Try to inherit wire type from tapped wire
    const tapWire = S.wires.find(w => w.id === wireId);
    if (tapWire) {
      this.wireType = tapWire.wireType || 'live';
    }
    this.setWireType(this.wireType);
    document.getElementById('wireHint').style.display = 'flex';
    requestRender();
  },

  // Find the closest point on any wire to (x, y)
  // Returns { wire, point: {x, y} } or null
  findWirePointAt(x, y, threshold = 18) {
    let best = null, bestDist = Infinity;
    S.wires.forEach(w => {
      const c1 = w.from.junction ? null : getComp(w.from.comp);
      const c2 = w.to.junction ? null : getComp(w.to.comp);
      if ((!c1 && !w.from.junction) || (!c2 && !w.to.junction)) return;
      // Skip junction-only wires (they only reference junctions, not components)
      if (w.from.junction && w.to.junction) return;
      // Get wire endpoints
      let p1, p2;
      if (w.from.junction) {
        p1 = w.from.junction;
        const c2p = getPinPos(c2, w.to.pin);
        if (!c2p) return;
        p2 = c2p;
      } else if (w.to.junction) {
        const c1p = getPinPos(c1, w.from.pin);
        if (!c1p) return;
        p1 = c1p;
        p2 = w.to.junction;
      } else {
        p1 = getPinPos(c1, w.from.pin);
        p2 = getPinPos(c2, w.to.pin);
        if (!p1 || !p2) return;
      }
      const allPoints = [p1, ...(w.waypoints || []), p2];
      for (let i = 0; i < allPoints.length - 1; i++) {
        const a = allPoints[i], b = allPoints[i + 1];
        const dist = this._pointToSegmentDist(x, y, a.x, a.y, b.x, b.y);
        if (dist < threshold && dist < bestDist) {
          // Project onto segment
          const dx = b.x - a.x, dy = b.y - a.y;
          const lenSq = dx * dx + dy * dy;
          let t = lenSq === 0 ? 0 : ((x - a.x) * dx + (y - a.y) * dy) / lenSq;
          t = Math.max(0.05, Math.min(0.95, t)); // avoid exact endpoints
          bestDist = dist;
          best = { wire: w, point: { x: a.x + t * dx, y: a.y + t * dy } };
        }
      }
    });
    return best;
  },

  // Click during routing: either add waypoint or complete wire
  routeClick(canvasPos) {
    const pin = findPinAt(canvasPos.x, canvasPos.y);
    const head = this._getHeadPos();
    if (!head) return;

    if (pin) {
      // Clicked on a pin → complete the wire
      // But don't complete if it's the start pin itself
      if (this.startPin && pin.comp === this.startPin.comp && pin.pin === this.startPin.pin) return;
      this.complete({ comp: pin.comp, pin: pin.pin });
      return;
    }

    // Clicked on existing wire while routing from a pin → T-junction (Pin → Wire)
    if (this.startPin) {
      const wireTap = this.findWirePointAt(canvasPos.x, canvasPos.y, 22);
      if (wireTap) {
        this.complete({ junction: wireTap.point, tapWireId: wireTap.wire.id });
        return;
      }
    }

    // Clicked on blank space → add a waypoint
    const constrained = this._constrainOrtho(head, canvasPos);

    // Alignment snap to nearest pin axis (only free axis, stay orthogonal)
    const ALIGN_SNAP = 15;
    const isHoriz = Math.abs(constrained.y - head.y) < 2;
    let bestPin = null, bestDist = Infinity;
    S.components.forEach(comp => {
      (comp.pins || []).forEach(pd => {
        const pp = getPinPos(comp, pd.id);
        if (pp && !(Math.abs(pp.x - head.x) < 3 && Math.abs(pp.y - head.y) < 3)) {
          const d = isHoriz ? Math.abs(canvasPos.x - pp.x) : Math.abs(canvasPos.y - pp.y);
          if (d < bestDist) { bestDist = d; bestPin = pp; }
        }
      });
    });
    if (bestPin && bestDist < ALIGN_SNAP) {
      if (isHoriz) constrained.x = bestPin.x;
      else constrained.y = bestPin.y;
    }

    // Only add waypoint if it actually moves from head
    if (Math.abs(constrained.x - head.x) > 1 || Math.abs(constrained.y - head.y) > 1) {
      this.routeWaypoints.push({ x: constrained.x, y: constrained.y });
      this.lastDir = constrained.dir;
    }
  },

  undoSegment() {
    if (this.routeWaypoints.length > 0) {
      this.routeWaypoints.pop();
      // Recalculate lastDir from remaining waypoints
      if (this.routeWaypoints.length === 0) {
        this.lastDir = null;
      } else {
        const c = getComp(this.startPin.comp);
        const startPos = c ? getPinPos(c, this.startPin.pin) : null;
        if (startPos && this.routeWaypoints.length > 0) {
          const last = this.routeWaypoints[this.routeWaypoints.length - 1];
          const prev = this.routeWaypoints.length > 1
            ? this.routeWaypoints[this.routeWaypoints.length - 2]
            : startPos;
          this.lastDir = Math.abs(last.x - prev.x) > 1 ? 'h' : 'v';
        }
      }
      requestRender();
    }
  },

  cancel() {
    this.active = false;
    this.phase = 'idle';
    this.startPin = null;
    this.junctionRef = null;
    this.tapWireId = null;
    this.routeWaypoints = [];
    this.lastDir = null;
    this.pinNaturalDir = null;
    document.getElementById('wireHint').style.display = 'none';
    requestRender();
  },

  complete(endPin) {
    // ==================== Junction → Pin (T-branch from existing wire) ====================
    if (this.junctionRef) {
      const jRef = this.junctionRef;
      const c2 = getComp(endPin.comp);
      const p2 = getPinPos(c2, endPin.pin);
      if (!p2) { this.cancel(); return; }

      // Build waypoints from junction to target
      let waypoints = this.routeWaypoints.filter(wp =>
        !(Math.abs(wp.x - p2.x) < 2 && Math.abs(wp.y - p2.y) < 2)
      );
      // Auto-orthogonal from junction
      if (waypoints.length === 0 && Math.abs(jRef.x - p2.x) > S.grid && Math.abs(jRef.y - p2.y) > S.grid) {
        const hg = S.grid;
        const corner = { x: Math.round(p2.x / hg) * hg, y: jRef.y };
        if (Math.abs(corner.x - jRef.x) > 1 && Math.abs(corner.y - jRef.y) > 1) {
          waypoints.push(corner);
        }
      }

      // Determine wire type from target pin
      const endPinDef = c2 ? c2.pins.find(p => p.id === endPin.pin) : null;
      const endType = this.detectWireType(endPinDef ? endPinDef.label : '');
      const resolvedType = endType !== 'live' ? endType : this.wireType;

      const branchWire = {
        id: S.nextWireId++,
        from: { junction: { x: jRef.x, y: jRef.y } },
        to: { comp: endPin.comp, pin: endPin.pin },
        waypoints: waypoints,
        wireType: resolvedType,
      };

      // Insert junction as waypoint in the tapped wire (if not already there)
      const tapWire = S.wires.find(w => w.id === this.tapWireId);
      if (tapWire) {
        const c1 = tapWire.from.junction ? null : getComp(tapWire.from.comp);
        const c2 = tapWire.to.junction ? null : getComp(tapWire.to.comp);
        const hasFrom = !!c1 || !!tapWire.from.junction;
        const hasTo = !!c2 || !!tapWire.to.junction;
        if (hasFrom && hasTo) {
          let p1, p2w;
          if (tapWire.from.junction) { p1 = tapWire.from.junction; } else { p1 = getPinPos(c1, tapWire.from.pin); }
          if (tapWire.to.junction) { p2w = tapWire.to.junction; } else { p2w = getPinPos(c2, tapWire.to.pin); }
          if (p1 && p2w) {
            const allPts = [p1, ...(tapWire.waypoints || []), p2w];
            let insertIdx = 0;
            let minDist = Infinity;
            for (let i = 1; i < allPts.length; i++) {
              const segDist = this._pointToSegmentDist(jRef.x, jRef.y, allPts[i-1].x, allPts[i-1].y, allPts[i].x, allPts[i].y);
              if (segDist < minDist) { minDist = segDist; insertIdx = i; }
            }
            if (!tapWire.waypoints) tapWire.waypoints = [];
            // Avoid inserting duplicate waypoint at same position
            const jxR = Math.round(jRef.x), jyR = Math.round(jRef.y);
            const exists = tapWire.waypoints.some(wp => Math.round(wp.x) === jxR && Math.round(wp.y) === jyR);
            if (!exists) {
              tapWire.waypoints.splice(insertIdx - 1, 0, { x: jRef.x, y: jRef.y });
            }
          }
        }
      }

      S.wires.push(branchWire);
      S.dirty = true;
      History.push({ type: 'wire', wire: branchWire });
      UI.toast('并联分支已连接', 'success');
      this.cancel();
      return;
    }

    // ==================== Pin → Junction (T-branch from terminal to existing wire) ====================
    if (this.startPin && endPin.junction) {
      const sp = this.startPin;
      const c1 = getComp(sp.comp);
      const p1 = getPinPos(c1, sp.pin);
      if (!p1) { this.cancel(); return; }

      // Build waypoints from pin to junction
      let waypoints = this.routeWaypoints.filter(wp =>
        !(Math.abs(wp.x - endPin.junction.x) < 2 && Math.abs(wp.y - endPin.junction.y) < 2)
      );
      // Auto-orthogonal from pin
      if (waypoints.length === 0 && Math.abs(p1.x - endPin.junction.x) > S.grid && Math.abs(p1.y - endPin.junction.y) > S.grid) {
        const useHorizFirst = this.pinNaturalDir === 'h';
        const hg = S.grid;
        const corner = useHorizFirst
          ? { x: Math.round(endPin.junction.x / hg) * hg, y: p1.y }
          : { x: p1.x, y: Math.round(endPin.junction.y / hg) * hg };
        if (Math.abs(corner.x - p1.x) > 1 && Math.abs(corner.y - p1.y) > 1) {
          waypoints.push(corner);
        }
      }

      // Resolve wire type from start pin
      const startPinDef = c1 ? c1.pins.find(p => p.id === sp.pin) : null;
      const resolvedType = this.resolveWireType(
        startPinDef ? startPinDef.label : '',
        '',
        this.wireType
      );

      const branchWire = {
        id: S.nextWireId++,
        from: { comp: sp.comp, pin: sp.pin },
        to: { junction: { x: endPin.junction.x, y: endPin.junction.y } },
        waypoints: waypoints,
        wireType: resolvedType,
      };

      // Insert junction into tapped wire
      const tapWire = S.wires.find(w => w.id === endPin.tapWireId);
      if (tapWire) {
        const tc1 = tapWire.from.junction ? null : getComp(tapWire.from.comp);
        const tc2 = tapWire.to.junction ? null : getComp(tapWire.to.comp);
        const hasFrom = !!tc1 || !!tapWire.from.junction;
        const hasTo = !!tc2 || !!tapWire.to.junction;
        if (hasFrom && hasTo) {
          let tp1, tp2;
          if (tapWire.from.junction) { tp1 = tapWire.from.junction; } else { tp1 = getPinPos(tc1, tapWire.from.pin); }
          if (tapWire.to.junction) { tp2 = tapWire.to.junction; } else { tp2 = getPinPos(tc2, tapWire.to.pin); }
          if (tp1 && tp2) {
            const allPts = [tp1, ...(tapWire.waypoints || []), tp2];
            let insertIdx = 0, minDist = Infinity;
            for (let i = 1; i < allPts.length; i++) {
              const segDist = this._pointToSegmentDist(endPin.junction.x, endPin.junction.y, allPts[i-1].x, allPts[i-1].y, allPts[i].x, allPts[i].y);
              if (segDist < minDist) { minDist = segDist; insertIdx = i; }
            }
            if (!tapWire.waypoints) tapWire.waypoints = [];
            const jxR = Math.round(endPin.junction.x), jyR = Math.round(endPin.junction.y);
            const exists = tapWire.waypoints.some(wp => Math.round(wp.x) === jxR && Math.round(wp.y) === jyR);
            if (!exists) {
              tapWire.waypoints.splice(insertIdx - 1, 0, { x: endPin.junction.x, y: endPin.junction.y });
            }
          }
        }
      }

      S.wires.push(branchWire);
      S.dirty = true;
      History.push({ type: 'wire', wire: branchWire });
      UI.toast('并联分支已连接', 'success');
      this.cancel();
      return;
    }

    // ==================== Pin → Pin (normal wiring) ====================
    if (!this.startPin) return;
    const sp = this.startPin;

    const exists = S.wires.some(w =>
      (w.from.comp === sp.comp && w.from.pin === sp.pin && w.to.comp === endPin.comp && w.to.pin === endPin.pin) ||
      (w.to.comp === sp.comp && w.to.pin === sp.pin && w.from.comp === endPin.comp && w.from.pin === endPin.pin)
    );
    if (exists) { UI.toast('连线已存在', 'warning'); this.cancel(); return; }

    const c1 = getComp(sp.comp), c2 = getComp(endPin.comp);
    const p1 = getPinPos(c1, sp.pin), p2 = getPinPos(c2, endPin.pin);
    const head = this._getHeadPos();
    // Build final waypoints: existing route waypoints only
    let waypoints = this.routeWaypoints.filter(wp =>
      !(Math.abs(wp.x - p2.x) < 2 && Math.abs(wp.y - p2.y) < 2)
    );

    // Auto-generate orthogonal waypoint when no user waypoints exist
    // and pins are not aligned (different row AND column → would be diagonal)
    if (waypoints.length === 0 && Math.abs(p1.x - p2.x) > S.grid && Math.abs(p1.y - p2.y) > S.grid) {
      // Choose corner based on pin edge direction:
      // horizontal edge pin → horizontal-first (corner at end.x, start.y)
      // vertical edge pin → vertical-first (corner at start.x, end.y)
      const useHorizFirst = this.pinNaturalDir === 'h';
      const hg = S.grid;
      const corner = useHorizFirst
        ? { x: Math.round(p2.x / hg) * hg, y: p1.y }
        : { x: p1.x, y: Math.round(p2.y / hg) * hg };
      // Only add if corner is truly between p1 and p2 (not collinear)
      if (Math.abs(corner.x - p1.x) > 1 && Math.abs(corner.y - p1.y) > 1) {
        waypoints.push(corner);
      }
    }

    // Resolve wire type from BOTH pins (not just start pin)
    const startPinDef = c1 ? c1.pins.find(p => p.id === sp.pin) : null;
    const endPinDef = c2 ? c2.pins.find(p => p.id === endPin.pin) : null;
    const resolvedType = this.resolveWireType(
      startPinDef ? startPinDef.label : '',
      endPinDef ? endPinDef.label : '',
      this.wireType
    );

    const wire = {
      id: S.nextWireId++,
      from: { ...sp },
      to: { ...endPin },
      waypoints: waypoints,
      wireType: resolvedType,
      current: 0
    };
    S.wires.push(wire);
    S.dirty = true;
    History.push({ type: 'wire', wire });
    UI.toast('连线成功', 'success');
    this.cancel();
  },

  // Get the wire type color for a specific pin
  getPinWireType(compId, pinId) {
    const wire = S.wires.find(w =>
      (w.from.comp === compId && w.from.pin === pinId) ||
      (w.to.comp === compId && w.to.pin === pinId)
    );
    return wire ? (wire.wireType || 'live') : null;
  },

  // Toggle delete wire mode
  toggleDeleteMode() {
    this.deleteMode = !this.deleteMode;
    // Cancel any active routing
    if (this.deleteMode) {
      this.cancel();
    }
    const btn = document.getElementById('btnDeleteWire');
    if (btn) {
      btn.classList.toggle('active', this.deleteMode);
      btn.style.color = this.deleteMode ? '#fff' : '';
      btn.style.background = this.deleteMode ? '#e53935' : '';
    }
    // Show/hide delete hint
    let hint = document.getElementById('deleteHint');
    if (this.deleteMode) {
      if (!hint) {
        hint = document.createElement('div');
        hint.id = 'deleteHint';
        hint.style.cssText = 'position:absolute;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(229,57,53,0.9);color:#fff;padding:6px 14px;border-radius:6px;font-size:12px;pointer-events:none;z-index:10;';
        hint.textContent = '点击附近的线即可删除，右键或按 Esc 取消';
        document.getElementById('canvasArea').appendChild(hint);
      }
      hint.style.display = 'block';
    } else {
      if (hint) hint.style.display = 'none';
    }
    requestRender();
  },

  // Delete all wires at once (with undo support)
  deleteAllWires() {
    if (S.wires.length === 0) return;
    this.cancel();
    const allWires = S.wires.map(w => ({ ...w }));
    S.wires = [];
    S.dirty = true;
    History.push({ type: 'deleteAllWires', wires: allWires });
    UI.toast(`已删除 ${allWires.length} 条布线`, 'success');
    // Reset all component simCurrent so arrows disappear
    S.components.forEach(c => { c.simCurrent = 0; c._ringing = false; });
    requestRender();
  },

  // Find the closest wire segment to a point (within threshold)
  findWireAt(x, y, threshold) {
    const t = threshold || 12;
    let closest = null;
    let minDist = Infinity;

    S.wires.forEach(w => {
      // Get wire endpoints, supporting both pin-based and junction-based
      let p1, p2;
      if (w.from.junction) {
        p1 = w.from.junction;
      } else {
        const c = getComp(w.from.comp);
        if (!c) return;
        p1 = getPinPos(c, w.from.pin);
      }
      if (w.to.junction) {
        p2 = w.to.junction;
      } else {
        const c = getComp(w.to.comp);
        if (!c) return;
        p2 = getPinPos(c, w.to.pin);
      }
      if (!p1 || !p2) return;

      // Build all segments: start->waypoints->end
      const allPoints = [p1, ...(w.waypoints || []), p2];
      for (let i = 0; i < allPoints.length - 1; i++) {
        const a = allPoints[i], b = allPoints[i + 1];
        const dist = this._pointToSegmentDist(x, y, a.x, a.y, b.x, b.y);
        if (dist < t && dist < minDist) {
          minDist = dist;
          closest = w;
        }
      }
    });
    return closest;
  },

  // Distance from point (px, py) to line segment (x1,y1)-(x2,y2)
  _pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  },

  // Delete a wire by id
  deleteWire(wire) {
    if (!wire) return;

    // If deleting a junction-based wire, clean up orphan junction waypoints in the tapped wire
    if (wire.from.junction || wire.to.junction) {
      const jPos = wire.from.junction || wire.to.junction;
      // Count how many other wires reference this junction position
      const jxR = Math.round(jPos.x), jyR = Math.round(jPos.y);
      const refCount = S.wires.filter(w => {
        if (w === wire) return false;
        if (w.from.junction) {
          return Math.round(w.from.junction.x) === jxR && Math.round(w.from.junction.y) === jyR;
        }
        if (w.to.junction) {
          return Math.round(w.to.junction.x) === jxR && Math.round(w.to.junction.y) === jyR;
        }
        return false;
      }).length;

      if (refCount === 0) {
        // No other wires reference this junction → remove it from the tapped wire's waypoints
        S.wires.forEach(w2 => {
          if (w2 === wire || !w2.waypoints) return;
          w2.waypoints = w2.waypoints.filter(wp =>
            !(Math.round(wp.x) === jxR && Math.round(wp.y) === jyR)
          );
        });
      }
    }

    const idx = S.wires.indexOf(wire);
    if (idx !== -1) {
      S.wires.splice(idx, 1);
      S.dirty = true;
      History.push({ type: 'deleteWire', wire });
      UI.toast('布线已删除', 'success');
      requestRender();
    }
  },

  drawWires() {
    const isXray = false;
    const junctionPositions = new Map(); // "x,y" → Set of wire IDs

    // Helper: get wire endpoints as [p1, p2], returns null if invalid
    const getWireEndpoints = (w) => {
      let p1, p2;
      if (w.from.junction) {
        p1 = w.from.junction;
      } else {
        const c = getComp(w.from.comp);
        if (!c) return null;
        p1 = getPinPos(c, w.from.pin);
      }
      if (w.to.junction) {
        p2 = w.to.junction;
      } else {
        const c = getComp(w.to.comp);
        if (!c) return null;
        p2 = getPinPos(c, w.to.pin);
      }
      if (!p1 || !p2) return null;
      return [p1, p2];
    };

    S.wires.forEach(w => {
      const eps = getWireEndpoints(w);
      if (!eps) return;
      const [p1, p2] = eps;
      const allPoints = [p1, ...(w.waypoints || []), p2];
      const wt = w.wireType || 'live';

      // Collect junction candidates: any waypoint position that has 2+ wires
      if (!isXray && w.waypoints) {
        w.waypoints.forEach(wp => {
          const key = `${Math.round(wp.x)},${Math.round(wp.y)}`;
          if (!junctionPositions.has(key)) junctionPositions.set(key, new Set());
          junctionPositions.get(key).add(w.id);
        });
      }

      if (isXray) {
        ctx.strokeStyle = 'rgba(57,210,192,0.5)';
        ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(allPoints[0].x, allPoints[0].y);
        for (let i = 1; i < allPoints.length; i++) ctx.lineTo(allPoints[i].x, allPoints[i].y);
        ctx.stroke();
      } else if (w._fault) {
        drawPipe3D(allPoints, '#ff1744', 5, 0.9);
      } else {
        drawPipe3D(allPoints, this.WireColors[wt], this.WireWidth, 1);
      }

      // Crimp only at real pin endpoints (not junctions)
      if (!isXray) {
        const crimpColor = w._fault ? '#ff1744' : this.WireColors[wt];
        if (!w.from.junction) drawCrimp3D(p1.x, p1.y, crimpColor, 4.5);
        if (!w.to.junction) drawCrimp3D(p2.x, p2.y, crimpColor, 4.5);
      }

      // Corner joints at waypoints
      if (w.waypoints && w.waypoints.length > 0 && !isXray) {
        const jtColor = w._fault ? '#ff1744' : this.WireColors[wt];
        const jr = parseInt(jtColor.slice(1,3),16);
        const jg = parseInt(jtColor.slice(3,5),16);
        const jb = parseInt(jtColor.slice(5,7),16);
        w.waypoints.forEach(wp => {
          ctx.save();
          const grad = ctx.createRadialGradient(wp.x - 1, wp.y - 1, 0, wp.x, wp.y, 3.5);
          grad.addColorStop(0, `rgba(${Math.min(255,jr+50)},${Math.min(255,jg+50)},${Math.min(255,jb+50)},1)`);
          grad.addColorStop(1, jtColor);
          ctx.beginPath();
          ctx.arc(wp.x, wp.y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = grad; ctx.fill();
          ctx.restore();
        });
      }

      // Current flow
      if (S.simRunning && S.showCurrentDir && w.current > 0) {
        const flowColor = isXray ? '#39d2c0' : this.WireColors[wt];
        this.drawCurrentFlow(allPoints, w.current, flowColor, w);
      }
    });

    // ========== Draw junction dots (solid filled circles at multi-wire connections) ==========
    if (!isXray) {
      // Collect all junction positions from wire junctions
      S.wires.forEach(w => {
        [w.from, w.to].forEach(end => {
          if (end.junction) {
            const key = `${Math.round(end.junction.x)},${Math.round(end.junction.y)}`;
            if (!junctionPositions.has(key)) junctionPositions.set(key, new Set());
            junctionPositions.get(key).add(w.id);
          }
        });
      });

      junctionPositions.forEach((wireIds, key) => {
        if (wireIds.size < 2) return; // only show dots where 2+ wires meet
        const [sx, sy] = key.split(',').map(Number);
        ctx.save();
        // Outer glow ring
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#1a1a2e'; ctx.fill();
        // Solid inner dot
        ctx.beginPath();
        ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#39d2c0'; ctx.fill();
        ctx.restore();
      });
    }
  },

  drawTempWire() {
    if (this.phase !== 'routing') return;
    const head = this._getHeadPos();
    if (!head) return;
    const m = screenToCanvas(S.mouse.x, S.mouse.y);
    const color = this.WireColors[this.wireType] || this.WireColors.live;

    // Auto-snap to valid end pin when mouse is close
    const nearPin = findPinAt(m.x, m.y);
    const isValidEndPin = nearPin &&
      !(this.startPin && nearPin.comp === this.startPin.comp && nearPin.pin === this.startPin.pin);
    let constrained, snapTarget = null, snapWireTap = null;
    if (isValidEndPin) {
      const ec = getComp(nearPin.comp);
      const ep = ec ? getPinPos(ec, nearPin.pin) : null;
      if (ep) { constrained = { x: ep.x, y: ep.y }; snapTarget = ep; }
    }
    // When routing from a pin, also snap to existing wires for T-junction
    if (!snapTarget && this.startPin) {
      const wireTap = this.findWirePointAt(m.x, m.y, 22);
      if (wireTap) {
        constrained = { x: wireTap.point.x, y: wireTap.point.y };
        snapWireTap = wireTap;
      }
    }
    if (!constrained) {
      constrained = this._constrainOrtho(head, m);
    }

    // ===== Alignment Guides (标尺线) — snap to pin X/Y axes =====
    let _alignGuides = []; // { axis:'v'|'h', pos, dist, isSnap }
    if (!snapTarget) {
      const allPins = [];
      S.components.forEach(comp => {
        (comp.pins || []).forEach(pd => {
          const pp = getPinPos(comp, pd.id);
          if (pp && !(Math.abs(pp.x - head.x) < 3 && Math.abs(pp.y - head.y) < 3)) {
            allPins.push({ ...pp, compId: comp.id, pinId: pd.id });
          }
        });
      });
      const ALIGN_SNAP = 15;
      // Only show guide for the SINGLE closest pin on the free axis (not all pins).
      // Horizontal segment (Y locked to head): snap X only.
      // Vertical segment (X locked to head): snap Y only.
      const isHoriz = Math.abs(constrained.y - head.y) < 2;
      let bestPin = null, bestDist = Infinity;
      allPins.forEach(pp => {
        const d = isHoriz ? Math.abs(m.x - pp.x) : Math.abs(m.y - pp.y);
        if (d < bestDist) { bestDist = d; bestPin = pp; }
      });
      if (bestPin && bestDist < ALIGN_SNAP) {
        if (isHoriz) {
          constrained.x = bestPin.x;
          _alignGuides.push({ axis: 'v', pos: bestPin.x, dist: bestDist, isSnap: true });
        } else {
          constrained.y = bestPin.y;
          _alignGuides.push({ axis: 'h', pos: bestPin.y, dist: bestDist, isSnap: true });
        }
      }
    }

    // Draw all committed segments (3D pipe, full opacity)
    const c = this.junctionRef ? null : getComp(this.startPin ? this.startPin.comp : null);
    const startPos = (c && this.startPin) ? getPinPos(c, this.startPin.pin) : head;
    const allCommitted = [startPos, ...this.routeWaypoints];

    if (allCommitted.length > 1) {
      drawPipe3D(allCommitted, color, this.WireWidth, 1);
      // Crimp joints on committed waypoints
      this.routeWaypoints.forEach(wp => {
        drawCrimp3D(wp.x, wp.y, color, 3);
      });
    }

    // Draw junction dot at start point when routing from wire tap
    if (this.junctionRef) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(head.x, head.y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a2e'; ctx.fill();
      ctx.beginPath();
      ctx.arc(head.x, head.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#39d2c0'; ctx.fill();
      ctx.restore();
    }

    // Draw wire snap indicator when routing from pin to existing wire (T-junction)
    if (snapWireTap) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(constrained.x, constrained.y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a2e'; ctx.fill();
      ctx.beginPath();
      ctx.arc(constrained.x, constrained.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#39d2c0'; ctx.fill();
      ctx.restore();
    }

    // Draw current preview segment (more opaque when snapped to pin)
    const previewPoints = [head, constrained];
    drawPipe3D(previewPoints, color, this.WireWidth, (snapTarget || snapWireTap) ? 0.8 : 0.4);

    // Distance label on preview segment
    const segLen = Math.round(Math.sqrt((constrained.x - head.x) ** 2 + (constrained.y - head.y) ** 2));
    if (segLen > 20) {
      const midX = (head.x + constrained.x) / 2;
      const midY = (head.y + constrained.y) / 2;
      ctx.save();
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#a0ffd0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(segLen + 'px', midX, midY - 8);
      ctx.restore();
    }

    // Crimp at head
    drawCrimp3D(head.x, head.y, color, 3.5);

    // Endpoint indicator — highlighted ring when snapped to pin, subtle dot otherwise
    if (snapTarget) {
      ctx.save();
      // Glow ring
      ctx.beginPath();
      ctx.arc(snapTarget.x, snapTarget.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(57,210,192,0.2)';
      ctx.fill();
      // Pulsing dashed ring
      const phase = Date.now() / 600;
      ctx.beginPath();
      ctx.arc(snapTarget.x, snapTarget.y, 11, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5 + Math.sin(phase) * 0.3;
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(constrained.x, constrained.y, 4, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Draw alignment guide lines (标尺)
    if (_alignGuides.length > 0) {
      _alignGuides.forEach(g => {
        const isSnap = g.isSnap;
        ctx.save();
        ctx.globalAlpha = isSnap ? 0.55 : 0.1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = isSnap ? 1.5 : 0.8;
        ctx.setLineDash(isSnap ? [4, 4] : [8, 10]);
        ctx.beginPath();
        if (g.axis === 'v') {
          ctx.moveTo(g.pos, g.pos < head.y ? Math.min(head.y, constrained.y) - 30 : Math.max(head.y, constrained.y) + 30);
          ctx.lineTo(g.pos, g.pos < head.y ? Math.max(head.y, constrained.y) + 30 : Math.min(head.y, constrained.y) - 30);
        } else {
          ctx.moveTo(g.pos < head.x ? Math.min(head.x, constrained.x) - 30 : Math.max(head.x, constrained.x) + 30, g.pos);
          ctx.lineTo(g.pos < head.x ? Math.max(head.x, constrained.x) + 30 : Math.min(head.x, constrained.x) - 30, g.pos);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        // Distance label on snap
        if (isSnap) {
          const dist = g.axis === 'v' ? Math.abs(head.y - g.pos) : Math.abs(head.x - g.pos);
          const labelX = g.axis === 'v' ? g.pos + 6 : Math.min(head.x, constrained.x) + 4;
          const labelY = g.axis === 'v' ? Math.min(head.y, constrained.y) - 10 : g.pos - 8;
          ctx.font = 'bold 11px monospace';
          ctx.fillStyle = '#a0ffd0';
          ctx.textAlign = g.axis === 'v' ? 'left' : 'center';
          ctx.fillText(dist + 'px', labelX, labelY);
        }
        ctx.restore();
      });
    }
  },

  drawCurrentFlow(points, current, wireColor, wire) {
    if (!points || points.length < 2) return;
    const speed = Math.min(Math.abs(current) / 4, 5);
    const isXray = false;
    const wt = wire ? (wire.wireType || 'live') : 'live';
    const isDC = wt === 'dc_pos' || wt === 'dc_neg';
    // Flow animation uses the wire's own color (not hardcoded gold/white)
    const flowColor = isXray ? '#39d2c0' : wireColor;

    // Determine actual current direction from positive terminal to negative terminal
    let flowPoints = points;
    if (wire) {
      const reversed = this._isWireFlowReversed(wire);
      if (reversed) {
        flowPoints = [...points].reverse();
      }
    }

    // Parse wire color for glow
    const r = parseInt(wireColor.slice(1, 3), 16);
    const g = parseInt(wireColor.slice(3, 5), 16);
    const b = parseInt(wireColor.slice(5, 7), 16);

    // === Layer 1: Ambient glow (wide, soft) ===
    ctx.save();
    ctx.shadowColor = flowColor;
    ctx.shadowBlur = isDC ? 12 : 18;
    ctx.strokeStyle = flowColor;
    ctx.globalAlpha = isDC ? 0.15 : 0.2;
    ctx.lineWidth = isDC ? 6 : 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(flowPoints[0].x, flowPoints[0].y);
    for (let i = 1; i < flowPoints.length; i++) ctx.lineTo(flowPoints[i].x, flowPoints[i].y);
    ctx.stroke();
    ctx.restore();

    // === Layer 2: Animated dashed flow (base) ===
    // DC: 实线短段（电流连续单向）  AC: 虚线闪烁
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.lineWidth = 3;
    if (isDC) {
      // DC: shorter dash, tighter gap, faster flow feel
      const dashLen = 8, gapLen = 12;
      ctx.beginPath();
      ctx.moveTo(flowPoints[0].x, flowPoints[0].y);
      for (let i = 1; i < flowPoints.length; i++) ctx.lineTo(flowPoints[i].x, flowPoints[i].y);
      ctx.strokeStyle = flowColor;
      ctx.setLineDash([dashLen, gapLen]);
      ctx.lineDashOffset = -(S.animTick * speed * 0.25);
      ctx.globalAlpha = 0.8;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const dashLen = 12, gapLen = 20;
      ctx.beginPath();
      ctx.moveTo(flowPoints[0].x, flowPoints[0].y);
      for (let i = 1; i < flowPoints.length; i++) ctx.lineTo(flowPoints[i].x, flowPoints[i].y);
      ctx.strokeStyle = flowColor;
      ctx.setLineDash([dashLen, gapLen]);
      ctx.lineDashOffset = -(S.animTick * speed * 0.18);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // === Layer 3: Flowing arrows (moving along wire path) ===
    // Both DC and AC use gold glowing arrows
    this._drawFlowingArrows(flowPoints, speed, isDC);
  },

  // Determine if current in wire actually flows from points[last] to points[0]
  // (i.e., if positive terminal of power source is at the wire's `to` end)
  _isWireFlowReversed(wire) {
    if (!wire) return false;
    // Primary: use path-determined direction (most accurate)
    if (wire._flowDir !== undefined && wire._flowDir !== 0) {
      return wire._flowDir === -1; // -1 = current flows opposite to wire draw direction
    }
    // Fallback: pin-based terminal detection
    const { from, to } = wire;
    const fromComp = getComp(from.comp), toComp = getComp(to.comp);
    if (!fromComp || !toComp) return false;

    const fromIsPos = this._isPositiveTerminal(fromComp, from.pin);
    const toIsPos = this._isPositiveTerminal(toComp, to.pin);
    const fromIsNeg = this._isNegativeTerminal(fromComp, from.pin);
    const toIsNeg = this._isNegativeTerminal(toComp, to.pin);

    // Conventional current: + → -
    // Wire draws from → to; if current opposite → reverse
    // Wire ends at positive → current flows TO positive (reversed)
    if (toIsPos && !fromIsPos) return true;
    // Wire starts at negative → current flows INTO negative (reversed)
    if (fromIsNeg && !toIsNeg) return true;

    return false;
  },

  // Check if a pin is the positive terminal of a power source
  _isPositiveTerminal(comp, pinId) {
    if (!comp) return false;
    const t = comp.type;
    if (t === 'battery' || t === 'battery_12v' || t === 'dc_dc') {
      const pin = comp.pins.find(p => p.id === pinId);
      return pin && (pin.label === '+' || pin.label === 'P' || pin.id === 'p');
    }
    if (t === 'ac_source') {
      const pin = comp.pins.find(p => p.id === pinId);
      return pin && pin.label === 'L'; // L = Line/hot = positive in AC context
    }
    return false;
  },

  // Check if a pin is the negative terminal of a power source
  _isNegativeTerminal(comp, pinId) {
    if (!comp) return false;
    const t = comp.type;
    if (t === 'battery' || t === 'battery_12v' || t === 'dc_dc') {
      const pin = comp.pins.find(p => p.id === pinId);
      return pin && (pin.label === '-' || pin.label === 'NEG' || pin.id === 'n');
    }
    if (t === 'ac_source') {
      const pin = comp.pins.find(p => p.id === pinId);
      return pin && (pin.label === 'N'); // N = neutral/return in AC context
    }
    return false;
  },

  // Calculate total path length
  _calcPathLength(points) {
    let len = 0;
    for (let i = 0; i < points.length - 1; i++) {
      len += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    }
    return len;
  },

  // Get point at specific distance along path
  _getPointAtDist(points, dist) {
    let remaining = dist;
    for (let i = 0; i < points.length - 1; i++) {
      const dx = points[i + 1].x - points[i].x;
      const dy = points[i + 1].y - points[i].y;
      const segLen = Math.hypot(dx, dy);
      if (remaining <= segLen) {
        const t = remaining / Math.max(segLen, 0.01);
        return { x: points[i].x + dx * t, y: points[i].y + dy * t };
      }
      remaining -= segLen;
    }
    return points[points.length - 1];
  },

  // Draw arrows that continuously flow/move along the wire path
  _drawFlowingArrows(points, speed, isDC) {
    const totalLen = this._calcPathLength(points);
    if (totalLen < 30) return;

    // Number of arrows based on wire length; each arrow travels full path
    const arrowSpacing = isDC ? 25 : 35; // px between arrows (DC denser)
    const numArrows = Math.max(2, Math.floor(totalLen / arrowSpacing));

    // All arrows move at the same speed as the dashed line (matching lineDashOffset)
    const cycleLen = totalLen + arrowSpacing; // full cycle (start→end + reset gap)
    const t = (S.animTick * speed * (isDC ? 0.25 : 0.18)) % cycleLen;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < numArrows; i++) {
      // Each arrow is offset by its index * spacing
      const offset = i * arrowSpacing;
      const dist = (t + offset) % cycleLen;

      // Skip arrow if in the "reset gap" (after end of wire)
      if (dist > totalLen) continue;

      const pos = this._getPointAtDist(points, dist);

      // Fade in at start, fade out at end of wire
      const fadeLen = arrowSpacing * 0.8;
      let alpha = 1;
      if (dist < fadeLen) alpha = dist / fadeLen;
      else if (dist > totalLen - fadeLen) alpha = (totalLen - dist) / fadeLen;
      alpha = Math.max(0.15, Math.min(1, alpha));

      // Find tangent direction at this point
      const dirAngle = this._getTangentAngle(points, dist);

      if (isDC) {
        // DC: gold glowing arrows, slightly smaller than AC
        const arrowSize = 5;
        const goldR = 255, goldG = 210, goldB = 0;

        // Glow halo behind arrow
        ctx.save();
        ctx.shadowColor = `rgba(255, 180, 0, ${alpha})`;
        ctx.shadowBlur = 6;
        ctx.fillStyle = `rgba(${goldR}, ${goldG}, ${goldB}, ${alpha * 0.6})`;
        ctx.beginPath();
        const hx1 = pos.x + Math.cos(dirAngle) * arrowSize;
        const hy1 = pos.y + Math.sin(dirAngle) * arrowSize;
        const hx2 = pos.x + Math.cos(dirAngle - 2.4) * arrowSize * 0.8;
        const hy2 = pos.y + Math.sin(dirAngle - 2.4) * arrowSize * 0.8;
        const hx3 = pos.x + Math.cos(dirAngle + 2.4) * arrowSize * 0.8;
        const hy3 = pos.y + Math.sin(dirAngle + 2.4) * arrowSize * 0.8;
        ctx.moveTo(hx1, hy1);
        ctx.lineTo(hx2, hy2);
        ctx.lineTo(hx3, hy3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Arrow shaft
        ctx.beginPath();
        ctx.moveTo(pos.x - Math.cos(dirAngle) * arrowSize, pos.y - Math.sin(dirAngle) * arrowSize);
        ctx.lineTo(pos.x + Math.cos(dirAngle) * arrowSize * 0.3, pos.y + Math.sin(dirAngle) * arrowSize * 0.3);
        ctx.strokeStyle = `rgba(${goldR}, ${goldG}, ${goldB}, ${alpha * 0.9})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Arrow head
        ctx.beginPath();
        const ax1 = pos.x + Math.cos(dirAngle) * arrowSize * 0.4;
        const ay1 = pos.y + Math.sin(dirAngle) * arrowSize * 0.4;
        const ax2 = pos.x + Math.cos(dirAngle - 2.4) * arrowSize * 0.7;
        const ay2 = pos.y + Math.sin(dirAngle - 2.4) * arrowSize * 0.7;
        const ax3 = pos.x + Math.cos(dirAngle + 2.4) * arrowSize * 0.7;
        const ay3 = pos.y + Math.sin(dirAngle + 2.4) * arrowSize * 0.7;
        ctx.moveTo(ax1, ay1);
        ctx.lineTo(ax2, ay2);
        ctx.lineTo(ax3, ay3);
        ctx.closePath();
        ctx.fillStyle = `rgba(${goldR}, ${goldG}, ${goldB}, ${alpha})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${goldR}, ${Math.min(255, goldG + 30)}, ${goldB}, ${alpha * 0.6})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        // AC: gold glowing arrows — slightly larger for emphasis
        const arrowSize = 6;
        const goldR = 255, goldG = 210, goldB = 0;

        // Glow halo behind arrow
        ctx.save();
        ctx.shadowColor = `rgba(255, 180, 0, ${alpha})`;
        ctx.shadowBlur = 8;
        ctx.fillStyle = `rgba(${goldR}, ${goldG}, ${goldB}, ${alpha * 0.7})`;
        ctx.beginPath();
        const hx1 = pos.x + Math.cos(dirAngle) * arrowSize;
        const hy1 = pos.y + Math.sin(dirAngle) * arrowSize;
        const hx2 = pos.x + Math.cos(dirAngle - 2.4) * arrowSize * 0.8;
        const hy2 = pos.y + Math.sin(dirAngle - 2.4) * arrowSize * 0.8;
        const hx3 = pos.x + Math.cos(dirAngle + 2.4) * arrowSize * 0.8;
        const hy3 = pos.y + Math.sin(dirAngle + 2.4) * arrowSize * 0.8;
        ctx.moveTo(hx1, hy1);
        ctx.lineTo(hx2, hy2);
        ctx.lineTo(hx3, hy3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Arrow shaft (short line in flow direction)
        ctx.beginPath();
        ctx.moveTo(pos.x - Math.cos(dirAngle) * arrowSize, pos.y - Math.sin(dirAngle) * arrowSize);
        ctx.lineTo(pos.x + Math.cos(dirAngle) * arrowSize * 0.3, pos.y + Math.sin(dirAngle) * arrowSize * 0.3);
        ctx.strokeStyle = `rgba(${goldR}, ${goldG}, ${goldB}, ${alpha * 0.95})`;
        ctx.lineWidth = 2.2;
        ctx.stroke();

        // Arrow head (filled triangle)
        ctx.beginPath();
        const ax1 = pos.x + Math.cos(dirAngle) * arrowSize * 0.4;
        const ay1 = pos.y + Math.sin(dirAngle) * arrowSize * 0.4;
        const ax2 = pos.x + Math.cos(dirAngle - 2.4) * arrowSize * 0.7;
        const ay2 = pos.y + Math.sin(dirAngle - 2.4) * arrowSize * 0.7;
        const ax3 = pos.x + Math.cos(dirAngle + 2.4) * arrowSize * 0.7;
        const ay3 = pos.y + Math.sin(dirAngle + 2.4) * arrowSize * 0.7;
        ctx.moveTo(ax1, ay1);
        ctx.lineTo(ax2, ay2);
        ctx.lineTo(ax3, ay3);
        ctx.closePath();
        ctx.fillStyle = `rgba(${goldR}, ${goldG}, ${goldB}, ${alpha})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${goldR}, ${Math.min(255, goldG + 30)}, ${goldB}, ${alpha * 0.6})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  // Get tangent angle at a specific distance along the path
  _getTangentAngle(points, dist) {
    let cumLen = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const segLen = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
      if (cumLen + segLen >= dist) {
        const localT = (dist - cumLen) / Math.max(segLen, 0.01);
        const dx = points[i + 1].x - points[i].x;
        const dy = points[i + 1].y - points[i].y;
        return Math.atan2(dy, dx);
      }
      cumLen += segLen;
    }
    const last = points.length - 1;
    return Math.atan2(points[last].y - points[last - 1].y, points[last].x - points[last - 1].x);
  },

  isPinConnected(compId, pinId) {
    return S.wires.some(w =>
      (w.from.comp === compId && w.from.pin === pinId) ||
      (w.to.comp === compId && w.to.pin === pinId)
    );
  },

  removeWiresForComp(compId) {
    S.wires = S.wires.filter(w => {
      if (w.from.comp === compId || w.to.comp === compId) return false;
      return true;
    });
  },

  getWirePoints(wire) {
    let p1, p2;
    if (wire.from.junction) { p1 = wire.from.junction; }
    else { const c = getComp(wire.from.comp); if (!c) return []; p1 = getPinPos(c, wire.from.pin); }
    if (wire.to.junction) { p2 = wire.to.junction; }
    else { const c = getComp(wire.to.comp); if (!c) return []; p2 = getPinPos(c, wire.to.pin); }
    if (!p1 || !p2) return [];
    return [p1, ...(wire.waypoints || []), p2];
  }
};

