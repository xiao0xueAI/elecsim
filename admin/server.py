"""
ElecSim 可视化编辑器 - 后端服务
功能：读取/保存 CSS 变量、元件库、产品库
端口：8766
启动：python3 admin/server.py
"""
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).parent.parent.resolve()  # elecsim/
CSS_FILE = ROOT / "样式" / "样式.css"
COMPONENTS_FILE = ROOT / "数据" / "元件库.js"
PRODUCTS_FILE = ROOT / "数据" / "产品库.js"
TEMPLATES_FILE = ROOT / "数据" / "模板库.js"
WIRE_STYLE_FILE = ROOT / "数据" / "布线样式.js"
IMAGES_DIR = ROOT / "images"
# 自动检测 Node.js 路径（兼容 Windows/Mac/Linux）
NODE_BIN = shutil.which("node")
if not NODE_BIN:
    # 尝试常见路径
    candidates = [
        "/Users/qiachip/.workbuddy/binaries/node/versions/22.22.2/bin/node",
        "node",
    ]
    for c in candidates:
        if os.path.isfile(c) or shutil.which(c):
            NODE_BIN = c if os.path.isfile(c) else shutil.which(c)
            break
if not NODE_BIN:
    print("⚠️  警告: 未找到 Node.js，元件库/产品库的 JSON 解析将不可用")
    print("   请安装 Node.js: https://nodejs.org/")
    print("   安装后请确保 node 命令在系统 PATH 中（Windows 可能需要重启终端）")
else:
    # 验证 Node.js 是否真正可用
    try:
        result = subprocess.run([NODE_BIN, "-e", "console.log('ok')"], capture_output=True, encoding='utf-8', errors='replace', timeout=5)
        if result.returncode != 0 or result.stdout.strip() != "ok":
            print(f"⚠️  警告: Node.js 在 {NODE_BIN} 但无法正常执行")
            print(f"   错误: {result.stderr[:200]}")
            NODE_BIN = None
        else:
            print(f"✅ Node.js 已就绪: {NODE_BIN}")
    except Exception as e:
        print(f"⚠️  警告: Node.js 检测异常: {e}")
        NODE_BIN = None

def js_text_to_json(text):
    """用 Node.js 求值 JS 数组文本，返回 Python list/dict。"""
    if not NODE_BIN:
        return None, "Node.js 未安装，无法解析元件数据"
    wrapper = "process.stdout.write(JSON.stringify((function(){\n  try { return [\n" + text + "\n]; } catch(e){ return [{__error__: String(e.message)}]; }\n})()));\n"
    # Windows 兼容：先关闭临时文件再让 Node.js 读取（Windows 不允许同时打开）
    tmp = None
    try:
        # 用 tempfile.mktemp + 手动写入，避免文件锁问题
        tmp_dir = tempfile.gettempdir()
        tmp = os.path.join(tmp_dir, f"elecsim_parse_{os.getpid()}_{id(text)}.js")
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(wrapper)
        result = subprocess.run(
            [NODE_BIN, tmp],
            capture_output=True, encoding='utf-8', errors='replace', timeout=10
        )
        if result.returncode != 0:
            err_msg = result.stderr[:300] if result.stderr else "(无错误输出)"
            print(f"  [DEBUG] Node.js 执行失败(码{result.returncode}): {err_msg}")
            return None, f"node 错误: {err_msg}"
        out = result.stdout.strip()
        if not out:
            err_msg = result.stderr[:200] if result.stderr else "(无输出)"
            print(f"  [DEBUG] Node.js 无 stdout 输出, stderr={err_msg}")
            return None, f"node 无输出 (stderr: {err_msg})"
        try:
            data = json.loads(out)
            return data, None
        except Exception as e:
            print(f"  [DEBUG] JSON 解析失败: {e}, out前200字符: {out[:200]}")
            return None, f"JSON 解析失败: {e}, 输出前200字符: {out[:200]}"
    except subprocess.TimeoutExpired:
        return None, "Node.js 执行超时(10秒)"
    except Exception as e:
        print(f"  [DEBUG] js_text_to_json 异常: {type(e).__name__}: {e}")
        return None, f"执行异常: {type(e).__name__}: {e}"
    finally:
        if tmp and os.path.isfile(tmp):
            try: os.unlink(tmp)
            except: pass

