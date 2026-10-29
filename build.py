#!/usr/bin/env python3
"""Assemble src/ into one page.

    python3 build.py              -> ./site.html (the Claude artifact), ./index.html and ./404.html (any static host),
                                     plus ./_headers (Cloudflare Pages: caching and security headers)
    python3 build.py --out DIR    -> the same files in DIR (for test builds)
    --no-minify                   -> keep the inline JS and CSS as written (readable; production builds minify them with
                                     esbuild, fetched through npx: needs Node and, the first time, the network)
    --dev                         -> --no-minify, and also include src/stubs.js, which stands in for missing modules (never shipped)
"""
import base64
import hashlib
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

root = pathlib.Path(__file__).resolve().parent
src = root / 'src'
out = pathlib.Path(sys.argv[sys.argv.index('--out') + 1]) if '--out' in sys.argv else root
out.mkdir(parents=True, exist_ok=True)
dev = '--dev' in sys.argv
minify = not dev and '--no-minify' not in sys.argv
ESBUILD = 'esbuild@0.24.2'   # pinned: the minified output only changes when this does
ORDER = ['content.js', 'keysamples.js', 'sound.js', 'scene.js', 'room.js', 'typist.js', 'terminal.js', 'apps.js', 'extras.js', 'editor.js', 'reader.js', 'stubs.js', 'main.js']
scripts = ''.join(f'<script>\n{(src / n).read_text(encoding="utf-8")}\n</script>\n' for n in ORDER if (src / n).exists() and (dev or n != 'stubs.js'))
body = (src / 'head.html').read_text(encoding='utf-8') + '\n' + scripts

BLOCK = re.compile(r'<(script|style)>(.*?)</\1>', re.S)   # inline blocks only (<script src> has attributes)


def minified(html):
    """Every inline <script> and <style> through esbuild in one run: comments and whitespace out, local names
    shortened, no syntax lowered (es2020 is already what the source is written in). Licence headers are kept."""
    blocks = list(BLOCK.finditer(html))
    with tempfile.TemporaryDirectory() as tmp:
        t = pathlib.Path(tmp)
        names = []
        for i, m in enumerate(blocks):
            n = f'b{i}.' + ('js' if m.group(1) == 'script' else 'css')
            (t / 'in' / n).parent.mkdir(exist_ok=True)
            (t / 'in' / n).write_text(m.group(2), encoding='utf-8')
            names.append(n)
        npx = shutil.which('npx')
        if not npx:
            raise RuntimeError('npx not found')
        subprocess.run([npx, '--yes', ESBUILD, *[f'in/{n}' for n in names], '--minify', '--target=es2020,chrome90,safari14,firefox90',
                        '--charset=utf8', '--legal-comments=none', '--log-level=warning', '--outdir=out'],
                       cwd=t, check=True)
        res = [(t / 'out' / n).read_text(encoding='utf-8').strip() for n in names]
    parts, last = [], 0
    for m, code in zip(blocks, res):
        lic = re.match(r'\s*(/\*.*?\*/)', m.group(2), re.S)   # an MIT notice must travel with the code it covers
        if lic and 'Permission is hereby granted' in lic.group(1):
            code = lic.group(1) + '\n' + code
        if m.group(1) == 'script' and re.search(r'</script', code, re.I):
            raise RuntimeError('minified script would close its own tag')
        parts += [html[last:m.start()], f'<{m.group(1)}>{code}</{m.group(1)}>']
        last = m.end()
    return ''.join(parts) + html[last:]


if minify:
    try:
        body = minified(body)
    except Exception as e:   # never block a build on the minifier: ship it readable, and say so loudly
        print(f'WARNING: not minified ({e}); building readable output', file=sys.stderr)
        minify = False

(out / 'site.html').write_text(body, encoding='utf-8')
cut = body.index('</style>') + len('</style>')
page = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        + body[:cut] + '\n</head>\n<body>\n' + body[cut:].lstrip('\n') + '</body>\n</html>\n')
(out / 'index.html').write_text(page, encoding='utf-8')
ICON = next((l for l in (src / 'head.html').read_text(encoding='utf-8').splitlines() if 'rel="icon"' in l), '')   # same favicon as the site
# a real 404 (its presence also stops Cloudflare Pages answering unknown paths with the whole site)
(out / '404.html').write_text(
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Not found · Kaiav Nihalani</title>\n'
    + ICON + '\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&display=swap">\n'
    '<style>html{ color-scheme: dark; background: #07080a; color: #c8f5b8; font: 15px/1.5 "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace }'
    ' body{ margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 0 16px; box-sizing: border-box }'
    ' a{ color: #8dffb4 } span{ color: #6b9061 }</style>\n</head>\n<body>\n'
    '<p><span>$</span> cd here: no such file or directory. <a href="/">go home</a></p>\n</body>\n</html>\n', encoding='utf-8')

# Cloudflare Pages headers. Nothing is content-hashed (the site is one file), so the page is cached briefly and
# revalidated in the background. The CSP allows exactly the inline scripts of this build (by hash), three.js from
# jsdelivr, Cloudflare's own analytics beacon (injected when Web Analytics is on), Google Fonts, and any https
# fetch (curl, weather, hn, wiki, define).
def csp_hashes(html):
    return ' '.join(sorted({"'sha256-" + base64.b64encode(hashlib.sha256(m.group(2).encode('utf-8')).digest()).decode() + "'"
                            for m in BLOCK.finditer(html) if m.group(1) == 'script'}))


CSP = '; '.join([
    "default-src 'self'",
    f"script-src 'self' {csp_hashes(page)} https://cdn.jsdelivr.net https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    "connect-src 'self' https: data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
])
(out / '_headers').write_text(f"""# Cloudflare Pages response headers (written by build.py; do not edit by hand)
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Content-Security-Policy: {CSP}
  Cache-Control: public, max-age=300, stale-while-revalidate=86400
""", encoding='utf-8')
print(f'built {out}/site.html ({len(body) // 1024} KB){" with stubs" if dev else ""}{" minified" if minify else ""}')
