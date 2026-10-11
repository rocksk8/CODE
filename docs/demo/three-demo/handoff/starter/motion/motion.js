// Motion starter (ES module). Needs a local web server (e.g. `npx serve .`) because it uses modules; three.js loads from a CDN import map in motion/index.html.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; // always respect this
export const stages = {};

// t0: three.js scene facts were captured (BoxGeometry, TorusGeometry; camera fov 50, position [0, 0.5, 4]; 2 moving object(s)).
// Geometry sizes and exact positions are NOT captured: treat this as a scaffold and refine against the filmstrip.
{
  const canvas = document.querySelector('canvas[data-motion="t0"]');
  if (canvas) {
    import('three').then((THREE) => {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(50, 3 / 2, 0.1, 100); camera.position.set(0, 0.5, 4);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6)); const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(3, 4, 5); scene.add(key);
      const colors = ["#ff6633","#66ccff"];
      const kinds = ["BoxGeometry","TorusGeometry"];
      const make = (k) => (k === 'SphereGeometry' ? new THREE.SphereGeometry(0.7, 32, 16) : k === 'TorusGeometry' ? new THREE.TorusGeometry(0.6, 0.22, 16, 48) : k === 'PlaneGeometry' ? new THREE.PlaneGeometry(2, 2) : k === 'ConeGeometry' ? new THREE.ConeGeometry(0.6, 1.2, 32) : k === 'CylinderGeometry' ? new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32) : new THREE.BoxGeometry(1, 1, 1));
      const meshes = kinds.map((k, i) => { const m = new THREE.Mesh(make(k), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.5, metalness: 0.2 })); m.position.x = (i - (kinds.length - 1) / 2) * 1.6; scene.add(m); return m; });
      const speed = 0.795; // rad/s measured from the source (0 = static)
      const fit = () => { const w = canvas.clientWidth || 600, h = canvas.clientHeight || 400; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
      fit(); addEventListener('resize', fit);
      const clock = new THREE.Clock(); renderer.setAnimationLoop(() => { const dt = clock.getDelta(); if (!reduce) for (const m of meshes) { m.rotation.y += speed * dt; m.rotation.x += speed * dt * 0.4; } renderer.render(scene, camera); });
      stages['t0'] = { renderer, scene, camera, meshes };
    });
  }
}