def json_to_js_text(arr):
    """把 Python list/dict 序列化为 JS 源码（用 util.inspect 风格）
    返回不含外层 [] 的数组元素文本，因为 _write_js_section 会把文本放在 marker: [ ... ] 之间。
    """
    if not NODE_BIN:
        return None, "Node.js 未安装"
    wrapper = (
        "var arr = " + json.dumps(arr, ensure_ascii=False) + ";\n"
        "process.stdout.write(require('util').inspect(arr, {depth: null, breakLength: 200, compact: false}));\n"
    )
    tmp = None
    try:
        tmp_dir = tempfile.gettempdir()
        tmp = os.path.join(tmp_dir, f"elecsim_serialize_{os.getpid()}.js")
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(wrapper)
        result = subprocess.run(
            [NODE_BIN, tmp],
            capture_output=True, encoding='utf-8', errors='replace', timeout=10
        )
        if result.returncode != 0:
            return None, f"node 错误: {result.stderr[:300]}"
        output = result.stdout.strip()
        # 去掉 util.inspect 输出的外层 [ ]，避免写入后变成 defs: [[...]] 双重嵌套
        if output.startswith('[') and output.endswith(']'):
            output = output[1:-1].strip()
        return output, None
    except Exception as e:
        return None, f"执行异常: {e}"
    finally:
        if tmp and os.path.isfile(tmp):
            try: os.unlink(tmp)
            except: pass

def parse_wire_style():
    """解析布线样式.js 返回嵌套格式，匹配前端期望"""
    if not WIRE_STYLE_FILE.exists():
        return None
    text = WIRE_STYLE_FILE.read_text(encoding="utf-8")

    def extract_obj(text, key):
        """从 text 中提取 key: { ... } 对象内容"""
        # 找 key: 后面紧跟的 { ... }
        m = re.search(rf"{key}\s*:\s*\{{", text)
        if not m:
            return {}
        start = m.end() - 1  # { 的位置
        depth = 1
        i = start + 1
        while i < len(text) and depth > 0:
            c = text[i]
            if c == "{": depth += 1
            elif c == "}": depth -= 1
            i += 1
        block = text[start:i]
        return block

    # colors
    colors_block = extract_obj(text, "colors")
    colors = {}
    for pair in re.findall(r"(\w+):\s*'([^']*)'", colors_block):
        colors[pair[0]] = pair[1]

    # width
    width = 5
    m = re.search(r"width:\s*([\d.]+)", text)
    if m:
        width = float(m.group(1))
        if width == int(width):
            width = int(width)

    # flow
    flow_block = extract_obj(text, "flow")

    # flow.ac
    ac_block = extract_obj(flow_block, "ac")
    ac = {"dashLen":12,"gapLen":20,"speed":0.18,"arrowSize":6,"arrowSpacing":35,"glowBlur":18}
    for pair in re.findall(r"(\w+):\s*([\d.]+)", ac_block):
        ac[pair[0]] = float(pair[1])

    # flow.dc
    dc_block = extract_obj(flow_block, "dc")
    dc = {"dashLen":8,"gapLen":12,"speed":0.25,"arrowSize":5,"arrowSpacing":25,"glowBlur":12}
    for pair in re.findall(r"(\w+):\s*([\d.]+)", dc_block):
        dc[pair[0]] = float(pair[1])

    return {
        "colors": colors,
        "width": width,
        "flow": {"ac": ac, "dc": dc},
    }

