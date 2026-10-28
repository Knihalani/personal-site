#!/usr/bin/env python3
"""Wrap site.html (the page body, also published as-is as a Claude artifact) into a full index.html.

    python3 build.py
"""
import pathlib

root = pathlib.Path(__file__).resolve().parent
body = (root / 'site.html').read_text(encoding='utf-8')
head_end = body.index('</style>') + len('</style>')
page = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        + body[:head_end] + '\n</head>\n<body>\n' + body[head_end:].lstrip('\n') + '\n</body>\n</html>\n')
(root / 'index.html').write_text(page, encoding='utf-8')
print('wrote index.html')
