// One Three.js viewer for every stage. Texture hints are drawn on a flat plane the player
// can tilt and zoom; the final stage swaps in the model. Loaded lazily from main.ts.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface ShowOptions {
  animate?: boolean;
  /** Called once the content has loaded, before any spin starts. */
  onLoaded?: () => void;
}

export interface Viewer {
  /**
   * Show an image on a plane. With `animate`, the current content spins a few turns and the
   * new one is swapped in mid-spin. Resolves false if a newer show call replaced it first.
   */
  showImage(url: string, opts?: ShowOptions): Promise<boolean>;
  showModel(url: string, opts?: ShowOptions): Promise<boolean>;
  resetView(): void;
  dispose(): void;
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const SPIN_MS = 1500;
const SPIN_TURNS = 3;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Loaded content, ready to be placed in the scene. */
interface Prepared {
  object: THREE.Object3D;
  mode: "image" | "model";
  radius: number;
  lift: number;
}

interface Spin {
  start: number;
  next: Prepared;
  swapped: boolean;
  fromCamera: THREE.Vector3;
  fromTarget: THREE.Vector3;
  resolve: () => void;
}

export function createViewer(container: HTMLElement, outline = "#4a5064"): Viewer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(2, 4, 3);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotateSpeed = 1.6;

  let content: THREE.Object3D | null = null;
  let mode: "image" | "model" = "image";
  let idle = true; // until the player touches the view, it moves on its own
  let token = 0;
  let spin: Spin | null = null;
  const home = new THREE.Vector3();
  const clock = new THREE.Clock();

  const stopIdle = () => {
    idle = false;
    controls.autoRotate = false;
  };
  renderer.domElement.addEventListener("pointerdown", stopIdle);
  renderer.domElement.addEventListener("wheel", stopIdle, { passive: true });
  renderer.domElement.addEventListener("dblclick", () => resetView());

  function resetView() {
    camera.position.copy(home);
    controls.target.set(0, 0, 0);
    if (content && mode === "image") content.rotation.set(0, 0, 0);
    controls.update();
  }

  /** Point the camera at the origin from far enough back to fit an object of this radius. */
  function frame(radius: number, lift: number) {
    const dist = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    home.set(0, lift * radius, dist);
    camera.near = dist / 100;
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    controls.minDistance = radius * 0.15;
    controls.maxDistance = dist * 3;
    resetView();
  }

  function swap(next: THREE.Object3D, nextMode: "image" | "model") {
    if (content) {
      scene.remove(content);
      disposeTree(content);
    }
    content = next;
    mode = nextMode;
    scene.add(next);
    idle = !reducedMotion;
    controls.autoRotate = idle && mode === "model";
    clock.start();
  }

  function place(p: Prepared) {
    swap(p.object, p.mode);
    frame(p.radius, p.lift);
  }

  async function loadImage(url: string): Promise<Prepared> {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter; // keep texels crisp up close
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); // and readable when tilted

    const { width, height } = tex.image as HTMLImageElement;
    const w = width >= height ? 1 : width / height;
    const h = height >= width ? 1 : height / width;
    const geo = new THREE.PlaneGeometry(w, h);
    const group = new THREE.Group();
    // Unlit so the hint shows its true colours; empty sheet areas are cut out entirely.
    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.04 })));
    // An outline keeps the plane's edges visible where the sheet is transparent.
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: outline })));
    // Extra margin so the near edge stays in view while it sways.
    return { object: group, mode: "image", radius: (Math.max(w, h) / 2) * 1.22, lift: 0 };
  }

  async function loadModel(url: string): Promise<Prepared> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of [mesh.material].flat() as THREE.MeshStandardMaterial[]) {
        // Ripped models often have cutout textures and single-sided faces that look broken otherwise.
        m.side = THREE.DoubleSide;
        if (m.map) {
          m.map.magFilter = THREE.NearestFilter;
          m.alphaTest = 0.4;
        }
        m.metalness = 0;
        m.roughness = 1;
      }
    });
    // Centre the model on the origin so orbiting feels natural.
    const sphere = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
    model.position.sub(sphere.center);
    // frame() fits a flat object; a sphere seen in perspective needs a bit more room.
    const half = THREE.MathUtils.degToRad(camera.fov / 2);
    return { object: new THREE.Group().add(model), mode: "model", radius: (sphere.radius * 1.05 * Math.tan(half)) / Math.sin(half), lift: 0.25 };
  }

  async function show(load: Promise<Prepared>, { animate = false, onLoaded }: ShowOptions = {}) {
    const mine = ++token;
    const next = await load;
    if (mine !== token) return disposeTree(next.object), false;
    onLoaded?.();
    if (animate && content && !reducedMotion) {
      await new Promise<void>((resolve) => {
        finishSpin();
        idle = false;
        controls.autoRotate = false;
        controls.enabled = false;
        spin = { start: performance.now(), next, swapped: false, fromCamera: camera.position.clone(), fromTarget: controls.target.clone(), resolve };
      });
    } else {
      finishSpin();
      place(next);
    }
    return true;
  }

  // The spin: content turns SPIN_TURNS times, easing in and out. A plane is swapped for the
  // next plane at the edge-on moment just past halfway, so the change is never seen. The model
  // instead grows in from nothing as the plane shrinks away.
  function stepSpin(s: Spin, now: number) {
    const t = clamp01((now - s.start) / SPIN_MS);
    const total = SPIN_TURNS * Math.PI * 2;
    const angle = easeInOutCubic(t) * total;
    const toModel = s.next.mode === "model";
    const swapAt = toModel ? total / 2 : total / 2 + Math.PI / 2;

    if (!s.swapped && angle >= swapAt) {
      place(s.next);
      s.swapped = true;
    }
    if (!s.swapped) {
      // Ease the camera back to the front view the player left.
      const k = easeInOutCubic(clamp01(angle / swapAt));
      camera.position.lerpVectors(s.fromCamera, home, k);
      controls.target.lerpVectors(s.fromTarget, new THREE.Vector3(), k);
      camera.lookAt(controls.target);
    }
    if (content) {
      content.rotation.y = angle;
      const scale = !toModel ? 1 : s.swapped ? easeOutBack(clamp01((angle - swapAt) / (total - swapAt))) : 1 - clamp01((angle - (swapAt - Math.PI)) / Math.PI);
      content.scale.setScalar(Math.max(scale, 0.001));
    }
    if (t >= 1) finishSpin();
  }

  function finishSpin() {
    const s = spin;
    if (!s) return;
    spin = null;
    if (!s.swapped) place(s.next);
    content?.rotation.set(0, 0, 0);
    content?.scale.setScalar(1);
    controls.enabled = true;
    idle = !reducedMotion;
    controls.autoRotate = idle && mode === "model";
    clock.start();
    s.resolve();
  }

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    if (spin) stepSpin(spin, performance.now());
    else {
      // A slow sway hints that the plane can be turned, without ever going edge-on.
      if (idle && mode === "image" && content) content.rotation.y = Math.sin(clock.getElapsedTime() * 0.8) * 0.22;
      controls.update();
    }
    renderer.render(scene, camera);
  });

  return {
    showImage: (url, opts) => show(loadImage(url), opts),
    showModel: (url, opts) => show(loadModel(url), opts),
    resetView,
    dispose() {
      token++;
      spin = null;
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      if (content) disposeTree(content);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.geometry) return;
    mesh.geometry.dispose();
    for (const m of [mesh.material].flat() as THREE.MeshBasicMaterial[]) {
      m.map?.dispose();
      m.dispose();
    }
  });
}
