# Brief: Kaiav Nihalani personal-site hero concepts

## Who he is (from public research, use these facts, don't invent others)
- Kaiav Nihalani (he/him). Student developer. Ships fast, builds his own tools and open-sources them.
- GitHub: github.com/KaiavN · DEV: dev.to/kaiav_nihalani · Email: kaiav.nihalani@gmail.com
- **Eden** — "the autonomous observability layer for AI agents". Unifies the AI observability stack and turns data into actions. MVP, recruiting beta testers. Stack: Tinybird/ClickHouse (OLAP), Neon Postgres (OLTP), Northflank backend, Vercel frontend.
- **Eden Know** — compact fact graph. Dump `graph.kpk` (magic bytes `KPK8`), ~15 KB holding 8,299 facts. Built by crawler `Edenbot/0.1` from public pages that allow crawling under RFC 9309 (Wikipedia, catalogs, Common Crawl WET). A query returns one fact card ≤ 48 tokens, or `{ "unknown": true }`. Source closed, data open (CC BY 4.0).
- **Folio** — on-device AI app (React Native/Expo, Android, native ExecuTorch engine module). Private, runs locally.
- **Anvil** (repo anvilcode) — Rust terminal AI coding agent. Multi-provider (OpenAI, Anthropic, OpenRouter, Groq, Vertex, Bedrock), MCP support, restricted shell mode, prompt queue, anvil.yaml, ZSH plugin with cost in prompt. `anvil provider login`.
- **WebProbe** — open-source Rust CLI (`npm i @knihalani/webprobe`). Launches crawlers that interact with every interactive element on a site to find errors a user would hit; load tests; handles auth via selectors; JSON report with network stats, load times, errors, per-page stats. Works with localhost / host:port / bare port.
- Others: Nodely (TS, node-based), StudyShare (TS), testagent (TS), fluxscape fork (Noodl visual programming), vellum-assistant fork.
- Languages: Rust, TypeScript. Themes: AI agents, observability, data, on-device AI, dev tooling.

Copy: keep it short. Use the name "Kaiav Nihalani", a one-line tagline like "Student developer building tools for AI agents" and the project facts above. Where longer bio text would go, use a clearly short placeholder line (Kaiav will supply long copy later). Link projects to their GitHub URLs (github.com/KaiavN/<repo>; Eden Know data repo is github.com/KaiavN/eden-know-data).

## Goal
The concept does NOT need to be about his projects. Creativity, wow-factor, interactivity and performance come first; his name + a light site skeleton is enough personalization. Each concept is the **hero / base** of his personal site, and it must be massively impressive: a real-time 3D or interactive piece that would make a visitor stop. Spend the effort on the centerpiece: smooth 60fps, shader craft, postprocessing, considered motion, interaction (mouse/touch/scroll/keys). Below or over the centerpiece, include a minimal site skeleton (name, tagline, project list or nav, contact) so it reads as a personal site. Each concept needs its OWN visual identity (palette, fonts from Google Fonts, layout). Avoid the cliches: no purple→blue gradient, no Inter/Space Grotesk, no cream+terracotta, no lone acid-green-on-black.

## Performance budget (mandatory, "optimised" is a core requirement)
- Steady 60fps on a mid laptop iGPU; usable on phones. Single requestAnimationFrame loop; pause rendering when the tab is hidden (visibilitychange) and when the canvas is offscreen (IntersectionObserver).
- Cap devicePixelRatio (≤2 desktop, ≤1.5 mobile). Adaptive quality: measure frame time over the first ~60 frames and drop resolution/particle count if slow.
- Instancing / Points / shaders over thousands of meshes. No per-frame allocations in hot loops (reuse vectors/typed arrays). Minimal draw calls. Dispose nothing in the loop.
- No layout thrash: don't read layout in the render loop; transforms/opacity only for DOM animation.
- Keep the file lean: only load libraries you really use. Lazy-init heavy parts after first paint.

## Hard technical contract (Claude Artifact host, CSP-enforced)
- Write ONE self-contained file: `/home/user/personal-site/concepts/NN-slug.html`.
- NO `<!doctype>`, `<html>`, `<head>`, `<body>` tags — the host wraps it. Start with `<title>Name</title>` (2-4 word name, e.g. "Kaiav · Fact Graph"? no: just a name like "Fact Graph Kaiav" — keep it a short noun phrase), then `<meta name="claude:viewport-fit-sides" content="cover">`, Google Fonts `<link>`, `<style>`, markup, scripts.
- Scripts ONLY from these hosts, pinned exact versions:
  - three.js r147 UMD: `https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js` and addons from `https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/...` (e.g. controls/OrbitControls.js, postprocessing/EffectComposer.js, RenderPass.js, UnrealBloomPass.js, ShaderPass.js, shaders/CopyShader.js, shaders/LuminosityHighPassShader.js). These define `THREE.OrbitControls` etc. Load CopyShader + LuminosityHighPassShader before the passes.
  - gsap: `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js` (+ ScrollTrigger.min.js same dir)
  - matter-js: `https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js`
  - Raw WebGL/WebGL2 shaders are welcome and often best.
- Fonts only via fonts.googleapis.com `<link>`, with fallback stacks. No other external images/fetches — generate everything procedurally (canvas, shaders, data: URIs).
- No alert/confirm/prompt, no mailto reliance (show the email as selectable text + copy button using navigator.clipboard inside click handler with catch), no window.open (use <a href target="_blank">), no iframes, no microphone/camera/gyroscope.
- Dark single-theme design is fine (deliberate): set `:root{color-scheme:dark; --bg:...}` and `body{background:var(--bg)}` explicitly, with all colors as tokens on :root.
- Responsive: must work at 400px phone width, no horizontal page scroll; side gutter `padding-left:max(16px, env(safe-area-inset-left,0px)); padding-right:max(16px, env(safe-area-inset-right,0px))` on the content wrapper. Touch must work (pointer events). Cap devicePixelRatio at 2, scale down particle counts on small screens.
- Use `height:100%`/`100dvh`-style sizing for canvas heroes; canvas `position:fixed` behind content is fine.
- Respect `prefers-reduced-motion` (slow/pause ambient motion). Visible keyboard focus.
- Page must be complete at rest: text visible without waiting on observers.
- Handle resize. Handle WebGL failure gracefully (fallback message/gradient).

## Verify before you finish
Use Playwright (pre-installed: `require('playwright')` works; `chromium.launch()` with no options; do NOT install anything). Load the file via `file://`, wait ~3s, capture console errors + page errors, take one desktop (1440x900) and one phone (390x844) screenshot to your scratch dir and LOOK at them (Read the png). If you see console errors, a blank canvas, or broken layout, fix and re-check (max 3 iterations). Note: when loading locally, wrap file content in nothing — browsers render it fine without html/body tags.
WebGL in headless chromium: launch with `args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']` if WebGL fails to init.

Do NOT git commit. Do NOT publish artifacts. Report back: file path, a 1-sentence description of the concept, the title, and any known limitations.
