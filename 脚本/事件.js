// ==================== Section 13: Event Handlers ====================
function initEvents() {
  // Canvas mouse events
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  // 自回弹开关：鼠标在画布外松开也要释放
  document.addEventListener('mouseup', () => {
    if (S._momentaryPress) {
      S._momentaryPress.props.closed = false;
      UI.showProps(S._momentaryPress);
      S._momentaryPress = null;
      S.dirty = true;
      requestRender();
    }
  });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('dblclick', onDoubleClick);

  // Keyboard
  document.addEventListener('keydown', onKeyDown);

  // Drag and drop
  const area = document.getElementById('canvasArea');
  area.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  area.addEventListener('drop', onDrop);

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    }
    if (!e.target.closest('.ctx-menu')) {
      document.getElementById('ctxMenu').style.display = 'none';
    }
  });
}

function onMouseDown(e) {
  // 用户交互时唤醒 AudioContext（浏览器自动播放策略）
  BellAudio.resume();

  const pos = screenToCanvas(e.offsetX, e.offsetY);

  // Middle button or Alt+left for panning
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    S.panning = true;
    S.panStart = { x: e.offsetX - S.pan.x, y: e.offsetY - S.pan.y };
    canvas.style.cursor = 'grabbing';
    return;
  }

  // Close context menu
  document.getElementById('ctxMenu').style.display = 'none';

  // 干接点控制器模式按钮点击（矩形按钮检测）
  for (const c of S.components) {
    if (c.type === 'dry_relay' && c._modeBtnX !== undefined) {
      const localX = pos.x - c.x, localY = pos.y - c.y;
      const hw = (c._modeBtnW || 90) / 2 + 6, hh = (c._modeBtnH || 28) / 2 + 6;
      if (localX >= c._modeBtnX - hw && localX <= c._modeBtnX + hw &&
          localY >= c._modeBtnY - hh && localY <= c._modeBtnY + hh) {
        const order = ['none', 'momentary', 'toggle', 'interlock'];
        const idx = order.indexOf(c.props.mode || 'none');
        c.props.mode = order[(idx + 1) % 4];
        c.props.energized = false;  // 切换模式时重置状态，确保行为可预测
        const modeLabels = { none:'纯线圈', momentary:'点动', toggle:'自锁', interlock:'互锁' };
        S.dirty = true;
        UI.toast('干接点模式：' + modeLabels[c.props.mode], 'success');
        requestRender();
        return;
      }
    }
  }

  // 433MHz 遥控器按钮按下
  for (const c of S.components) {
    if (c.type === 'rf_remote') {
      const localX = pos.x - c.x, localY = pos.y - c.y;
      // PIL精确测量：按钮中心 x=62(31.0%), y=130(48.5%) in 200×268 image, c.w=200, c.h=273
      const btnLocalY = (130 / 268 - 0.5) * c.h;  // ≈ -4
      const btnLocalX = (62 / 200 - 0.5) * c.w;    // ≈ -38 (按钮偏左)
      if (Math.hypot(localX - btnLocalX, localY - btnLocalY) < 40) {  // 大按钮28 + 金属环6 + 容差6
        c.props.pressed = true;
        S._pressRemote = c;
        S.dragging = null;  // 不要触发拖动
        S.dirty = true;
        requestRender();
        if (Engine.running) Engine.solve();  // 立即处理RF信号（不等4帧节流）
        e.preventDefault();
        return;
      }
    }
    if (c.type === 'rf_remote_2key') {
      const localX = pos.x - c.x, localY = pos.y - c.y;
      // 实物图 366×500, 组件 200×273, 图片填充整个组件
      // PIL精确测量(边缘检测)：ON按钮中心 img(110,102) 占(30.1%,20.5%), OFF中心 img(130,226) 占(35.5%,45.1%)
      const onCX = (0.301 - 0.5) * c.w;   // -39.8 (按钮偏左)
      const onCY = (0.205 - 0.5) * c.h;   // -80.5
      const offCX = (0.355 - 0.5) * c.w;  // -29.0
      const offCY = (0.451 - 0.5) * c.h;  // -13.4
      const hitR = 30;  // 按钮半径（实物按钮约25px + 容差5px）
      if (Math.hypot(localX - onCX, localY - onCY) < hitR) {
        c.props.pressed1 = true;
        c._lastBtn = 1;
        S._pressRemote = c;
        S.dragging = null;
        S.dirty = true;
        requestRender();
        if (Engine.running) Engine.solve();  // 立即处理RF信号
        e.preventDefault();
        return;
      }
      if (Math.hypot(localX - offCX, localY - offCY) < hitR) {
        c.props.pressed2 = true;
        c._lastBtn = 2;
        S._pressRemote = c;
        S.dragging = null;
        S.dirty = true;
        requestRender();
        if (Engine.running) Engine.solve();  // 立即处理RF信号
        e.preventDefault();
        return;
      }
    }
  }

  // Wiring mode — handle wire tap detection FIRST (before pin detection)
  // This ensures clicking on a wire near a pin still triggers T-junction, not a new wire from pin
  let wireTap = null;
  if (!WireRouter.isActive() && !WireRouter.deleteMode) {
    wireTap = WireRouter.findWirePointAt(pos.x, pos.y, 22);
  }

  const pin = wireTap ? null : findPinAt(pos.x, pos.y);

  if (WireRouter.isActive()) {
    if (pin) {
      // Clicked on a pin → complete the wire
      WireRouter.complete({ comp: pin.comp, pin: pin.pin });
    } else {
      // Clicked on blank space → add waypoint (fix current segment)
      WireRouter.routeClick(pos);
    }
    return;
  }

  // Wire tap: click on existing wire to create a T-junction (parallel branch)
  if (wireTap) {
    WireRouter.startAtJunction(wireTap.point.x, wireTap.point.y, wireTap.wire.id);
    return;
  }

  // Delete wire mode
  if (WireRouter.deleteMode) {
    const wire = WireRouter.findWireAt(pos.x, pos.y);
    if (wire) {
      WireRouter.deleteWire(wire);
    } else {
      // Clicked on empty space → cancel delete mode
      WireRouter.toggleDeleteMode();
    }
    return;
  }

  if (pin && !WireRouter.isActive()) {
    WireRouter.start({ comp: pin.comp, pin: pin.pin });
    return;
  }

  // Component selection/drag
  const comp = findCompAt(pos.x, pos.y);
  if (comp) {
    S.selected = comp.id;
    S.dragging = comp.id;
    S.dragOff = { x: pos.x - comp.x, y: pos.y - comp.y };
    UI.showProps(comp);
    S.clickCompId = comp.id; // Track clicked component for toggle on mouseup
    S.clickPos = { x: e.offsetX, y: e.offsetY }; // Record mouse down position for drag detection
    // 自回弹开关：按住导通
    if (comp.type === 'spst_momentary') {
      // 兜底：如果上一个没松开，先释放
      if (S._momentaryPress) S._momentaryPress.props.closed = false;
      comp.props.closed = true;
      S._momentaryPress = comp;
      S.dirty = true;
      UI.showProps(comp);
      requestRender();
    }

    // 点击电铃时播放测试音（仅在通电状态下，模拟真实电铃行为）
    if (comp.type === 'bell_dc' && S.simRunning && comp.simCurrent > 0) {
      BellAudio.playTestTone();
    }
  } else {
    S.selected = null;
    UI.hideProps();
  }
  requestRender();
}

