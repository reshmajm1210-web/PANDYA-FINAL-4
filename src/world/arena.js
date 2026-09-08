import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ASSETS, CAMERA } from '../config.js';

/** Places a loaded model on the ground at a given size, centred on X/Z. */
function fitModel(object, { height, width, position = [0, 0, 0], rotationY = 0, yOffset = 0 }) {
  const wrapper = new THREE.Group();
  wrapper.add(object);

  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const scale = height ? height / size.y : width / Math.max(size.x, size.z);
  object.scale.multiplyScalar(scale);

  const scaled = new THREE.Box3().setFromObject(object);
  const centre = scaled.getCenter(new THREE.Vector3());
  object.position.x -= centre.x;
  object.position.z -= centre.z;
  object.position.y -= scaled.min.y - yOffset;

  wrapper.position.set(position[0], position[1], position[2]);
  wrapper.rotation.y = rotationY;
  return wrapper;
}

/** Procedural sand/dust ground texture — avoids shipping another image. */
function makeGroundTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  const base = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.52);
  base.addColorStop(0, '#a98459');
  base.addColorStop(0.55, '#8a6942');
  base.addColorStop(1, '#5d4429');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // speckle
  for (let i = 0; i < 24000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 2.2;
    const shade = 40 + Math.random() * 90;
    ctx.fillStyle = `rgba(${shade + 60}, ${shade + 34}, ${shade}, ${Math.random() * 0.35})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // duelling ring
  ctx.strokeStyle = 'rgba(226, 200, 147, 0.5)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.375, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(226, 200, 147, 0.22)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.415, 0, Math.PI * 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 top;
  uniform vec3 middle;
  uniform vec3 bottom;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;

  void main() {
    vec3 dir = normalize(vWorld);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 sky = mix(bottom, middle, smoothstep(0.36, 0.52, h));
    sky = mix(sky, top, smoothstep(0.5, 0.95, h));
    float sun = pow(max(dot(dir, normalize(sunDirection)), 0.0), 90.0);
    float halo = pow(max(dot(dir, normalize(sunDirection)), 0.0), 6.0) * 0.35;
    gl_FragColor = vec4(sky + sunColor * (sun + halo), 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * Builds the battlefield: sky dome, lighting rig, ground and the temple/palace
 * skyline that frames the duel, plus the ambient dust that sells the scale.
 */
export class Arena {
  constructor(renderer, loader) {
    this.renderer = renderer;
    this.loader = loader;
    this.clockOffset = Math.random() * 100;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xc79a62, 26, 74);

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 400);
    this.camera.position.fromArray(CAMERA.position);
    this.cameraTarget = new THREE.Vector3().fromArray(CAMERA.target);
    this.cameraBase = this.camera.position.clone();
    this.camera.lookAt(this.cameraTarget);

    this.shake = 0;
    this._tmp = new THREE.Vector3();

    this.#buildSky();
    this.#buildLights();
    this.#buildGround();
    this.#buildDust();
  }

  #buildSky() {
    const sunDirection = new THREE.Vector3(-0.45, 0.36, -1).normalize();
    this.sunDirection = sunDirection;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(180, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color('#2c4f86') },
          middle: { value: new THREE.Color('#c98f56') },
          bottom: { value: new THREE.Color('#f0c489') },
          sunDirection: { value: sunDirection },
          sunColor: { value: new THREE.Color('#ffd9a0') },
        },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
      }),
    );
    sky.frustumCulled = false;
    this.scene.add(sky);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;
    this.scene.environmentIntensity = 0.42;
  }

  #buildLights() {
    const hemi = new THREE.HemisphereLight(0xffdcb0, 0x4a3520, 1.15);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffdca8, 2.6);
    sun.position.set(-7, 11, -8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 42;
    sun.shadow.camera.left = -11;
    sun.shadow.camera.right = 11;
    sun.shadow.camera.top = 11;
    sun.shadow.camera.bottom = -6;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.028;
    this.sun = sun;
    this.scene.add(sun, sun.target);

    // Team rim lights: emerald on the player's side, blood red on the king's.
    const green = new THREE.PointLight(0x39d16f, 26, 16, 2);
    green.position.set(-5.2, 2.4, 2.6);
    const red = new THREE.PointLight(0xf0432c, 26, 16, 2);
    red.position.set(5.2, 2.4, 2.6);
    const fill = new THREE.DirectionalLight(0x9fc6ff, 0.55);
    fill.position.set(4, 5, 9);
    this.scene.add(green, red, fill);
    this.rimLights = { green, red };
  }

  #buildGround() {
    const texture = makeGroundTexture();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;

    const arena = new THREE.Mesh(
      new THREE.CircleGeometry(11, 64),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.96, metalness: 0.02 }),
    );
    arena.rotation.x = -Math.PI / 2;
    arena.receiveShadow = true;
    this.scene.add(arena);

    const plainTexture = texture.clone();
    plainTexture.needsUpdate = true;
    plainTexture.repeat.set(9, 9);
    const plain = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 260),
      new THREE.MeshStandardMaterial({ map: plainTexture, roughness: 1, metalness: 0, color: 0x9d7c52 }),
    );
    plain.rotation.x = -Math.PI / 2;
    plain.position.y = -0.02;
    plain.receiveShadow = true;
    this.scene.add(plain);

    // Team markers: emerald for the player's side, blood red for the king's.
    this.markers = {};
    for (const [side, color] of [['player', 0x37d16a], ['enemy', 0xec4433]]) {
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.62, 48),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.y = 0.012;
      marker.renderOrder = 2;
      this.markers[side] = marker;
      this.scene.add(marker);
    }

    // Soft contact shadow under the ring keeps the fighters grounded.
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(9.2, 48),
      new THREE.MeshBasicMaterial({ color: 0x2a1a0c, transparent: true, opacity: 0.22 }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.005;
    this.scene.add(pool);
  }

  #buildDust() {
    const count = 320;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 22;
      positions[i * 3 + 1] = Math.random() * 6.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 14;
      speeds[i] = 0.08 + Math.random() * 0.22;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const dust = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xffd9a0,
        size: 0.05,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    dust.frustumCulled = false;
    this.dust = { points: dust, speeds };
    this.scene.add(dust);
  }

  /** Loads and places the skyline. Called after the characters so the duel starts fast. */
  async buildSkyline() {
    const [palace, tower, temple] = await Promise.all([
      this.loader.load(ASSETS.scenery.palace),
      this.loader.load(ASSETS.scenery.tower),
      this.loader.load(ASSETS.scenery.temple),
    ]);

    const group = new THREE.Group();

    group.add(fitModel(palace.scene.clone(true), { height: 15, position: [0, -0.4, -34], rotationY: Math.PI }));
    group.add(fitModel(tower.scene.clone(true), { height: 9.5, position: [-13.5, -0.2, -15], rotationY: 0.5 }));
    group.add(fitModel(tower.scene.clone(true), { height: 9.5, position: [13.5, -0.2, -15], rotationY: -0.5 }));
    group.add(fitModel(temple.scene.clone(true), { width: 16, position: [-19, -0.3, -27], rotationY: 0.35 }));
    group.add(fitModel(temple.scene.clone(true), { width: 16, position: [19, -0.3, -27], rotationY: -0.35 }));

    group.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = false;
      object.frustumCulled = true;
    });

    this.scene.add(group);
    this.skyline = group;

    // Banners flanking the arena — cheap geometry, big atmosphere.
    this.#buildBanners();
  }

  #buildBanners() {
    const banners = new THREE.Group();
    const poleGeometry = new THREE.CylinderGeometry(0.055, 0.07, 4.6, 8);
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x4c3418, roughness: 0.8, metalness: 0.15 });
    const clothGeometry = new THREE.PlaneGeometry(0.95, 2.1, 6, 10);

    const spots = [
      [-7.6, -3.6, 0x2f9c53],
      [-8.6, 1.8, 0x2f9c53],
      [7.6, -3.6, 0xb32b1c],
      [8.6, 1.8, 0xb32b1c],
    ];

    this.banners = [];
    for (const [x, z, color] of spots) {
      const pole = new THREE.Mesh(poleGeometry, poleMaterial);
      pole.position.set(x, 2.3, z);
      pole.castShadow = true;

      const cloth = new THREE.Mesh(
        clothGeometry.clone(), // each banner ripples independently
        new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide }),
      );
      cloth.position.set(x + (x < 0 ? 0.5 : -0.5), 3.15, z);
      cloth.rotation.y = x < 0 ? -0.25 : 0.25;
      cloth.castShadow = true;
      this.banners.push({ mesh: cloth, base: cloth.geometry.attributes.position.array.slice(), phase: Math.random() * 7 });
      banners.add(pole, cloth);
    }
    this.scene.add(banners);
  }

  /**
   * Wraps a wide war-scene image behind the battleground. The player can swap
   * `public/assets/war-background.png` for their own art — the game just shows
   * whatever image lives there. Falls back to the procedural sky if missing.
   */
  async buildBackdrop() {
    try {
      // ?v= token busts the browser cache so a replaced image always shows.
      const texture = await this.loader.loadTexture('war-background.png?v=4');
      // A large curved wall of the battle scene wraps behind the duel so the
      // fight always reads as part of a raging war, edge to edge on any screen.
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(190, 80),
        new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, fog: false, depthWrite: false }),
      );
      plane.position.set(0, 11, -48);
      plane.renderOrder = -1;
      plane.frustumCulled = false;
      this.scene.add(plane);
      this.backdrop = plane;

      // War effects that live on top of the backdrop: a warm smoke/fire glow and
      // drifting embers rising off the distant battlefield.
      this.#buildWarEffects();
    } catch (err) {
      // No image present — keep the procedural sky.
    }
  }

  /** Adds embers + a fiery horizon glow so the arena feels like a live warzone. */
  #buildWarEffects() {
    // Warm glow washing up from the battlefield horizon behind the fighters.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(190, 34),
      new THREE.MeshBasicMaterial({
        color: 0xff6b1e,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.position.set(0, 2.5, -45.5);
    glow.renderOrder = -1;
    glow.frustumCulled = false;
    this.scene.add(glow);
    this.warGlow = glow;

    // Rising embers — small additive sparks blown across the field.
    const count = 220;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const drift = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 70;
      positions[i * 3 + 1] = Math.random() * 22;
      positions[i * 3 + 2] = -12 - Math.random() * 30;
      speeds[i] = 0.6 + Math.random() * 1.7;
      drift[i] = Math.random() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffb257,
      size: 0.14,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const embers = new THREE.Points(geometry, material);
    embers.frustumCulled = false;
    this.scene.add(embers);
    this.embers = { points: embers, speeds, drift, count };
  }

  /** Keeps the team markers and rim lights glued to the duellists. */
  trackFighters(playerX, enemyX, elapsed = 0) {
    const pulse = 1 + Math.sin(elapsed * 2.4) * 0.04;
    if (this.markers.player) {
      this.markers.player.position.x = playerX;
      this.markers.player.scale.setScalar(pulse);
    }
    if (this.markers.enemy) {
      this.markers.enemy.position.x = enemyX;
      this.markers.enemy.scale.setScalar(2 - pulse);
    }
    this.rimLights.green.position.x = playerX - 2.2;
    this.rimLights.red.position.x = enemyX + 2.2;
    this.sun.target.position.set((playerX + enemyX) * 0.5, 1, 0);
    this.sun.target.updateMatrixWorld();
  }

  addShake(amount) {
    this.shake = Math.min(1.1, this.shake + amount);
  }

  resize(width, height) {
    this.camera.aspect = width / height;
    // Portrait phones need to pull back so both fighters stay in frame.
    const portraitPull = THREE.MathUtils.clamp(1.35 - this.camera.aspect * 0.42, 0, 0.85);
    this.camera.position.z = CAMERA.position[2] + portraitPull * 4.6;
    this.camera.position.y = CAMERA.position[1] + portraitPull * 0.5;
    this.cameraBase.copy(this.camera.position);
    this.camera.updateProjectionMatrix();
  }

  update(dt, elapsed) {
    // Slow cinematic drift + decaying impact shake.
    const sway = Math.sin((elapsed + this.clockOffset) * CAMERA.swaySpeed) * CAMERA.swayAmplitude;
    const bob = Math.cos((elapsed + this.clockOffset) * CAMERA.swaySpeed * 1.7) * CAMERA.swayAmplitude * 0.35;
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const shake = this.shake * this.shake;

    this.camera.position.set(
      this.cameraBase.x + sway + (Math.random() - 0.5) * shake * 0.42,
      this.cameraBase.y + bob + (Math.random() - 0.5) * shake * 0.3,
      this.cameraBase.z + (Math.random() - 0.5) * shake * 0.16,
    );
    this.camera.lookAt(this.cameraTarget);

    // Ambient dust rises and loops.
    const positions = this.dust.points.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      let y = positions.getY(i) + this.dust.speeds[i] * dt;
      if (y > 7) y = -0.2;
      positions.setY(i, y);
      positions.setX(i, positions.getX(i) + Math.sin(elapsed * 0.4 + i) * dt * 0.06);
    }
    positions.needsUpdate = true;

    // Rising war embers loop up the battlefield with a little sideways drift.
    if (this.embers) {
      const pos = this.embers.points.geometry.attributes.position;
      for (let i = 0; i < this.embers.count; i++) {
        let y = pos.getY(i) + this.embers.speeds[i] * dt;
        if (y > 24) {
          y = -1;
          pos.setX(i, (Math.random() - 0.5) * 70);
        }
        pos.setY(i, y);
        pos.setX(i, pos.getX(i) + Math.sin(elapsed * 0.6 + this.embers.drift[i]) * dt * 0.5);
      }
      pos.needsUpdate = true;
    }
    if (this.warGlow) {
      this.warGlow.material.opacity = 0.18 + Math.abs(Math.sin(elapsed * 0.9)) * 0.12;
    }

    // Banner cloth ripple.
    if (this.banners) {
      for (const banner of this.banners) {
        const attribute = banner.mesh.geometry.attributes.position;
        for (let i = 0; i < attribute.count; i++) {
          const x = banner.base[i * 3];
          const y = banner.base[i * 3 + 1];
          attribute.setZ(i, Math.sin(elapsed * 2.4 + banner.phase + x * 3 + y * 1.2) * 0.09 * (0.5 + x + 0.5));
        }
        attribute.needsUpdate = true;
      }
    }
  }
}
