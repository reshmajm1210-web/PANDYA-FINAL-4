/**
 * Asset pipeline for "Pandya: Empire of Warriors".
 *
 * Source art lives in /aset (raw Mixamo FBX rigs + Sketchfab GLB props). Those files
 * are far too heavy to ship to a browser (≈260 MB), and the rigged FBX characters lost
 * their textures on the Mixamo round-trip. This script:
 *
 *   1. Converts the FBX rigs / animation clips to glTF with FBX2glTF.
 *   2. Re-attaches the original 2K colour map (taken from the untextured-but-textured
 *      Meshy GLB export) to the rigged mesh - UVs survive the Mixamo round trip.
 *   3. Merges every animation clip onto the single shared skeleton and renames the
 *      clips to the semantic names the game asks for (idle / walk / attack / ...).
 *   4. Strips root motion from locomotion clips (movement is driven by game code).
 *   5. Welds + simplifies geometry, compresses textures to WebP and applies
 *      EXT_meshopt_compression so the whole game loads in a few MB.
 *
 * Run with:  npm run assets
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  mergeDocuments,
  metalRough,
  meshopt,
  prune,
  quantize,
  reorder,
  resample,
  simplify,
  textureCompress,
  unpartition,
  weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'aset');
const OUT = path.join(ROOT, 'public/assets');
const CACHE = path.join(ROOT, 'tools/.cache');
const FBX2GLTF = path.join(ROOT, 'node_modules/fbx2gltf/bin/Linux/FBX2glTF');

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

await MeshoptSimplifier.ready;

const mkdir = (p) => fs.mkdirSync(p, { recursive: true });
const mb = (p) => (fs.statSync(p).size / 1048576).toFixed(2) + ' MB';

/* ------------------------------------------------------------------ FBX → GLB */

function fbx2glb(fbxPath) {
  const key = fbxPath.replace(SRC + '/', '').replace(/[^a-z0-9]+/gi, '_');
  const out = path.join(CACHE, key + '.glb');
  if (fs.existsSync(out)) return out;
  mkdir(CACHE);
  execFileSync(
    FBX2GLTF,
    ['-i', fbxPath, '-o', out.replace(/\.glb$/, ''), '--binary', '--pbr-metallic-roughness', '--anim-framerate', 'bake30'],
    { stdio: 'pipe' },
  );
  return out;
}

/** Removes an extension (and its properties) from a document. */
function dropExtension(doc, name) {
  for (const extension of doc.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === name) extension.dispose();
  }
}

/* ------------------------------------------------------------ geometry weld */

/**
 * FBX2glTF emits fully un-indexed triangle soup, so the stock (exact-match) weld
 * finds nothing to merge and the simplifier cannot collapse a single edge. This
 * welds vertices that share a position/uv within a tolerance, which restores a
 * real triangle topology and lets `simplify()` do its job.
 */
function weldTolerant(doc, { positionTolerance = 1e-4, uvTolerance = 1e-4 } = {}) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      const semantics = prim.listSemantics();
      const attributes = semantics.map((s) => [s, prim.getAttribute(s)]);
      const uv = prim.getAttribute('TEXCOORD_0');
      const count = position.getCount();
      const oldIndices = prim.getIndices();

      const lookup = new Map();
      const remap = new Uint32Array(count);
      const kept = [];
      const p = [0, 0, 0];
      const t = [0, 0];
      for (let i = 0; i < count; i++) {
        position.getElement(i, p);
        let key = `${Math.round(p[0] / positionTolerance)},${Math.round(p[1] / positionTolerance)},${Math.round(p[2] / positionTolerance)}`;
        if (uv) {
          uv.getElement(i, t);
          key += `|${Math.round(t[0] / uvTolerance)},${Math.round(t[1] / uvTolerance)}`;
        }
        const hit = lookup.get(key);
        if (hit === undefined) {
          lookup.set(key, kept.length);
          remap[i] = kept.length;
          kept.push(i);
        } else {
          remap[i] = hit;
        }
      }
      if (kept.length === count && oldIndices) continue;

      for (const [semantic, attribute] of attributes) {
        const size = attribute.getElementSize();
        const source = attribute.getArray();
        const next = source.constructor.from({ length: kept.length * size }, (_, k) => source[kept[(k / size) | 0] * size + (k % size)]);
        const welded = doc.createAccessor(semantic).setType(attribute.getType()).setArray(next).setNormalized(attribute.getNormalized());
        prim.setAttribute(semantic, welded);
      }

      const indexCount = oldIndices ? oldIndices.getCount() : count;
      const indexArray = new Uint32Array(indexCount);
      for (let i = 0; i < indexCount; i++) indexArray[i] = remap[oldIndices ? oldIndices.getScalar(i) : i];
      prim.setIndices(doc.createAccessor('indices').setType('SCALAR').setArray(indexArray));
    }
  }
}

