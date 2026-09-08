// ==========================================
// PANDYA EMPIRE - MAP PAGE
// map.js
// ==========================================

// ---------------- LEVEL POPUP ----------------

const popup = document.getElementById("popup");
const title = document.getElementById("levelTitle");
const text = document.getElementById("levelText");
const enterBtn = document.getElementById("enterBtn");

// Current Level
let currentLevel = 1;

// Level Unlock (Default Level 1)
let unlockedLevel = Number(localStorage.getItem("pandyaUnlockedLevel")) || 1;

// ---------------- COINS / PEARLS WALLET ----------------

function updateWallet(){
    let wallet = { coins: 0, pearls: 0 };
    try {
        const saved = JSON.parse(localStorage.getItem("pandya.wallet") || "null");
        if (saved && Number.isFinite(saved.coins) && Number.isFinite(saved.pearls)) wallet = saved;
    } catch (e) {}

    const coinsEl = document.getElementById("mapCoins");
    const pearlsEl = document.getElementById("mapPearls");
    if (coinsEl) coinsEl.textContent = Number(wallet.coins).toLocaleString('en-IN');
    if (pearlsEl) pearlsEl.textContent = Number(wallet.pearls).toLocaleString('en-IN');
}

updateWallet();

// ---------------- LEVEL DESCRIPTIONS ----------------

const levelDescriptions = {
    1: "Battle of the First Fortress. Defeat the enemies and capture the fortress.",
    2: "Cross the Dark Forest and defeat the Tiger Guardian.",
    3: "Protect the Pandya Village from enemy soldiers.",
    4: "Capture the enemy fortress and raise the Pandya flag.",
    5: "Find the Sacred Crown inside the ancient temple.",
    6: "Defeat the Elephant Commander in battle.",
    7: "Rescue the captured Pandya warriors.",
    8: "Win the Great Battlefield and defeat the enemy king.",
    9: "Final Battle. Protect the Pandya Empire and become the Legendary Warrior."
};

// Load Levels
updateLevels();

// ---------------- OPEN LEVEL ----------------

function openLevel(level){

    if(level > unlockedLevel){
        alert("🔒 Complete the previous level first!");
        return;
    }

    currentLevel = level;

    title.innerHTML = "LEVEL " + level;
    text.innerHTML = levelDescriptions[level];

    popup.style.display = "flex";
}

// ---------------- LOCKOUT ----------------

function isLocked(){
    let until = NaN;
    try {
        until = Number(localStorage.getItem("pandya.lockoutUntil"));
    } catch (e) {}
    return Number.isFinite(until) && (until - Date.now()) > 0;
}

// ---------------- CLOSE POPUP ----------------

function closePopup(){
    popup.style.display = "none";
}

// ---------------- ENTER LEVEL ----------------

enterBtn.addEventListener("click", function(){

    // If the kingdom is still recovering, block the duel.
    if(isLocked()){
        alert("⏳ The kingdom is recovering. Please wait before fighting again.");
        return;
    }

    popup.style.display = "none";

    // Open the 3D war for the chosen level.
    window.location.href = "index.html?level=" + currentLevel;

});

// ---------------- UPDATE LEVEL BUTTONS ----------------

function updateLevels(){

    for(let i=1;i<=9;i++){

        const btn = document.getElementById("level"+i);

        if(i <= unlockedLevel){

            btn.classList.remove("lock");
            btn.classList.add("unlock");

            btn.innerHTML = `
                ${i}
                <span class="label">LEVEL ${i}</span>
            `;

        }else{

            btn.classList.remove("unlock");
            btn.classList.add("lock");

            btn.innerHTML = `
                🔒
                <span class="label">LEVEL ${i}</span>
            `;

        }

    }

}

// ---------------- UNLOCK NEXT LEVEL ----------------

function unlockNextLevel(level){

    if(level >= unlockedLevel && level < 9){

        unlockedLevel = level + 1;

        localStorage.setItem("pandyaUnlockedLevel", unlockedLevel);

        updateLevels();

        alert("🎉 LEVEL " + unlockedLevel + " UNLOCKED!");

    }

}

// ---------------- TASK BUTTON ----------------
// TASK logo → Loading Page

function openTask(){

    // Go to Loading Page
    window.location.href = "loading2.html";

}

// ---------------- RESET GAME ----------------

function resetGame(){

    localStorage.removeItem("pandyaUnlockedLevel");
    localStorage.removeItem("pandya.lockoutUntil");
    localStorage.removeItem("pandya.wallet");

    unlockedLevel = 1;

    updateLevels();
    updateWallet();

    alert("Game Reset Successfully!");

}