def write_wire_style(data):
    """
    写回布线样式.js —— 全量重建（不用 regex 替换，避免缩进错乱/丢失注释）
    data 格式:
      { colors: {live:'#xxx', ...}, width: 5, flow: {ac:{...}, dc:{...}} }
    """
    # 先用已读内容作为基准，保留未传入的颜色
    current = parse_wire_style() or {}
    cur_colors = current.get("colors", {})
    cur_width = current.get("width", 5)
    cur_flow = current.get("flow", {})
    cur_ac = cur_flow.get("ac", {})
    cur_dc = cur_flow.get("dc", {})

    new_colors = data.get("colors", {})
    new_width = data.get("width", cur_width)
    new_flow = data.get("flow", {})

    # 合并颜色（只覆盖传入的键）
    colors = {}
    color_order = ["live","neutral","ground","signal","dc_pos","dc_neg","purple","cyan","pink","gold"]
    for k in color_order:
        colors[k] = new_colors.get(k, cur_colors.get(k, "#888888"))
    # 也保留未在 color_order 中的自定义键
    for k in new_colors:
        if k not in colors:
            colors[k] = new_colors[k]

    # flow 默认值
    ac = {"dashLen":12,"gapLen":20,"speed":0.18,"arrowSize":6,"arrowSpacing":35,"glowBlur":18}
    dc = {"dashLen":8,"gapLen":12,"speed":0.25,"arrowSize":5,"arrowSpacing":25,"glowBlur":12}
    nac = new_flow.get("ac", {})
    ndc = new_flow.get("dc", {})
    for k in ac: ac[k] = nac.get(k, cur_ac.get(k, ac[k]))
    for k in dc: dc[k] = ndc.get(k, cur_dc.get(k, dc[k]))

    # 颜色注释
    color_comments = {
        "live": "火线/AC正极 — 红色", "neutral": "零线/AC负极 — 蓝色",
        "ground": "地线 — 绿色", "signal": "信号线 — 橙色",
        "dc_pos": "DC正极 — 深橙", "dc_neg": "DC负极 — 青色",
        "purple": "紫色备用", "cyan": "青色备用",
        "pink": "粉色备用", "gold": "金色备用",
    }

    # 构建文件内容
    lines = []
    lines.append("// ==================== 布线样式配置（可视化编辑器可修改） ====================")
    lines.append("const WireStyle = {")
    lines.append("  // ----- 各线型颜色 -----")
    lines.append("  colors: {")
    for k in color_order:
        if k in colors:
            cmt = color_comments.get(k, "")
            lines.append(f"    {k}: '{colors[k]}',    // {cmt}" if cmt else f"    {k}: '{colors[k]}',")
    # 自定义键
    for k in colors:
        if k not in color_order:
            lines.append(f"    {k}: '{colors[k]}',")
    lines.append("  },")
    lines.append("")
    lines.append("  // ----- 导线主体宽度 -----")
    lines.append(f"  width: {int(new_width) if new_width == int(new_width) else new_width},")
    lines.append("")
    lines.append("  // ----- 电流流动动画参数 -----")
    lines.append("  flow: {")
    lines.append("    // AC 交流电")
    lines.append("    ac: {")
    lines.append(f"      dashLen: {int(ac['dashLen']) if ac['dashLen'] == int(ac['dashLen']) else ac['dashLen']},        // 虚线长度")
    lines.append(f"      gapLen: {int(ac['gapLen']) if ac['gapLen'] == int(ac['gapLen']) else ac['gapLen']},         // 虚线间隔")
    lines.append(f"      speed: {ac['speed']},        // 流动速度倍率")
    lines.append(f"      arrowSize: {int(ac['arrowSize']) if ac['arrowSize'] == int(ac['arrowSize']) else ac['arrowSize']},       // 箭头大小")
    lines.append(f"      arrowSpacing: {int(ac['arrowSpacing']) if ac['arrowSpacing'] == int(ac['arrowSpacing']) else ac['arrowSpacing']},   // 箭头间距")
    lines.append(f"      glowBlur: {int(ac['glowBlur']) if ac['glowBlur'] == int(ac['glowBlur']) else ac['glowBlur']}        // 发光模糊半径")
    lines.append("    },")
    lines.append("    // DC 直流电")
    lines.append("    dc: {")
    lines.append(f"      dashLen: {int(dc['dashLen']) if dc['dashLen'] == int(dc['dashLen']) else dc['dashLen']},")
    lines.append(f"      gapLen: {int(dc['gapLen']) if dc['gapLen'] == int(dc['gapLen']) else dc['gapLen']},")
    lines.append(f"      speed: {dc['speed']},")
    lines.append(f"      arrowSize: {int(dc['arrowSize']) if dc['arrowSize'] == int(dc['arrowSize']) else dc['arrowSize']},")
    lines.append(f"      arrowSpacing: {int(dc['arrowSpacing']) if dc['arrowSpacing'] == int(dc['arrowSpacing']) else dc['arrowSpacing']},")
    lines.append(f"      glowBlur: {int(dc['glowBlur']) if dc['glowBlur'] == int(dc['glowBlur']) else dc['glowBlur']}")
    lines.append("    }")
    lines.append("  }")
    lines.append("};")

    content = "\n".join(lines) + "\n"

    # 原子写入：先写临时文件，验证通过再重命名
    import shutil as _shutil2
    bak = WIRE_STYLE_FILE.with_suffix(WIRE_STYLE_FILE.suffix + ".bak")
    try: _shutil2.copy2(WIRE_STYLE_FILE, bak)
    except: pass

    tmp_path = WIRE_STYLE_FILE.with_suffix(WIRE_STYLE_FILE.suffix + ".tmp")
    tmp_path.write_text(content, encoding="utf-8")
    # Node.js 语法检查
    if NODE_BIN:
        result = subprocess.run(
            [NODE_BIN, "--check", str(tmp_path)],
            capture_output=True, encoding="utf-8", errors="replace", timeout=10
        )
        if result.returncode != 0:
            try: tmp_path.unlink()
            except: pass
            return False, f"生成的 JS 有语法错误（备份 {bak.name}）"
    tmp_path.replace(WIRE_STYLE_FILE)
    return True, "已保存"

