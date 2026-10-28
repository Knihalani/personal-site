#!/usr/bin/env python3
"""Assemble src/ into one page.

    python3 build.py              -> ./site.html (the Claude artifact), ./index.html and ./404.html (any static host)
    python3 build.py --out DIR    -> the same files in DIR (for test builds)
    --dev                         -> also include src/stubs.js, which stands in for missing modules (never shipped)
"""
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent
src = root / 'src'
out = pathlib.Path(sys.argv[sys.argv.index('--out') + 1]) if '--out' in sys.argv else root
out.mkdir(parents=True, exist_ok=True)
dev = '--dev' in sys.argv
ORDER = ['content.js', 'keysamples.js', 'sound.js', 'scene.js', 'room.js', 'typist.js', 'terminal.js', 'apps.js', 'extras.js', 'editor.js', 'reader.js', 'stubs.js', 'main.js']
scripts = ''.join(f'<script>\n{(src / n).read_text(encoding="utf-8")}\n</script>\n' for n in ORDER if (src / n).exists() and (dev or n != 'stubs.js'))
body = (src / 'head.html').read_text(encoding='utf-8') + '\n' + scripts
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
print(f'built {out}/site.html ({len(body) // 1024} KB){" with stubs" if dev else ""}')
