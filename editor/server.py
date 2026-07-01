#!/usr/bin/env python3
"""
ElecSim Editor Server
本地开发服务器 — 支持读取、保存、部署 index.html
"""
import http.server
import json
import os
import subprocess
import sys

PORT = 8765
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_PATH = os.path.join(ROOT_DIR, 'index.html')


class EditorHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/file':
            self._handle_get_file()
        elif self.path == '/api/status':
            self._handle_get_status()
        else:
            super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length else b''

        if self.path == '/api/save':
            self._handle_save(body)
        elif self.path == '/api/deploy':
            self._handle_deploy()
        else:
            self.send_response(404)
            self.end_headers()

    def _json(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def _handle_get_file(self):
        try:
            if not os.path.exists(INDEX_PATH):
                self._json(404, {'error': 'index.html not found'})
                return
            with open(INDEX_PATH, 'r', encoding='utf-8') as f:
                content = f.read()
            self._json(200, {
                'content': content,
                'size': len(content),
                'lines': content.count('\n') + 1,
                'path': INDEX_PATH,
            })
        except Exception as e:
            self._json(500, {'error': str(e)})

    def _handle_get_status(self):
        try:
            result = subprocess.run(
                ['git', 'status', '--short'],
                cwd=ROOT_DIR,
                capture_output=True,
                text=True,
                timeout=10
            )
            log = subprocess.run(
                ['git', 'log', '--oneline', '-3'],
                cwd=ROOT_DIR,
                capture_output=True,
                text=True,
                timeout=10
            )
            self._json(200, {
                'dirty': bool(result.stdout.strip()),
                'changes': result.stdout.strip(),
                'recent': log.stdout.strip(),
            })
        except Exception as e:
            self._json(500, {'error': str(e)})

    def _handle_save(self, body):
        try:
            content = body.decode('utf-8')
            # 备份旧文件
            if os.path.exists(INDEX_PATH):
                backup = INDEX_PATH + '.backup'
                with open(INDEX_PATH, 'r', encoding='utf-8') as f:
                    old = f.read()
                with open(backup, 'w', encoding='utf-8') as f:
                    f.write(old)
            # 写新文件
            with open(INDEX_PATH, 'w', encoding='utf-8') as f:
                f.write(content)
            self._json(200, {
                'ok': True,
                'size': len(content),
                'lines': content.count('\n') + 1,
                'backup': os.path.exists(INDEX_PATH + '.backup'),
            })
        except Exception as e:
            self._json(500, {'error': str(e)})

    def _handle_deploy(self):
        try:
            results = {}
            # git add
            r = subprocess.run(
                ['git', 'add', 'index.html'],
                cwd=ROOT_DIR, capture_output=True, text=True, timeout=10
            )
            results['add'] = r.stdout + r.stderr

            # git commit
            r = subprocess.run(
                ['git', 'commit', '-m', 'Update from Editor'],
                cwd=ROOT_DIR, capture_output=True, text=True, timeout=10
            )
            results['commit'] = r.stdout + r.stderr

            # git push
            r = subprocess.run(
                ['git', 'push'],
                cwd=ROOT_DIR, capture_output=True, text=True, timeout=30
            )
            results['push'] = r.stdout + r.stderr

            ok = r.returncode == 0
            self._json(200, {'ok': ok, 'details': results})
        except Exception as e:
            self._json(500, {'error': str(e)})

    def log_message(self, format, *args):
        # 简洁日志
        if '/api/' in str(args[0]):
            print(f'  [{self.command}] {args[0]}')
        else:
            pass  # 跳过静态文件日志


if __name__ == '__main__':
    server = http.server.HTTPServer(('127.0.0.1', PORT), EditorHandler)
    print('=' * 60)
    print('  ElecSim 代码编辑器已启动')
    print(f'  打开浏览器访问: http://localhost:{PORT}/editor/editor.html')
    print(f'  项目目录: {ROOT_DIR}')
    print('  Ctrl+C 停止服务')
    print('=' * 60)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止。')
        server.shutdown()
