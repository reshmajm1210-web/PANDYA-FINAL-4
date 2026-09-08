// ==========================================
// PANDYA EMPIRE - TASK BOARD
// task.js
// ==========================================

// ---------------- COINS & PEARLS ----------------

// Default Values
let coins = Number(localStorage.getItem("pandyaCoins")) || 100;
let pearls = Number(localStorage.getItem("pandyaPearls")) || 50;

// Default Unlock (Task 1 Only)
let unlockedTask = Number(localStorage.getItem("pandyaUnlockedTask")) || 1;

// Load Data
window.onload = function () {
    updateStats();
    updateTasks();
};

// ---------------- UPDATE TOP STATUS ----------------

function updateStats() {

    document.getElementById("coins").innerText = coins;
    document.getElementById("pearls").innerText = pearls;

}

// ---------------- UPDATE LOCK / UNLOCK ----------------

function updateTasks() {

    const cards = document.querySelectorAll(".task-card");

    cards.forEach((card, index) => {

        const taskNumber = index + 1;
        const lock = card.querySelector(".lock-circle");

        if (taskNumber <= unlockedTask) {

            // Unlock Current Task
            lock.style.display = "none";
            card.classList.add("unlocked");

        } else {

            // Lock Remaining Tasks
            lock.style.display = "flex";
            card.classList.remove("unlocked");

        }

    });

}

// ---------------- OPEN TASK PAGE ----------------

function openTask(taskNumber) {

    if (taskNumber > unlockedTask) {

        alert("🔒 Complete the previous task first!");
        return;

    }

    switch(taskNumber){

        case 1:
            window.location.href = "task1.html";
            break;

        case 2:
            window.location.href = "task2.html";
            break;

        case 3:
            window.location.href = "task3.html";
            break;

        case 4:
            window.location.href = "task4.html";
            break;

        case 5:
            window.location.href = "task5.html";
            break;

        case 6:
            window.location.href = "task6.html";
            break;

        default:
            alert("Task page not found.");
    }

}

// ---------------- COMPLETE TASK ----------------
// Call completeTask(taskNumber) after finishing a mission.

function completeTask(taskNumber){

    // Rewards
    switch(taskNumber){

        case 1:
            coins += 5000;
            pearls += 100;
            break;

        case 2:
            coins += 1000;
            pearls += 100;
            break;

        case 3:
            coins += 1500;
            pearls += 150;
            break;

        case 4:
            coins += 2000;
            pearls += 200;
            break;

        case 5:
            coins += 2500;
            pearls += 250;
            break;

        case 6:
            coins += 3000;
            pearls += 300;
            break;

    }

    // Save Rewards
    localStorage.setItem("pandyaCoins", coins);
    localStorage.setItem("pandyaPearls", pearls);

    // Unlock Next Task
    if (taskNumber === unlockedTask && taskNumber < 6) {

        unlockedTask++;
        localStorage.setItem("pandyaUnlockedTask", unlockedTask);

    }

    alert("🏆 Task " + taskNumber + " Completed!\n✨ Next Task Unlocked!");

    // Back to Task Board
    window.location.href = "task.html";

}

// ---------------- RESET TASK BOARD ----------------
// Type resetTasks() in browser console if needed.

function resetTasks(){

    coins = 100;
    pearls = 50;
    unlockedTask = 1;

    localStorage.setItem("pandyaCoins", coins);
    localStorage.setItem("pandyaPearls", pearls);
    localStorage.setItem("pandyaUnlockedTask", unlockedTask);

    updateStats();
    updateTasks();

    alert("🔄 Task Board Reset Successfully!");

}