import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js";

// Scene
const scene = new THREE.Scene();

// Camera
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

camera.position.set(0, 2, 8);

// Renderer
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x000000, 0);

document.body.appendChild(renderer.domElement);

// Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enableZoom = false;
controls.target.set(0, 1, 0);

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 3);
scene.add(ambientLight);

const dirLight1 = new THREE.DirectionalLight(0xffffff, 4);
dirLight1.position.set(5, 10, 5);
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0xffffff, 2);
dirLight2.position.set(-5, 5, -5);
scene.add(dirLight2);

// Loader
const loader = new GLTFLoader();

// Hero
loader.load(
  "models/hero.glb",

  (gltf) => {
    const hero = gltf.scene;

    hero.position.set(-2.5, -1, 0);
    hero.rotation.y = Math.PI / 2;
    hero.scale.set(2.5, 2.5, 2.5);

    scene.add(hero);

    console.log("✅ Hero Loaded");
  },

  undefined,

  (error) => {
    console.error("❌ Hero Loading Error", error);
    alert("Hero model not found!");
  }
);

// Villain
loader.load(
  "models/villan.glb",

  (gltf) => {
    const villain = gltf.scene;

    villain.position.set(2.5, -1, 0);
    villain.rotation.y = -Math.PI / 2;
    villain.scale.set(2.5, 2.5, 2.5);

    scene.add(villain);

    console.log("✅ Villain Loaded");
  },

  undefined,

  (error) => {
    console.error("❌ Villain Loading Error", error);
    alert("Villain model not found!");
  }
);

// Ground Shadow
const plane = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.ShadowMaterial({ opacity: 0.25 })
);

plane.rotation.x = -Math.PI / 2;
plane.position.y = -1.05;
scene.add(plane);

// Animation
function animate() {
  requestAnimationFrame(animate);

  controls.update();
  renderer.render(scene, camera);
}

animate();

// Resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});