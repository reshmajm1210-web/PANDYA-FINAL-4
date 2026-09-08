import * as THREE from "three"; 
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"; 
import { OrbitControls } from "three/addons/controls/OrbitControls.js"; 

let coins = Number(localStorage.getItem("pandyaCoins")) || 100; 
let pearls = Number(localStorage.getItem("pandyaPearls")) || 50; 
let lives = 5; 

document.getElementById("coinCount").innerText = coins; 
document.getElementById("pearlCount").innerText = pearls; 
document.getElementById("lives").innerText = lives; 

const loadingScreen = document.getElementById("loadingScreen"); 
const progressBar = document.getElementById("progressBar"); 

let progress = 0; 

const loading = setInterval(() => { 

    progress += 4; 
    progressBar.style.width = progress + "%"; 

    if(progress >= 100){ 

        clearInterval(loading); 

        setTimeout(() => { 
            loadingScreen.style.display = "none"; 
        },300); 

    } 

},120); 

const scene = new THREE.Scene(); 

const camera = new THREE.PerspectiveCamera( 
    60, 
    window.innerWidth / window.innerHeight, 
    0.1, 
    1000 
); 
 
camera.position.set(0,7,18); 
 
const renderer = new THREE.WebGLRenderer({ 
    canvas: document.getElementById("gameCanvas"), 
    antialias:true, 
    alpha:true 
}); 
 
renderer.setSize(window.innerWidth,window.innerHeight); 
renderer.setPixelRatio(window.devicePixelRatio); 
renderer.shadowMap.enabled = true; 

// Needed for the step-by-step (layer by layer) tower construction 
renderer.localClippingEnabled = true; 
 
// ================= LIGHTS ================= 
 
const ambient = new THREE.AmbientLight(0xffffff,1.5); 
scene.add(ambient); 
 
const sun = new THREE.DirectionalLight(0xfff2b5,3); 
sun.position.set(20,25,10); 
sun.castShadow = true; 

// Bigger shadow area so the tall stone tower's shadow is not cut off 
sun.shadow.mapSize.set(2048,2048); 
sun.shadow.camera.left = -15; 
sun.shadow.camera.right = 15; 
sun.shadow.camera.top = 20; 
sun.shadow.camera.bottom = -10; 
sun.shadow.camera.far = 80; 

scene.add(sun); 
 
// ================= BUILD PLATFORM ================= 
 
const platform = new THREE.Mesh( 
    new THREE.CylinderGeometry(5,5,0.4,40), 
    new THREE.MeshStandardMaterial({ 
        color:0x5b3b18, 
        roughness:0.8 
    }) 
); 
 
platform.position.y = -0.2; 
platform.receiveShadow = true; 
scene.add(platform); 
 
// ================= PALACE MODEL ================= 
 
const loader = new GLTFLoader(); 
 
let palace = null; 
 
loader.load( 

    "./pandyar3/assets/models/stone-tower.glb", 

    (gltf)=>{ 

        palace = gltf.scene; 

        palace.rotation.y = Math.PI; 

        // Fit the stone tower to the build platform (realistic size) 
        const towerBox = new THREE.Box3().setFromObject(palace); 
        const towerSize = new THREE.Vector3(); 
        towerBox.getSize(towerSize); 

        const towerScale = Math.min(11 / towerSize.y, 8.6 / Math.max(towerSize.x, towerSize.z)); 

        palace.scale.set(towerScale,towerScale,towerScale); 

        // Re-measure after scaling and place the base exactly on the platform (y = 0) 
        const fittedBox = new THREE.Box3().setFromObject(palace); 
        const fittedCenter = new THREE.Vector3(); 
        fittedBox.getCenter(fittedCenter); 

        palace.position.x = -fittedCenter.x; 
        palace.position.z = -fittedCenter.z; 
        palace.position.y = -fittedBox.min.y; 

        // Hidden until BUILD is clicked 
        palace.visible = false; 

        palace.traverse((child)=>{ 
            if(child.isMesh){ 
                child.castShadow = true; 
                child.receiveShadow = true; 
            } 
        }); 

        scene.add(palace); 

        console.log("Stone Tower (stone-tower.glb) Loaded Successfully"); 

    }, 

    undefined, 

    (error)=>{ 
        console.error(error); 
        alert("stone-tower.glb file not found!"); 
    } 

); 
 
// ================= CAMERA CONTROL ================= 
 
const controls = new OrbitControls(camera,renderer.domElement); 
 
controls.enablePan = false; 
controls.enableZoom = true; 
controls.enableRotate = true; 
 
controls.minDistance = 10; 
controls.maxDistance = 25; 
 
controls.maxPolarAngle = Math.PI / 2.2; 
 
controls.target.set(0,3,0); 
 
controls.update(); 
 
// ================= BUILD PALACE ================= 
 
const buildBtn = document.getElementById("buildBtn"); 
const buildEffect = document.getElementById("buildEffect"); 
const completeBtn = document.getElementById("completeBtn"); 
const buildEffectText = document.getElementById("buildEffectText"); 

// Ring that marks the current build level (used in animate loop for pulse) 
let activeBuildRing = null; 

// ================= NOT ENOUGH COINS & PEARLS MESSAGE ================= 

const fundPopup = document.getElementById("fundPopup"); 

