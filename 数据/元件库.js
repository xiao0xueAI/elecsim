// ==================== Section 3: Component Registry ====================
const Registry = {
  categories: [
    '电源', '开关/按钮', '继电器/接触器',
    '输出器件'
  ],

  // Global image cache: shared across all components (key = image URL)
  _imageCache: new Map(),
  _preloadQueue: [],
  _preloading: false,

  // Preload an image and cache it. Returns the cached Image element.
  preloadImage(src) {
    if (!src) return null;
    if (this._imageCache.has(src)) return this._imageCache.get(src);
    const img = new Image();
    img.decoding = 'async'; // non-blocking decode (was 'sync')
    img.fetchPriority = 'high'; // prioritize image loading
    this._imageCache.set(src, img);
    img.src = src;
    return img;
  },

  // Preload all images used by component defs (call on app init)
  preloadAllImages() {
    const seen = new Set();
    for (const def of this.defs) {
      if (def.image && !seen.has(def.image)) { seen.add(def.image); this.preloadImage(def.image); }
      if (def.imageOn && !seen.has(def.imageOn)) { seen.add(def.imageOn); this.preloadImage(def.imageOn); }
    }
  },

  // Component definitions
  defs: [
    // --- 电源 ---
    { type:'battery_12v', name:'12V直流电池', cat:'电源', icon:'🔋', desc:'DC 12V 实物电池包（蓝线-/红线+）',
      w:200, h:120,
      image:'images/battery_12v.webp',
      pins:[{id:'p',label:'+',dx:65,dy:45,lo:0,ld:28},{id:'n',label:'-',dx:-65,dy:45,lo:0,ld:28}],
      props:{voltage:12} },

    { type:'ac_source', name:'交流电源', cat:'电源', icon:'⚡', desc:'AC 220V 实物插头',
      w:120, h:180,
      image:'images/ac_plug.webp',
      pins:[{id:'p',label:'L',dx:-12,dy:90,lo:-18,ld:-18},{id:'n',label:'N',dx:12,dy:90,lo:18,ld:-18}],
      props:{voltage:220,freq:50} },

    // --- 开关/按钮 ---
    // SPST (单开单控): 最简单的开关，L=相线入(红)，L1=相线出，闭合导通断开截止
    { type:'spst', name:'单开单控', cat:'开关/按钮', icon:'🎚', desc:'单刀单掷/单开单控墙壁开关（实物照片）',
      w:160, h:160,
      pins:[{id:'l',label:'L',dx:0,dy:-83},{id:'l1',label:'L1',dx:0,dy:83}],
      props:{closed:false},
      image:'images/spst_off.webp?v=1',
      imageOn:'images/spst_on.webp?v=1',
    },


    // --- 自回弹开关（点动/复位按钮，按住导通松手断开） ---
    { type:'spst_momentary', name:'自回弹开关', cat:'开关/按钮', icon:'🔘', desc:'点动自回弹开关（按住导通松手断开，带指示灯）',
      w:160, h:160,
      image:'images/switch_momentary_off.webp?v=2',
      imageOn:'images/switch_momentary_on.webp?v=2',
      pins:[{id:'l',label:'L',dx:0,dy:-83},{id:'l1',label:'L1',dx:0,dy:83}],
      props:{closed:false} },

    // --- 继电器/接触器 ---
    // (433MHz干接点继电器已移至产品库 QIACHIP.templates)


    // --- 输出器件 ---
    { type:'lamp', name:'灯泡', cat:'输出器件', icon:'💡', desc:'白炽灯/卤素灯（交流）',
      w:120, h:220,
      pins:[{id:'l',label:'L',dx:0,dy:100,lo:0,ld:30},{id:'n',label:'N',dx:16,dy:68,lo:28,ld:-8}],
      props:{voltage:220,wattage:60},
      image:'images/lamp_off.webp',
      imageOn:'images/lamp_on.webp' },

    // 直流电铃 (电磁锤式，通电即响，内部触点自动通断)
    { type:'bell_dc', name:'直流电铃', cat:'输出器件', icon:'🔔', desc:'直流电磁锤式电铃（通电即响，内部触点自动通断）',
      w:160, h:155,
      image:'images/bell_dc.webp',
      pins:[{id:'n',label:'-',dx:-18,dy:62,ld:18},{id:'p',label:'+',dx:18,dy:62,ld:18}],
      props:{voltage:12,resistance:20} },

    // (433MHz遥控器已移至产品库 QIACHIP.templates)

  ],

  getDef(type) { return this.defs.find(d => d.type === type); },

  getByCategory() {
    const result = [];
    this.categories.forEach(cat => {
      const items = this.defs.filter(d => d.cat === cat);
      if (items.length > 0) result.push({ cat, items });
    });
    return result;
  },

  createInstance(def, x, y) {
    const g = S.grid;
    return {
      id: S.nextId++,
      type: def.type,
      name: def.name,
      cat: def.cat,
      icon: def.icon,
      image: def.image || null,
      imageOn: def.imageOn || null,
      w: def.w || 100,
      h: def.h || 56,
      x: Math.round(x / g) * g,
      y: Math.round(y / g) * g,
      pins: def.pins.map(p => ({ ...p })),
      props: { ...def.props },
      simCurrent: 0,
      simVoltage: 0
    };
  }
};

