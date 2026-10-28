# kaiav.sh

The personal site of **Kaiav Nihalani**, founder of Eden (context for agents) and co-founder of
[J](https://risingfounder.net).

It is a room at night. A beige 1980s computer sits on a desk under a lamp, and its green phosphor
screen is a working terminal. When you type, the hands on the desk type the same keys on the 3D
keyboard, and you hear a real Topre switch for every press and release.

## Using it

| | |
|---|---|
| **type** | everything goes to the terminal. Start with `help` |
| **move the cursor** | look around. Move it down to lean back and see the whole desk and the hands |
| **scroll** | scroll back through the terminal (also Page Up / Page Down) |
| **phones** | just the terminal, full screen. Tap to type, drag to scroll, tap an email to copy it |

Deep links run a command on load: `#j`, `#eden`, `#about`, `#links`, `#contact`.

## What's in the terminal

- **About Kaiav:** `about`, `eden`, `j`, `links`, `linkedin`, `x`, `gh`, `contact` (copies an
  address to the clipboard), `open <name|url>`
- **Tools:** `weather [city]`, `todo`, `cal`, `clock`, `timer`, `stopwatch`, `pomodoro`, `bc`, `date`
- **Play:** `typing` (a WPM test), `tetris`, `snake`, `donut`, `matrix`, `fortune`, `cowsay`, `banner`, `lamp`
- **A real little shell:** pipes, `>` `>>` `<` redirection, `&&` `||` `;`, globs, `$VAR`, aliases,
  history (`!!`, `!n`), Tab completion, "did you mean". Also `ls` `cd` `cat` `grep` `sed` `sort` `uniq`
  `wc` `head` `tail` `tree` `cp` `mv` `rm` `mkdir` `touch` `man` `neofetch` and friends, on a
  filesystem that's saved in your browser

`help` lists everything, `help all` lists more, and `man <command>` explains any command.

## How it's built

There's no framework and no build tooling beyond one Python script. [three.js](https://threejs.org)
r147 is loaded from a CDN, and everything else is hand-written and procedural: models, textures and
lighting.

```
src/
  head.html      page shell, fonts, styles, overlay UI
  content.js     all copy about Kaiav (MAC.CONTENT)
  keysamples.js  the key recordings, embedded as PCM
  sound.js       Web Audio: key playback with per-key variation, terminal beeps and disk sounds
  scene.js       the room, computer, CRT shader, keyboard, lamp and camera
  room.js        set dressing: shelf, books, cork board, prints, curtains, radio clock
  typist.js      the hands: arm and finger IK, strike timing synced to key travel and sound
  terminal.js    the shell, the virtual filesystem and the canvas renderer the CRT displays
  apps.js        full-screen apps: tetris, snake, donut, lamp
  extras.js      weather, todo, clocks, typing test, fortune, cowsay, banner, matrix
  main.js        input routing, phone mode, the loop
  CONTRACT.md    how the modules talk to each other, and the terminal extension API
build.py         concatenates src/ into index.html (static hosting) and site.html (an embeddable fragment)
```

```sh
python3 build.py            # writes index.html and site.html
python3 build.py --out dir  # build somewhere else
```

Open `index.html` in a browser. It needs WebGL; phones skip WebGL and get the terminal only.

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
- The donut is after [a1k0n's donut.c](https://www.a1k0n.net/2011/07/20/donut-math.html)
- Weather data from [Open-Meteo](https://open-meteo.com)
