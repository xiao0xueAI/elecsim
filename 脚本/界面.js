// ==================== Section 12: UI Controllers ====================
const UI = {
  clearAll() {
    const compCount = S.components.length;
    const wireCount = S.wires.length;
    if (compCount === 0 && wireCount === 0) {
      this.toast('画布已是空的', 'warn');
      return;
    }
    // 停止仿真
    if (Engine.running) Engine.toggle();
    // 清空所有数据
    S.components = [];
    S.wires = [];
    S.selected = null;
    S.nextId = 1;
    S.nextWireId = 1;
    // 清空历史记录
    History.stack = [];
    History.index = -1;
    History.updateButtons();
    // 更新计数和渲染
    document.getElementById('compCount').textContent = '0';
    document.getElementById('wireCount').textContent = '0';
    requestRender();
    this.toast(`已清空：${compCount} 个元件 + ${wireCount} 条布线`);
  },

  toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + type;
    setTimeout(() => el.classList.remove('show'), 2500);
  },

  showModal(id) { document.getElementById(id).classList.add('show'); },
  closeModal(id) { document.getElementById(id).classList.remove('show'); },

  toggleDropdown(id) {
    const menu = document.getElementById(id);
    menu.classList.toggle('show');
    // Close others
    document.querySelectorAll('.dropdown-menu').forEach(m => {
      if (m.id !== id) m.classList.remove('show');
    });
  },

  switchTab(tabEl, tabId) {
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    const target = document.getElementById('tab' + tabId.charAt(0).toUpperCase() + tabId.slice(1));
    if (target) target.classList.add('active');
  },

  toggleOpt(el, opt) {
    el.classList.toggle('on');
    if (opt === 'internal') S.showInternal = el.classList.contains('on');
    if (opt === 'currentDir') S.showCurrentDir = el.classList.contains('on');
    if (opt === 'pinLabels') S.showPinLabels = el.classList.contains('on');
    requestRender();
  },

  setOpt(btn, group) {
    btn.parentElement.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.exportOpts[group] = btn.textContent;
  },

  showProps(comp) {
    const panel = document.getElementById('propPanel');
    const content = document.getElementById('propContent');
    panel.style.display = 'block';
    content.innerHTML = '';

    const makeRow = (label, key, val, type = 'number') => {
      const row = document.createElement('div');
      row.className = 'prop-row';
      row.innerHTML = `<span class="label">${label}</span><input type="${type}" value="${val}">`;
      row.querySelector('input').addEventListener('change', e => {
        const c = getComp(comp.id);
        if (c) { c.props[key] = type === 'number' ? parseFloat(e.target.value) : e.target.value; S.dirty = true; requestRender(); }
      });
      content.appendChild(row);
    };

    makeRow('名称', 'name', comp.name, 'text');

    // Type-specific properties
    if (comp.type === 'resistor') makeRow('阻值 (Ω)', 'resistance', comp.props.resistance);
    else if (comp.type === 'capacitor') makeRow('容值 (μF)', 'capacitance', comp.props.capacitance);
    else if (comp.type === 'inductor') makeRow('电感 (mH)', 'inductance', comp.props.inductance);
    else if (comp.type === 'battery' || comp.type === 'battery_12v' || comp.type === 'ac_source') makeRow('电压 (V)', 'voltage', comp.props.voltage);
    else if (comp.type === 'dc_dc') { makeRow('输入 (V)', 'inputV', comp.props.inputV); makeRow('输出 (V)', 'outputV', comp.props.outputV); }
    else if (comp.type === 'led') {
      makeRow('正向压降 (V)', 'forwardV', comp.props.forwardV);
      const row = document.createElement('div'); row.className = 'prop-row';
      row.innerHTML = `<span class="label">颜色</span><input type="color" value="${comp.props.color || '#ff4444'}" style="width:40px;height:22px;padding:0;border:1px solid var(--border);border-radius:4px;cursor:pointer;">`;
      row.querySelector('input').addEventListener('input', e => { comp.props.color = e.target.value; requestRender(); });
      content.appendChild(row);
    }
    else if (comp.type === 'switch' || comp.type === 'spst' || comp.type === 'breaker' || comp.type === 'spst_momentary') {
      const row = document.createElement('div'); row.className = 'prop-row';
      row.innerHTML = `<span class="label">状态</span><button class="tbtn" style="font-size:10px;padding:2px 8px;${comp.props.closed ? 'border-color:var(--green);color:var(--green);' : ''}">${comp.props.closed ? '闭合 ON' : '断开 OFF'}</button>`;
      row.querySelector('button').addEventListener('click', () => { comp.props.closed = !comp.props.closed; S.dirty = true; this.showProps(comp); requestRender(); });
      content.appendChild(row);
    }
    else if (comp.type === 'spdt' || comp.type === 'rotary') {
      const row = document.createElement('div'); row.className = 'prop-row';
      row.innerHTML = `<span class="label">拨向</span><div style="display:flex;gap:4px;"><button class="tbtn" style="font-size:10px;padding:2px 10px;${comp.props.position === 1 ? 'border-color:var(--green);color:var(--green);background:rgba(63,185,80,0.1);' : ''}" data-pos="1">触点 1</button><button class="tbtn" style="font-size:10px;padding:2px 10px;${comp.props.position === 2 ? 'border-color:var(--accent);color:var(--accent);background:rgba(88,166,255,0.1);' : ''}" data-pos="2">触点 2</button></div>`;
      row.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => { comp.props.position = parseInt(btn.dataset.pos); S.dirty = true; this.showProps(comp); requestRender(); });
      });
      content.appendChild(row);
    }
    else if (comp.type === 'push_no' || comp.type === 'push_nc') {
      const row = document.createElement('div'); row.className = 'prop-row';
      row.innerHTML = `<span class="label">状态</span><button class="tbtn" style="font-size:10px;padding:2px 8px;${comp.props.pressed ? 'border-color:var(--yellow);color:var(--yellow);' : ''}">${comp.props.pressed ? '按下' : '释放'}</button>`;
      row.querySelector('button').addEventListener('click', () => { comp.props.pressed = !comp.props.pressed; S.dirty = true; this.showProps(comp); requestRender(); });
      content.appendChild(row);
    }
    else if (comp.type === 'fuse') {
      makeRow('额定 (A)', 'rating', comp.props.rating);
      const row = document.createElement('div'); row.className = 'prop-row';
      row.innerHTML = `<span class="label">状态</span><button class="tbtn" style="font-size:10px;padding:2px 8px;${comp.props.blown ? 'border-color:var(--red);color:var(--red);' : ''}">${comp.props.blown ? '熔断' : '正常'}</button>`;
      row.querySelector('button').addEventListener('click', () => { comp.props.blown = !comp.props.blown; S.dirty = true; this.showProps(comp); requestRender(); });
      content.appendChild(row);
    }
    else if (comp.type === 'relay5' || comp.type === 'relay8' || comp.type === 'contactor' || comp.type === 'dry_relay') {
      makeRow('线圈电压 (V)', 'coilVoltage', comp.props.coilVoltage);
      // 干接点控制器专用：模式选择（循环切换）
      if (comp.type === 'dry_relay') {
        const modeLabels = { 'none':'纯线圈', 'momentary':'点动', 'toggle':'自锁', 'interlock':'互锁' };
        const modeRow = document.createElement('div'); modeRow.className = 'prop-row';
        const nextMode = { 'none':'momentary', 'momentary':'toggle', 'toggle':'interlock', 'interlock':'momentary' }[comp.props.mode] || 'momentary';
        modeRow.innerHTML = `<span class="label">控制模式</span><button class="tbtn" style="font-size:13px;padding:4px 14px;font-weight:bold;" title="点击切换：${modeLabels[nextMode]}">${modeLabels[comp.props.mode] || '未设模式'}</button>`;
        modeRow.querySelector('button').addEventListener('click', () => {
          comp.props.mode = nextMode;
          S.dirty = true; this.showProps(comp); requestRender();
        });
        content.appendChild(modeRow);
      }
      const row = document.createElement('div'); row.className = 'prop-row';
      row.innerHTML = `<span class="label">状态</span><button class="tbtn" style="font-size:10px;padding:2px 8px;${comp.props.energized ? 'border-color:var(--green);color:var(--green);' : ''}">${comp.props.energized ? '吸合' : '释放'}</button>`;
      row.querySelector('button').addEventListener('click', () => { comp.props.energized = !comp.props.energized; S.dirty = true; this.showProps(comp); requestRender(); });
      content.appendChild(row);
    }
    else if (comp.type === 'motor_dc') makeRow('电压 (V)', 'voltage', comp.props.voltage);
    else if (comp.type === 'buzzer') makeRow('电压 (V)', 'voltage', comp.props.voltage);
    else if (comp.type === 'solenoid') makeRow('电压 (V)', 'voltage', comp.props.voltage);
    else if (comp.type === 'bell_dc') {
      makeRow('电压 (V)', 'voltage', comp.props.voltage);
      makeRow('电阻 (Ω)', 'resistance', comp.props.resistance);
    }
    else if (comp.type === 'lamp') {
      makeRow('额定电压 (V)', 'voltage', comp.props.voltage);
      makeRow('额定功率 (W)', 'wattage', comp.props.wattage);
      // 热态电阻 R = V²/P，由以上两值自动计算，不可编辑
      const hotR = Math.max(1, (comp.props.voltage*comp.props.voltage)/(comp.props.wattage||1)).toFixed(1);
      const row = document.createElement('div'); row.className = 'prop-row';
      row.innerHTML = `<span class="label">热态电阻 (Ω)</span><span style="color:var(--yellow);font-size:11px">${hotR}</span>`;
      content.appendChild(row);
    }
    else if (comp.type === 'indicator') makeRow('正向压降 (V)', 'forwardV', comp.props.forwardV);
    else if (comp.type === 'diode') makeRow('正向压降 (V)', 'forwardV', comp.props.forwardV);
    else if (comp.type === 'npn') makeRow('放大倍数', 'beta', comp.props.beta);
    else if (comp.props.behavior === 'relay') {
      const row = document.createElement('div'); row.className = 'prop-row';
      row.innerHTML = `<span class="label">继电器</span><button class="tbtn" style="font-size:10px;padding:2px 8px;${comp.props.energized ? 'border-color:var(--green);color:var(--green);' : ''}">${comp.props.energized ? 'ON' : 'OFF'}</button>`;
      row.querySelector('button').addEventListener('click', () => { comp.props.energized = !comp.props.energized; S.dirty = true; this.showProps(comp); requestRender(); });
      content.appendChild(row);
    }

    // Delete button
    const del = document.createElement('div'); del.style.marginTop = '10px'; del.style.textAlign = 'right';
    del.innerHTML = `<button class="btn-danger" style="font-size:10px;">删除元件</button>`;
    del.querySelector('button').addEventListener('click', () => {
      const removed = S.components.find(c => c.id === comp.id);
      History.push({ type: 'remove', comp: { ...removed } });
      S.components = S.components.filter(c => c.id !== comp.id);
      WireRouter.removeWiresForComp(comp.id);
      S.selected = null; this.hideProps();
      this.toast('已删除: ' + comp.name, 'success');
      S.dirty = true;
      requestRender();
    });
    content.appendChild(del);
  },

  hideProps() { document.getElementById('propPanel').style.display = 'none'; },

  showContextMenu(x, y, comp) {
    const menu = document.getElementById('ctxMenu');
    menu.innerHTML = '';
    menu.style.display = 'block';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    if (comp) {
      const items = [
        { label: '📋 属性', action: () => { UI.showProps(comp); } },
        { label: '📋 复制', action: () => {
          const def = Registry.getDef(comp.type) || { type: comp.type, name: comp.name, cat: comp.cat, icon: comp.icon, w: comp.w, h: comp.h, pins: comp.pins, props: comp.props };
          Renderer.addComponent(def, comp.x + 30, comp.y + 30);
        }},
        { sep: true },
        { label: '🗑️ 删除', cls: 'danger', action: () => {
          const removed = S.components.find(c => c.id === comp.id);
          History.push({ type: 'remove', comp: { ...removed } });
          S.components = S.components.filter(c => c.id !== comp.id);
          WireRouter.removeWiresForComp(comp.id);
          S.selected = null; UI.hideProps();
          UI.toast('已删除: ' + comp.name, 'success');
          S.dirty = true;
          requestRender();
        }}
      ];
      items.forEach(item => {
        if (item.sep) {
          const sep = document.createElement('div'); sep.className = 'ctx-sep'; menu.appendChild(sep);
        } else {
          const el = document.createElement('div'); el.className = 'ctx-item' + (item.cls ? ' ' + item.cls : '');
          el.textContent = item.label;
          el.addEventListener('click', () => { menu.style.display = 'none'; item.action(); });
          menu.appendChild(el);
        }
      });
    }
  }
};

