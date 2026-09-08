import * as THREE from 'three';

const MAX_PARTICLES = 900;
const tmp = new THREE.Vector3();

/**
 * All the sparkle: sparks on impact, parry flashes, heal aura, ground rings,
 * arrow projectiles and weapon swooshes. One pooled Points cloud drives the
 * particles so the whole thing stays a single draw call.
 */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.rings = [];
    this.arrows = [];
    this.trails = [];

    const positions = new Float32Array(MAX_PARTICLES * 3);
    const colors = new Float32Array(MAX_PARTICLES * 3);
    const sizes = new Float32Array(MAX_PARTICLES);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // PointsMaterial cannot vary size per particle, so a tiny custom shader
    // gives every spark its own world-space size with correct perspective.
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        map: { value: Effects.#sprite() },
        uHeight: { value: 800 },
        uTanFov: { value: Math.tan(THREE.MathUtils.degToRad(40) / 2) },
      },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uHeight;
        uniform float uTanFov;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.0, size * 0.055 * (uHeight * 0.5) / (uTanFov * max(0.001, -mv.z)));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec3 vColor;
        void main() {
          vec4 texel = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, 1.0) * texel;
          if (gl_FragColor.a < 0.01) discard;
        }
      `,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    this.pool = Array.from({ length: MAX_PARTICLES }, () => ({
      life: 0,
      maxLife: 1,
      velocity: new THREE.Vector3(),
      gravity: -4,
      drag: 0.94,
      size: 1,
      color: new THREE.Color(),
      position: new THREE.Vector3(),
    }));
    this.cursor = 0;
  }

  /** Keeps point sizes physically correct when the viewport changes. */
  setViewport(height, fovDegrees) {
    this.points.material.uniforms.uHeight.value = height;
    this.points.material.uniforms.uTanFov.value = Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2);
  }

  static #sprite() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,240,200,0.85)');
    gradient.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  #spawn(config) {
    const particle = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    Object.assign(particle, config);
    particle.maxLife = config.life;
    return particle;
  }

  /* ------------------------------------------------------------- bursts */

  burst(position, { count = 26, color = '#ffcf7a', speed = 4.2, spread = 1, size = 1, gravity = -6, life = 0.5 } = {}) {
    const base = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const direction = new THREE.Vector3(
        (Math.random() - 0.5) * 2 * spread,
        Math.random() * 1.1,
        (Math.random() - 0.5) * 2 * spread,
      ).normalize();
      this.#spawn({
        position: position.clone(),
        velocity: direction.multiplyScalar(speed * (0.45 + Math.random() * 0.85)),
        life: life * (0.6 + Math.random() * 0.7),
        gravity,
        drag: 0.93,
        size: size * (0.5 + Math.random() * 0.9),
        color: base.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.18),
      });
    }
  }

  impact(position, { color = '#ffd48a', crit = false } = {}) {
    this.burst(position, { count: crit ? 48 : 26, color, speed: crit ? 6.5 : 4.4, size: crit ? 1.5 : 1 });
    this.ring(position, { color, radius: crit ? 1.6 : 1.05, life: 0.42 });
  }

  block(position) {
    this.burst(position, { count: 22, color: '#9fd0ff', speed: 3.4, size: 0.9, life: 0.42 });
    this.ring(position, { color: '#8fc6ff', radius: 0.9, life: 0.35, tilt: true });
  }

  heal(position) {
    for (let i = 0; i < 46; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.25 + Math.random() * 0.45;
      this.#spawn({
        position: new THREE.Vector3(position.x + Math.cos(angle) * radius, position.y - 0.85 + Math.random() * 0.4, position.z + Math.sin(angle) * radius),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.5 + Math.random() * 1.4, (Math.random() - 0.5) * 0.4),
        life: 0.9 + Math.random() * 0.5,
        gravity: 1.2,
        drag: 0.99,
        size: 0.9 + Math.random() * 0.7,
        color: new THREE.Color('#6dffa8').offsetHSL(0, 0, Math.random() * 0.2),
      });
    }
    this.ring(position.clone().setY(0.03), { color: '#5cff9d', radius: 1.5, life: 0.7, flat: true });
  }

  dust(position, amount = 12) {
    for (let i = 0; i < amount; i++) {
      this.#spawn({
        position: position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.02, (Math.random() - 0.5) * 0.4)),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 1.4, Math.random() * 0.9, (Math.random() - 0.5) * 1.4),
        life: 0.5 + Math.random() * 0.4,
        gravity: -1.4,
        drag: 0.9,
        size: 1.4 + Math.random(),
        color: new THREE.Color('#c9a570'),
      });
    }
  }

  /* -------------------------------------------------------------- rings */

  ring(position, { color = '#ffd48a', radius = 1, life = 0.4, flat = false, tilt = false } = {}) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.22, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    mesh.position.copy(position);
    if (flat) mesh.rotation.x = -Math.PI / 2;
    else if (tilt) mesh.rotation.set(-0.4, 0, 0);
    mesh.renderOrder = 4;
    this.scene.add(mesh);
    this.rings.push({ mesh, life, maxLife: life, radius });
  }

  /** Curved swoosh that traces a weapon swing. */
  swoosh(position, facing, color = '#ffe9b0') {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.75, 0.045, 6, 22, Math.PI * 0.85),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    mesh.position.copy(position);
    mesh.rotation.set(Math.PI / 2, 0, facing > 0 ? -0.6 : Math.PI + 0.6);
    mesh.renderOrder = 4;
    this.scene.add(mesh);
    this.trails.push({ mesh, life: 0.28, maxLife: 0.28 });
  }

  /* ------------------------------------------------------------- arrows */

  arrow(from, to, { onHit, speed = 17, color = '#f4dfae' } = {}) {
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.8, 6),
      new THREE.MeshStandardMaterial({ color: '#7a5427', roughness: 0.8 }),
    );
    shaft.rotation.z = Math.PI / 2;
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.035, 0.13, 8),
      new THREE.MeshStandardMaterial({ color: '#d9d2c4', metalness: 0.85, roughness: 0.3 }),
    );
    head.rotation.z = -Math.PI / 2;
    head.position.x = 0.45;
    const fletch = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.09),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    fletch.position.x = -0.36;
    group.add(shaft, head, fletch);
    group.position.copy(from);

    const direction = to.clone().sub(from);
    const distance = direction.length();
    direction.normalize();
    group.rotation.y = direction.x >= 0 ? 0 : Math.PI;
    this.scene.add(group);
    this.arrows.push({ mesh: group, from: from.clone(), to: to.clone(), t: 0, duration: distance / speed, onHit });
  }

  /* -------------------------------------------------------------- update */

  update(dt) {
    const positions = this.points.geometry.attributes.position;
    const colors = this.points.geometry.attributes.color;
    const sizes = this.points.geometry.attributes.size;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const particle = this.pool[i];
      if (particle.life <= 0) {
        positions.setXYZ(i, 0, -999, 0);
        continue;
      }
      particle.life -= dt;
      particle.velocity.y += particle.gravity * dt;
      particle.velocity.multiplyScalar(particle.drag);
      particle.position.addScaledVector(particle.velocity, dt);

      const fade = Math.max(0, particle.life / particle.maxLife);
      positions.setXYZ(i, particle.position.x, particle.position.y, particle.position.z);
      colors.setXYZ(i, particle.color.r * fade, particle.color.g * fade, particle.color.b * fade);
      sizes.setX(i, particle.size * fade);
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    sizes.needsUpdate = true;

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.life -= dt;
      const t = 1 - ring.life / ring.maxLife;
      const scale = 0.4 + t * ring.radius * 4;
      ring.mesh.scale.setScalar(scale);
      ring.mesh.material.opacity = Math.max(0, 0.9 * (1 - t));
      if (ring.life <= 0) {
        this.scene.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        ring.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }

    for (let i = this.trails.length - 1; i >= 0; i--) {
      const trail = this.trails[i];
      trail.life -= dt;
      const t = 1 - trail.life / trail.maxLife;
      trail.mesh.scale.setScalar(1 + t * 0.5);
      trail.mesh.material.opacity = Math.max(0, 0.85 * (1 - t));
      if (trail.life <= 0) {
        this.scene.remove(trail.mesh);
        trail.mesh.geometry.dispose();
        trail.mesh.material.dispose();
        this.trails.splice(i, 1);
      }
    }

    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const arrow = this.arrows[i];
      arrow.t += dt;
      const t = Math.min(1, arrow.t / arrow.duration);
      arrow.mesh.position.lerpVectors(arrow.from, arrow.to, t);
      arrow.mesh.position.y += Math.sin(t * Math.PI) * 0.22; // gentle arc
      if (t >= 1) {
        this.burst(arrow.mesh.position, { count: 16, color: '#ffd7a0', speed: 3, life: 0.35 });
        this.scene.remove(arrow.mesh);
        arrow.mesh.traverse((object) => {
          if (object.isMesh) {
            object.geometry.dispose();
            object.material.dispose();
          }
        });
        this.arrows.splice(i, 1);
        arrow.onHit?.();
      }
    }
  }
}

export { tmp as scratch };
