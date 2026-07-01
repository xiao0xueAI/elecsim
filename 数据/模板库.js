// ==================== Section 10: Templates ====================
const Templates = {
  list: [],

  buildTemplateList() {
    const list = document.getElementById('templateList');
    if (!list) return;
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--fg-muted);font-size:12px;">暂无模板<br><span style="font-size:11px;">后续可在此添加电路模板</span></div>';
  },

  load(id) {
    UI.toast('模板暂未配置，请等待后续更新', 'warning');
  }
};

