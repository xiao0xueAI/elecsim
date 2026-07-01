// ==================== Section 7: Simulation Engine ====================
const Engine = {
  running: false,
  animFrame: null,
  simLoop: null,

  toggle() {
    this.running = !this.running;
    S.simRunning = this.running; // Sync state for visual effects
    const btn = document.getElementById('btnRun');
    const dot = document.getElementById('simDot');
    const status = document.getElementById('simStatus');
    const hint = document.getElementById('simHint');

    if (this.running) {
      btn.innerHTML = '&#9632; 停止仿真';
      btn.classList.add('running');
      dot.className = 'dot green';
      status.textContent = '仿真运行中';
      status.style.color = 'var(--green)';
      hint.textContent = '电路仿真已启动...';
      S.simTime = 0;
      // 清理上轮残留的铃声状态
      BellAudio.stop();
      S.components.forEach(c => { c._ringing = false; });
      // 解锁音频上下文（浏览器自动播放策略要求用户手势）
      BellAudio.resume();
      this.simLoop = requestAnimationFrame(() => this.loop());
    } else {
      btn.innerHTML = '&#9654; 运行仿真';
      btn.classList.remove('running');
      dot.className = 'dot yellow';
      status.textContent = '仿真已停止';
      status.style.color = 'var(--yellow)';
      hint.textContent = '点击"运行仿真"重新启动';
      cancelAnimationFrame(this.simLoop);
      BellAudio.stop();
      S.components.forEach(c => { c.simCurrent = 0; c.simVoltage = 0; c._fault = null; c._ringing = false; });
      S.wires.forEach(w => { w.current = 0; w._fault = false; w._flowDir = undefined; });
      document.getElementById('simTime').textContent = '0.00 s';
      document.getElementById('simCurrent').textContent = '0.00 mA';
      document.getElementById('simVoltage').textContent = '0.00 V';
      document.getElementById('simPower').textContent = '0.00 mW';
      document.getElementById('faultPanel').style.display = 'none';
      requestRender();
    }
  },

  loop() {
    if (!this.running) return;
    S.simTime += 0.016;
    document.getElementById('simTime').textContent = S.simTime.toFixed(2) + ' s';
    // Throttle solve to every 4 frames (~15fps) — electrical quantities don't need 60Hz updates
    this._solveFrame = (this._solveFrame || 0) + 1;
    if (this._solveFrame >= 4) { this._solveFrame = 0; this.solve(); }
    requestRender();
    this.simLoop = requestAnimationFrame(() => this.loop());
  },

  solve() {
    try {
    // Clear previous simulation state
    S.components.forEach(c => { c.simCurrent = 0; c.simVoltage = 0; c._fault = null; });
    S.wires.forEach(w => { w.current = 0; w._fault = false; w._flowDir = undefined; });
    this.showFaults([]); // 每次求解前清空故障面板，避免残留上一次的告警

    const faults = [];
    const mkKey = (compId, pinId) => compId + '_' + pinId;

    // ==================== Build connectivity graph ====================
    const _buildGraph = () => {
    const adj = []; // Array of {from, to, wireId, compId}
    const pinInfo = new Map(); // pinKey -> {comp, pinDef}

    S.components.forEach(c => {
      c.pins.forEach(p => pinInfo.set(mkKey(c.id, p.id), { comp: c, pin: p }));
    });

    // Helper: add edge (both directions for undirected graph)
    const addEdge = (from, to, wireId, compId) => {
      adj.push({ from, to, wireId, compId });
      adj.push({ from: to, to: from, wireId, compId });
    };

    // Add component internal connections based on type
    S.components.forEach(c => {
      const t = c.type;
      const pins = c.pins;
      if (t === 'spdt') {
        const pos = c.props.position || 1;
        const comPin = pins.find(p => p.id === 'c');
        const activePin = pos === 1 ? pins.find(p => p.id === 't1') : pins.find(p => p.id === 't2');
        if (comPin && activePin) {
          addEdge(mkKey(c.id, comPin.id), mkKey(c.id, activePin.id), null, c.id);
        }
      } else if (t === 'rotary') {
        const pos = c.props.position || 1;
        const comPin = pins.find(p => p.id === 'com');
        const activePin = pos === 1 ? pins.find(p => p.id === 'pos1') : pins.find(p => p.id === 'pos2');
        if (comPin && activePin) {
          addEdge(mkKey(c.id, comPin.id), mkKey(c.id, activePin.id), null, c.id);
        }
      } else if (t === 'switch' || t === 'spst' || t === 'breaker' || t === 'spst_momentary') {
        if (c.props.closed && pins.length >= 2) {
          addEdge(mkKey(c.id, pins[0].id), mkKey(c.id, pins[1].id), null, c.id);
        }
      } else if (t === 'fuse') {
        if (!c.props.blown && pins.length >= 2) {
          addEdge(mkKey(c.id, pins[0].id), mkKey(c.id, pins[1].id), null, c.id);
        }
      } else if (t === 'push_no') {
        if (c.props.pressed && pins.length >= 2) {
          addEdge(mkKey(c.id, pins[0].id), mkKey(c.id, pins[1].id), null, c.id);
        }
      } else if (t === 'push_nc') {
        if (!c.props.pressed && pins.length >= 2) {
          addEdge(mkKey(c.id, pins[0].id), mkKey(c.id, pins[1].id), null, c.id);
        }
      } else if (t === 'relay5' || t === 'relay8' || t === 'contactor' || t === 'dry_relay') {
        const coilPins = pins.filter(p => p.type === 'coil');
        if (coilPins.length >= 2) {
          addEdge(mkKey(c.id, coilPins[0].id), mkKey(c.id, coilPins[1].id), null, c.id);
        }
        // 触点逻辑: COM-NO(吸合时) / COM-NC(释放时)
        const noPin = pins.find(p => p.id === 'no');
        const comPin = pins.find(p => p.id === 'com');
        const ncPin = pins.find(p => p.id === 'nc');
        const contactPins = pins.filter(p => p.type === 'contact');
        if (comPin && noPin && ncPin) {
          if (c.props.energized) {
            // 吸合: COM连接到NO
            addEdge(mkKey(c.id, comPin.id), mkKey(c.id, noPin.id), null, c.id);
          } else {
            // 释放: COM连接到NC
            addEdge(mkKey(c.id, comPin.id), mkKey(c.id, ncPin.id), null, c.id);
          }
        } else if (contactPins.length >= 2) {
          // 兼容其他继电器类型（只有2个触点脚）
          if (c.props.energized && contactPins.length >= 2) {
            addEdge(mkKey(c.id, contactPins[0].id), mkKey(c.id, contactPins[1].id), null, c.id);
          }
        }
      } else if (pins.length >= 2 && !['battery', 'battery_12v', 'ac_source', 'dc_dc'].includes(t)) {
        // Default: adjacent pins connected (for 2-pin pass-through components)
        for (let i = 0; i < pins.length - 1; i++) {
          addEdge(mkKey(c.id, pins[i].id), mkKey(c.id, pins[i + 1].id), null, c.id);
        }
      }
    });

    // Add wire connections
    const wireMap = new Map();
    // First pass: handle regular pin-to-pin wires
    S.wires.forEach(w => {
      wireMap.set(w.id, w);
      if (!w.from.junction && !w.to.junction) {
        const a = mkKey(w.from.comp, w.from.pin);
        const b = mkKey(w.to.comp, w.to.pin);
        addEdge(a, b, w.id, null);
      }
    });

    // Second pass: process junction-based wires (T-branches for parallel circuits)
    // Build a junction map: { "x,y": [wireIds touching this point] }
    const jxMap = new Map();
    S.wires.forEach(w => {
      // Collect all points on this wire that could be junction sites
      const eps = [];
      if (w.from.junction) eps.push({ x: w.from.junction.x, y: w.from.junction.y });
      else { const c = getComp(w.from.comp); if (c) { const p = getPinPos(c, w.from.pin); if (p) eps.push(p); } }
      if (w.to.junction) eps.push({ x: w.to.junction.x, y: w.to.junction.y });
      else { const c = getComp(w.to.comp); if (c) { const p = getPinPos(c, w.to.pin); if (p) eps.push(p); } }
      (w.waypoints || []).forEach(wp => eps.push(wp));

      eps.forEach(ep => {
        const key = `${Math.round(ep.x)},${Math.round(ep.y)}`;
        if (!jxMap.has(key)) jxMap.set(key, []);
        jxMap.get(key).push({ wire: w, pos: ep });
      });
    });

    // For each junction, create a junction node and connect all pins to it.
    // This prevents the DFS from traversing between different components' pins
    // at the same junction (which would create spurious series paths for parallel circuits).
    jxMap.forEach((entries, key) => {
      // Track which wire connects to which pin at this junction.
      // Previously wireId was null on junction edges, so junction wires
      // (e.g. Battery+→branch→switch_L) never appeared in DFS pathWires
      // and never got current assigned → no flow arrows on parallel branches.
      const pinToWire = new Map(); // pinKey → wireId
      const _seenKeys = new Set();
      entries.forEach(entry => {
        const w = entry.wire;
        if (!w.from.junction) {
          const k = mkKey(w.from.comp, w.from.pin);
          if (!_seenKeys.has(k)) { _seenKeys.add(k); pinToWire.set(k, w.id); }
        }
        if (!w.to.junction) {
          const k = mkKey(w.to.comp, w.to.pin);
          if (!_seenKeys.has(k)) { _seenKeys.add(k); pinToWire.set(k, w.id); }
        }
      });
      if (pinToWire.size >= 2) {
        const jxKey = 'jx:' + key;
        pinToWire.forEach((wireId, pk) => {
          // Extract component ID from pin key (format: "compId_pinId")
          const compId = pk.substring(0, pk.lastIndexOf('_'));
          // Pin → Junction (wireId so DFS adds this wire to pathWires)
          adj.push({ from: pk, to: jxKey, wireId, compId: null });
          // Junction → Pin (compId so DFS knows which component this pin belongs to)
          adj.push({ from: jxKey, to: pk, wireId, compId });
        });
      }
    });

    // Deduplicate adj to prevent edge explosion (same from/to/wireId/compId)
    const _seenAdj = new Set();
    const uniqueAdj = [];
    adj.forEach(e => {
      const ek = `${e.from}|${e.to}|${e.wireId || ''}|${e.compId || ''}`;
      if (!_seenAdj.has(ek)) { _seenAdj.add(ek); uniqueAdj.push(e); }
    });

    // Build adjacency list for graph traversal
    const graph = new Map();
    uniqueAdj.forEach(e => {
      if (!graph.has(e.from)) graph.set(e.from, []);
      graph.get(e.from).push(e);
    });
    return { graph, pinInfo, wireMap };
    }; // end _buildGraph

    // ==================== First build: pre-solve AC to determine relay states ====================
    let { graph, pinInfo, wireMap } = _buildGraph();

    // ==================== Component resistance & behavior ====================
    const getR = (comp) => {
      const t = comp.type;
      if (t === 'battery' || t === 'battery_12v' || t === 'ac_source' || t === 'dc_dc') return 0.1; // realistic internal R (~100mΩ)
      if (t === 'resistor') return Math.max(0.1, comp.props.resistance || 1000);
      if (t === 'led') return 1; // LED dynamic R ~1Ω when conducting (approximates If=20mA at Vf=2V)
      if (t === 'diode') return 0.1; // diode ~0.1Ω forward resistance
      if (t === 'motor_dc') return Math.max(0.5, comp.props.resistance || 50);
      if (t === 'buzzer') return 80;
      if (t === 'solenoid') return Math.max(1, comp.props.resistance || 200);
      if (t === 'bell_dc') return Math.max(1, comp.props.resistance || 20);
      if (t === 'lamp') { const v = comp.props.voltage||220, w = comp.props.wattage||60; return Math.max(1, (v*v)/w); }
      if (t === 'inductor') return Math.max(0.01, (comp.props.inductance||1)*10);
      if (t === 'thermistor') return Math.max(100, comp.props.resistance || 10000);
      if (t === 'photoresistor') return Math.max(100, comp.props.resistance || 5000);
      if (t === 'capacitor') return 1e9; // DC steady state: open circuit (does NOT conduct)
      if (t === 'npn') return 500;
      if (t === 'relay5' || t === 'relay8' || t === 'contactor' || t === 'dry_relay') return comp.props.coilResistance || 10;
      if (t === 'switch' || t === 'spst' || t === 'breaker') return 0.05; // realistic contact resistance (~50mΩ)
      if (t === 'push_no' || t === 'push_nc') return 0.05;
      if (t === 'spdt' || t === 'rotary') return 0.05;
      if (t === 'voltmeter') return comp.props.resistance || 1e6; // very high R, almost no current draw
      if (t === 'ammeter') return comp.props.resistance || 0.01; // very low R, almost no voltage drop
      if (t === 'indicator') return 0; // use Vf-based conduction model like LED
      return 10;
    };

    const getLED_Vf = (comp) => (comp.type === 'led') ? (comp.props.forwardV || 2) :
                             (comp.type === 'diode') ? (comp.props.forwardV || 0.7) :
                             (comp.type === 'indicator') ? (comp.props.forwardV || 2.2) : 0;

    // ==================== AC/DC power type classification ====================
    // Returns 'ac', 'dc', or 'both' for a component
    const getPowerType = (comp) => {
      const t = comp.type;
      // DC power sources
      if (t === 'battery' || t === 'battery_12v' || t === 'dc_dc') return 'dc';
      // AC power sources
      if (t === 'ac_source') return 'ac';
      // AC-only loads (只接受交流电)
      if (t === 'lamp') return 'ac';
      // DC-only loads (只接受直流电)
      if (t === 'led' || t === 'diode' || t === 'motor_dc' || t === 'bell_dc' || t === 'solenoid' || t === 'npn') return 'dc';
      // Everything else works on both (passive: resistor, capacitor, inductor, switches, meters, etc.)
      return 'both';
    };

    const isBlocking = (comp) => {
      if (!comp) return false;
      const t = comp.type;
      if ((t === 'switch' || t === 'spst' || t === 'breaker' || t === 'spst_momentary') && !comp.props.closed) return true;
      if (t === 'fuse' && comp.props.blown) return true;
      if (t === 'push_no' && !comp.props.pressed) return true;
      if (t === 'push_nc' && comp.props.pressed) return true;
      return false;
    };

    // ==================== Find all paths using DFS ====================
    const findAllPaths = (startKey, endKey, maxPaths = 50) => {
      let paths = [];
      const visitedEdges = new Set(); // to avoid duplicate paths
      const _deadline = Date.now() + 500; // 500ms 超时，防止 UI 假死
      let _timedOut = false;

      const dfs = (current, entryComp, entryPin, visitedPins, pathComps, pathWires, pathPins) => {
        if (_timedOut) return;
        if (Date.now() > _deadline) { _timedOut = true; paths._timedOut = true; return; }
        if (paths.length >= maxPaths) return;

        if (current === endKey) {
          // Valid path found
          const compKey = pathComps.join(',');
          if (!visitedEdges.has(compKey)) {
            visitedEdges.add(compKey);
            paths.push({
              comps: [...pathComps],
              wires: [...pathWires],
              pins: [...pathPins]
            });
          }
          return;
        }

        const neighbors = graph.get(current) || [];
        for (const edge of neighbors) {
          const { from, to, wireId, compId } = edge;

          // Don't go back to the pin we just came from
          if (to === entryPin) continue;

          // Skip if this pin was already visited (avoid cycles)
          if (visitedPins.has(to)) continue;

          // Handle junction nodes (jx:*) — electrical nodes that pass through without component processing.
          // Junction nodes represent physical wire T-junctions where multiple wires converge.
          if (to.startsWith('jx:')) {
            // Allow all junction traversals. visitedPins prevents cycles.
            // False series paths (Battery→Comp1→Comp2→Battery in a parallel circuit)
            // are filtered out after findAllPaths() returns using superset detection.
            const newPathWires = [...pathWires];
            if (wireId && !newPathWires.includes(wireId)) newPathWires.push(wireId);
            const newVisitedPins = new Set(visitedPins);
            newVisitedPins.add(to);
            dfs(to, entryComp, entryPin, newVisitedPins, [...pathComps], newPathWires, [...pathPins, to]);
            continue;
          }

          // Get component info for 'to' pin
          const info = pinInfo.get(to);
          if (!info) continue;

          // Check if component blocks
          if (isBlocking(info.comp)) continue;

          // Determine if we're crossing into a new component or staying in the same one
          let newEntryComp = entryComp;
          let newEntryPin = entryPin;
          const newPathComps = [...pathComps];
          const newPathWires = [...pathWires];
          const newPathPins = [...pathPins, to];
          const newVisitedPins = new Set(visitedPins);

          // Resolve actual component ID: wire edges have compId=null, use pinInfo instead
          const actualCompId = compId || info.comp.id;

          if (actualCompId !== entryComp) {
            // Entering a new component
            newEntryComp = actualCompId;
            newEntryPin = to;
            if (!pathComps.includes(actualCompId)) {
              newPathComps.push(actualCompId);
            }
            // Only mark the entry pin as visited (not all pins of this component)
            // This allows traversing internal edges within the same component (e.g., Lamp L→N)
            newVisitedPins.add(to);
          }

          if (wireId && !newPathWires.includes(wireId)) {
            newPathWires.push(wireId);
          }

          // Allow going to endKey even if visited
          if (to === endKey) {
            // Reached the negative terminal - record this complete path immediately
            paths.push({ comps: [...newPathComps], wires: [...newPathWires], pins: [...newPathPins] });
            continue;
          } else {
            dfs(to, newEntryComp, newEntryPin, newVisitedPins, newPathComps, newPathWires, newPathPins);
          }
        }
      };

      // Start DFS from battery positive
      const startInfo = pinInfo.get(startKey);
      const startComp = startInfo ? startInfo.comp.id : null;
      // Only mark the starting pin as visited - NOT all pins of the start component
      // (otherwise the other pin of a 2-pin component like AC Source would be unreachable)
      const startVisited = new Set([startKey]);

      dfs(startKey, startComp, startKey, startVisited, [startComp], [], [startKey]);

      // Filter out false series paths: remove paths whose component set is a superset
      // of another path's component set. In true parallel circuits (Battery→Comp1→Battery
      // and Battery→Comp2→Battery), the DFS also finds Battery→Comp1→Comp2→Battery which
      // is a false series. Superset detection removes these because {Comp1,Comp2} ⊃ {Comp1}.
      if (paths.length > 1) {
        const compSets = paths.map(p => new Set(p.comps));
        const keep = paths.map(() => true);
        for (let i = 0; i < paths.length; i++) {
          for (let j = 0; j < paths.length; j++) {
            if (i === j || !keep[i] || !keep[j]) continue;
            if (paths[i].comps.length > paths[j].comps.length) {
              let isSuperset = true;
              for (const c of compSets[j]) {
                if (!compSets[i].has(c)) { isSuperset = false; break; }
              }
              if (isSuperset) { keep[i] = false; break; }
            }
          }
        }
        paths = paths.filter((_, idx) => keep[idx]);
      }
      return paths;
    };

    // ==================== Pre-pass: detect relay energize from ALL power sources + RF signals ====================
    // We must update c.props.energized BEFORE the final graph is built,
    // so contact edges (COM→NO vs COM→NC) are correct.
    const batteries = S.components.filter(c =>
      c.type === 'battery_12v' || c.type === 'ac_source'
    );
    let graphNeedsRebuild = false;

    // --- 1. Coil energize from AC/DC power sources ---
    for (const bat of batteries) {
      // Handle both AC and DC sources (battery_12v 'p'=+'/'n'=-, ac_source 'p'=L/'n'=N)
      const posKey = mkKey(bat.id, 'p');
      const negKey = mkKey(bat.id, 'n');
      if (!graph.has(posKey)) continue;
      const paths = findAllPaths(posKey, negKey);
      for (const p of paths) {
        for (const compId of p.comps) {
          if (compId === bat.id) continue;
          const comp = S.components.find(c => c.id === compId);
          if (!comp || comp.type !== 'dry_relay') continue;
          // Remote modes: energized controlled by RF signals, not coil current.
          // Skipping coil energize here prevents the coil current from overriding
          // remote toggles (otherwise toggle flips energized=false → coil sets it back to true)
          const dmode = comp.props.mode;
          if (dmode !== 'none' && dmode !== undefined) continue;
          if (comp.props.energized) continue; // already set
          // Calculate coil current: does the path provide >1mA?
          let R = 0;
          for (const cid of p.comps) {
            if (cid === bat.id) continue;
            const c = S.components.find(c2 => c2.id === cid);
            if (c) R += getR(c);
          }
          R = Math.max(0.1, R);
          const I_mA = bat.props.voltage / R * 1000;
          if (I_mA > 1) {
            comp.props.energized = true;
            graphNeedsRebuild = true;
          }
        }
      }
    }

    // --- 2. RF remote signal processing (must happen before graph build) ---
    // 433MHz modules have their own internal power; RF signals are independent of coil current.
    const allRemotes1k = S.components.filter(c => c.type === 'rf_remote');
    const allRemotes2k = S.components.filter(c => c.type === 'rf_remote_2key');

    S.components.filter(c => c.type === 'dry_relay').forEach(relay => {
      const mode = relay.props.mode;
      // mode='none' or undefined → driven purely by coil current (handled by step 1 above)
      if (mode === 'none' || mode === undefined) return;

      // Collect RF signals from all remotes
      let signalOn = false, signalPulse = false;
      const allChannelPresses = [];
      for (const r of allRemotes1k) {
        if (r.props.pressed) signalOn = true;
        if (r.props.pressed && !r._wasPressed) signalPulse = true;
        const ch = r.props.channel || 'A';
        allChannelPresses.push({ channel: ch, pressed: r.props.pressed, pulse: r.props.pressed && !r._wasPressed });
        r._wasPressed = r.props.pressed;
      }
      for (const r of allRemotes2k) {
        if (r.props.pressed1 || r.props.pressed2) signalOn = true;
        const p1Pulse = r.props.pressed1 && !r._wasPressed1;
        const p2Pulse = r.props.pressed2 && !r._wasPressed2;
        if (p1Pulse || p2Pulse) signalPulse = true;
        allChannelPresses.push({ channel: '1', pressed: r.props.pressed1, pulse: p1Pulse });
        allChannelPresses.push({ channel: '2', pressed: r.props.pressed2, pulse: p2Pulse });
        r._wasPressed1 = r.props.pressed1;
        r._wasPressed2 = r.props.pressed2;
      }

      const prevEnergized = relay.props.energized;
      if (mode === 'momentary') {
        // 点动：按住时吸合
        relay.props.energized = signalOn;
      } else if (mode === 'toggle') {
        // 自锁：每次按一下翻转
        if (signalPulse) relay.props.energized = !relay.props.energized;
      } else if (mode === 'interlock') {
        // 互锁：channel='1'/'A'→开，channel='2'/'B'→关
        for (const ev of allChannelPresses) {
          if (ev.pulse) {
            if (ev.channel === '1' || ev.channel === 'A') relay.props.energized = true;
            else if (ev.channel === '2' || ev.channel === 'B') relay.props.energized = false;
            break;
          }
        }
      }

      if (relay.props.energized !== prevEnergized) {
        graphNeedsRebuild = true;
      }
    });
    // Rebuild graph if any relay changed energize state
    if (graphNeedsRebuild) {
      const rebuilt = _buildGraph();
      graph = rebuilt.graph;
      pinInfo = rebuilt.pinInfo;
      wireMap = rebuilt.wireMap;
    }

    // ==================== Process each battery (full solve with correct relay states) ====================

    if (batteries.length === 0) {
      document.getElementById('simCurrent').textContent = '0.00 mA';
      document.getElementById('simVoltage').textContent = '0.00 V';
      document.getElementById('simPower').textContent = '0.00 mW';
      return;
    }

    let anyBatteryHasPath = false;
    batteries.forEach(bat => {
      // Determine positive/negative pin IDs based on component type
      // (Cannot hardcode 'p'/'n' because different power sources use different pin names)
      let posPin, negPin;
      if (bat.type === 'battery_12v') { posPin = 'p'; negPin = 'n'; } // 12V电池：p=正极(+), n=负极(−)
      else if (bat.type === 'ac_source') { posPin = 'p'; negPin = 'n'; } // AC Source: L=hot(p), N=neutral(n)
      else { posPin = 'p'; negPin = 'n'; } // fallback

      const posKey = mkKey(bat.id, posPin);
      const negKey = mkKey(bat.id, negPin);

      // Check if positive terminal has any connections
      if (!graph.has(posKey) || (graph.get(posKey) || []).length === 0) return;

      const paths = findAllPaths(posKey, negKey);
      if (paths._timedOut) {
        faults.push({ type: 'warn', msg: '仿真计算超时（电路过于复杂），已停止计算', comp: bat.name });
      }

      if (paths.length === 0) {
        // 此电源无通路，不覆盖其他电源的结果；最终若所有电源都无通路才显示断路
        return;
      }
      anyBatteryHasPath = true;

      // ==================== Calculate equivalent resistance ====================
      // Each path represents a series circuit from + to -
      // Parallel paths: 1/R_eq = 1/R1 + 1/R2 + ...

      const pathData = paths.map(p => {
        let R = 0;
        let typeMismatch = false; // AC/DC 类型不匹配标记
        let mismatchInfo = null; // 不匹配详情
        const sourceType = getPowerType(bat);
        const sourceLabel = sourceType === 'dc' ? '直流' : '交流';
        for (const compId of p.comps) {
          if (compId === bat.id) continue; // Don't count battery internal R
          const comp = S.components.find(c => c.id === compId);
          if (!comp) continue;
          // 继电器电阻需区分：线圈(AC供电)用coilResistance，触点(DC导通)用contactR
          if (comp.type === 'dry_relay' && sourceType !== 'ac') {
            R += comp.props.contactR || 0.02; // DC 电路：干接点导通电阻 ~20mΩ
          } else {
            R += getR(comp);
          }
          // 检查交直流类型匹配：负载的电类型必须与电源兼容
          const loadType = getPowerType(comp);
          if (loadType !== 'both' && loadType !== sourceType) {
            typeMismatch = true;
            mismatchInfo = { comp: comp.name, loadType: loadType === 'dc' ? '直流' : '交流', sourceType: sourceLabel };
          }
        }
        return { ...p, R, typeMismatch, mismatchInfo };
      });
      // Detect type mismatches for warning
      const mismatchedPaths = pathData.filter(p => p.typeMismatch);
      if (mismatchedPaths.length > 0) {
        const m = mismatchedPaths[0].mismatchInfo;
        faults.push({ type: 'warn', msg: `${m.comp} 为${m.loadType}设备，不能使用${m.sourceType}电源`, comp: m.comp });
      }
      const validPaths = pathData.filter(p => p.R > 0 && p.R < 1e6 && !p.typeMismatch);

      if (validPaths.length === 0) {
        document.getElementById('simCurrent').textContent = '0.00 mA (断路)';
        document.getElementById('simVoltage').textContent = bat.props.voltage + ' V';
        document.getElementById('simPower').textContent = '0.00 mW';
        return;
      }

      // Calculate equivalent resistance (parallel combination)
      let G_eq = 0; // total conductance
      validPaths.forEach(p => { G_eq += 1 / p.R; });
      const R_eq = 1 / G_eq;

      // Short circuit detection: only when a path has NO significant load (only wire/switch/conductive elements)
      // A true short: battery+ -> [wire/switch ONLY] -> battery- with no resistor/LED/motor/load in between
      const isLoadComp = (compId) => {
        const comp = S.components.find(c => c.id === compId);
        if (!comp) return false;
        const t = comp.type;
        // Load components that consume power (not just conduct)
        return ['resistor', 'led', 'diode', 'motor_dc', 'buzzer', 'solenoid', 'lamp', 'bell_dc',
                'capacitor', 'inductor', 'thermistor', 'photoresistor', 'npn',
                'relay5', 'relay8', 'contactor', 'dry_relay', 'ac_source', 'dc_dc'].includes(t);
      };

      // Check each path: if a path has only wire/switch elements (no load), it's a direct short
      let hasDirectShort = false;
      let shortPathCount = 0;
      validPaths.forEach(p => {
        const loadComps = p.comps.filter(id => id !== bat.id && isLoadComp(id));
        if (loadComps.length === 0 && p.R < 0.5) {
          // Path has no load components and very low resistance → direct short
          hasDirectShort = true;
          shortPathCount++;
        }
      });

      if (hasDirectShort) {
        faults.push({ type: 'short', msg: '检测到短路！电池正负极直接相连（无负载）', comp: '' });
        document.getElementById('simCurrent').textContent = '∞ (短路)';
        document.getElementById('simVoltage').textContent = bat.props.voltage + ' V';
        document.getElementById('simPower').textContent = '∞ mW';
        return;
      }

      // ==================== Apply Ohm's Law ====================
      const V = bat.props.voltage;
      const I_total = V / R_eq; // Amps
      const I_total_mA = I_total * 1000;

      document.getElementById('simCurrent').textContent = I_total_mA.toFixed(2) + ' mA';
      document.getElementById('simVoltage').textContent = V.toFixed(2) + ' V';
      document.getElementById('simPower').textContent = (V * I_total_mA).toFixed(2) + ' mW';

      // ==================== Distribute current/voltage ====================
      // For each path: voltage is same (V), current divides: I_path = V / R_path
      // For series components in path: same I, V_drop = I * R

      const compCurrents = new Map();
      const compVoltages = new Map();

      validPaths.forEach(p => {
        const I_path = V / p.R; // current through this parallel path
        const compsOnly = p.comps.filter(id => id !== bat.id);

        compsOnly.forEach(compId => {
          const comp = S.components.find(c => c.id === compId);
          if (!comp) return;

          // Accumulate current (sum from all parallel paths)
          compCurrents.set(compId, (compCurrents.get(compId) || 0) + I_path);

          // Voltage drop for this component in series = I_path * R_comp
          const R_comp = getR(comp);
          const V_drop = I_path * R_comp;
          compVoltages.set(compId, (compVoltages.get(compId) || 0) + V_drop);
        });

        // ==================== Determine wire current direction from DFS path ====================
        // Walk the ordered pins of this path to set correct flow direction on each wire
        for (let i = 0; i < p.pins.length - 1; i++) {
          const pinA = p.pins[i], pinB = p.pins[i + 1];
          for (const wId of p.wires) {
            const w = wireMap.get(wId);
            if (!w || w._flowDir) continue; // already set by another path
            const wKeyA = w.from.junction ? null : mkKey(w.from.comp, w.from.pin);
            const wKeyB = w.to.junction ? null : mkKey(w.to.comp, w.to.pin);
            if ((wKeyA === pinA && wKeyB === pinB)) {
              w._flowDir = 1;
            } else if ((wKeyB === pinA && wKeyA === pinB)) {
              w._flowDir = -1;
            } else if (w.from.junction && wKeyB === pinB) {
              // Junction→pin: current flows toward the pin
              w._flowDir = 1;
            } else if (w.from.junction && wKeyB === pinA) {
              w._flowDir = -1;
            } else if (w.to.junction && wKeyA === pinA) {
              w._flowDir = 1;
            } else if (w.to.junction && wKeyA === pinB) {
              w._flowDir = -1;
            }
          }
        }

        // Set wire currents (accumulate across parallel paths for shared segments)
        p.wires.forEach(wId => {
          const w = wireMap.get(wId);
          if (w) w.current += I_path * 1000; // mA
        });
      });

      // Apply to components
      compCurrents.forEach((I, compId) => {
        const comp = S.components.find(c => c.id === compId);
        if (comp) {
          comp.simCurrent = I * 1000; // mA
          comp.simVoltage = compVoltages.get(compId) || 0;
        }
      });

      // ==================== Diode/LED/Indicator conduction check ====================
      // Diodes, LEDs and Indicators only conduct when forward voltage is reached
      S.components.forEach(comp => {
        if (comp.type !== 'led' && comp.type !== 'diode' && comp.type !== 'indicator') return;
        const Vf = getLED_Vf(comp);
        const V_comp = comp.simVoltage || 0;
        // Conducts only if forward voltage is reached
        if (V_comp < Vf || comp.simCurrent < 0.1) {
          comp.simCurrent = 0;
          comp.simVoltage = 0;
          comp._fault = 'off';
        } else {
          comp._fault = null;
          comp._power = comp.simVoltage * (comp.simCurrent / 1000);
        }
      });

      // ==================== Fuse overcurrent fault ====================
      S.components.forEach(comp => {
        if (comp.type !== 'fuse') return;
        if (comp.props.blown) return; // already blown
        const rating = comp.props.rating || 1; // default 1A
        if (comp.simCurrent / 1000 > rating * 1.5) {
          // 150% of rating trips the fuse
          comp.props.blown = true;
          comp._fault = 'blown';
          faults.push({ type: 'warn', msg: `${comp.name} 熔断！电流 ${(comp.simCurrent).toFixed(1)}mA 超过 ${rating}A 额定值`, comp: comp.name });
        }
      });

      // ==================== Check faults ====================
      S.components.forEach(comp => {
        if (comp._fault === 'off') return; // Don't flag LED off as fault
        const maxI = comp.props.maxCurrent || Infinity;
        if (comp.simCurrent / 1000 > maxI) {
          comp._fault = 'overcurrent';
          faults.push({ type: 'warn', msg: `${comp.name} 过流: ${(comp.simCurrent).toFixed(1)}mA > ${maxI}A`, comp: comp.name });
        }
      });

      // 干接点：模式'none'由线圈电流驱动（断电释放），遥控模式已在 pre-pass 处理
      S.components.filter(c => c.type === 'dry_relay').forEach(relay => {
        const mode = relay.props.mode;
        if (mode === 'none' || mode === undefined) {
          relay.props.energized = !!(relay.simCurrent > 1);
        }
      });
    });

    // 如果所有电源都没有找到通路，显示断路提示
    if (!anyBatteryHasPath && batteries.length > 0) {
      document.getElementById('simCurrent').textContent = '0.00 mA (断路)';
      document.getElementById('simPower').textContent = '0.00 mW';
    }

    this.showFaults(faults);
    } catch(err) {
      console.error('[ElecSim] solve() error:', err);
      S.wires.forEach(w => { w.current = 0; w._flowDir = undefined; });
      S.components.forEach(c => { c.simCurrent = 0; c._fault = 'error'; });
      faults.push({ type: 'warn', msg: '仿真计算出错，已停止：' + err.message });
      this.showFaults(faults);
    }
  },

  showFaults(faults) {
    const panel = document.getElementById('faultPanel');
    const content = document.getElementById('faultContent');
    if (faults.length === 0) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    content.innerHTML = faults.map(f =>
      `<div class="fault-item ${f.type}"><span>${f.type === 'short' ? '⚠️' : '⚡'} ${f.msg}</span></div>`
    ).join('');
  }
};

