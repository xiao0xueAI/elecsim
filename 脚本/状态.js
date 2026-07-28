// ==================== Section 2: State ====================
const S = {
  components: [],
  wires: [],
  selected: null,
  simRunning: false,
  simTime: 0,
  animTick: 0,
  zoom: 1,
  pan: { x: 0, y: 0 },
  dragging: null,
  dragOff: { x: 0, y: 0 },
  panning: false,
  panStart: { x: 0, y: 0 },
  showInternal: false,
  showCurrentDir: true,
  showPinLabels: true,
  nextId: 1,
  nextWireId: 1,
  grid: Config.grid,
  mouse: { x: 0, y: 0 },
  hoverWireId: null,
  dirty: false,
  recording: false,
  exportOpts: { res: '1080p', dur: '10秒' }
};