function onMouseMove(e) {
  S.mouse = { x: e.offsetX, y: e.offsetY };

  if (S.panning) {
    S.pan.x = e.offsetX - S.panStart.x;
    S.pan.y = e.offsetY - S.panStart.y;
    requestRender(); return;
  }

  if (S.dragging) {
    const pos = screenToCanvas(e.offsetX, e.offsetY);
    const c = getComp(S.dragging);
    if (c) {
      const g = S.grid;
      c.x = Math.round((pos.x - S.dragOff.x) / g) * g;
      c.y = Math.round((pos.y - S.dragOff.y) / g) * g;
    }
    requestRender(); return;
  }

  if (WireRouter.isActive()) requestRender();

  // Cursor
  const pos = screenToCanvas(e.offsetX, e.offsetY);
  const pin = findPinAt(pos.x, pos.y);
  const comp = findCompAt(pos.x, pos.y);
  const wire = WireRouter.deleteMode ? WireRouter.findWireAt(pos.x, pos.y) : null;
  if (WireRouter.deleteMode) {
    canvas.style.cursor = wire ? 'pointer' : 'not-allowed';
  } else {
    canvas.style.cursor = WireRouter.isActive() ? 'crosshair' : (pin ? 'pointer' : (comp ? 'move' : 'crosshair'));
  }
}

