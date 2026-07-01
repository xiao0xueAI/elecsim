// ==================== Section 1: Config ====================
const Config = {
  grid: 20,
  zoomMin: 0.2,
  zoomMax: 4,
  zoomStep: 0.1,
  maxComponents: 100,
  maxHistory: 50,
  autoSaveInterval: 30000,
  maxImageSize: 200 * 1024, // 200KB base64
  pinRadius: 8.5,
  pinHitRadius: 14,
  particleSpeed: 0.3,
  categoryColors: {
    '电源': '#f0883e', '开关/按钮': '#58a6ff', '保护器件': '#f85149',
    '继电器/接触器': '#bc8cff', '传感器': '#39d2c0', '输出器件': '#3fb950',
    '测量仪表': '#d29922', '无源元件': '#8b949e', 'QIACHIP产品': '#ff7eb3'
  }
};