const weldTolerantTransform = (options) => (doc) => weldTolerant(doc, options);

/* ------------------------------------------------------- animation processing */

/** Removes horizontal root motion so game code owns character position. */
function stripRootMotion(animation, { keepVertical = true } = {}) {
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode();
    if (!node || channel.getTargetPath() !== 'translation') continue;
    if (!/hips/i.test(node.getName())) continue;
    const sampler = channel.getSampler();
    const output = sampler.getOutput();
    if (!output) continue;
    const array = output.getArray().slice();
    const stride = output.getElementSize();
    const [x0, y0, z0] = [array[0], array[1], array[2]];
    for (let i = 0; i < array.length; i += stride) {
      array[i] = x0;
      array[i + 1] = keepVertical ? array[i + 1] : y0;
      array[i + 2] = z0;
    }
    output.setArray(array);
  }
}

/**
 * Copies every animation of `clipFile` onto the skeleton that already exists in
 * `target`, matching bones by name (all rigs come out of Mixamo, so the joint
 * names are identical across files).
 */
async function appendClip(target, targetNodesByName, clipFile, name, options = {}) {
  const source = await io.read(clipFile);
  const map = mergeDocuments(target, source);

  const added = [];
  for (const srcAnim of source.getRoot().listAnimations()) {
    const anim = map.get(srcAnim);
    if (!anim) continue;
    anim.setName(name);
    for (const channel of anim.listChannels()) {
      const node = channel.getTargetNode();
      if (!node) continue;
      const twin = targetNodesByName.get(node.getName());
      if (twin) channel.setTargetNode(twin);
      else channel.dispose();
    }
    if (options.inPlace) stripRootMotion(anim, options);
    added.push(anim);
  }

  // Drop everything else that came along with the clip file (duplicate rig,
  // duplicate mesh, duplicate material...). Animations keep their accessors.
  for (const srcProp of [
    ...source.getRoot().listScenes(),
    ...source.getRoot().listNodes(),
    ...source.getRoot().listSkins(),
    ...source.getRoot().listMeshes(),
    ...source.getRoot().listMaterials(),
    ...source.getRoot().listTextures(),
    ...source.getRoot().listCameras(),
  ]) {
    map.get(srcProp)?.dispose();
  }
  return added;
}

/* --------------------------------------------------------------- characters */

