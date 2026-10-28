/* ================= mesher (runs in a Blob worker, or inline as a fallback) ================= */
function MESHER(self){
  'use strict';
  let RT, OPQ, TIL, SWY, WYM = 64, TVAR, TV0, TEXP, TCAP, TFR, AOQ, SNOWI = -1, ICEI = -1, OX = 0, OZ = 0;
  const P = 18, P2 = 324;
  const FN = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const FU = [[0,1,0],[0,0,1],[0,0,1],[1,0,0],[1,0,0],[0,1,0]];
  const FV = [[0,0,1],[0,1,0],[1,0,0],[0,0,1],[0,1,0],[1,0,0]];
  const FB = [[1,0,0],[0,0,0],[0,1,0],[0,0,0],[0,0,1],[0,0,0]];
  const off = v => v[0] + v[2] * P + v[1] * P2;
  const NO = FN.map(off), UO = FU.map(off), VO = FV.map(off);
  const CU = [0, 1, 1, 0], CV = [0, 0, 1, 1];
  function Buf(){ this.cap = 4096; this.p = new Float32Array(this.cap * 3); this.u = new Float32Array(this.cap * 2); this.a = new Uint8Array(this.cap * 4); this.i = new Uint32Array(this.cap * 1.5); this.nv = 0; this.ni = 0; }
  Buf.prototype.grow = function(){ const c = this.cap * 2; const p = new Float32Array(c * 3); p.set(this.p); this.p = p; const u = new Float32Array(c * 2); u.set(this.u); this.u = u; const a = new Uint8Array(c * 4); a.set(this.a); this.a = a; const i = new Uint32Array(c * 1.5); i.set(this.i); this.i = i; this.cap = c; };
  Buf.prototype.v = function(x, y, z, u, v, a0, a1, a2, a3){ const n = this.nv++; this.p[n*3] = x; this.p[n*3+1] = y; this.p[n*3+2] = z; this.u[n*2] = u; this.u[n*2+1] = v; this.a[n*4] = a0; this.a[n*4+1] = a1; this.a[n*4+2] = a2; this.a[n*4+3] = a3; };
  Buf.prototype.q = function(flip){ const b = this.nv - 4, o = this.ni; if (flip){ this.i[o] = b+1; this.i[o+1] = b+2; this.i[o+2] = b+3; this.i[o+3] = b+1; this.i[o+4] = b+3; this.i[o+5] = b; } else { this.i[o] = b; this.i[o+1] = b+1; this.i[o+2] = b+2; this.i[o+3] = b; this.i[o+4] = b+2; this.i[o+5] = b+3; } this.ni += 6; };
  Buf.prototype.out = function(){ return { p: this.p.slice(0, this.nv * 3), u: this.u.slice(0, this.nv * 2), a: this.a.slice(0, this.nv * 4), i: this.i.slice(0, this.ni) }; };
  const S = new Buf(), Wt = new Buf();
  const ao = [0,0,0,0], lv = [0,0,0,0];
  function mesh(b, l){
    S.nv = S.ni = Wt.nv = Wt.ni = 0;
    for (let y = 0; y < WYM; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++){
      const o = (x + 1) + (z + 1) * P + (y + 1) * P2, id = b[o];
      if (!id) continue;
      const rt = RT[id];
      if (rt === 5) continue;
      if (rt === 3){
        if (S.nv + 16 >= S.cap) S.grow();
        const t = TIL[id * 6 + 2], L = l[o], a0 = 6 + 8;
        const d = [[.15,.15,.85,.85],[.15,.85,.85,.15]];
        for (let k = 0; k < 2; k++){
          const q = d[k];
          for (let s = 0; s < 2; s++){
            const xa = s ? q[2] : q[0], za = s ? q[3] : q[1], xb = s ? q[0] : q[2], zb = s ? q[1] : q[3];
            S.v(x + xa, y, z + za, 0, 0, a0, 3, L, t); S.v(x + xb, y, z + zb, 1, 0, a0, 3, L, t); S.v(x + xb, y + .95, z + zb, 1, 1, a0, 3, L, t); S.v(x + xa, y + .95, z + za, 0, 1, a0, 3, L, t); S.q(false);
          }
        }
        continue;
      }
      for (let f = 0; f < 6; f++){
        const no = o + NO[f], nb = b[no];
        if (rt === 4){
          if (nb === id || OPQ[nb]) continue;
          if (f === 3 && nb) continue;
          if (Wt.nv + 4 >= Wt.cap) Wt.grow();
          const top = b[o + P2] === id ? 1 : .86, L = l[no];
          const shore = (OPQ[b[o + 1]] || OPQ[b[o - 1]] || OPQ[b[o + P]] || OPQ[b[o - P]]) ? 1 : 0; let dep = 0; while (dep < 3 && b[o - P2 * (dep + 1)] === id) dep++; const t = shore * 4 + dep; // the water shader reads foam and depth from this
          const B = FB[f], U = FU[f], V = FV[f];
          for (let k = 0; k < 4; k++){
            const cu = CU[k], cv = CV[k];
            let px = x + B[0] + U[0] * cu + V[0] * cv, py = y + B[1] + U[1] * cu + V[1] * cv, pz = z + B[2] + U[2] * cu + V[2] * cv;
            if (py > y + .5) py = y + top;
            Wt.v(px, py, pz, px + pz * .5, py + pz * .5, f, 3, L, t);
          }
          Wt.q(false);
          continue;
        }
        if (OPQ[nb]) continue;
        if (rt === 2 && nb === id) continue;
        if (S.nv + 4 >= S.cap) S.grow();
        const uo = UO[f], vo = VO[f];
        for (let k = 0; k < 4; k++){
          const su = CU[k] ? uo : -uo, sv = CV[k] ? vo : -vo;
          const s1 = AOQ[b[no + su]], s2 = AOQ[b[no + sv]], c = AOQ[b[no + su + sv]];
          ao[k] = (s1 && s2) ? 0 : 3 - (s1 + s2 + c);
          let sum = l[no], cnt = 1;
          if (!s1){ sum += l[no + su]; cnt++; } if (!s2){ sum += l[no + sv]; cnt++; } if (!c && !(s1 && s2)){ sum += l[no + su + sv]; cnt++; }
          lv[k] = Math.round(sum / cnt);
        }
        let t = TIL[id * 6 + f]; const B = FB[f], U = FU[f], V = FV[f], sw = SWY[id] ? 8 : 0;
        if (f !== 2 && f !== 3){ const ab = b[o + P2]; if (TCAP[t] && (ab === SNOWI || ab === ICEI)) t = TCAP[t]; else if (TEXP[t] && !OPQ[ab] && ab !== id) t = TEXP[t]; }
        if (TVAR[t] > 1){ const hh = (Math.imul(x + OX, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z + OZ, 83492791) ^ Math.imul(f + 1, 668265263)) >>> 0; const k = (hh >>> 7) % TVAR[t]; if (k) t = TV0[t] + k - 1; }
        for (let k = 0; k < 4; k++){
          const cu = CU[k], cv = CV[k];
          let tu, tv;
          if (f === 0 || f === 5){ tu = 1 - cv; tv = cu; } else if (f === 2){ tu = cv; tv = cu; } else { tu = cu; tv = cv; }
          S.v(x + B[0] + U[0] * cu + V[0] * cv, y + B[1] + U[1] * cu + V[1] * cv, z + B[2] + U[2] * cu + V[2] * cv, tu, tv, f + sw, ao[k], lv[k], t);
        }
        S.q(ao[0] + ao[2] < ao[1] + ao[3]);
        // a grass (snow, mycelium, moss) lip that hangs over cliff edges: an alpha-cut fringe just off the face
        if (TFR[id] && f !== 2 && f !== 3 && !OPQ[b[no - P2]] && !RT[nb] && b[o + P2] !== id){
          if (S.nv + 4 >= S.cap) S.grow(); const N = FN[f], ft = TFR[id], Lf = l[no];
          for (let k = 0; k < 4; k++){ const cu = CU[k], cv = CV[k]; let tu, tv; if (f === 0 || f === 5){ tu = 1 - cv; tv = cu; } else { tu = cu; tv = cv; }
            S.v(x + B[0] + U[0] * cu + V[0] * cv + N[0] * .07, y + B[1] + U[1] * cu + V[1] * cv - .45, z + B[2] + U[2] * cu + V[2] * cv + N[2] * .07, tu, tv, f + 8, 3, Lf, ft); }
          S.q(false);
        }
      }
    }
    return { s: S.out(), w: Wt.out() };
  }
  self.onmessage = function(e){
    const d = e.data;
    if (d.type === 'init'){ RT = d.RT; OPQ = d.OPQ; TIL = d.TIL; SWY = d.SWY; WYM = d.WY; TVAR = d.TVAR; TV0 = d.TV0; TEXP = d.TEXP; TCAP = d.TCAP; TFR = d.TFR; AOQ = d.AOQ; SNOWI = d.SNOW; ICEI = d.ICE; return; }
    if (d.type === 'mesh'){
      OX = d.ox || 0; OZ = d.oz || 0;
      const r = mesh(d.b, d.l);
      const msg = { key: d.key, ver: d.ver, s: r.s, w: r.w, b: d.b, l: d.l };
      self.postMessage(msg, [r.s.p.buffer, r.s.u.buffer, r.s.a.buffer, r.s.i.buffer, r.w.p.buffer, r.w.u.buffer, r.w.a.buffer, r.w.i.buffer, d.b.buffer, d.l.buffer]);
    }
  };
}

