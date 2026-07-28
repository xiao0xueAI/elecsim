#!/usr/bin/env python3
"""将 index.html 拆分为模块化文件（中文名）"""
import os

# 读取原始文件
with open('index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 总行数
total = len(lines)
print(f"读取 index.html: {total} 行")

# ============================================================
# 1. 提取 CSS → 样式.css
# ============================================================
# CSS: lines 9-206 (0-indexed: 8-206)
# 去掉 <style> 和 </style>
css_lines = []
in_style = False
for i, line in enumerate(lines):
    if '<style>' in line:
        in_style = True
        continue
    if '</style>' in line:
        in_style = False
        continue
    if in_style:
        css_lines.append(line)

css_content = ''.join(css_lines)
os.makedirs('样式', exist_ok=True)
with open('样式/样式.css', 'w', encoding='utf-8') as f:
    f.write(css_content)
print(f"样式.css: {len(css_lines)} 行")

# ============================================================
# 2. 创建目录
# ============================================================
os.makedirs('脚本', exist_ok=True)
os.makedirs('数据', exist_ok=True)

# ============================================================
# 3. 编写 split_js 辅助函数
# ============================================================
def write_js(filename, start_line, end_line, description):
    """提取 [start_line, end_line) 行 (0-indexed) 写入文件"""
    content = ''.join(lines[start_line:end_line])
    filepath = f'{filename}'
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"  {filepath}: {end_line - start_line} 行")

# ============================================================
# 4. JS 文件拆分（行号均为 1-indexed 转 0-indexed）
# ============================================================
# 每个文件 = 原始内容去掉 IIFE 包装

JS_SPLITS = [
    # (文件路径, 起始行1, 结束行, 描述) 
    # 行号是 1-indexed 的原始文件行号
    # 结束行是 exclusive (不包含)
    
    # Section 1: Config
    ('脚本/配置.js', 478, 498, 'Config 配置常量'),
    
    # Section 2: State
    ('脚本/状态.js', 498, 525, 'S 全局状态'),
    
    # Section 3: Registry - 元件库 ⭐
    ('数据/元件库.js', 525, 674, 'Registry 元件定义'),
    
    # Section 4: QIACHIP
    ('数据/产品库.js', 674, 926, 'QIACHIP 产品系统'),
    
    # BellAudio + helpers (Section 5 前部分)
    ('脚本/音频.js', 926, 1082, 'BellAudio 音效模块'),
    
    # screenToCanvas + _SR_render + Renderer
    ('脚本/绘图.js', 1082, 2307, 'Renderer 绘图系统'),
    
    # Section 6: WireRouter
    ('脚本/布线.js', 2307, 3561, 'WireRouter 布线系统'),
    
    # Section 7: Engine
    ('脚本/引擎.js', 3561, 4352, 'Engine 仿真引擎'),
    
    # Section 8: History
    ('脚本/历史.js', 4352, 4427, 'History 撤销重做'),
    
    # Section 9: Persistence
    ('脚本/存储.js', 4427, 4514, 'Persistence 持久化'),
    
    # Section 10: Templates
    ('数据/模板库.js', 4514, 4529, 'Templates 模板'),
    
    # Section 11: Recording
    ('脚本/录制.js', 4529, 5175, 'Recorder 录制系统'),
    
    # Section 12: UI
    ('脚本/界面.js', 5175, 5406, 'UI 界面控制器'),
    
    # Section 13: Event Handlers
    ('脚本/事件.js', 5406, 5747, 'Event 事件处理器'),
    
    # Section 14: Helpers + UnionFind
    ('脚本/工具.js', 5747, 5947, 'Helpers 工具函数'),
    
    # Section 15: Init + Public API + Bootstrap
    ('脚本/初始化.js', 5947, 6040, 'Init 初始化 + 启动'),
]

for filepath, start_1idx, end_1idx, desc in JS_SPLITS:
    start_0idx = start_1idx - 1  # 转 0-indexed
    end_0idx = end_1idx - 1
    write_js(filepath, start_0idx, end_0idx, desc)

# ============================================================
# 5. 生成新的 index.html
# ============================================================

# HTML head (lines 1-7) + 替换 style 为 link
head_lines = []
for i in range(0, 8):  # lines 1-8 (0-indexed 0-7)
    head_lines.append(lines[i])

# 替换 <style> 为 <link>：找到 <style> 开始到 </style> 之间的部分并替换
new_head = []
skip = False
for i, line in enumerate(head_lines):
    if '<style>' in line:
        new_head.append('  <link rel="stylesheet" href="样式/样式.css">\n')
        skip = True
        continue
    if '</style>' in line:
        skip = False
        continue
    if not skip:
        new_head.append(line)

# HTML body (lines 209-467, 0-indexed: 208-467)
body_lines = []
for i in range(208, 468):
    body_lines.append(lines[i])

# 组装新的 index.html
new_index = []
new_index.extend(new_head)

# body 部分
for line in body_lines:
    new_index.append(line)

# 关闭 body 前插入所有 script 标签
scripts_order = [s[0] for s in JS_SPLITS]  # 顺序重要！
new_index.append('\n')
new_index.append('  <!-- ===== 拆分后的模块化 JS 文件 ===== -->\n')
for script_path in scripts_order:
    new_index.append(f'  <script src="{script_path}"></script>\n')
new_index.append('\n')

# 关闭 HTML
new_index.append('</body>\n')
new_index.append('</html>\n')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(''.join(new_index))
print(f"\n新 index.html: {len(new_index)} 行")

# ============================================================
# 6. 备份原文件
# ============================================================
import shutil
shutil.copy2('index.html', 'index.html.before-split')
print("\n✅ 拆分完成！原文件已备份为 index.html.before-split")

# ============================================================
# 7. 验证文件创建
# ============================================================
print("\n📁 文件结构：")
print("elecsim/")
print("├── index.html              ← 外壳（HTML 结构）")
print("├── 样式/")
print("│   └── 样式.css            ← 所有 CSS 样式")
print("├── 脚本/")
split_map = {s[0]: s[3] for s in JS_SPLITS}
for s in scripts_order:
    if s.startswith('脚本/'):
        print(f"│   ├── {os.path.basename(s):20s} ← {split_map[s]}")
print("├── 数据/")
for s in scripts_order:
    if s.startswith('数据/'):
        print(f"│   ├── {os.path.basename(s):20s} ← {split_map[s]}")
print("└── 编辑器/                  ← 代码编辑器（已有）")
