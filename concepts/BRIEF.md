# Brief: Kaiav Nihalani personal-site hero concepts

## Who he is (UPDATED — this replaces any earlier project list; use ONLY these facts)
- Kaiav Nihalani (he/him). Founder.
- **Eden** — he is the founder. Describe it ONLY as "Context for agents." No link, no other detail.
- **J: Rising Founder** — he is co-founder (with Jose Cruz-Lopez). https://risingfounder.net. "An early chance for extraordinary founders." A free, remote, three-month program for ambitious founders aged 23 and under, anywhere in the world. No fee, no equity.
- Links: LinkedIn https://www.linkedin.com/in/kaiav-nihalani-594703356/ · X https://x.com/KaiavRNihalani
- Do NOT mention or reference any other projects (no WebProbe, Anvil, Folio, Eden Know, Nodely, StudyShare, GitHub repos, Rust gears, phones-as-Folio, "8,299 facts", KPK8, etc.). Replace any such content with Eden / J or with neutral content.
- Tagline suggestions: "Founder of Eden. Co-founder of J." / "Building context for agents."

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

## Contact (UPDATED — mandatory)
- NEVER write any email address anywhere in the page (not in text, attributes, comments or JS). Emails are unlocked by mini-games via a shared module that will be injected later.
- In the contact area put exactly this placeholder element: `<div data-contact-gate></div>` (it will render two retro "unlock" buttons: J enquiries, and everything else). Give it room (~min 120px tall area); style around it, but do not style its contents. Keep the LinkedIn and X links as normal links.
- Any terminal/command-based contact output should say: "Emails are locked behind a game — click Contact" and call `window.KaiavContact && KaiavContact.open('j')` or `('general')` where it makes sense.
