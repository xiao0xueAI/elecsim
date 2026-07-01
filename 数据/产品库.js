// ==================== Section 4: QIACHIP Product System ====================
const QIACHIP = {
  products: [],
  editorPins: [],
  editorImage: null,

  templates: [
    { id:'qca_1ch', name:'QIACHIP 1路无线继电器', model:'QCA-1CH-RF',
      desc:'433MHz无线遥控, 1路继电器输出, 5-12V供电',
      w:140, h:100,
      pins:[
        {id:'vcc',label:'VCC',dx:-70,dy:-20},{id:'gnd',label:'GND',dx:-70,dy:20},
        {id:'sig',label:'SIG',dx:-70,dy:0,type:'signal'},
        {id:'no',label:'NO',dx:70,dy:-20,type:'contact'},{id:'com',label:'COM',dx:70,dy:0,type:'contact'},{id:'nc',label:'NC',dx:70,dy:20,type:'contact'}
      ],
      specs:{voltage:'5-12V DC',frequency:'433MHz',channels:1,relayRating:'10A 250VAC'},
      behavior:'relay', icon:'📡' },
    { id:'qca_2ch', name:'QIACHIP 2路无线继电器', model:'QCA-2CH-RF',
      desc:'433MHz无线遥控, 2路继电器输出, 5-12V供电',
      w:160, h:100,
      pins:[
        {id:'vcc',label:'VCC',dx:-80,dy:-40},{id:'gnd',label:'GND',dx:-80,dy:40},
        {id:'sig1',label:'CH1',dx:-80,dy:-20,type:'signal'},{id:'sig2',label:'CH2',dx:-80,dy:0,type:'signal'},
        {id:'no1',label:'NO1',dx:80,dy:-20,type:'contact'},{id:'com1',label:'COM1',dx:80,dy:0,type:'contact'},
        {id:'no2',label:'NO2',dx:80,dy:20,type:'contact'}
      ],
      specs:{voltage:'5-12V DC',frequency:'433MHz',channels:2,relayRating:'10A 250VAC'},
      behavior:'relay', icon:'📡' },
    { id:'qca_4ch', name:'QIACHIP 4路无线继电器', model:'QCA-4CH-RF',
      desc:'433MHz无线遥控, 4路继电器输出, 5-12V供电',
      w:200, h:120,
      pins:[
        {id:'vcc',label:'VCC',dx:-100,dy:-40},{id:'gnd',label:'GND',dx:-100,dy:40},
        {id:'sig1',label:'CH1',dx:-100,dy:-20,type:'signal'},{id:'sig2',label:'CH2',dx:-100,dy:0,type:'signal'},
        {id:'sig3',label:'CH3',dx:-100,dy:20,type:'signal'},{id:'sig4',label:'CH4',dx:-100,dy:40,type:'signal'},
        {id:'no1',label:'NO1',dx:100,dy:-40,type:'contact'},{id:'com1',label:'COM1',dx:100,dy:-20,type:'contact'},
        {id:'no2',label:'NO2',dx:100,dy:0,type:'contact'},{id:'com2',label:'COM2',dx:100,dy:20,type:'contact'}
      ],
      specs:{voltage:'5-12V DC',frequency:'433MHz',channels:4,relayRating:'10A 250VAC'},
      behavior:'relay', icon:'📡' },
    { id:'qca_wifi', name:'QIACHIP WiFi继电器', model:'QCA-WIFI-1',
      desc:'WiFi无线控制, 1路继电器, Tuya/Smart Life',
      w:160, h:100,
      pins:[
        {id:'vcc',label:'VCC',dx:-80,dy:-40},{id:'gnd',label:'GND',dx:-80,dy:40},
        {id:'no',label:'NO',dx:80,dy:-20,type:'contact'},{id:'com',label:'COM',dx:80,dy:0,type:'contact'},
        {id:'nc',label:'NC',dx:80,dy:20,type:'contact'}
      ],
      specs:{voltage:'5V DC',protocol:'WiFi 2.4GHz',channels:1,relayRating:'10A 250VAC'},
      behavior:'relay', icon:'📶' },
  ],

  init() {
    // Load from localStorage or use templates
    // Version check: clear old cache when pin layout changes
    const PIN_LAYOUT_VERSION = 3;
    try {
      const cachedVer = localStorage.getItem('elecsim_pin_layout_ver');
      if (cachedVer !== String(PIN_LAYOUT_VERSION)) {
        localStorage.removeItem('elecsim_v2_products');
        localStorage.setItem('elecsim_pin_layout_ver', String(PIN_LAYOUT_VERSION));
      }
    } catch(e) {}
    try {
      const saved = localStorage.getItem('elecsim_v2_products');
      if (saved) { this.products = JSON.parse(saved); return; }
    } catch(e) {}
    // Default: load templates as products
    this.products = this.templates.map(t => ({...t, image: null}));
    this.save();
  },

  save() {
    try { localStorage.setItem('elecsim_v2_products', JSON.stringify(this.products)); } catch(e) {}
  },

  getAsDefs() {
    return this.products.map(p => ({
      type: 'product_' + (p.id || p.model),
      name: p.name, cat: 'QIACHIP产品', icon: p.icon || '📡',
      desc: p.model || '', w: p.w || 140, h: p.h || 90,
      pins: p.pins || [],
      props: { ...(p.specs || {}), behavior: p.behavior || 'blackbox', energized: false },
      image: p.image || null
    }));
  },

  buildProductList() {
    const list = document.getElementById('productList');
    if (!list) return;
    list.innerHTML = '';
    const allProducts = [...this.templates, ...this.products.filter(p => !this.templates.find(t => t.id === p.id))];
    allProducts.forEach(p => {
      const card = document.createElement('div');
      card.className = 'product-card';
      card.draggable = true;
      card.innerHTML = `
        <div class="prod-img">${p.image ? `<img src="${p.image}" alt="">` : (p.icon || '📡')}</div>
        <div class="prod-info">
          <div class="prod-name">${p.name}</div>
          <div class="prod-model">${p.model || ''} | ${(p.specs || {}).frequency || ''}</div>
        </div>`;
      const def = {
        type: 'product_' + (p.id || p.model),
        name: p.name, cat: 'QIACHIP产品', icon: p.icon || '📡',
        desc: p.model || '', w: p.w || 140, h: p.h || 90,
        pins: p.pins || [],
        props: { ...(p.specs || {}), behavior: p.behavior || 'blackbox', energized: false },
        image: p.image || null
      };
      card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', JSON.stringify(def)); });
      card.addEventListener('dblclick', () => {
        Renderer.addComponent(def, W / 2 / S.zoom - S.pan.x / S.zoom, H / 2 / S.zoom - S.pan.y / S.zoom);
      });
      list.appendChild(card);
    });
  },

  initEditor() {
    const canvas = document.getElementById('pinEditorCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const handleImage = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          QIACHIP.editorImage = img;
          QIACHIP.drawEditor();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    };
    document.getElementById('prodImage').addEventListener('change', handleImage);

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const pinId = 'pin_' + this.editorPins.length;
      this.editorPins.push({ id: pinId, label: pinId.toUpperCase(), dx: Math.round(x), dy: Math.round(y) });
      this.drawEditor();
      this.updateEditorPinsList();
    });
  },

  drawEditor() {
    const canvas = document.getElementById('pinEditorCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (this.editorImage) {
      const scale = Math.min(canvas.width / this.editorImage.width, canvas.height / this.editorImage.height, 1);
      const w = this.editorImage.width * scale;
      const h = this.editorImage.height * scale;
      ctx.drawImage(this.editorImage, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    } else {
      ctx.fillStyle = '#484f58';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('上传产品图片后在此添加引脚', canvas.width / 2, canvas.height / 2);
    }

    // Draw pins
    this.editorPins.forEach((pin, i) => {
      ctx.fillStyle = '#ff7eb3';
      ctx.strokeStyle = '#ff7eb3';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pin.dx, pin.dy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#c9d1d9';
      ctx.font = 'bold 11px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(pin.label, pin.dx, pin.dy - 12);
    });
  },

  updateEditorPinsList() {
    const el = document.getElementById('pinEditorPins');
    if (!el) return;
    if (this.editorPins.length === 0) {
      el.textContent = '暂无引脚，点击画布添加';
      return;
    }
    el.innerHTML = this.editorPins.map((p, i) =>
      `<span style="display:inline-block;background:rgba(255,126,179,.1);border:1px solid var(--pink);border-radius:3px;padding:1px 6px;margin:2px;font-size:10px;color:var(--pink);">${p.label} <span style="cursor:pointer;color:var(--red);" onclick="ElecSim.QIACHIP.removeEditorPin(${i})">&times;</span></span>`
    ).join('');
  },

  removeEditorPin(index) {
    this.editorPins.splice(index, 1);
    this.drawEditor();
    this.updateEditorPinsList();
  },

  clearEditor() {
    this.editorPins = [];
    this.editorImage = null;
    this.drawEditor();
    this.updateEditorPinsList();
    document.getElementById('prodName').value = '';
    document.getElementById('prodModel').value = '';
    document.getElementById('prodDesc').value = '';
    document.getElementById('prodSpecs').value = '{}';
  },

  addProduct() {
    const name = document.getElementById('prodName').value.trim();
    if (!name) { UI.toast('请输入产品名称', 'error'); return; }
    const model = document.getElementById('prodModel').value.trim();
    const desc = document.getElementById('prodDesc').value.trim();
    const behavior = document.getElementById('prodBehavior').value;
    let specs = {};
    try { specs = JSON.parse(document.getElementById('prodSpecs').value || '{}'); } catch(e) { UI.toast('JSON格式错误', 'error'); return; }

    const canvas = document.getElementById('pinEditorCanvas');
    const scaleX = this.editorImage ? this.editorImage.width / canvas.width : 1;
    const scaleY = this.editorImage ? this.editorImage.height / canvas.height : 1;

    const pins = this.editorPins.map(p => ({
      id: p.label.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      label: p.label,
      dx: Math.round((p.dx - canvas.width / 2) / scaleX * 0.5),
      dy: Math.round((p.dy - canvas.height / 2) / scaleY * 0.5)
    }));

    const product = {
      id: 'custom_' + Date.now(),
      name, model, desc,
      icon: '📡', w: 140, h: 90,
      pins, specs, behavior,
      image: this.editorImage ? this.editorImage.src : null
    };

    this.products.push(product);
    this.save();
    this.buildProductList();
    UI.closeModal('productModal');
    UI.toast('已添加产品: ' + name, 'success');
    this.clearEditor();
  }
};

