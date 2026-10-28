/* Stand-ins so any one module can be developed and tested without the others. */
(() => {
const M = window.MAC;
if (!M.createScene) M.createScene = el => {
  const renderer = new THREE.WebGLRenderer({ antialias: true }); el.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, .05, 50); camera.position.set(0, 1.4, 1.6); camera.lookAt(0, 1, 0);
  const tex = new THREE.Texture(); const screen = new THREE.Mesh(new THREE.PlaneGeometry(.48, .36), new THREE.MeshBasicMaterial({ map: tex })); screen.position.set(0, 1.15, 0); scene.add(screen);
  const keys = {}; const kb = new THREE.Group(); kb.position.set(0, .78, .35); scene.add(kb);
  'QWERTYUIOP'.split('').forEach((c, i) => { const k = new THREE.Mesh(new THREE.BoxGeometry(.017, .008, .017), new THREE.MeshBasicMaterial({ color: 0xccc0a8 })); k.position.set(-.09 + i * .019, 0, 0); kb.add(k); keys['Key' + c] = k; });
  return { renderer, scene, camera, screenAspect: 4 / 3,
    setScreenCanvas(c){ tex.image = c; tex.needsUpdate = true; }, markScreenDirty(){ tex.needsUpdate = true; },
    keyboard: { hasKey: c => !!keys[c], keyWorldPos: c => keys[c] ? keys[c].getWorldPosition(new THREE.Vector3()) : null, keyRow: () => 1, press: c => keys[c] && (keys[c].position.y = -.004), release: c => keys[c] && (keys[c].position.y = 0) },
    rig: { seat: new THREE.Vector3(0, .45, .9), keyboardCenter: new THREE.Vector3(0, .78, .35), keyboardNormal: new THREE.Vector3(0, 1, 0), screenCenter: new THREE.Vector3(0, 1.15, 0) },
    add: o => scene.add(o), setView(){}, setPointer(){}, update(){}, render(){ renderer.render(scene, camera); },
    resize(w, h){ renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); } };
};
if (!M.createTypist) M.createTypist = api => ({ object3d: new THREE.Group(), keyDown(c){ api.keyboard.press(c); }, keyUp(c){ api.keyboard.release(c); }, update(){} });
if (!M.createTerminal) M.createTerminal = ({ aspect }) => {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = Math.round(1024 / aspect); const x = canvas.getContext('2d');
  let line = '', dirty = true;
  const draw = () => { x.fillStyle = '#0a0d0a'; x.fillRect(0, 0, canvas.width, canvas.height); x.fillStyle = '#d8f0c8'; x.font = '40px VT323, monospace'; x.fillText('> ' + line + '_', 30, 70); };
  return { canvas, handleKey(e){ if (e.key.length === 1){ line += e.key; dirty = true; return true; } if (e.key === 'Backspace'){ line = line.slice(0, -1); dirty = true; return true; } if (e.key === 'Enter'){ line = ''; dirty = true; return true; } return false; },
    insertText(s){ line += s; dirty = true; }, run(){}, update(){ if (dirty){ draw(); dirty = false; return true; } return false; } };
};
})();