/* ================= renderer & shared shading ================= */
const canvas = $('#gl');
let renderer = null, glOK = !!Wn.THREE;
if (glOK){
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW, powerPreference: 'high-performance', alpha: false, stencil: false }); if (!renderer.getContext()) throw 0; }
  catch (e){ glOK = false; renderer = null; }
}
if (!glOK){ $('#nogl').hidden = false; $('#title').hidden = true; }
const BASE_DPR = Math.min(Wn.devicePixelRatio || 1, LOW ? 1.5 : 1.5);
let qScale = 1, renderDist = LOW ? 76 : 120;
const scene = glOK ? new THREE.Scene() : null;
const camera = glOK ? new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .08, 900) : null;
if (glOK){ renderer.setPixelRatio(BASE_DPR); renderer.setSize(innerWidth, innerHeight, false); camera.rotation.order = 'YXZ'; scene.add(camera); renderer.setClearColor(0xb9bfc0); }

const U = glOK ? {
  uAtlas: { value: null }, uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(.4, .6, .3).normalize() },
  uSunCol: { value: new THREE.Color(1, .9, .8) }, uAmbSky: { value: new THREE.Color(.6, .65, .7) }, uAmbGround: { value: new THREE.Color(.45, .4, .35) },
  uZenith: { value: new THREE.Color(.45, .58, .7) }, uHorizon: { value: new THREE.Color(.9, .85, .75) }, uAbyss: { value: new THREE.Color(.6, .62, .66) },
  uFog: { value: new THREE.Vector2(40, 120) }, uNight: { value: 0 }, uReveal: { value: 0 }, uWild: { value: 0 }
} : null;
const GL_COMMON = `
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmbSky; uniform vec3 uAmbGround;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uAbyss; uniform vec2 uFog; uniform float uNight; uniform float uTime; uniform float uWild;
vec3 skyCol(vec3 d){
  float y = d.y;
  vec3 c = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.55));
  c = mix(c, uAbyss, smoothstep(0.02, -0.4, y));
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunCol * (0.16 * pow(s, 5.0) + 0.22 * pow(s, 40.0)) * (1.0 - uNight * 0.9);
  return c;
}
vec3 litCol(vec3 alb, vec3 n, float ao, float blk){
  float ndl = dot(n, uSunDir);
  float sun = smoothstep(-0.04, 0.2, ndl) * 0.78 + smoothstep(0.42, 0.72, ndl) * 0.22;
  vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5);
  vec3 L = amb * ao + uSunCol * sun * (0.45 + 0.55 * ao);
  L += vec3(1.0, 0.7, 0.4) * blk * blk * (0.35 + 1.15 * uNight);
  return alb * L;
}
vec3 fogIt(vec3 c, vec3 wp){
  vec3 v = wp - cameraPosition; float d = length(v);
  float f = smoothstep(uFog.x, uFog.y, d) * 0.92;
  f = max(f, smoothstep(16.0, -4.0, wp.y) * 0.9);
  return mix(c, skyCol(v / max(d, 0.001)), f);
}
vec3 grade(vec3 c){
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 0.9);
  c = c * 1.06 / (1.0 + 0.16 * c);
  c += vec3(0.018, 0.012, 0.03) * (1.0 - l);
  c = mix(c, c * vec3(1.05, 0.93, 1.0) + vec3(0.02, 0.0, 0.025) * (1.0 - l), uWild * 0.7); // the Wilds: warmer, a touch of violet
  return c;
}`;

