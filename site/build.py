#!/usr/bin/env python3
"""Build the published page: game + site copy + writings + contact-gate games.

    python3 site/build.py

Reads   content/copy.md            (## key sections)
        content/writings/*.md       (front matter + Markdown body; files starting with _ are skipped)
        site/kaiav-world.html       (the game)
        concepts/contact-gate/contact-gate.html
Writes  site/dist/kaiav-world.html

The content is embedded as JSON in <script type="application/json" id="kw-content">, which the game
reads at boot as window.KW_CONTENT. Markdown is rendered in the browser.
"""
import json
import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / 'site' / 'kaiav-world.html'
GATE = ROOT / 'concepts' / 'contact-gate' / 'contact-gate.html'
OUT = ROOT / 'site' / 'dist' / 'kaiav-world.html'
EMAIL = re.compile(r'[\w.+-]+@[\w-]+\.[\w.]+')


def read_copy(path):
    copy, key, buf = {}, None, []

    def flush():
        if key is not None:
            copy[key] = '\n'.join(buf).strip()

    for line in path.read_text(encoding='utf-8').splitlines():
        m = re.match(r'^##\s+([\w.]+)\s*$', line)
        if m:
            flush()
            key, buf = m.group(1), []
        elif key is not None and not line.startswith('>'):
            buf.append(line)
    flush()
    return copy


def read_writings(folder):
    posts = []
    for f in sorted(folder.glob('*.md')):
        if f.name.startswith('_') or f.name.lower() == 'readme.md':
            continue
        text = f.read_text(encoding='utf-8')
        meta, body = {}, text
        m = re.match(r'^---\s*\n(.*?)\n---\s*\n?(.*)$', text, re.S)
        if m:
            meta = yaml.safe_load(m.group(1)) or {}
            body = m.group(2)
        if meta.get('draft'):
            continue
        posts.append({
            'slug': re.sub(r'[^a-z0-9-]', '', f.stem.lower().replace(' ', '-')),
            'title': str(meta.get('title') or f.stem),
            'date': str(meta.get('date') or ''),
            'summary': str(meta.get('summary') or ''),
            'body': body.strip(),
        })
    posts.sort(key=lambda p: p['date'], reverse=True)
    return posts


def main():
    content = {
        'copy': read_copy(ROOT / 'content' / 'copy.md'),
        'writings': read_writings(ROOT / 'content' / 'writings'),
    }
    blob = json.dumps(content, ensure_ascii=False)
    if EMAIL.search(blob):
        sys.exit('Refusing to build: an email address appears in content/. Emails stay behind the contact games.')
    blob = blob.replace('</', '<\\/')  # never close the script tag early
    tag = '<script type="application/json" id="kw-content">' + blob + '</script>\n'

    game = GAME.read_text(encoding='utf-8')
    # place right after the <title> line so it exists before any game script runs
    i = game.index('</title>') + len('</title>')
    page = game[:i] + '\n' + tag + game[i:].lstrip('\n')
    page += GATE.read_text(encoding='utf-8')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding='utf-8')
    print(f"built {OUT.relative_to(ROOT)}: {len(content['copy'])} copy keys, "
          f"{len(content['writings'])} writings, {len(page) // 1024} KB")


if __name__ == '__main__':
    main()
