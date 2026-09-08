import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f); const r = doc.getRoot();
  console.log('===', f);
  console.log(' scene bounds', JSON.stringify(getBounds(r.getDefaultScene())));
  console.log(' skins', r.listSkins().map(s=>s.listJoints().length));
  const joints = r.listSkins()[0]?.listJoints().map(j=>j.getName()) || [];
  console.log(' hand bones', joints.filter(n=>/Hand|Spine|Hips|Head/i.test(n)).join(', '));
  console.log(' anims', r.listAnimations().map(a=>`${a.getName()}`).join(', '));
  for (const m of r.listMeshes()) for (const p of m.listPrimitives()) console.log('  prim verts', p.getAttribute('POSITION').getCount(), 'tris', (p.getIndices()?.getCount()||0)/3);
  for (const t of r.listTextures()) console.log('  tex', t.getMimeType(), (t.getImage().byteLength/1024|0)+'KB', t.getSize());
  const n = r.listNodes().filter(x=>x.getMesh());
  console.log(' mesh nodes', n.map(x=>x.getName()+' scale='+x.getScale().join(',')).join(' | '));
}