function showFundPopup(){ 

    document.getElementById("fundCoins").innerText = coins; 
    document.getElementById("fundPearls").innerText = pearls; 

    fundPopup.style.display = "flex"; 

} 

document.getElementById("fundOkBtn").onclick = ()=>{ 

    fundPopup.style.display = "none"; 

}; 

buildBtn.onclick = ()=>{ 

    if(!palace){ 
        alert("Palace model is still loading..."); 
        return; 
    } 

    if(coins < 5000 || pearls < 100){ 

        // ❌ Player does not have enough Coins and Pearls → show message 
        showFundPopup(); 
        return; 

    } 

    coins -= 5000; 
    pearls -= 100; 

    document.getElementById("coinCount").innerText = coins; 
    document.getElementById("pearlCount").innerText = pearls; 

    localStorage.setItem("pandyaCoins",coins); 
    localStorage.setItem("pandyaPearls",pearls); 

    buildBtn.disabled = true; 
    buildBtn.innerText = "BUILDING PALACE..."; 

    buildEffect.style.display = "flex"; 

    palace.visible = true; 

    // ========== STEP BY STEP CONSTRUCTION OF stone-tower.glb ========== 

    // Collect every material of the tower model 
    const towerMaterials = new Set(); 

    palace.traverse((child)=>{ 
        if(child.isMesh){ 
            const mats = Array.isArray(child.material) ? child.material : [child.material]; 
            mats.forEach((m)=>towerMaterials.add(m)); 
        } 
    }); 

    // Clip plane that reveals the tower from bottom to top, step by step 
    const buildClipPlane = new THREE.Plane(new THREE.Vector3(0,-1,0), 0); 

    towerMaterials.forEach((m)=>{ 
        m.clippingPlanes = [buildClipPlane]; 
        m.clipShadows = true; 
        m.needsUpdate = true; 
    }); 

    const buildBox = new THREE.Box3().setFromObject(palace); 
    const buildBase = buildBox.min.y; 
    const buildTop = buildBox.max.y; 
    const buildHeight = buildTop - buildBase; 

    const totalSteps = 14; 
    const stepHeight = buildHeight / totalSteps; 

    buildClipPlane.constant = buildBase; 

    // Golden construction ring that marks the current building level 
    const towerFootprint = Math.max( 
        buildBox.max.x - buildBox.min.x, 
        buildBox.max.z - buildBox.min.z 
    ); 

    const buildRing = new THREE.Mesh( 
        new THREE.TorusGeometry(towerFootprint * 0.62, 0.07, 8, 48), 
        new THREE.MeshBasicMaterial({ color:0xffd04e, transparent:true, opacity:0.9 }) 
    ); 

    buildRing.rotation.x = Math.PI / 2; 
    buildRing.position.set(0, buildBase, 0); 

    scene.add(buildRing); 
    activeBuildRing = buildRing; 

    let currentStep = 0; 

    const buildAnimation = setInterval(()=>{ 

        currentStep++; 

        const buildY = Math.min(buildBase + (currentStep * stepHeight), buildTop); 

        // One more layer of the stone tower appears 
        buildClipPlane.constant = buildY; 
        buildRing.position.y = buildY; 

        const percent = Math.round(((buildY - buildBase) / buildHeight) * 100); 

        buildEffectText.innerText = "🏰 Building the Royal Palace... " + percent + "%"; 

        if(currentStep >= totalSteps){ 

            clearInterval(buildAnimation); 

            // Build finished → show the FULL stone-tower.glb model 
            towerMaterials.forEach((m)=>{ 
                m.clippingPlanes = null; 
                m.needsUpdate = true; 
            }); 

            scene.remove(buildRing); 
            buildRing.geometry.dispose(); 
            buildRing.material.dispose(); 
            activeBuildRing = null; 

            buildEffect.style.display = "none"; 

            buildBtn.style.display = "none"; 

            completeBtn.style.display = "inline-block"; 

        } 

    },230); 

}; 
 
// ================= COMPLETE MISSION ================= 
 
completeBtn.onclick = ()=>{ 
 
    coins += 5000; 
    pearls += 100; 
 
    document.getElementById("coinCount").innerText = coins; 
    document.getElementById("pearlCount").innerText = pearls; 
 
    localStorage.setItem("pandyaCoins",coins); 
    localStorage.setItem("pandyaPearls",pearls); 
 
    // Unlock Task 2 
    localStorage.setItem("pandyaUnlockedTask",2); 
 
    document.getElementById("missionPopup").style.display = "flex"; 
 
}; 
 
// ================= CONTINUE ================= 
 
document.getElementById("continueBtn").onclick = ()=>{ 
 
    window.location.href = "task.html"; 
 
}; 
 
// ================= RESIZE ================= 
 
window.addEventListener("resize",()=>{ 
 
    camera.aspect = window.innerWidth / window.innerHeight; 
    camera.updateProjectionMatrix(); 

    renderer.setSize(window.innerWidth,window.innerHeight); 

});

// ================= ANIMATION LOOP ================= 

function animate(){ 

    requestAnimationFrame(animate); 

    // Gentle pulse of the golden construction ring while building 
    if(activeBuildRing){ 
        const pulse = 1 + Math.sin(performance.now() * 0.008) * 0.04; 
        activeBuildRing.scale.set(pulse,pulse,1); 
    } 

    renderer.render(scene,camera); 

} 

animate();  