# CSS 变量可改的白名单
CSS_VAR_WHITELIST = [
    "bg-dark", "bg-panel", "bg-card", "bg-input",
    "border", "border-light",
    "text", "text-dim", "text-muted",
    "accent", "accent-glow",
    "green", "yellow", "red", "purple",
    "cyan", "orange", "pink",
    "cat-power", "cat-switch", "cat-protection",
    "cat-relay", "cat-sensor", "cat-output",
    "cat-meter", "cat-passive", "cat-qiachip",
]

# ------------------ CSS 解析 ------------------
def parse_css_vars():
    """解析 :root 块中的 CSS 变量"""
    if not CSS_FILE.exists():
        return {}
    text = CSS_FILE.read_text(encoding="utf-8")
    # 找到 :root {...} 块
    m = re.search(r":root\s*\{([^}]*)\}", text, re.DOTALL)
    if not m:
        return {}
    block = m.group(1)
    vars_ = {}
    for line in block.split(";"):
        line = line.strip()
        if not line or ":" not in line:
            continue
        name, _, val = line.partition(":")
        name = name.strip().lstrip("--")
        val = val.strip()
        if name and name in CSS_VAR_WHITELIST:
            vars_[name] = val
    return vars_

def write_css_vars(vars_):
    """写回 CSS 变量到 :root 块（保留未在白名单中的变量）"""
    if not CSS_FILE.exists():
        return False, "样式.css 不存在"
    text = CSS_FILE.read_text(encoding="utf-8")
    m = re.search(r"(:root\s*\{)([^}]*)(\})", text, re.DOTALL)
    if not m:
        return False, "未找到 :root 块"
    block = m.group(2)
    # 解析原块中所有变量
    existing = {}
    for line in block.split(";"):
        line = line.strip()
        if not line or ":" not in line:
            continue
        name, _, val = line.partition(":")
        n = name.strip().lstrip("--")
        if n:
            existing[n] = val.strip()
    # 用新值覆盖
    for k, v in vars_.items():
        if k in CSS_VAR_WHITELIST:
            existing[k] = v
    # 重组
    parts = []
    for n, v in existing.items():
        parts.append(f"--{n}:{v}")
    new_block = "\n  " + ";\n  ".join(parts) + ";\n"
    new_text = text[:m.start(2)] + new_block + text[m.end(2):]
    # 原子写入
    import shutil as _shutil3
    bak = CSS_FILE.with_suffix(CSS_FILE.suffix + ".bak")
    try: _shutil3.copy2(CSS_FILE, bak)
    except: pass
    tmp_css = CSS_FILE.with_suffix(CSS_FILE.suffix + ".tmp")
    tmp_css.write_text(new_text, encoding="utf-8")
    tmp_css.replace(CSS_FILE)
    return True, "已保存"

