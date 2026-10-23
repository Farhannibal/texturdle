// Three.js model viewer for the final stage. Loaded lazily so the 3D code
// only downloads once a player reaches the model.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface Viewer {
  dispose(): void;
}

export async function mountViewer(container: HTMLElement, url: string): Promise<Viewer> {
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
  controls.autoRotate = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.autoRotateSpeed = 1.6;
  renderer.domElement.addEventListener("pointerdown", () => (controls.autoRotate = false), { once: true });

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
  scene.add(model);

  // Frame the model: centre it and back the camera off to fit its bounding sphere.
  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  model.position.sub(sphere.center);
  const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, sphere.radius * 0.25, dist * 1.05);
  camera.near = dist / 100;
  camera.far = dist * 10;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.minDistance = sphere.radius * 0.5;
  controls.maxDistance = dist * 3;

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    dispose() {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