/* ---- atlas texture ---- */
let atlasTex = null;
if (glOK){
  atlasTex = new THREE.DataTexture(atlasData, ATL, ATL, THREE.RGBAFormat);
  atlasTex.magFilter = THREE.NearestFilter; atlasTex.minFilter = THREE.NearestMipmapLinearFilter; atlasTex.generateMipmaps = true;
  atlasTex.needsUpdate = true;
  U.uAtlas.value = atlasTex;
}
const ATLAS_FN = `
vec4 atlas(float tileF, vec2 uv){
  float tile = floor(tileF + 0.5);
  vec2 cell = vec2(tile - 16.0 * floor(tile / 16.0 + 0.01), floor(tile / 16.0 + 0.01));
  vec2 l = clamp(uv, 0.0, 1.0);
  return texture2D(uAtlas, (cell * 32.0 + 8.0 + vec2(l.x, 1.0 - l.y) * 16.0) / 512.0);
}`;
const terrainMat = glOK ? new THREE.ShaderMaterial({
  uniforms: U,
  vertexShader: `
    attribute vec4 aux;
    uniform float uTime;
    varying vec2 vUv; varying vec3 vN; varying float vAO; varying float vBl; varying float vTile; varying vec3 vW;
    void main(){
      float ni = floor(aux.x + 0.5); float sw = 0.0;
      if (ni > 7.5){ ni -= 8.0; sw = 1.0; }
      vec3 n = ni < 0.5 ? vec3(1.,0.,0.) : ni < 1.5 ? vec3(-1.,0.,0.) : ni < 2.5 ? vec3(0.,1.,0.) : ni < 3.5 ? vec3(0.,-1.,0.) : ni < 4.5 ? vec3(0.,0.,1.) : ni < 5.5 ? vec3(0.,0.,-1.) : vec3(0.,1.,0.);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      if (sw > 0.5){
        float k = ni > 5.5 ? uv.y : 0.3;
        float gw = dot(wp.xz, vec2(0.78, 0.62)) * 0.045 - uTime * 0.33;
        float gust = pow(max(0.0, sin(gw)), 6.0) * (0.6 + 0.4 * sin(uTime * 0.21));
        float a = 1.0 + gust * 2.6;
        wp.x += (sin(uTime * 1.7 + wp.z * 0.6 + wp.y * 0.3) * 0.07 + gust * 0.09) * k * a;
        wp.z += (cos(uTime * 1.3 + wp.x * 0.5) * 0.06 + gust * 0.07) * k * a;
      }
      vW = wp.xyz; vN = n; vUv = uv; vAO = aux.y; vBl = aux.z / 15.0; vTile = aux.w;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `
    uniform sampler2D uAtlas; uniform float uReveal;
    ${GL_COMMON}
    ${ATLAS_FN}
    varying vec2 vUv; varying vec3 vN; varying float vAO; varying float vBl; varying float vTile; varying vec3 vW;
    void main(){
      vec4 t = atlas(vTile, vUv);
      if (t.a < 0.5) discard;
      float emis = 1.0 - smoothstep(0.84, 0.96, t.a);
      float ao = 0.4 + vAO * 0.2;
      vec3 c = litCol(t.rgb, vN, ao, vBl);
      c = mix(c, t.rgb * (0.95 + 0.3 * uNight), emis * (0.22 + 0.78 * uNight));
      if (abs(vTile - ${T.crystal}.0) < 0.5){ float pl = 0.5 + 0.5 * sin(uTime * 1.4 - vW.y * 0.55 + dot(vW.xz, vec2(0.21, 0.17))); c += t.rgb * pl * pl * 0.22 * emis; }
      c = fogIt(c, vW);
      c = mix(skyCol(normalize(vW - cameraPosition)), c, uReveal);
      gl_FragColor = vec4(grade(c), 1.0);
    }`
}) : null;
const waterMat = glOK ? new THREE.ShaderMaterial({
  uniforms: U, transparent: true, depthWrite: false,
  vertexShader: `
    attribute vec4 aux; uniform float uTime;
    varying vec2 vUv; varying vec3 vN; varying float vBl; varying vec3 vW; varying float vFlags;
    void main(){
      float ni = aux.x; vFlags = aux.w;
      vec3 n = ni < 0.5 ? vec3(1.,0.,0.) : ni < 1.5 ? vec3(-1.,0.,0.) : ni < 2.5 ? vec3(0.,1.,0.) : ni < 3.5 ? vec3(0.,-1.,0.) : ni < 4.5 ? vec3(0.,0.,1.) : vec3(0.,0.,-1.);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      if (n.y > 0.5) wp.y += sin(wp.x * 1.3 + uTime * 1.5) * 0.03 + cos(wp.z * 1.1 - uTime * 1.2) * 0.03 - 0.03;
      vW = wp.xyz; vN = n; vUv = uv; vBl = aux.z / 15.0;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `
    uniform sampler2D uAtlas;
    ${GL_COMMON}
    ${ATLAS_FN}
    varying vec2 vUv; varying vec3 vN; varying float vBl; varying vec3 vW; varying float vFlags;
    void main(){
      vec2 q = vW.xz * 0.5 + vec2(uTime * 0.05, uTime * 0.03);
      vec4 t = atlas(20.0, fract(q));
      vec3 c = litCol(t.rgb, vN, 0.9, vBl);
      vec3 v = normalize(vW - cameraPosition);
      float fr = pow(1.0 - abs(dot(v, vN)), 3.0);
      float sp = pow(max(dot(reflect(v, vN), uSunDir), 0.0), 60.0) * (1.0 - uNight);
      c = mix(c, skyCol(reflect(v, vN)), fr * 0.6) + uSunCol * sp * 0.6;
      float ripple = smoothstep(0.85, 1.0, sin(vW.x * 3.0 + uTime * 2.0 + sin(vW.z * 2.0 + uTime)) * 0.5 + 0.5) * 0.12 * step(0.5, vN.y);
      // a moving shimmer of sun glints on the surface
      float gl = pow(max(0.0, sin(vW.x * 5.1 + uTime * 1.7) * sin(vW.z * 4.3 - uTime * 1.3)), 18.0) * 0.5 * (1.0 - uNight) * step(0.5, vN.y);
      // depth tint: deeper water is darker and bluer; shore foam laps the banks
      float dep = mod(vFlags, 4.0), shore = step(3.5, vFlags);
      c = mix(c, c * vec3(0.62, 0.78, 0.92), dep / 3.0 * 0.55);
      float foam = shore * step(0.5, vN.y) * smoothstep(0.55, 0.95, sin(vW.x * 4.0 + vW.z * 3.1 + uTime * 2.2) * 0.5 + 0.5 + texture2D(uAtlas, fract(vW.xz * 0.25)).r * 0.0);
      c += ripple + gl; c = mix(c, vec3(0.93, 0.95, 0.96), foam * 0.55);
      c = fogIt(c, vW);
      gl_FragColor = vec4(grade(c), 0.72 + fr * 0.15 + dep * 0.04 + foam * 0.15);
    }`
}) : null;
/* generic lit material for mobs / avatar / clouds / props (vertex colours, optional instancing) */
function litMat(o){
  o = o || {};
  const uni = Object.assign({}, U, { uEmis: { value: o.emis || 0 }, uAlpha: { value: o.alpha || 1 }, uRim: { value: o.rim === undefined ? .22 : o.rim } });
  return new THREE.ShaderMaterial({
    uniforms: uni, transparent: !!o.transparent, depthWrite: o.depthWrite !== false, side: o.side || THREE.FrontSide,
    vertexShader: `
      attribute vec3 aCol;
      varying vec3 vC; varying vec3 vN; varying vec3 vW;
      uniform float uTime;
      void main(){
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
        m = m * instanceMatrix;
        #endif
        vec4 wp = m * vec4(position, 1.0);
        ${o.cloud ? 'wp.x = mod(wp.x + uTime * 0.7 + 200.0, 600.0) - 200.0;' : ''}
        vC = aCol;
        #ifdef USE_INSTANCING_COLOR
        vC *= instanceColor;
        #endif
        vN = normalize(mat3(m) * normal); vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      ${GL_COMMON}
      uniform float uEmis; uniform float uAlpha; uniform float uRim;
      varying vec3 vC; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 n = normalize(vN);
        vec3 c = litCol(vC, n, ${o.cloud ? '1.0' : '0.92'}, 0.0);
        vec3 v = normalize(cameraPosition - vW);
        c += (uSunCol * 0.6 + uAmbSky * 0.4) * pow(1.0 - max(dot(n, v), 0.0), 3.0) * uRim;
        c = mix(c, vC * (1.0 + uNight * 0.6), uEmis * (0.5 + 0.5 * uNight));
        c = fogIt(c, vW);
        gl_FragColor = vec4(grade(c), uAlpha);
      }`
  });
}
/* box-merging helper (vertex coloured) */
function boxGeo(list){
  let n = 0; list.forEach(() => n++);
  const pos = new Float32Array(n * 24 * 3), nor = new Float32Array(n * 24 * 3), col = new Float32Array(n * 24 * 3), idx = [];
  let v = 0;
  const F = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  list.forEach(b => {
    const [x, y, z, w, h, d] = b, c = b[6], hw = w / 2, hh = h / 2, hd = d / 2;
    const cc = typeof c === 'number' ? rgb(c).map(k => k / 255) : c;
    for (let f = 0; f < 6; f++){
      const N = F[f];
      const k = f === 2 ? 1.06 : (f === 3 ? .8 : 1);
      const ax = N[0] ? 0 : (N[1] ? 0 : 0);
      const corners = [];
      if (N[0]) corners.push([N[0]*hw, -hh, hd*N[0]], [N[0]*hw, -hh, -hd*N[0]], [N[0]*hw, hh, -hd*N[0]], [N[0]*hw, hh, hd*N[0]]);
      else if (N[1]) corners.push([-hw, N[1]*hh, hd*N[1]], [hw, N[1]*hh, hd*N[1]], [hw, N[1]*hh, -hd*N[1]], [-hw, N[1]*hh, -hd*N[1]]);
      else corners.push([-hw*N[2], -hh, N[2]*hd], [hw*N[2], -hh, N[2]*hd], [hw*N[2], hh, N[2]*hd], [-hw*N[2], hh, N[2]*hd]);
      for (let q = 0; q < 4; q++){
        pos[v*3] = x + corners[q][0]; pos[v*3+1] = y + corners[q][1]; pos[v*3+2] = z + corners[q][2];
        nor[v*3] = N[0]; nor[v*3+1] = N[1]; nor[v*3+2] = N[2];
        col[v*3] = cc[0] * k; col[v*3+1] = cc[1] * k; col[v*3+2] = cc[2] * k; v++;
      }
      const b0 = v - 4; idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
      void ax;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx); return g;
}

/* ================= chunk manager ================= */
const NCH = NCX * NCY * NCZ;
const chunks = [];
for (let i = 0; i < NCH; i++) chunks.push({ cx: i % NCX, cz: ((i / NCX) | 0) % NCZ, cy: (i / (NCX * NCZ)) | 0, mesh: null, wmesh: null, ver: 0, sent: -1, dirty: false, count: 0 });
const ckey = (cx, cy, cz) => cx + NCX * (cz + NCZ * cy);
const dirtyList = [];
let inflight = 0, worker = null, workerOK = false, inline = null, meshedOnce = 0, totalToMesh = 0;
function countChunks(){
  chunks.forEach(c => c.count = 0);
  for (let y = 0; y < WY; y++) for (let z = 0; z < WZ; z++) for (let x = 0; x < WX; x++) if (world[x + WX * (z + WZ * y)]) chunks[ckey(x >> 4, 0, z >> 4)].count++;
}
function markDirty(k){ const c = chunks[k]; c.ver++; if (!c.dirty){ c.dirty = true; dirtyList.push(k); } }
function markBox(x0, y0, z0, x1, y1, z1){
  const a = clamp(x0 >> 4, 0, NCX - 1), b = clamp(x1 >> 4, 0, NCX - 1), c = 0, d = 0, e = clamp(z0 >> 4, 0, NCZ - 1), f = clamp(z1 >> 4, 0, NCZ - 1);
  for (let y = c; y <= d; y++) for (let z = e; z <= f; z++) for (let x = a; x <= b; x++) markDirty(ckey(x, y, z));
}
function padded(c){
  const b = new Uint8Array(324 * (WY + 2)), l = new Uint8Array(324 * (WY + 2));
  let o = 0; const bx = c.cx * 16, by = 0, bz = c.cz * 16;
  for (let y = -1; y < WY + 1; y++){ const wy = by + y; for (let z = -1; z < 17; z++){ const wz = bz + z; for (let x = -1; x < 17; x++, o++){ const wx = bx + x;
    if (wx < 0 || wy < 0 || wz < 0 || wx >= WX || wy >= WY || wz >= WZ) continue; const i = wx + WX * (wz + WZ * wy); b[o] = world[i]; l[o] = light[i]; } } }
  return [b, l];
}
const SPHERE_C = glOK ? new THREE.Vector3(8, WY / 2, 8) : null;
function applyMesh(key, ver, s, w){
  const c = chunks[key];
  if (ver !== c.ver) return;
  c.sent = ver;
  const mk = (data, mat, old) => {
    if (!data.i.length){ if (old){ scene.remove(old); old.geometry.dispose(); } return null; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.p, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(data.u, 2));
    g.setAttribute('aux', new THREE.BufferAttribute(data.a, 4));
    g.setIndex(new THREE.BufferAttribute(data.i, 1));
    g.boundingSphere = new THREE.Sphere(SPHERE_C, WY / 2 + 6);
    if (old){ old.geometry.dispose(); old.geometry = g; return old; }
    const m = new THREE.Mesh(g, mat); m.position.set(c.cx * 16, 0, c.cz * 16); m.matrixAutoUpdate = false; m.updateMatrix();
    if (mat === waterMat) m.renderOrder = 2;
    scene.add(m); return m;
  };
  c.mesh = mk(s, terrainMat, c.mesh);
  c.wmesh = mk(w, waterMat, c.wmesh);
  meshedOnce++;
}
function startMesher(){
  if (!glOK) return;
  const init = { type: 'init', RT: B_RT, OPQ: B_OPQ, TIL: B_TILES, SWY: B_SWAY, WY, TVAR, TV0, TEXP, TCAP, TFR, AOQ: B_AOQ, SNOW, ICE };
  try {
    const url = URL.createObjectURL(new Blob(['(' + MESHER.toString() + ')(self);'], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = e => { const d = e.data; workerOK = true; inflight--; applyMesh(d.key, d.ver, d.s, d.w); };
    worker.onerror = () => { useInline(); };
    worker.postMessage(init);
    setTimeout(() => { if (!workerOK && inflight > 0) useInline(); }, 2500);
  } catch (e){ useInline(); }
  function useInline(){
    if (inline) return;
    try { if (worker) worker.terminate(); } catch (e){}
    worker = null; inflight = 0;
    const fake = { postMessage(m){ fake.last = m; } };
    MESHER(fake); fake.onmessage({ data: init });
    inline = fake;
    chunks.forEach((c, k) => { if (c.sent !== c.ver && !c.dirty && (c.count || c.mesh)){ c.dirty = true; dirtyList.push(k); } });
  }
}
const meshRadius = () => (typeof state !== 'undefined' && state === 'title' ? 150 : renderDist * 1.3 + 28);
const streamFocus = () => (typeof CINE !== 'undefined' && CINE.on) || (typeof state !== 'undefined' && state === 'title') ? camera.position : PL;
// meshes far outside the view radius are released (GPU memory stays flat as the world grows); they re-mesh on approach
function unloadFar(){ const px = streamFocus().x, pz = streamFocus().z, R = meshRadius() * 1.6; let n = 0;
  for (let k = 0; k < chunks.length; k++){ const c = chunks[k]; if (!c.mesh && !c.wmesh) continue; if (Math.hypot(c.cx * 16 + 8 - px, c.cz * 16 + 8 - pz) < R) continue;
    for (const m of [c.mesh, c.wmesh]) if (m){ scene.remove(m); m.geometry.dispose(); } c.mesh = c.wmesh = null; c.sent = -1; markDirty(k); n++; } return n; }
function pumpMeshing(budgetMs){
  if (!dirtyList.length) return;
  // streaming: only chunks within the view radius are meshed (nearest first); far ones wait until approached
  const px = streamFocus().x, pz = streamFocus().z, RR = meshRadius();
  if (dirtyList.length > 1) dirtyList.sort((a, b) => { const A = chunks[a], B = chunks[b]; return (Math.hypot(B.cx * 16 + 8 - px, B.cz * 16 + 8 - pz)) - (Math.hypot(A.cx * 16 + 8 - px, A.cz * 16 + 8 - pz)); });
  const t0 = performance.now();
  while (dirtyList.length){
    { const c = chunks[dirtyList[dirtyList.length - 1]]; if (Math.hypot(c.cx * 16 + 8 - px, c.cz * 16 + 8 - pz) > RR) break; }
    if (worker && inflight >= 24) break;
    if (performance.now() - t0 > budgetMs) break; // packing a chunk for the worker costs too: budget both paths
    const k = dirtyList.pop(), c = chunks[k];
    c.dirty = false;
    if (!c.count && !c.mesh && !c.wmesh){ c.sent = c.ver; continue; }
    const [b, l] = padded(c);
    const msg = { type: 'mesh', key: k, ver: c.ver, b, l, ox: c.cx * 16, oz: c.cz * 16 };
    if (worker){ inflight++; worker.postMessage(msg, [b.buffer, l.buffer]); }
    else if (inline){ inline.onmessage({ data: msg }); const d = inline.last; applyMesh(d.key, d.ver, d.s, d.w); }
  }
}

/* ================= sky, cloud sea, clouds ================= */
let sky = null, cloudSea = null, puffs = null, noiseTex = null;
function makeNoiseTex(){
  const N = 128, d = new Uint8Array(N * N * 4);
  const per = (x, z, p) => { // tileable value noise
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi; const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const H = (a, b) => h2(((a % p) + p) % p + 500, ((b % p) + p) % p + 900);
    const A_ = H(xi, zi), B_ = H(xi + 1, zi), C_ = H(xi, zi + 1), D_ = H(xi + 1, zi + 1); return A_ + (B_ - A_) * u + (C_ - A_) * v + (A_ - B_ - C_ + D_) * u * v; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    let s = 0, a = .5, f = 8, n = 0;
    for (let o = 0; o < 4; o++){ s += a * per(x / N * f, y / N * f, f); n += a; a *= .5; f *= 2; }
    const v = s / n * 255, o = (y * N + x) * 4; d[o] = v; d[o + 1] = per(x / N * 4, y / N * 4, 4) * 255; d[o + 2] = per(x / N * 16 + 3, y / N * 16 + 7, 16) * 255; d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
}
function buildSky(){
  noiseTex = makeNoiseTex();
  sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U), side: THREE.BackSide, depthWrite: false, depthTest: false,
    vertexShader: `varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `${GL_COMMON}
      varying vec3 vD;
      float hh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        vec3 d = normalize(vD);
        vec3 c = skyCol(d);
        float sd = dot(d, uSunDir);
        c += uSunCol * smoothstep(0.9993, 0.9997, sd) * 1.4 * (1.0 - uNight);
        if (uNight > 0.01){
          vec3 p = d * 190.0; vec3 ce = floor(p); float h = hh(ce);
          if (h > 0.986 && d.y > -0.02){ float r = length(fract(p) - 0.5); c += vec3(1.0, 0.95, 0.85) * smoothstep(0.32, 0.0, r) * uNight * (0.55 + 0.45 * sin(uTime * 2.0 + h * 90.0)) * smoothstep(-0.02, 0.2, d.y); }
          vec3 md = uSunDir; float m = dot(d, md);
          float disc = smoothstep(0.9985, 0.999, m);
          float crater = smoothstep(0.5, 0.9, hh(floor(d * 900.0)));
          c = mix(c, vec3(0.93, 0.91, 0.84) * (1.0 - crater * 0.12), disc * uNight);
          c += vec3(0.5, 0.55, 0.7) * pow(max(m, 0.0), 120.0) * 0.35 * uNight;
        }
        gl_FragColor = vec4(grade(c), 1.0);
      }`
  }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  // sea of clouds far below the islands
  const g = new THREE.PlaneGeometry(1400, 1400, 1, 1); g.rotateX(-Math.PI / 2);
  cloudSea = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: Object.assign({ uNoise: { value: noiseTex } }, U), transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${GL_COMMON}
      uniform sampler2D uNoise; varying vec3 vW;
      void main(){
        vec2 p = vW.xz;
        float a = texture2D(uNoise, p * 0.0026 + vec2(uTime * 0.0016, 0.0)).r;
        float b = texture2D(uNoise, p * 0.0071 - vec2(0.0, uTime * 0.0027)).g;
        float c2 = texture2D(uNoise, p * 0.021 + vec2(uTime * 0.004, uTime * 0.002)).b;
        float n = a * 0.6 + b * 0.3 + c2 * 0.1;
        float dens = smoothstep(0.32, 0.62, n);
        float hl = smoothstep(0.45, 0.8, n);
        vec3 shadowC = mix(uAbyss, uAmbGround, 0.25) * 0.95;
        vec3 litC = mix(uHorizon, vec3(1.0), 0.35) * (0.75 + 0.35 * max(uSunDir.y, 0.0)) ;
        vec3 col = mix(shadowC, litC, hl);
        col = mix(col, uSunCol * 0.9 + uHorizon * 0.3, pow(hl, 3.0) * 0.25 * (1.0 - uNight));
        vec3 v = vW - cameraPosition; float d = length(v);
        float f = smoothstep(120.0, 520.0, d);
        col = mix(col, skyCol(v / d), f);
        gl_FragColor = vec4(grade(col), dens * 0.95);
      }`
  }));
  cloudSea.position.set(WX / 2, 2, WZ / 2); cloudSea.renderOrder = 1; scene.add(cloudSea);
  // drifting puffy clouds at island height: instanced soft boxes, each cluster wraps around the world as a whole
  CLOUDS.length = 0;
  for (let k = 0; k < 34; k++){
    const cx = rnd() * (WX + 300) - 150, cy = 30 + rnd() * 50, cz = rnd() * (WZ + 300) - 150;
    if (Math.hypot(cx - HOMEC.x, cz - HOMEC.z) < 70) continue;
    const n = 4 + Math.floor(rnd() * 5), parts = [];
    for (let i = 0; i < n; i++) parts.push([(rnd() - .5) * 16, rnd() * 3, (rnd() - .5) * 10, 5 + rnd() * 8, 2 + rnd() * 3, 4 + rnd() * 6]);
    CLOUDS.push({ x: cx, y: cy, z: cz, sp: .5 + rnd() * .5, parts });
  }
  const nInst = CLOUDS.reduce((a, c) => a + c.parts.length, 0), cg = new THREE.BoxGeometry(1, 1, 1); cg.setAttribute("aCol", new THREE.BufferAttribute(new Float32Array(cg.attributes.position.count * 3).fill(.97), 3));
  puffs = new THREE.InstancedMesh(cg, litMat({ rim: .35, transparent: true, alpha: .9 }), nInst);
  puffs.frustumCulled = false; puffs.renderOrder = 3; scene.add(puffs); updateClouds(0);
}
const CLOUDS = [];
function updateClouds(t){
  if (!puffs) return; const span = WX + 300; let i = 0;
  for (const c of CLOUDS){ const x = ((c.x + t * c.sp + 150) % span + span) % span - 150;
    for (const p of c.parts){ _cm.makeScale(p[3], p[4], p[5]); _cm.setPosition(x + p[0], c.y + p[1], c.z + p[2]); puffs.setMatrixAt(i++, _cm); } }
  puffs.instanceMatrix.needsUpdate = true;
}
const _cm = glOK ? new THREE.Matrix4() : null;

/* ================= signs (canvas lettering) ================= */
const SIGN_TEXT = {
  hub: ['Kaiav Nihalani', 'Founder of Eden · Co-founder of J'],
  eden: ['Eden', 'Context for agents'],
  j: ['J', 'Rising Founder'],
  about: ['About', 'the person behind the islands'],
  contact: ['Contact', 'say hello']
};
function drawBoard(cv, title, sub, opts){
  const g = cv.getContext('2d'), w = cv.width, h = cv.height;
  g.clearRect(0, 0, w, h);
  if (opts && opts.arrow){
    g.save(); g.beginPath(); const tip = h * .5;
    if (opts.flip){ g.moveTo(w, 0); g.lineTo(tip, 0); g.lineTo(0, h / 2); g.lineTo(tip, h); g.lineTo(w, h); }
    else { g.moveTo(0, 0); g.lineTo(w - tip, 0); g.lineTo(w, h / 2); g.lineTo(w - tip, h); g.lineTo(0, h); }
    g.closePath(); g.clip();
  }
  const rows = 4;
  for (let r = 0; r < rows; r++){
    const y0 = r * h / rows, gr = g.createLinearGradient(0, y0, 0, y0 + h / rows);
    const base = [[122, 88, 62], [112, 80, 56], [128, 93, 66], [116, 84, 58]][r % 4];
    gr.addColorStop(0, `rgb(${base[0] + 14},${base[1] + 10},${base[2] + 8})`); gr.addColorStop(1, `rgb(${base[0] - 12},${base[1] - 10},${base[2] - 8})`);
    g.fillStyle = gr; g.fillRect(0, y0, w, h / rows);
    g.strokeStyle = 'rgba(40,26,18,.35)'; g.lineWidth = 1.5;
    for (let k = 0; k < 7; k++){ const yy = y0 + 6 + h2(r, k) * (h / rows - 12); g.beginPath(); g.moveTo(0, yy); g.bezierCurveTo(w * .3, yy + 3, w * .6, yy - 3, w, yy + 1); g.stroke(); }
    g.fillStyle = 'rgba(30,18,12,.55)'; g.fillRect(0, y0 + h / rows - 3, w, 3);
  }
  if (!(opts && opts.arrow)){
    g.strokeStyle = 'rgba(38,24,16,.65)'; g.lineWidth = Math.max(6, h * .03); g.strokeRect(g.lineWidth / 2 + 4, g.lineWidth / 2 + 4, w - g.lineWidth - 8, h - g.lineWidth - 8);
    g.fillStyle = '#3a2a20'; [[18, 18], [w - 18, 18], [18, h - 18], [w - 18, h - 18]].forEach(p => { g.beginPath(); g.arc(p[0], p[1], 6, 0, 7); g.fill(); });
  }
  const carve = (txt, font, y, size) => {
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.imageSmoothingEnabled = false;
    g.fillStyle = 'rgba(25,15,10,.8)'; g.fillText(txt, w / 2 + Math.max(3, size * .06), y + Math.max(3, size * .06));
    g.fillStyle = '#f4e4c2'; g.fillText(txt, w / 2, y);
  };
  const fitSize = (txt, pre, fam, max, maxW) => { let sz = Math.round(max); g.font = `${pre} ${sz}px ${fam}`; while (g.measureText(txt).width > maxW && sz > 10){ sz -= 2; g.font = `${pre} ${sz}px ${fam}`; } return sz; };
  const SC = "'Silkscreen', 'Courier New', monospace", SER = "'Silkscreen', 'Courier New', monospace";
  if (opts && opts.arrow){
    const s0 = fitSize(title, '700', SC, h * .5, w * .68);
    carve(title, `700 ${s0}px ${SC}`, h * .54, s0);
    g.restore(); return;
  }
  const s1 = fitSize(title, '700', SC, h * (sub ? .34 : .5), w * .84);
  carve(title, `700 ${s1}px ${SC}`, sub ? h * .4 : h * .5, s1);
  if (sub){ const s2 = fitSize(sub, '400', SER, h * .13, w * .8); carve(sub, `400 ${s2}px ${SER}`, h * .74, s2); }
}
const signMats = [];
const UScale = { value: 300 };
function signMaterial(tex){
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uMap: { value: tex } }, U),
    vertexShader: `varying vec2 vUv; varying vec3 vW; varying vec3 vN; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${GL_COMMON}
      uniform sampler2D uMap; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      void main(){
        vec4 t = texture2D(uMap, vUv); if (t.a < 0.5) discard;
        vec3 n = gl_FrontFacing ? vN : -vN;
        vec3 c = litCol(t.rgb, n, 0.95, 0.55);
        c += t.rgb * smoothstep(0.75, 0.95, t.r) * 0.25 * uNight;
        c = fogIt(c, vW);
        gl_FragColor = vec4(grade(c), 1.0);
      }`
  });
  signMats.push(m); return m;
}
let signAtlas = null, signAtlasTex = null; const SIGN_REG = [];
function buildSigns(){
  // every board, finger-post arrow and plaque lives in one 2048x2048 atlas and one merged geometry: a single draw call
  signAtlas = D.createElement('canvas'); signAtlas.width = 2048; signAtlas.height = 2048; const AH = 2048;
  const pos = [], uv = [], nor = [], idx = [];
  const plane = (cx, cy, cz, w, h, rot, r) => { // r = atlas region [x,y,w,h]
    const c = Math.cos(rot), sn = Math.sin(rot), b = pos.length / 3;
    const u0 = r[0] / 2048, u1 = (r[0] + r[2]) / 2048, v0 = 1 - (r[1] + r[3]) / AH, v1 = 1 - r[1] / AH;
    const pts = [[-w / 2, -h / 2, u0, v0], [w / 2, -h / 2, u1, v0], [w / 2, h / 2, u1, v1], [-w / 2, h / 2, u0, v1]];
    for (const p of pts){ pos.push(cx + p[0] * c, cy + p[1], cz - p[0] * sn); uv.push(p[2], p[3]); nor.push(sn, 0, c); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  let ax = 0, ay = 0, rowH = 0;
  const alloc = (w, h) => { if (ax + w > 2048){ ax = 0; ay += rowH; rowH = 0; } const r = [ax, ay, w, h]; ax += w; rowH = Math.max(rowH, h); return r; };
  SIGNS.forEach(s => {
    const bw = s.w - 2, txt = SIGN_TEXT[s.id], r = alloc(160 * bw, 480);
    SIGN_REG.push({ r, title: txt[0], sub: txt[1] });
    for (const side of [0, 1]){
      if (s.axis === 'x') plane(s.x + .5, s.y + 3.5, side ? s.z + 1.012 : s.z - .012, bw - .04, 2.96, side ? 0 : Math.PI, r);
      else plane(side ? s.x + 1.012 : s.x - .012, s.y + 3.5, s.z + .5, bw - .04, 2.96, side ? Math.PI / 2 : -Math.PI / 2, r);
    }
  });
  const T0 = hTop[HOMEC.x + HOMEC.z * WX];
  const arrows = []; // the finger-post went with the old archipelago
  ax = 0; ay += rowH; rowH = 0;
  arrows.forEach(a => { for (const flip of [false, true]){ const r = alloc(384, 112); SIGN_REG.push({ r, title: a[0], arrow: { arrow: true, flip } });
    plane(96.5 + a[1] * 1.3, T0 + a[3], 98.5 + a[2] * 1.3, 1.7, .5, (a[2] === -1 ? Math.PI / 2 : a[2] === 1 ? -Math.PI / 2 : a[1] === 1 ? 0 : Math.PI) + (flip ? Math.PI : 0), r); } });
  ax = 0; ay += rowH; rowH = 0;
  PLAQUES.forEach(q => { const r = alloc(512, Math.round(512 * q.h / q.w)); SIGN_REG.push({ r, title: q.title }); plane(q.x, q.y, q.z, q.w, q.h, q.rot, r); });
  if (ay + rowH > AH) console.warn('sign atlas overflow');
  signAtlasTex = new THREE.CanvasTexture(signAtlas); signAtlasTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); signAtlasTex.generateMipmaps = true; signAtlasTex.minFilter = THREE.LinearMipmapLinearFilter;
  redrawSigns();
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, signMaterial(signAtlasTex)); m.frustumCulled = false; scene.add(m);
}
function redrawSigns(){
  const g = signAtlas.getContext('2d'), tmp = D.createElement('canvas');
  for (const s of SIGN_REG){ tmp.width = s.r[2]; tmp.height = s.r[3]; drawBoard(tmp, s.title, s.sub, s.arrow || null); g.clearRect(s.r[0], s.r[1], s.r[2], s.r[3]); g.drawImage(tmp, s.r[0], s.r[1]); }
  signAtlasTex.needsUpdate = true;
}

