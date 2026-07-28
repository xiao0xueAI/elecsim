// ==================== 布线样式配置（可视化编辑器可修改） ====================
const WireStyle = {
  // ----- 各线型颜色 -----
  colors: {
    live: '#e53935',    // 火线/AC正极 — 红色
    neutral: '#1e88e5',    // 零线/AC负极 — 蓝色
    ground: '#43a047',    // 地线 — 绿色
    signal: '#ffa800',    // 信号线 — 橙色
    dc_pos: '#ff6d00',    // DC正极 — 深橙
    dc_neg: '#00bcd4',    // DC负极 — 青色
    purple: '#ab47bc',    // 紫色备用
    cyan: '#00bcd4',    // 青色备用
    pink: '#ec407a',    // 粉色备用
    gold: '#ffc107',    // 金色备用
  },

  // ----- 导线主体宽度 -----
  width: 5,

  // ----- 电流流动动画参数 -----
  flow: {
    // AC 交流电
    ac: {
      dashLen: 12,        // 虚线长度
      gapLen: 20,         // 虚线间隔
      speed: 0.4,         // 流动速度倍率
      arrowSize: 6,       // 箭头大小
      arrowSpacing: 35,   // 箭头间距
      glowBlur: 18        // 发光模糊半径
    },
    // DC 直流电
    dc: {
      dashLen: 8,
      gapLen: 12,
      speed: 0.6,
      arrowSize: 5,
      arrowSpacing: 25,
      glowBlur: 12
    }
  }
};
