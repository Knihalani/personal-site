# kaiav.sh

The personal site of **Kaiav Nihalani**, co-founder of [J](https://risingfounder.net) and founder of
Eden (context for agents).

It is a room at night. A beige 1980s computer sits on a desk under a lamp, and its green phosphor
screen is a working terminal. When you type, the hands on the desk type the same keys on the 3D
keyboard, and you hear a real Topre switch for every press and release. Each visit opens on an 80s
demoscene-style intro on the screen (a chrome 3D "KN", copper bars, a sine scroller), until the first command.

## Using it

| | |
|---|---|
| **type** | everything goes to the terminal. Start with `help`, or click a highlighted word |
| **move the cursor** | look around. Move it down to lean back and see the whole desk and the hands |
| **scroll** | scroll back through the terminal (also Page Up / Page Down, or Space when the prompt is empty) |
| **phones** | just the terminal, full screen. Tap to type, drag to scroll, tap an email to copy it |

Without WebGL the desktop gets the same terminal-only page. Deep links run a page on load:
`#about`, `#j`, `#eden`, `#writing`, `#contact`, `#links`, `#help`, and `#post/<slug>` opens a post.

## What's in the terminal

- **About Kaiav:** `about`, `j`, `eden`, `writing` (posts open in a typeset reader), `contact`
  (copies an address), `links`, `linkedin`, `x`, `gh`, `open <name|url>`, `neofetch`
- **Do something:** `edit` (a nano-style editor), `todo`, `weather [city]` (where you are, by default), `timer`, `clock`, `qr`, `pass` and an
  encrypted `vault` (kept only in your browser), `cal`, `bc`, `convert`, `roll`, `countdown`
- **The network** (live site only; the claude.ai preview blocks it): `curl`, `hn`, `wiki`, `define`
- **Play:** `tetris`, `snake` (tap controls on phones), `breakout`, `typing` (a WPM test), `lamp`
- **A real little shell:** pipes, `>` `>>` `<` redirection, `&&` `||` `;`, globs, `$VAR`, aliases,
  history (`!!`, `!n`, ctrl+r), Tab completion, "did you mean", plain phrases like "who are you".
  Also `ls` `cd` `cat` `grep` `sort` `wc` `head` `tail` `tree` `cp` `mv` `rm` `mkdir` `touch` `man`,
  on a filesystem saved in your browser (built-in files are read-only)

`help` shows the essentials, `help all` lists everything, and `man <command>` explains any command.

## How it's built

There's no framework and no build tooling beyond one Python script. [three.js](https://threejs.org)
r147 is loaded from a CDN, and everything else is hand-written and procedural: models, textures and
lighting.

```
src/
  head.html      page shell, fonts, styles, overlay UI
  content.js     all copy about Kaiav (MAC.CONTENT)
  keysamples.js  the key recordings, one small embedded MP3 sprite
  sound.js       Web Audio: key playback with per-key variation, terminal beeps and disk sounds
  scene.js       the room, computer, CRT shader, keyboard, lamp and camera
  room.js        set dressing: shelf, books, cork board, prints, curtains, radio clock
  typist.js      the hands: arm and finger IK, strike timing synced to key travel and sound
  terminal.js    the shell, the virtual filesystem and the canvas renderer the CRT displays
  apps.js        full-screen apps: tetris, snake, breakout, lamp
  extras.js      weather, todo, timer, clock, typing test, qr, pass/vault, the network commands and small tools
  editor.js      edit / nano / vi / vim
  reader.js      the typeset post reader
  main.js        input routing, the terminal-only layout (phones, no WebGL), fallbacks, the loop
  CONTRACT.md    how the modules talk to each other, and the terminal extension API
build.py         concatenates src/ into index.html, 404.html and site.html (an embeddable fragment), minified, plus _headers
functions/
  api/where.js   a Cloudflare Pages Function: the visitor's rough location (from Cloudflare), for weather
tools/
  copy-desk.html the private Copy Desk (all site copy and posts, with a TipTap editor), published as a claude.ai artifact
```

```sh
python3 build.py            # writes index.html and site.html
python3 build.py --out dir  # build somewhere else
python3 build.py --dev      # include src/stubs.js, so modules can be tested on their own
```

To deploy to Cloudflare Pages, run `./deploy.sh`. It needs a token with *Cloudflare Pages: Edit* in `CLOUDFLARE_API_TOKEN`.

Open `index.html` in a browser. Phones, and browsers without WebGL, get the terminal on its own.

### Adding a command

```js
MAC.TERM.cmds.hello = {
  desc: 'say hello', usage: 'hello [name]',
  run(argv, io){ io.out('hello, ' + (argv[1] || 'world') + '\n', 'bright'); },
};
```

Full-screen apps register on `MAC.TERM.apps` with `start(api) -> { key, tick, render }`. See
`src/CONTRACT.md`.

## Credits

- Key sounds: Topre switch recordings from [kbsim](https://github.com/tplai/kbsim) by Thomas Lai, MIT
  licence (notice reproduced in `src/keysamples.js`)
- [three.js](https://github.com/mrdoob/three.js), MIT
- Fonts: [VT323](https://fonts.google.com/specimen/VT323), IBM Plex Mono and Caveat via Google Fonts (OFL)
- Weather data from [Open-Meteo](https://open-meteo.com)