async function buildCharacter({ id, baseFbx, textureGlb, clips, simplifyRatio = 0.45, textureSize = 1600 }) {
  console.log(`\n▶ character: ${id}`);
  const doc = await io.read(fbx2glb(baseFbx));
  const root = doc.getRoot();

  // The base file ships with its own (unnamed) clip - clips are merged explicitly below.
  root.listAnimations().forEach((a) => a.dispose());

  // Re-attach the colour map from the textured (unrigged) export.
  if (textureGlb) {
    const texDoc = await io.read(textureGlb);
    const srcTex = texDoc.getRoot().listTextures()[0];
    if (srcTex) {
      const tex = doc
        .createTexture(`${id}_baseColor`)
        .setImage(srcTex.getImage())
        .setMimeType(srcTex.getMimeType());
      for (const material of root.listMaterials()) {
        material
          .setName(`${id}_body`)
          .setBaseColorTexture(tex)
          .setBaseColorFactor([1, 1, 1, 1])
          .setMetallicFactor(0.25)
          .setRoughnessFactor(0.62)
          .setDoubleSided(false);
        material.getBaseColorTextureInfo()?.setTexCoord(0);
      }
      console.log(`   colour map: ${srcTex.getSize().join('×')} ${srcTex.getMimeType()}`);
    }
  }

  // FBX2glTF re-exports the authoring camera + light: they are not wanted in-game.
  root.listCameras().forEach((camera) => camera.dispose());
  for (const node of root.listNodes()) {
    if (/^(camera|light)/i.test(node.getName())) node.dispose();
  }
  dropExtension(doc, 'KHR_lights_punctual');

  const nodesByName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  for (const [name, clip] of Object.entries(clips)) {
    const file = path.join(SRC, clip.file);
    const added = await appendClip(doc, nodesByName, fbx2glb(file), name, clip);
    console.log(`   clip ${name.padEnd(10)} ← ${path.basename(clip.file)} (${added.length})`);
  }

  await doc.transform(
    unpartition(),
    resample(),
    dedup(),
    weldTolerantTransform(),
    simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio, error: 0.0025, lockBorder: false }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureSize, textureSize], quality: 88 }),
    prune({ keepAttributes: false, keepLeaves: false }),
    reorder({ encoder: MeshoptEncoder, target: 'performance' }),
    quantize({ pattern: /^(POSITION|TEXCOORD|NORMAL|WEIGHTS|JOINTS)/ }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );

  mkdir(path.join(OUT, 'characters'));
  const dest = path.join(OUT, 'characters', `${id}.glb`);
  await io.write(dest, doc);
  console.log(`   → ${path.relative(ROOT, dest)} ${mb(dest)}`);
}

/* ---------------------------------------------------------- props / scenery */

async function buildProp({ id, src, dir, textureSize = 1024, simplifyRatio = 1, drop = [], quality = 82 }) {
  const doc = await io.read(path.join(SRC, src));
  const root = doc.getRoot();

  for (const node of root.listNodes()) {
    if (drop.some((re) => re.test(node.getName()))) node.dispose();
  }
  // Sketchfab exports frequently carry punctual lights we do not want in-game.
  root.listCameras().forEach((c) => c.dispose());

  // Sketchfab exports arrive as spec/gloss (unsupported by three) or unlit.
  dropExtension(doc, 'KHR_materials_unlit');
  const transforms = [unpartition(), metalRough(), dedup(), weldTolerantTransform()];
  if (simplifyRatio < 1) {
    transforms.push(simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio, error: 0.004 }));
  }
  transforms.push(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureSize, textureSize], quality }),
    prune({ keepAttributes: false, keepLeaves: false }),
    reorder({ encoder: MeshoptEncoder, target: 'performance' }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  await doc.transform(...transforms);

  mkdir(path.join(OUT, dir));
  const dest = path.join(OUT, dir, `${id}.glb`);
  await io.write(dest, doc);
  console.log(`▶ ${dir}/${id}`.padEnd(28) + `→ ${mb(dest)}`);
}

/* ----------------------------------------------------------------- manifest */

const HERO = {
  id: 'hero',
  baseFbx: path.join(SRC, 'character/hero/Great Sword Idle.fbx'),
  textureGlb: path.join(SRC, 'character/hero/king1.glb'),
  clips: {
    idle: { file: 'character/hero/Great Sword Idle.fbx', inPlace: true },
    walk: { file: 'character/hero/Great Sword Walk.fbx', inPlace: true },
    walkBack: { file: 'character/hero/Walking.fbx', inPlace: true },
    attack: { file: 'character/hero/Great Sword Attack.fbx', inPlace: true },
    attackSpin: { file: 'character/hero/Great Sword High Spin Attack.fbx', inPlace: true },
    block: { file: 'character/hero/Sword And Shield Block.fbx', inPlace: true },
    hit: { file: 'character/hero/Injured Turn Right.fbx', inPlace: true },
    death: { file: 'character/hero/Two Handed Sword Death.fbx', inPlace: true },
    bow: { file: 'character/hero/Standing Draw Arrow.fbx', inPlace: true },
  },
};

