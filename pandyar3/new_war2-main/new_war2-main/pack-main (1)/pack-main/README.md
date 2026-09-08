# Pandya · Empire of Warriors

A browser-based 3D duel game built with [Three.js](https://threejs.org/). The Pandya king
(green side) faces the invading warlord (red side) on a fixed cinematic camera, with a
touch/keyboard HUD that mirrors the reference layout: joystick on the left, ATTACK /
DEFEND / WEAPON / HEAL / BOW on the right, health bars and lives up top, and a scroll
result card with the coins and gems collected.

Runs on a phone or a laptop — one canvas, no plugins, ~6 MB of assets.

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` / `npm run preview` | Production bundle |
| `npm run assets` | Rebuilds `public/assets` from the raw art in `aset/` |
| `npm run test:assets` | Headless rig/weapon checks against the shipped GLBs |
| `npm run test:ui` | jsdom checks for the HUD + control layer |

## Playing

| Action | Touch | Keyboard |
| --- | --- | --- |
| Move toward / away from the enemy | Left joystick (or the ▲ ▼ keys around it) | `W` `S` / `↑` `↓` |
| Attack | **ATTACK** | `J` or `Space` |
| Block (hold) | **DEFEND** | `K` or `Shift` |
| Cycle weapon: vaal → valari → vel → vil | **WEAPON** | `L` |
| Heal (3 charges, 13 s cooldown) | **HEAL** | `H` |
| Ranged shot (quick-draws the bow) | **BOW** | `B` |

Blocking within 0.32 s of the incoming swing is a **parry** — it cuts damage to 6 % and
pays a gem. Crits pay gems too. The enemy king is fully AI-driven: he closes distance,
parries, backs off to reset spacing and enrages below a third of health, getting sharper
with each life you lose. Lose all three lives and the scroll reads **YOU LOSE**; drop the
king first and it reads **YOU WIN** — either way it tallies coins, gems and lives left,
with a **Play again** button.

## How it is put together

```
src/
  config.js            all tuning: arena, combat, weapon rack, AI ramp
  main.js              boot
  engine/assets.js     GLTF + meshopt loading, progress, cache
  engine/sfx.js        procedural WebAudio kit (no audio files)
  world/arena.js       sky shader, lighting rig, ground, skyline, banners, dust
  game/fighter.js      rig scaling, animation state machine, weapon sockets
  game/ai.js           enemy king brain
  game/effects.js      pooled particles, rings, swooshes, arrows
  game/game.js         match flow, combat maths, lives, loot, frame loop
  ui/hud.js            every DOM overlay update
  ui/controls.js       joystick, hold/tap buttons, keyboard
tools/
  build-assets.mjs     the asset pipeline (see below)
  smoke-test.mjs       character-layer checks
  ui-test.mjs          DOM-layer checks
```

### Assets

The raw art in `aset/` is ~260 MB: Mixamo-rigged FBX kings (whose textures were lost in
the auto-rig round trip), separate FBX animation clips, and Sketchfab GLB props. `npm run
assets` turns that into the ~6 MB the browser actually downloads:

1. **FBX → glTF** with `FBX2glTF`.
2. **Texture re-attach** — the 2K colour map is lifted out of the untextured-but-textured
   Meshy export (`king1.glb` / `villan.glb`) and re-bound to the rigged mesh; the UVs
   survive the Mixamo round trip, so the kings look like the concept art again.
3. **Clip merge** — every animation FBX is merged onto the one shared skeleton, matched by
   bone name and renamed to a semantic key (`idle`, `walk`, `attack`, `block`, `hit`,
   `death`, `bow`, …). Horizontal root motion is stripped, because movement is game-driven.
4. **Geometry** — tolerant weld (FBX2glTF emits triangle soup, so the stock exact-match
   weld finds nothing to merge), then `meshoptimizer` simplification: 80 k → 36 k triangles.
5. **Materials** — spec/gloss converted to metal/rough, unlit backdrops made lit,
   authoring cameras and lights pruned.
6. **Compression** — WebP textures + `EXT_meshopt_compression`: 5.5 MB per character
   becomes ~0.7 MB.

| Output | Size |
| --- | --- |
| `characters/hero.glb` (9 clips) | 0.70 MB |
| `characters/villain.glb` (12 clips) | 0.78 MB |
| `weapons/*.glb` (vaal, valari, vel, vil, shield) | 1.5 MB |
| `scenery/*.glb` (palace, towers, temples) | 3.2 MB |

### Weapons attach themselves

Weapons are never placed by hand. `WeaponRack` normalises any prop — PCA finds its true
long axis (the Tamil `vel` is modelled diagonally, so a bounding box is not enough), the
flattest axis becomes the facing normal, the model is scaled to its configured length and
its grip is moved to the origin. `Fighter` then reads the rig's *own* two-fisted idle pose:
the vector between the hands is the hilt axis, so the socket orientation is derived from
the animation rather than from magic numbers. Tapping **WEAPON** just detaches one prop and
attaches the next to the same hand bone — no reload, no reset.

If a prop ever needs nudging, do it live in the browser console and paste the result into
`src/config.js`:

```js
game.tuneWeapon({ rotation: [0, 90, 0], offset: [0, 0.04, 0] })
game.tuneWeapon({ align: 'forearm', length: 1.3, grip: 0.2 })   // 'grip' | 'forearm' | 'upright'
```

### Testing without a browser

This repo was developed in a sandbox with no browser available, so the two test harnesses
do the verifying: `test:assets` loads the real GLBs in Node (with tiny DOM shims), builds
both fighters, checks bone discovery, stance height, ground contact, prop sizing and a full
attack → block → hit → death → revive cycle; `test:ui` mounts `index.html` in jsdom and
drives every button, key and HUD update. Both are fast enough to run on every change.
