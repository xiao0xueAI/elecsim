// ==================== Section 15: Init ====================
function init() {
  // Preload bell audio early so it's ready when simulation starts
  BellAudio.preload();
  // Preload all component images into shared cache (no per-component reload)
  Registry.preloadAllImages();

  // Build component library UI
  buildLibrary();
  // Init QIACHIP products
  QIACHIP.init();
  QIACHIP.buildProductList();
  QIACHIP.initEditor();
  // Build templates list
  Templates.buildTemplateList();
  // Setup canvas
  resize();
  // Init events
  initEvents();
  // Start auto-save
  Persistence.startAutoSave();

  // Start with empty canvas (no default template)
  UI.toast('就绪 | 从左侧元件库拖放元件，或从模板库加载', 'success');
}

function buildLibrary() {
  const list = document.getElementById('compList');
  list.innerHTML = '';

  // Built-in components by category
  const cats = Registry.getByCategory();
  cats.forEach(cat => {
    const catEl = document.createElement('div');
    catEl.className = 'comp-cat';
    catEl.style.color = Config.categoryColors[cat.cat] || '#8b949e';
    catEl.textContent = cat.cat;
    list.appendChild(catEl);

    cat.items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'comp-item';
      el.draggable = true;
      el.innerHTML = `<div class="comp-icon">${item.icon}</div><div class="comp-info"><div class="comp-name">${item.name}</div><div class="comp-desc">${item.desc}</div></div>`;
      el.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', JSON.stringify(item));
      });
      el.addEventListener('dblclick', () => {
        Renderer.addComponent(item, W / 2 / S.zoom - S.pan.x / S.zoom, H / 2 / S.zoom - S.pan.y / S.zoom);
      });
      list.appendChild(el);
    });
  });

  // Custom/QIACHIP components (if any extra)
  const qiachipDefs = QIACHIP.getAsDefs();
  if (qiachipDefs.length > 0) {
    const catEl = document.createElement('div');
    catEl.className = 'comp-cat';
    catEl.style.color = Config.categoryColors['QIACHIP产品'];
    catEl.textContent = 'QIACHIP产品';
    list.appendChild(catEl);

    qiachipDefs.forEach(item => {
      const el = document.createElement('div');
      el.className = 'comp-item';
      el.draggable = true;
      el.innerHTML = `<div class="comp-icon">${item.icon || '📡'}</div><div class="comp-info"><div class="comp-name">${item.name}</div><div class="comp-desc">${item.desc}</div></div>`;
      el.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', JSON.stringify(item));
      });
      el.addEventListener('dblclick', () => {
        Renderer.addComponent(item, W / 2 / S.zoom - S.pan.x / S.zoom, H / 2 / S.zoom - S.pan.y / S.zoom);
      });
      list.appendChild(el);
    });
  }
}

// ==================== Public API ====================
// 创建命名空间（保持 onclick 处理器兼容）
window.ElecSim = {
  Config, S, Registry, QIACHIP, Renderer, WireRouter, Engine, History, Persistence, Templates, Recorder, UI,
  init, requestRender, resize, zoomToFit
};

// Global aliases for onclick handlers in HTML
window.render = () => ElecSim.requestRender();

// Boot
document.addEventListener('DOMContentLoaded', () => ElecSim.init());