const VILLAIN = {
  id: 'villain',
  baseFbx: path.join(SRC, 'character/villen/Great Sword Pack/villen.fbx'),
  textureGlb: path.join(SRC, 'character/villen/Great Sword Pack/villan.glb'),
  clips: {
    idle: { file: 'character/villen/Great Sword Pack/great sword idle.fbx', inPlace: true },
    walk: { file: 'character/villen/Great Sword Pack/great sword walk.fbx', inPlace: true },
    walkBack: { file: 'character/villen/Great Sword Pack/Injured Walk Backwards.fbx', inPlace: true },
    run: { file: 'character/villen/Great Sword Pack/great sword run.fbx', inPlace: true },
    attack: { file: 'character/villen/Great Sword Pack/great sword attack.fbx', inPlace: true },
    attackSpin: { file: 'character/villen/Great Sword Pack/great sword high spin attack.fbx', inPlace: true },
    slash: { file: 'character/villen/Great Sword Pack/great sword slash.fbx', inPlace: true },
    block: { file: 'character/villen/Great Sword Pack/great sword blocking.fbx', inPlace: true },
    hit: { file: 'character/villen/Great Sword Pack/great sword impact.fbx', inPlace: true },
    death: { file: 'character/villen/Great Sword Pack/two handed sword death.fbx', inPlace: true },
    cast: { file: 'character/villen/Great Sword Pack/great sword casting.fbx', inPlace: true },
    powerUp: { file: 'character/villen/Great Sword Pack/great sword power up.fbx', inPlace: true },
  },
};

const PROPS = [
  { id: 'sword', src: 'props/demonic weapons pack/sword.glb', dir: 'weapons', textureSize: 512 },
  { id: 'valari', src: 'props/demonic weapons pack/valari.glb', dir: 'weapons', textureSize: 512, drop: [/light/i] },
  { id: 'vel', src: 'props/demonic weapons pack/vel.glb', dir: 'weapons', textureSize: 256, simplifyRatio: 0.4, quality: 75 },
  { id: 'bow', src: 'props/demonic weapons pack/bow_and_arrow.glb', dir: 'weapons', textureSize: 512, quality: 78, drop: [/^quiver/i, /^arrow\.00[2-5]/i] },
  { id: 'shield', src: 'props/demonic weapons pack/knights_shield.glb', dir: 'weapons', textureSize: 512 },
  { id: 'palace', src: 'models/palace.glb', dir: 'scenery', textureSize: 2048, simplifyRatio: 0.55, quality: 80 },
  { id: 'tower', src: 'models/stone-tower.glb', dir: 'scenery', textureSize: 1024, simplifyRatio: 0.5, quality: 80 },
  { id: 'temple', src: 'models/temple.2.glb', dir: 'scenery', textureSize: 512, quality: 78 },
];

/* ---------------------------------------------------------------- portraits */

/** Crops the concept-art heads into round HUD medallions. */
const PORTRAITS = [
  {
    id: 'hero-portrait',
    src: 'character/hero/WhatsApp Image 2026-09-04 at 12.32.46 PM (1).jpeg',
    box: { left: 366, top: 170, width: 176, height: 176 },
    tint: null,
  },
  {
    id: 'villain-portrait',
    src: 'character/villen/Great Sword Pack/WhatsApp Image 2026-09-04 at 12.32.46 PM.jpeg',
    box: { left: 355, top: 128, width: 156, height: 156 },
    tint: null,
  },
];

async function buildPortraits() {
  mkdir(path.join(OUT, 'ui'));
  for (const portrait of PORTRAITS) {
    const dest = path.join(OUT, 'ui', `${portrait.id}.webp`);
    await sharp(path.join(SRC, portrait.src))
      .extract(portrait.box)
      .resize(192, 192, { fit: 'cover' })
      .modulate({ brightness: 1.06, saturation: 1.08 })
      .webp({ quality: 88 })
      .toFile(dest);
    console.log(`▶ ui/${portrait.id}`.padEnd(28) + `→ ${mb(dest)}`);
  }
}

const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);

if (want('characters')) {
  await buildCharacter(HERO);
  await buildCharacter(VILLAIN);
}
if (want('props')) {
  console.log('');
  for (const prop of PROPS) await buildProp(prop);
}
if (want('portraits')) {
  console.log('');
  await buildPortraits();
}
console.log('\n✔ assets written to public/assets');
