import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { BASE_URL } from '../config.js';

/**
 * Thin wrapper around GLTFLoader: shared manager (so we can report a single
 * progress value to the loading screen), meshopt decoding for our compressed
 * assets, and a tiny cache so a model is only ever fetched once.
 */
export class AssetLoader {
  constructor({ onProgress } = {}) {
    this.manager = new THREE.LoadingManager();
    this.cache = new Map();
    this.onProgress = onProgress;

    this.manager.onProgress = (_url, loaded, total) => {
      this.onProgress?.(total ? loaded / total : 0);
    };

    this.gltf = new GLTFLoader(this.manager).setPath(BASE_URL);
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
  }

  /** Loads a GLB once; later calls return a fresh SkeletonUtils-safe clone source. */
  load(path) {
    if (!this.cache.has(path)) {
      this.cache.set(
        path,
        this.gltf.loadAsync(path).then((gltf) => {
          gltf.scene.traverse((object) => {
            if (!object.isMesh) return;
            object.castShadow = true;
            object.receiveShadow = true;
            object.frustumCulled = false;
            const material = object.material;
            if (material && 'envMapIntensity' in material) material.envMapIntensity = 1.15;
          });
          return gltf;
        }),
      );
    }
    return this.cache.get(path);
  }

  loadAll(paths) {
    return Promise.all(paths.map((path) => this.load(path)));
  }
}
