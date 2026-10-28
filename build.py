#!/usr/bin/env python3
"""Assemble src/ into one page.

    python3 build.py              -> ./site.html (the Claude artifact) and ./index.html (any static host)
    python3 build.py --out DIR    -> the same two files in DIR (for test builds)
"""
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent
src = root / 'src'
out = pathlib.Path(sys.argv[sys.argv.index('--out') + 1]) if '--out' in sys.argv else root
out.mkdir(parents=True, exist_ok=True)
ORDER = ['content.js', 'scene.js', 'typist.js', 'terminal.js', 'stubs.js', 'main.js']
scripts = ''.join(f'<script>\n{(src / n).read_text(encoding="utf-8")}\n</script>\n' for n in ORDER if (src / n).exists())
body = (src / 'head.html').read_text(encoding='utf-8') + '\n' + scripts
(out / 'site.html').write_text(body, encoding='utf-8')
cut = body.index('</style>') + len('</style>')
page = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        + body[:cut] + '\n</head>\n<body>\n' + body[cut:].lstrip('\n') + '</body>\n</html>\n')
(out / 'index.html').write_text(page, encoding='utf-8')
print(f'built {out}/site.html ({len(body) // 1024} KB)')