/* ================= glow: lamp halos, fireflies, network, waterfalls ================= */
let halos = null, fireflies = null, network = null, falls = null;
function pointsMat(add, shader){
  return new THREE.ShaderMaterial({ uniforms: Object.assign({ uScale: UScale }, U), transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, vertexShader: shader[0], fragmentShader: shader[1] });
}
function buildGlow(){
  // halos around lamps (and the Eden canopy)
  const hp = [];
  LAMPS.forEach(p => hp.push(p[0], p[1], p[2], 1));
  if (EDEN_TREE) for (let k = 0; k < 7; k++){ const a = k / 7 * Math.PI * 2; hp.push(EDEN_TREE.x + Math.cos(a) * 5, EDEN_TREE.y + 13 + (k % 3), EDEN_TREE.z + Math.sin(a) * 5, 3.2); }
  CRYSTAL_TOPS.forEach(p => hp.push(p[0], p[1] - 1, p[2], 1.6));
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(hp.filter((v, i) => i % 4 !== 3)), 3)); hg.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(hp.filter((v, i) => i % 4 === 3)), 1));
  halos = new THREE.Points(hg, pointsMat(true, [
    `attribute float aS; uniform float uScale; uniform float uNight; varying float vS; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vS = aS; gl_PointSize = (aS > 1.5 ? 9.0 : 3.6) * aS * uScale / -mv.z * (0.35 + 0.65 * uNight); }`,
    `uniform float uNight; varying float vS; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(1.0 - d, 0.0), 2.2); vec3 c = vS > 1.5 ? vec3(0.62, 0.95, 0.8) : (vS > 1.2 ? vec3(0.7, 0.75, 1.0) : vec3(1.0, 0.74, 0.42)); gl_FragColor = vec4(c * a * (0.06 + 0.42 * uNight), 1.0); }`]));
  halos.frustumCulled = false; scene.add(halos);
  // fireflies
  const nF = LOW ? 90 : 240, fp = new Float32Array(nF * 3), fa = new Float32Array(nF);
  for (let i = 0; i < nF; i++){ const s = FIREFLY_SPOTS[Math.floor(rnd() * FIREFLY_SPOTS.length)] || [HOMEC.x, 60, HOMEC.z]; fp[i * 3] = s[0] + (rnd() - .5) * 6; fp[i * 3 + 1] = s[1] + rnd() * 2.5; fp[i * 3 + 2] = s[2] + (rnd() - .5) * 6; fa[i] = rnd() * 100; }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fp, 3)); fg.setAttribute('aP', new THREE.BufferAttribute(fa, 1));
  fireflies = new THREE.Points(fg, pointsMat(true, [
    `attribute float aP; uniform float uScale; uniform float uTime; uniform float uNight; varying float vA;
     void main(){ vec3 p = position + vec3(sin(uTime * 0.31 + aP) * 1.4, sin(uTime * 0.53 + aP * 2.1) * 0.7, cos(uTime * 0.27 + aP * 1.3) * 1.4);
       vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; vA = uNight * (0.5 + 0.5 * sin(uTime * 2.3 + aP * 7.0)); gl_PointSize = 0.42 * uScale / -mv.z * (0.4 + uNight); }`,
    `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(1.0 - d, 0.0), 1.8) * vA; gl_FragColor = vec4(vec3(0.95, 0.9, 0.45) * a, 1.0); }`]));
  fireflies.frustumCulled = false; scene.add(fireflies);
  // knowledge network threads
  if (NETWORK.length){
    const pos = [], t = [], ph = [];
    NETWORK.forEach((s, k) => { const a = s[0], b = s[1]; const segs = 10; for (let i = 0; i < segs; i++){ const u0 = i / segs, u1 = (i + 1) / segs; const sag = (u) => -Math.sin(Math.PI * u) * .9; pos.push(lerp(a[0], b[0], u0), lerp(a[1], b[1], u0) + sag(u0), lerp(a[2], b[2], u0), lerp(a[0], b[0], u1), lerp(a[1], b[1], u1) + sag(u1), lerp(a[2], b[2], u1)); t.push(u0, u1); ph.push(k * .37, k * .37); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(t), 1)); g.setAttribute('aPh', new THREE.BufferAttribute(new Float32Array(ph), 1));
    network = new THREE.LineSegments(g, new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aT; attribute float aPh; varying float vT; varying float vPh; void main(){ vT = aT; vPh = aPh; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime; uniform float uNight; varying float vT; varying float vPh; void main(){ float p = fract(uTime * 0.35 + vPh); float pulse = smoothstep(0.08, 0.0, abs(vT - p)); vec3 c = mix(vec3(0.45, 0.85, 0.75), vec3(1.0, 0.92, 0.6), pulse); gl_FragColor = vec4(c * (0.22 + 0.25 * uNight + pulse * (0.7 + 0.5 * uNight)), 1.0); }` }));
    network.frustumCulled = false; scene.add(network);
  }
  // waterfalls
  if (FALLS.length){
    const pos = [], uv = [], idx = []; let v = 0;
    FALLS.forEach(f => {
      const segs = 24, len = 34;
      for (let i = 0; i <= segs; i++){
        const u = i / segs, d = u * len, out = .15 + Math.pow(u, 1.4) * 3.2 * .35, y = f.y - d;
        const cx = f.x + f.dx * out, cz = f.z + f.dz * out, w = .55 + u * .5;
        pos.push(cx - f.dz * w, y, cz - f.dx * w, cx + f.dz * w, y, cz + f.dx * w); uv.push(0, u, 1, u);
        if (i < segs){ idx.push(v, v + 1, v + 3, v, v + 3, v + 2, v, v + 3, v + 1, v, v + 2, v + 3); }
        v += 2;
      }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2)); g.setIndex(idx);
    falls = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: Object.assign({ uNoise: { value: noiseTex } }, U), transparent: true, depthWrite: false,
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `${GL_COMMON}
        uniform sampler2D uNoise; varying vec2 vUv; varying vec3 vW;
        void main(){
          float s = texture2D(uNoise, vec2(vUv.x * 0.35, vUv.y * 2.2 - uTime * 0.55)).b;
          float s2 = texture2D(uNoise, vec2(vUv.x * 0.6 + 0.3, vUv.y * 1.1 - uTime * 0.32)).r;
          float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
          float foam = smoothstep(0.55, 0.8, s * 0.6 + s2 * 0.5);
          vec3 c = mix(vec3(0.42, 0.6, 0.66), vec3(0.93, 0.95, 0.94), foam * 0.8 + smoothstep(0.08, 0.0, vUv.y) * 0.6);
          c = litCol(c, vec3(0.0, 0.4, 0.9), 1.0, 0.0) * 0.9 + c * 0.15;
          float a = edge * (0.55 + foam * 0.4) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
          c = fogIt(c, vW);
          gl_FragColor = vec4(grade(c), a);
        }` }));
    falls.renderOrder = 4; scene.add(falls);
  }
}

/* ================= particles (debris, hearts, sparkles) ================= */
const PMAX = LOW ? 180 : 480;
let parts = null; const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pSL = new Float32Array(PMAX * 3), pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX), pGrav = new Float32Array(PMAX);
let pCursor = 0, pActive = 0;
function buildParticles(){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aCol', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSL', new THREE.BufferAttribute(pSL, 3).setUsage(THREE.DynamicDrawUsage));
  parts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: Object.assign({ uScale: UScale }, U), transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 aCol; attribute vec3 aSL; uniform float uScale; varying vec3 vC; varying float vA; varying float vK;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSL.x * uScale / -mv.z; vC = aCol; vA = aSL.y; vK = aSL.z; }`,
    fragmentShader: `uniform vec3 uSunCol; uniform vec3 uAmbSky; varying vec3 vC; varying float vA; varying float vK;
      void main(){
        vec2 p = gl_PointCoord * 2.0 - 1.0; vec3 c = vC; float a = vA;
        if (vK < 0.5){ if (max(abs(p.x), abs(p.y)) > 0.75) discard; c *= (uSunCol * 0.6 + uAmbSky * 0.55) * (p.y < 0.0 ? 1.08 : 0.86); }
        else if (vK < 1.5){ float x = p.x * 1.25, y = -p.y * 1.25 + 0.25; float f = pow(x * x + y * y - 1.0, 3.0) - x * x * y * y * y; if (f > 0.0) discard; c = vC * (1.0 + 0.25 * (1.0 - length(p))); }
        else if (vK < 2.5) { float d = length(p); a *= pow(max(1.0 - d, 0.0), 1.5); }
        else { vec2 q = p * vec2(1.0, 1.4); float pad = step(length(q - vec2(0.0, 0.25)), 0.42); float toe = step(length(p - vec2(-0.42, -0.42)), 0.2) + step(length(p - vec2(0.0, -0.62)), 0.2) + step(length(p - vec2(0.42, -0.42)), 0.2); if (pad + toe < 0.5) discard; a *= 0.75; }
        gl_FragColor = vec4(c, a);
      }` }));
  parts.frustumCulled = false; parts.renderOrder = 6; scene.add(parts);
}
function emit(x, y, z, vx, vy, vz, r, g, b, size, life, kind, grav){
  const i = pCursor; pCursor = (pCursor + 1) % PMAX;
  pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z; pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
  pCol[i * 3] = r; pCol[i * 3 + 1] = g; pCol[i * 3 + 2] = b; pSL[i * 3] = size; pSL[i * 3 + 1] = 1; pSL[i * 3 + 2] = kind; pLife[i] = life; pMax[i] = life; pGrav[i] = grav;
  pActive = PMAX;
}
function updateParticles(dt){
  if (!pActive) return;
  let any = 0;
  for (let i = 0; i < PMAX; i++){
    if (pLife[i] <= 0){ if (pSL[i * 3 + 1] !== 0){ pSL[i * 3 + 1] = 0; any = 1; } continue; }
    any = 1; pLife[i] -= dt;
    pVel[i * 3 + 1] -= pGrav[i] * dt;
    let nx = pPos[i * 3] + pVel[i * 3] * dt, ny = pPos[i * 3 + 1] + pVel[i * 3 + 1] * dt, nz = pPos[i * 3 + 2] + pVel[i * 3 + 2] * dt;
    if (pGrav[i] > 0 && solidAt(Math.floor(nx), Math.floor(ny), Math.floor(nz))){ pVel[i * 3] *= .4; pVel[i * 3 + 2] *= .4; pVel[i * 3 + 1] = 0; ny = pPos[i * 3 + 1]; nx = pPos[i * 3]; nz = pPos[i * 3 + 2]; }
    pPos[i * 3] = nx; pPos[i * 3 + 1] = ny; pPos[i * 3 + 2] = nz;
    const t = pLife[i] / pMax[i]; pSL[i * 3 + 1] = Math.min(1, t * 3);
  }
  const g = parts.geometry; g.attributes.position.needsUpdate = true; g.attributes.aSL.needsUpdate = true; g.attributes.aCol.needsUpdate = true;
  if (!any) pActive = 0;
}
function burst(x, y, z, id, n){
  const c = B_COL[id] || [.6, .6, .6];
  n = LOW ? Math.ceil(n * .5) : n;
  for (let i = 0; i < n; i++){ const k = .8 + rnd() * .35; emit(x + .2 + rnd() * .6, y + .2 + rnd() * .6, z + .2 + rnd() * .6, (rnd() - .5) * 3, 1.5 + rnd() * 3, (rnd() - .5) * 3, c[0] * k, c[1] * k, c[2] * k, .12 + rnd() * .08, .5 + rnd() * .5, 0, 14); }
}
function hearts(x, y, z, n){ for (let i = 0; i < n; i++) emit(x + (rnd() - .5) * .6, y + rnd() * .3, z + (rnd() - .5) * .6, (rnd() - .5) * .6, 1.2 + rnd() * .6, (rnd() - .5) * .6, .86, .42, .46, .32, 1.1 + rnd() * .4, 1, -0.4); }
function sparkle(x, y, z, n, r, g, b){ for (let i = 0; i < n; i++) emit(x + (rnd() - .5), y + rnd(), z + (rnd() - .5), (rnd() - .5) * .8, .5 + rnd(), (rnd() - .5) * .8, r, g, b, .35, .9 + rnd() * .5, 2, -0.2); }

