#!/usr/bin/env python3
"""
ElecSim 一键部署脚本
自动提交并推送到 GitHub Pages，1-2 分钟后网站更新。
"""

import subprocess
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
URL = "https://xiao0xueai.github.io/elecsim/"


def run(cmd, timeout=30):
    """运行命令，返回 (成功, 输出)"""
    try:
        r = subprocess.run(
            cmd, cwd=str(PROJECT_DIR),
            capture_output=True, text=True, timeout=timeout
        )
        return r.returncode == 0, (r.stdout + r.stderr).strip()
    except Exception as e:
        return False, str(e)


def main():
    print("=" * 50)
    print("  ElecSim 一键部署")
    print("=" * 50)

    # 1. 检查 Git
    ok, out = run(["git", "--version"])
    if not ok:
        print("❌ 未安装 Git，请先安装 Git")
        return 1
    print(f"✅ Git 可用")

    # 2. 检查仓库
    ok, _ = run(["git", "status"])
    if not ok:
        print("❌ 当前目录不是 Git 仓库")
        return 1

    # 3. 显示变更
    print("\n📋 检查变更...")
    ok, changes = run(["git", "status", "--short"])
    if not changes:
        print("⚠️  没有检测到变更，跳过部署")
        return 0
    print("待提交的文件:")
    for line in changes.split("\n"):
        if line.strip():
            print(f"  {line}")

    # 4. 询问确认
    print(f"\n部署地址: {URL}")
    resp = input("确认部署？(y/n): ").strip().lower()
    if resp not in ("y", "yes"):
        print("❌ 已取消")
        return 0

    # 5. git add
    print("\n📦 添加文件...")
    ok, out = run(["git", "add", "-A"])
    if not ok:
        print(f"❌ git add 失败: {out}")
        return 1
    print("✅ 文件已暂存")

    # 6. git commit
    print("💾 提交...")
    from datetime import datetime
    msg = f"Update: {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    ok, out = run(["git", "commit", "-m", msg])
    if not ok:
        if "nothing to commit" in out:
            print("⚠️  没有需要提交的内容")
            return 0
        print(f"❌ 提交失败: {out}")
        return 1
    print(f"✅ 已提交: {msg}")

    # 7. git push
    print("🚀 推送中...")
    ok, out = run(["git", "push"], timeout=60)
    if not ok:
        print(f"❌ 推送失败: {out}")
        print("可能原因: 网络问题或未配置 GitHub 权限")
        return 1
    print("✅ 推送成功!")
    print(f"\n🎉 部署完成！1-2 分钟后访问:")
    print(f"  {URL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