# ------------------ JS 解析（用正则，安全地只改属性值） ------------------
def extract_js_obj_array(js_text, marker):
    """从 JS 文件中提取 Registry.defs / QIACHIP.products 等数组
    使用安全的字符串匹配，不执行 JS
    """
    # 找到 'defs: [' 或 'products: [' 等标记后的数组
    pattern = re.escape(marker) + r"\s*:\s*\["
    m = re.search(pattern, js_text)
    if not m:
        return None, "未找到标记 " + marker
    start = m.end()  # '[' 之后的位置
    # 配对 [] 找数组结束
    depth = 1
    i = start
    while i < len(js_text) and depth > 0:
        c = js_text[i]
        if c == "[": depth += 1
        elif c == "]": depth -= 1
        i += 1
    if depth != 0:
        return None, "方括号不匹配"
    arr_text = js_text[start:i-1]
    return arr_text, None

# ------------------ HTTP Handler ------------------
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # 静默大部分日志
        pass

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception as e:
            return {"__error__": str(e)}

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        try:
            self._do_get()
        except Exception as e:
            print(f"  ⚠️ GET 错误 {self.path}: {e}")
            self._json(500, {"error": f"服务器内部错误: {e}"})

    def _do_get(self):
        url = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(url.path)  # 解码中文路径

        if path == "/api/css":
            return self._json(200, {"vars": parse_css_vars()})
        if path == "/api/wire-style":
            return self._json(200, parse_wire_style() or {})
        if path == "/api/node-check":
            info = {
                "available": NODE_BIN is not None,
                "path": NODE_BIN,
            }
            if NODE_BIN:
                try:
                    result = subprocess.run([NODE_BIN, "-v"], capture_output=True, encoding='utf-8', errors='replace', timeout=5)
                    info["version"] = result.stdout.strip()
                except:
                    info["version"] = "未知"
            return self._json(200, info)
        if path == "/api/components":
            return self._read_js_section(COMPONENTS_FILE, "defs")
        if path == "/api/products":
            return self._read_js_section(PRODUCTS_FILE, "products")
        if path == "/api/templates":
            return self._read_js_section(TEMPLATES_FILE, "list")
        if path == "/api/all":
            # 辅助函数：尝试用 Node.js 解析，失败则返回 {_raw: text} 让前端 eval
            def try_parse(text_val, section_name="数据"):
                if text_val is None:
                    return [], f"{section_name}文件读取失败"
                if not isinstance(text_val, str):
                    return [], f"{section_name}格式异常"
                if text_val.startswith("/*"):
                    return [], None  # 是注释标记，跳过
                result, err = js_text_to_json(text_val)
                if result is not None:
                    return result, err
                else:
                    # Node.js 不可用，返回原始文本让前端 new Function 求值
                    return {"_raw": text_val}, None if NODE_BIN else err

            comps_text = self._safe_read_section(COMPONENTS_FILE, "defs")
            prods_text = self._safe_read_section(PRODUCTS_FILE, "products")
            temps_text = self._safe_read_section(TEMPLATES_FILE, "list")
            comps, err1 = try_parse(comps_text)
            prods, err2 = try_parse(prods_text)
            temps, err3 = try_parse(temps_text)
            return self._json(200, {
                "css": parse_css_vars(),
                "components": comps,
                "products": prods,
                "templates": temps,
                "errors": [e for e in (err1, err2, err3) if e],
                "nodeAvailable": NODE_BIN is not None,
            })
        if path == "/api/images":
            return self._list_images()
        if path.startswith("/images/"):
            # 代理 images 目录（用于预览）
            rel = path[len("/images/"):]
            fp = IMAGES_DIR / rel
            if fp.is_file() and fp.suffix.lower() in (".webp",".png",".jpg",".jpeg",".svg",".gif"):
                data = fp.read_bytes()
                ext = fp.suffix.lower()
                mime = {".webp":"image/webp",".png":"image/png",".jpg":"image/jpeg",
                        ".jpeg":"image/jpeg",".svg":"image/svg+xml",".gif":"image/gif"}.get(ext, "application/octet-stream")
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            return self._json(404, {"error": "图片不存在"})

        # 默认走文件服务
        if path == "/" or path == "":
            path = "/admin/index.html"
        fs_path = ROOT / path.lstrip("/")
        if fs_path.is_file():
            return self._serve_file(fs_path)
        # 兜底返回 admin 主页
        admin_index = ROOT / "admin" / "index.html"
        if admin_index.is_file():
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(admin_index.read_text(encoding="utf-8").encode("utf-8"))
            return
        return self._json(404, {"error": "路径不存在"})

    def do_POST(self):
        try:
            self._do_post()
        except Exception as e:
            print(f"  ⚠️ POST 错误 {self.path}: {e}")
            self._json(500, {"error": f"服务器内部错误: {e}"})

    def _do_post(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path
        body = self._read_body()
        if isinstance(body, dict) and "__error__" in body:
            return self._json(400, {"error": body["__error__"]})

        if path == "/api/css":
            vars_ = body.get("vars", {})
            if not isinstance(vars_, dict):
                return self._json(400, {"error": "vars 必须是对象"})
            # 过滤白名单
            filtered = {k: v for k, v in vars_.items() if k in CSS_VAR_WHITELIST}
            ok, msg = write_css_vars(filtered)
            return self._json(200 if ok else 500, {"message": msg})

        if path == "/api/wire-style":
            ok, msg = write_wire_style(body)
            return self._json(200 if ok else 500, {"message": msg})

        if path == "/api/components":
            return self._write_js_section(COMPONENTS_FILE, "defs", body)

        if path == "/api/products":
            return self._write_js_section(PRODUCTS_FILE, "products", body)

        if path == "/api/templates":
            return self._write_js_section(TEMPLATES_FILE, "list", body)

        if path == "/api/upload-image":
            return self._upload_image(body)

        if path == "/api/save-file":
            return self._save_file(body)

        if path == "/api/deploy":
            return self._deploy()

        return self._json(404, {"error": "API 不存在"})

    def _save_file(self, body):
        """保存任意源文件（高级代码编辑用）"""
        rel_path = body.get("file", "").strip()
        text = body.get("text", "")
        # 安全：只能保存白名单内路径
        allowed = [
            "数据/元件库.js", "数据/产品库.js", "数据/模板库.js", "数据/布线样式.js",
            "样式/样式.css",
            "脚本/配置.js", "脚本/状态.js", "脚本/工具.js", "脚本/界面.js",
            "脚本/历史.js", "脚本/存储.js", "脚本/音频.js",
        ]
        if rel_path not in allowed:
            return self._json(403, {"error": f"禁止修改该文件: {rel_path}"})
        target = ROOT / rel_path
        if not target.exists():
            return self._json(404, {"error": "文件不存在"})
        # 备份
        bak = target.with_suffix(target.suffix + ".bak")
        try:
            bak.write_bytes(target.read_bytes())
        except Exception:
            pass
        target.write_text(text, encoding="utf-8")
        return self._json(200, {"message": f"{rel_path} 已保存（备份: {bak.name}）"})

    def _deploy(self):
        """一键部署到 GitHub Pages"""
        import time as _time
        steps = []

        # 1. 检查 git
        ok = True
        try:
            r = subprocess.run(
                ["git", "--version"],
                cwd=str(ROOT), capture_output=True, encoding="utf-8", errors="replace", timeout=5
            )
            ok = r.returncode == 0
        except Exception:
            ok = False
        if not ok:
            return self._json(500, {"error": "未安装 Git", "steps": steps})

        # 2. git add
        try:
            r = subprocess.run(
                ["git", "add", "-A"],
                cwd=str(ROOT), capture_output=True, encoding="utf-8", errors="replace", timeout=10
            )
            steps.append(f"git add: {'OK' if r.returncode == 0 else 'FAIL'}")
        except Exception as e:
            steps.append(f"git add 异常: {e}")
            return self._json(500, {"error": f"git add 失败", "steps": steps})

        # 3. 检查是否有变更
        try:
            r = subprocess.run(
                ["git", "status", "--short"],
                cwd=str(ROOT), capture_output=True, encoding="utf-8", errors="replace", timeout=5
            )
            if not r.stdout.strip():
                return self._json(200, {"message": "没有检测到变更", "steps": steps, "pushed": False})
        except Exception as e:
            return self._json(500, {"error": f"git status 失败", "steps": steps})

        # 4. git commit
        commit_msg = f"Update: {_time.strftime('%Y-%m-%d %H:%M')}"
        try:
            r = subprocess.run(
                ["git", "commit", "-m", commit_msg],
                cwd=str(ROOT), capture_output=True, encoding="utf-8", errors="replace", timeout=10
            )
            ok_commit = r.returncode == 0 or "nothing to commit" in r.stdout + r.stderr
            steps.append(f"git commit: {'OK' if ok_commit else 'FAIL'}")
            if not ok_commit and r.returncode != 0:
                return self._json(500, {"error": f"提交失败: {r.stderr[:200]}", "steps": steps})
        except Exception as e:
            steps.append(f"git commit 异常: {e}")
            return self._json(500, {"error": f"git commit 失败", "steps": steps})

        # 5. git push
        try:
            r = subprocess.run(
                ["git", "push"],
                cwd=str(ROOT), capture_output=True, encoding="utf-8", errors="replace", timeout=60
            )
            if r.returncode == 0:
                steps.append("git push: OK")
                return self._json(200, {
                    "message": "部署成功！1-2 分钟后生效",
                    "url": "https://xiao0xueai.github.io/elecsim/",
                    "steps": steps,
                    "pushed": True
                })
            else:
                steps.append(f"git push: FAIL")
                err = r.stderr[:300] if r.stderr else r.stdout[:300]
                return self._json(500, {"error": f"推送失败: {err}", "steps": steps})
        except subprocess.TimeoutExpired:
            return self._json(500, {"error": "推送超时（网络慢或 GitHub 不可达）", "steps": steps})
        except Exception as e:
            steps.append(f"git push 异常: {e}")
            return self._json(500, {"error": f"推送异常: {e}", "steps": steps})

    # ----------------- helpers -----------------
    def _serve_file(self, file_path):
        """直接提供静态文件（不经过 SimpleHTTPRequestHandler）"""
        ext = file_path.suffix.lower()
        mime_map = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
        }
        mime = mime_map.get(ext, "application/octet-stream")
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _safe_read_section(self, file_path, marker):
        if not file_path.exists():
            print(f"  [DEBUG] 文件不存在: {file_path}")
            return None
        try:
            text = file_path.read_text(encoding="utf-8")
            print(f"  [DEBUG] 成功读取 {file_path.name}: {len(text)} 字符")
        except Exception as e:
            print(f"  [DEBUG] 读取失败 {file_path.name}: {e}")
            return None
        arr_text, err = extract_js_obj_array(text, marker)
        if arr_text is None:
            print(f"  [DEBUG] 提取标记 '{marker}' 失败: {err}")
            return None  # 返回 None 让上层知道失败了，而非伪造一个注释字符串
        print(f"  [DEBUG] 提取 '{marker}': {len(arr_text)} 字符")
        return arr_text

    def _read_js_section(self, file_path, marker):
        arr = self._safe_read_section(file_path, marker)
        if arr is None:
            return self._json(404, {"error": f"文件不存在: {file_path.name}"})
        # 返回数组源码
        return self._json(200, {"text": arr, "marker": marker})

    def _write_js_section(self, file_path, marker, body):
        # 接受两种输入：
        #   1. body.array 是 JSON 数组（前端修改后发回）→ 自动转 JS 源码
        #   2. body.text 是 JS 源码字符串（高级用户）→ 直接用
        if "array" in body:
            arr = body["array"]
            if not isinstance(arr, list):
                return self._json(400, {"error": "array 必须是数组"})
            formatted, err = json_to_js_text(arr)
            if err:
                return self._json(500, {"error": err})
        elif "text" in body:
            formatted = body["text"]
            if not isinstance(formatted, str):
                return self._json(400, {"error": "text 必须是字符串"})
        else:
            return self._json(400, {"error": "需要 array 或 text 字段"})

        if not file_path.exists():
            return self._json(404, {"error": "文件不存在"})

        # 读取原文件
        text = file_path.read_text(encoding="utf-8")
        pattern = re.escape(marker) + r"\s*:\s*\["
        m = re.search(pattern, text)
        if not m:
            return self._json(404, {"error": "未找到标记 " + marker})
        start = m.end()
        depth = 1
        i = start
        while i < len(text) and depth > 0:
            c = text[i]
            if c == "[": depth += 1
            elif c == "]": depth -= 1
            i += 1
        # 在 formatted 前后加缩进
        new_body = "\n  " + formatted.replace("\n", "\n  ") + ",\n  "
        new_text = text[:start] + new_body + text[i-1:]

        # 1) 先备份（复制原文件）
        bak = file_path.with_suffix(file_path.suffix + ".bak")
        try:
            import shutil as _shutil
            _shutil.copy2(file_path, bak)
        except Exception:
            pass  # 备份失败不阻止保存

        # 2) 原子写入：先写临时文件，验证通过再重命名
        tmp_path = file_path.with_suffix(file_path.suffix + ".tmp")
        try:
            tmp_path.write_text(new_text, encoding="utf-8")

            # 3) 用 Node.js 验证语法（如果有 Node）
            if NODE_BIN:
                result = subprocess.run(
                    [NODE_BIN, "--check", str(tmp_path)],
                    capture_output=True, encoding="utf-8", errors="replace", timeout=10
                )
                if result.returncode != 0:
                    err_detail = result.stderr.strip()[:300] if result.stderr else "未知语法错误"
                    try: tmp_path.unlink()
                    except: pass
                    return self._json(500, {
                        "error": f"生成的 JS 有语法错误，文件未修改（已备份到 {bak.name}）",
                        "detail": err_detail
                    })

            # 4) 验证通过，原子替换
            tmp_path.replace(file_path)
            return self._json(200, {"message": f"{file_path.name} 已更新（备份 {bak.name}）"})

        except subprocess.TimeoutExpired:
            try: tmp_path.unlink()
            except: pass
            return self._json(500, {"error": "Node.js 语法检查超时"})
        except Exception as e:
            # 写入/验证失败，清理临时文件
            try: tmp_path.unlink()
            except: pass
            return self._json(500, {"error": f"保存失败: {e}"})

    def _list_images(self):
        if not IMAGES_DIR.is_dir():
            return self._json(200, {"images": []})
        imgs = []
        for f in sorted(IMAGES_DIR.iterdir()):
            if f.suffix.lower() in (".webp",".png",".jpg",".jpeg",".svg",".gif"):
                imgs.append({
                    "name": f.name,
                    "size": f.stat().st_size,
                    "url": "/images/" + f.name,
                })
        return self._json(200, {"images": imgs})

    def _upload_image(self, body):
        # body: { filename: "...", data: "data:image/png;base64,..." }
        import base64
        filename = body.get("filename", "").strip()
        data_url = body.get("data", "")
        if not filename or not data_url:
            return self._json(400, {"error": "缺少 filename 或 data"})
        # 安全文件名
        filename = re.sub(r"[^a-zA-Z0-9_.\-\u4e00-\u9fff]", "_", filename)
        if "," in data_url:
            data_url = data_url.split(",", 1)[1]
        try:
            data = base64.b64decode(data_url)
        except Exception as e:
            return self._json(400, {"error": f"base64 解码失败: {e}"})
        out = IMAGES_DIR / filename
        out.write_bytes(data)
        return self._json(200, {"message": "已上传", "url": "/images/" + filename})

def run(port=8766):
    # Windows UTF-8 兼容：用 reconfigure 而非包裹 TextIOWrapper（避免重复包裹）
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
        os.environ.setdefault("PYTHONIOENCODING", "utf-8")

    # 切换工作目录到 ROOT，让 SimpleHTTPRequestHandler 能服务文件
    os.chdir(ROOT)
    # 改造 handler 的根目录
    handler = Handler
    server = http.server.HTTPServer(("127.0.0.1", port), handler)
    print(f"")
    print(f"  ElecSim 可视化编辑器已启动")
    print(f"  ─────────────────────────────")
    print(f"  浏览器打开: http://localhost:{port}/")
    print(f"  按 Ctrl+C 停止")
    print(f"")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")

if __name__ == "__main__":
    port = 8766
    if len(sys.argv) > 1:
        try: port = int(sys.argv[1])
        except: pass
    run(port)
