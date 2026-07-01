// ==================== Section 8: History (Undo/Redo) ====================
const History = {
  stack: [],
  index: -1,

  push(action) {
    this.stack.splice(this.index + 1);
    this.stack.push(action);
    if (this.stack.length > Config.maxHistory) this.stack.shift();
    this.index = this.stack.length - 1;
    this.updateButtons();
  },

  undo() {
    if (this.index < 0) return;
    const action = this.stack[this.index];
    this.index--;
    this.applyUndo(action);
    this.updateButtons();
    S.dirty = true;
  },

  redo() {
    if (this.index >= this.stack.length - 1) return;
    this.index++;
    const action = this.stack[this.index];
    this.applyRedo(action);
    this.updateButtons();
    S.dirty = true;
  },

  applyUndo(action) {
    if (action.type === 'add') {
      S.components = S.components.filter(c => c.id !== action.comp.id);
      WireRouter.removeWiresForComp(action.comp.id);
    } else if (action.type === 'remove') {
      S.components.push({ ...action.comp });
    } else if (action.type === 'wire') {
      S.wires = S.wires.filter(w => w.id !== action.wire.id);
    } else if (action.type === 'deleteWire') {
      // Undo delete: re-add the wire
      S.wires.push({ ...action.wire });
    } else if (action.type === 'deleteAllWires') {
      // Undo delete all: restore all wires
      S.wires = action.wires.map(w => ({ ...w }));
    }
    S.selected = null;
    UI.hideProps();
    requestRender();
  },

  applyRedo(action) {
    if (action.type === 'add') {
      S.components.push({ ...action.comp });
    } else if (action.type === 'remove') {
      S.components = S.components.filter(c => c.id !== action.comp.id);
      WireRouter.removeWiresForComp(action.comp.id);
    } else if (action.type === 'wire') {
      S.wires.push({ ...action.wire });
    } else if (action.type === 'deleteWire') {
      // Redo delete: remove the wire again
      S.wires = S.wires.filter(w => w.id !== action.wire.id);
    } else if (action.type === 'deleteAllWires') {
      // Redo delete all: clear all wires again
      S.wires = [];
    }
    requestRender();
  },

  updateButtons() {
    document.getElementById('btnUndo').disabled = this.index < 0;
    document.getElementById('btnRedo').disabled = this.index >= this.stack.length - 1;
  }
};

