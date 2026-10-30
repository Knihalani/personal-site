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
DESK = ['scene.js', 'room.js', 'typist.js']   # the 3D room: shipped inert, run only on desktops (main.js), so phones never parse it
def block(n):
    if n == DESK[0]: return '<script>\n' + ';\n'.join((src / d).read_text(encoding='utf-8') for d in DESK) + '\n</script>\n'
    if n in DESK: return ''
    return f'<script>\n{(src / n).read_text(encoding="utf-8")}\n</script>\n'
scripts = ''.join(block(n) for n in ORDER if (src / n).exists() and (dev or n != 'stubs.js'))

# ---- SEO / AEO: everything a crawler, a link preview or an answer engine reads, generated from content.js ----
SITE = 'https://kaiav.dev'   # the custom domain (Cloudflare Pages project kaiav); kaiav.pages.dev redirects here
import json, html as H, datetime
def _content():
    js = ("const vm=require('vm'),fs=require('fs');const c={};c.window=c;"
          "vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),c);process.stdout.write(JSON.stringify(c.MAC.CONTENT))")
    return json.loads(subprocess.run(['node', '-e', js, str(src / 'content.js')], capture_output=True, text=True, check=True).stdout)
C = _content()
NAME, ROLE, LK = C['name'], C['about']['role'], C['links']
J, E = C['j'], C['eden']
BULLETS = [l[2:].strip() for b in C['about']['body'] for l in b.split('\n') if l.startswith('- ')]
DESC = f"{NAME}, co-founder of {J['title']} ({J['line']}) and founder of {E['title']} ({E['line'].lower()})."
SAME = [LK[k] for k in ('linkedin', 'x', 'github') if LK.get(k)]
e = lambda t: H.escape(str(t), quote=True)
ld = {'@context': 'https://schema.org', '@graph': [
    {'@type': 'ProfilePage', '@id': SITE + '/#page', 'url': SITE + '/', 'name': NAME, 'description': DESC,
     'mainEntity': {'@id': SITE + '/#person'}, 'image': SITE + '/og.png', 'inLanguage': 'en'},
    {'@type': 'Person', '@id': SITE + '/#person', 'name': NAME, 'url': SITE + '/', 'image': SITE + '/og.png',
     'description': DESC, 'jobTitle': ROLE, 'sameAs': SAME,
     'email': ['mailto:' + c['email'] for c in C['contact']],
     'worksFor': [{'@type': 'Organization', 'name': J['title'], 'url': J['url'], 'description': J['line']},
                  {'@type': 'Organization', 'name': E['title'], 'description': E['line']}],
     'knowsAbout': ['AI agents', 'Large language models', 'Startups'],
     'birthPlace': {'@type': 'Place', 'name': 'Hong Kong'} if any('Hong Kong' in b for b in BULLETS) else None},
    {'@type': 'WebSite', '@id': SITE + '/#site', 'url': SITE + '/', 'name': NAME, 'publisher': {'@id': SITE + '/#person'}}]}
for n in ld['@graph']:
    for k in [k for k, v in n.items() if v is None]: del n[k]