function onMouseUp(e) {
  // Toggle switch if clicked (not dragged) — require movement < 5px
  const clickMoved = S.clickPos ? Math.hypot(e.offsetX - S.clickPos.x, e.offsetY - S.clickPos.y) : 0;
  if (S.clickCompId && !S.panning && clickMoved < 5) {
    const comp = getComp(S.clickCompId);
    if (comp && comp.type === 'spst') {
      comp.props.closed = !comp.props.closed;
      S.dirty = true;
      UI.showProps(comp);
      requestRender();
    }
  }
  // 自回弹开关：松手断开
  if (S._momentaryPress) {
    S._momentaryPress.props.closed = false;
    UI.showProps(S._momentaryPress);
    S._momentaryPress = null;
    S.dirty = true;
    requestRender();
  }
  // 433MHz 遥控器按钮松开
  if (S._pressRemote) {
    if (S._pressRemote.type === 'rf_remote_2key') {
      S._pressRemote.props.pressed1 = false;
      S._pressRemote.props.pressed2 = false;
    } else {
      S._pressRemote.props.pressed = false;
    }
    S._pressRemote = null;
    requestRender();
    if (Engine.running) Engine.solve();  // 立即处理RF信号释放
  }
  S.clickCompId = null;
  S.clickPos = null;
  S.panning = false;
  S.dragging = null;
  canvas.style.cursor = 'crosshair';
}

function onWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const newZoom = Math.max(Config.zoomMin, Math.min(Config.zoomMax, S.zoom * delta));
  const mx = e.offsetX, my = e.offsetY;
  S.pan.x = mx - (mx - S.pan.x) * (newZoom / S.zoom);
  S.pan.y = my - (my - S.pan.y) * (newZoom / S.zoom);
  S.zoom = newZoom;
  document.getElementById('zoomLevel').textContent = Math.round(S.zoom * 100);
  requestRender();
}

function onContextMenu(e) {
  e.preventDefault();
  const pos = screenToCanvas(e.offsetX, e.offsetY);
  const comp = findCompAt(pos.x, pos.y);
  if (comp) {
    UI.showContextMenu(e.clientX, e.clientY, comp);
  }
  // Cancel delete mode on right-click
  if (WireRouter.deleteMode) {
    WireRouter.toggleDeleteMode();
  }
}

function onDoubleClick(e) {
  // Double click to zoom to fit
  const pos = screenToCanvas(e.offsetX, e.offsetY);
  if (!findCompAt(pos.x, pos.y) && !findPinAt(pos.x, pos.y)) {
    zoomToFit();
  }
}

function onKeyDown(e) {
  if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'SELECT') return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (S.selected) {
      const comp = getComp(S.selected);
      if (comp) {
        const removed = S.components.find(c => c.id === comp.id);
        History.push({ type: 'remove', comp: { ...removed } });
        S.components = S.components.filter(c => c.id !== comp.id);
        WireRouter.removeWiresForComp(comp.id);
        S.selected = null; UI.hideProps();
        UI.toast('已删除: ' + comp.name, 'success');
        S.dirty = true;
        requestRender();
      }
    }
  }
  if (e.key === 'Escape') { WireRouter.cancel(); if (WireRouter.deleteMode) WireRouter.toggleDeleteMode(); }
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); History.undo(); }
  if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); History.redo(); }
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); Persistence.save(); }
}

function onDrop(e) {
  e.preventDefault();
  try {
    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
    const pos = screenToCanvas(e.offsetX, e.offsetY);
    Renderer.addComponent(data, pos.x, pos.y);
  } catch (err) {}
}

