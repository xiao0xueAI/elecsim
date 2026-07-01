// ==================== Section 9: Persistence ====================
const Persistence = {
  save() {
    try {
      const data = {
        version: '2.0',
        components: S.components.map(c => ({ ...c, simCurrent: 0, simVoltage: 0, _fault: null })),
        wires: S.wires.map(w => ({ ...w, current: 0, _fault: false })),
        nextId: S.nextId,
        nextWireId: S.nextWireId
      };
      localStorage.setItem('elecsim_v2_save', JSON.stringify(data));
      UI.toast('已保存到浏览器', 'success');
      S.dirty = false;
    } catch(e) { UI.toast('保存失败: ' + e.message, 'error'); }
  },

  load() {
    try {
      const raw = localStorage.getItem('elecsim_v2_save');
      if (!raw) { UI.toast('没有找到保存的电路', 'warning'); return; }
      this.loadCircuit(JSON.parse(raw));
      UI.toast('已加载保存的电路', 'success');
    } catch(e) { UI.toast('加载失败: ' + e.message, 'error'); }
  },

  exportJSON() {
    const data = {
      version: '2.0',
      components: S.components.map(c => ({ ...c, simCurrent: 0, simVoltage: 0, _fault: null })),
      wires: S.wires.map(w => ({ ...w, current: 0, _fault: false })),
      nextId: S.nextId,
      nextWireId: S.nextWireId
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'elecsim_circuit.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    UI.toast('JSON已导出', 'success');
  },

  importJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        this.loadCircuit(JSON.parse(e.target.result));
        UI.toast('电路已导入', 'success');
      } catch(err) { UI.toast('导入失败: 无效的JSON文件', 'error'); }
    };
    reader.readAsText(file);
    document.getElementById('importInput').value = '';
  },

  loadCircuit(data) {
    if (data.version !== '2.0') { UI.toast('不兼容的版本', 'error'); return; }
    S.components = data.components || [];
    S.wires = data.wires || [];
    S.nextId = data.nextId || (S.components.length + 1);
    S.nextWireId = data.nextWireId || (S.wires.length + 1);
    S.selected = null;
    S.dirty = false;
    if (Engine.running) Engine.toggle();
    UI.hideProps();
    requestRender();
  },

  autoSaveInterval: null,
  startAutoSave() {
    this.autoSaveInterval = setInterval(() => {
      if (S.dirty && S.components.length > 0) {
        try {
          const data = {
            version: '2.0',
            components: S.components.map(c => ({ ...c, simCurrent: 0, simVoltage: 0, _fault: null })),
            wires: S.wires.map(w => ({ ...w, current: 0, _fault: false })),
            nextId: S.nextId, nextWireId: S.nextWireId
          };
          localStorage.setItem('elecsim_v2_autosave', JSON.stringify(data));
        } catch(e) {}
      }
    }, Config.autoSaveInterval);
  }
};