X = '@' + LK['x'].rstrip('/').rsplit('/', 1)[-1] if LK.get('x') else ''
SEO = '\n'.join([
    f'<meta name="description" content="{e(DESC)}">',
    f'<link rel="canonical" href="{SITE}/">',
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    f'<meta name="author" content="{e(NAME)}">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">',
    '<link rel="manifest" href="/site.webmanifest">',
    '<meta property="og:type" content="profile">',
    f'<meta property="og:site_name" content="{e(NAME)}">',
    f'<meta property="og:title" content="{e(NAME)}">',
    f'<meta property="og:description" content="{e(ROLE)}">',
    f'<meta property="og:url" content="{SITE}/">',
    f'<meta property="og:image" content="{SITE}/og.png">',
    '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
    f'<meta property="og:image:alt" content="{e(NAME + " · " + ROLE)}, on a green terminal screen">',
    '<meta property="og:locale" content="en_US">',
    f'<meta property="profile:first_name" content="{e(NAME.split()[0])}">',
    f'<meta property="profile:last_name" content="{e(NAME.split()[-1])}">',
    '<meta name="twitter:card" content="summary_large_image">',
    f'<meta name="twitter:title" content="{e(NAME)}">',
    f'<meta name="twitter:description" content="{e(ROLE)}">',
    f'<meta name="twitter:image" content="{SITE}/og.png">',
    f'<meta name="twitter:image:alt" content="{e(NAME + " · " + ROLE)}">',
] + ([f'<meta name="twitter:site" content="{e(X)}">', f'<meta name="twitter:creator" content="{e(X)}">'] if X else [])
  + ['<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False).replace('</', '<\\/') + '</script>'])
# the same facts as real text (headings, lists, links) for crawlers, answer engines and screen readers
PROFILE = '\n'.join([
    f'  <h1>{e(NAME)}</h1>', f'  <p>{e(ROLE)}</p>',
    '  <h2>About</h2>', '  <ul>' + ''.join(f'<li>{e(b)}</li>' for b in BULLETS) + '</ul>',
    f'  <h2>{e(J["title"])}</h2>', f'  <p>{e(J["role"])}. {e(J["line"])}.</p>'] +
    [f'  <p>{e(p)}</p>' for p in J['body'].split('\n\n')] +
    ['  <ul>' + ''.join(f'<li>{e(k)}: {e(v)}</li>' for k, v in J.get('facts', [])) + '</ul>',
     f'  <p><a tabindex="-1" href="{e(J["url"])}">{e(J["url"].split("//")[-1])}</a></p>',
     f'  <h2>{e(E["title"])}</h2>', f'  <p>{e(E["role"])}. {e(E["line"])}.</p>', f'  <p>{e(E["body"])}</p>',
     '  <h2>Contact</h2>', '  <ul>' + ''.join(f'<li>{e(c["label"])}: <a tabindex="-1" href="mailto:{e(c["email"])}">{e(c["email"])}</a></li>' for c in C['contact']) + '</ul>',
     '  <h2>Links</h2>', '  <ul>' + ''.join(f'<li><a tabindex="-1" rel="me" href="{e(u)}">{e(n)}</a></li>' for n, u in (('LinkedIn', LK.get('linkedin')), ('X', LK.get('x')), ('GitHub', LK.get('github'))) if u) + '</ul>'])
head = (src / 'head.html').read_text(encoding='utf-8').replace('<!--SEO-->', SEO).replace('<!--PROFILE-->', PROFILE)
body = head + '\n' + scripts

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

# the desk block becomes inert text (type="text/plain"): main.js copies it into a live <script> on desktops only
_desk = [m for m in BLOCK.finditer(body) if m.group(1) == 'script' and 'loadScene' in m.group(2) and 'createTypist' in m.group(2) and 'desk3d' not in m.group(2)]   # (main.js names both too)
if len(_desk) != 1: raise SystemExit('build: could not find the 3D room block')
DESK_CODE = _desk[0].group(2)
body = body[:_desk[0].start()] + '<script type="text/plain" id="desk3d">' + DESK_CODE + '</script>' + body[_desk[0].end():]
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
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n<title>Not found · Kaiav Nihalani</title>\n'
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
                            for m in BLOCK.finditer(html) if m.group(1) == 'script'} |
                           {"'sha256-" + base64.b64encode(hashlib.sha256(DESK_CODE.encode('utf-8')).digest()).decode() + "'"}))   # the desk block, run as a copy


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
WEB = out != root   # the repo-root build (index.html, site.html) skips the deploy-only files
for f in (root / 'static').glob('*') if WEB else []: shutil.copyfile(f, out / f.name)
today = datetime.date.today().isoformat()
WEB and (out / 'robots.txt').write_text(f'User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n', encoding='utf-8')
WEB and (out / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    f'  <url><loc>{SITE}/</loc><lastmod>{today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n', encoding='utf-8')
WEB and (out / 'site.webmanifest').write_text(json.dumps({'name': NAME, 'short_name': NAME.split()[0], 'start_url': '/', 'display': 'standalone',
    'background_color': '#0a0f0a', 'theme_color': '#0a0f0a',
    'icons': [{'src': '/icon-512.png', 'sizes': '512x512', 'type': 'image/png'}, {'src': '/apple-touch-icon.png', 'sizes': '180x180', 'type': 'image/png'}]}, indent=1), encoding='utf-8')
# llms.txt: a plain summary for answer engines and agents (https://llmstxt.org)
WEB and (out / 'llms.txt').write_text('\n'.join([f'# {NAME}', '', f'> {DESC}', '', '## About', *[f'- {b}' for b in BULLETS], '',
    f'## {J["title"]}', f'{J["role"]}. {J["line"]}.', '', J['body'], '', *[f'- {k}: {v}' for k, v in J.get('facts', [])], f'- site: {J["url"]}', '',
    f'## {E["title"]}', f'{E["role"]}. {E["line"]}.', '', E['body'], '',
    '## Contact', *[f'- {c["label"]}: {c["email"]}' for c in C['contact']], '',
    '## Links', *[f'- [{n}]({u})' for n, u in (('LinkedIn', LK.get('linkedin')), ('X', LK.get('x')), ('GitHub', LK.get('github'))) if u],
    '', '## Note', f'{SITE} is an interactive terminal on a 1980s computer: type help to explore.', '']), encoding='utf-8')
(out / '_headers').write_text(f"""# Cloudflare Pages response headers (written by build.py; do not edit by hand)
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Content-Security-Policy: {CSP}
  Cache-Control: public, max-age=300, stale-while-revalidate=86400
""", encoding='utf-8')
print(f'built {out}/site.html ({len(body) // 1024} KB){" with stubs" if dev else ""}{" minified" if minify else ""}')
