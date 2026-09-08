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
let unlockedLevel = PandyaProgress.unlocked();

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

    unlockedLevel = PandyaProgress.unlocked();

    if(level > unlockedLevel){
        alert(PandyaProgress.pendingMilestone() ? "GO TO THE CHARACTER SELECTION PAGE and select the unlocked character first!" : "🔒 Complete the previous level first!");
        return;
    }

    currentLevel = level;

    title.innerHTML = "LEVEL " + level;
    text.innerHTML = levelDescriptions[level];

    popup.style.display = "flex";
}

// ---------------- CLOSE POPUP ----------------

function closePopup(){
    popup.style.display = "none";
}

// ---------------- ENTER LEVEL ----------------

enterBtn.addEventListener("click", function(){

    popup.style.display = "none";

    // All 9 levels run the same 3D battle scene; the level number is passed
    // along so the battle can pick the right enemy and difficulty.
    window.location.href = "battle.html?level=" + currentLevel;

});

// ---------------- UPDATE LEVEL BUTTONS ----------------

function updateLevels(){

    unlockedLevel = PandyaProgress.unlocked();
    const progress = PandyaProgress.get();

    for(let i=1;i<=9;i++){

        const btn = document.getElementById("level"+i);
        btn.classList.toggle("completed", i <= progress.completed);
        btn.setAttribute("aria-label", `Level ${i}${i <= progress.completed ? " completed" : i > unlockedLevel ? " locked" : " unlocked"}`);

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

    const milestone = PandyaProgress.pendingMilestone();
    const message = document.getElementById("characterMilestone");
    message.hidden = !milestone;
    message.dataset.level = String(milestone);

    const taskBtn = document.getElementById("taskBtn");
    const taskReady = progress.completed >= 3;
    taskBtn.classList.toggle("task-ready", taskReady);
    taskBtn.querySelector("span").textContent = taskReady ? "COMPLETE THIS TASK" : "TASK";
    taskBtn.title = taskReady ? `${Math.floor(progress.completed / 3) * 3} levels completed — complete this task!` : "TASK";
}

// ---------------- UNLOCK NEXT LEVEL ----------------

function unlockNextLevel(level){
    PandyaProgress.completeLevel(level);
    updateLevels();
}

// Refresh after returning with the browser Back button or another tab's win.
window.addEventListener("pageshow", updateLevels);
window.addEventListener("storage", updateLevels);

// ---------------- TASK BUTTON ----------------
// TASK logo → Loading Page

function openTask(){

    // Go to Loading Page
    window.location.href = "loading2.html";

}

// Closes the task popup box on this page.
function closeTask(){

    const taskPopup = document.getElementById("taskPopup");

    if(taskPopup){
        taskPopup.style.display = "none";
    }

}

// ---------------- RESET GAME ----------------

function resetGame(){

    PandyaProgress.reset();

    unlockedLevel = 1;

    updateLevels();

    alert("Game Reset Successfully!");

}

// ================= BACK BUTTON =================

function goBack(){
    window.location.href = "showlevel.html";
}