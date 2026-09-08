/* Shared Kingdom Path progress. Winning a milestone makes a character
   available; selecting that character opens the next group of levels. */
(function () {
    const KEY = 'pandya.progress';
    const LEGACY_KEY = 'pandyaUnlockedLevel';
    let sessionState = null;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.floor(Number(value) || min)));

    function read() {
        if (sessionState) return { ...sessionState };
        try {
            const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (saved) {
                const completed = clamp(saved.completed, 0, 9);
                return {
                    completed,
                    activated: clamp(saved.activated, 1, completed >= 6 ? 3 : completed >= 3 ? 2 : 1),
                    selected: clamp(saved.selected, 1, completed >= 6 ? 3 : completed >= 3 ? 2 : 1)
                };
            }
            // Preserve old wins, but require the milestone character click.
            const unlocked = clamp(localStorage.getItem(LEGACY_KEY), 1, 9);
            return { completed: unlocked - 1, activated: 1, selected: 1 };
        } catch {
            return { completed: 0, activated: 1, selected: 1 };
        }
    }

    function unlocked(state = read()) {
        return Math.min(9, state.completed + 1, state.activated * 3);
    }

    function save(state) {
        try {
            localStorage.setItem(KEY, JSON.stringify(state));
            localStorage.setItem(LEGACY_KEY, String(unlocked(state)));
        } catch {
            // Keep the current battle usable if the browser blocks storage.
            sessionState = { ...state };
        }
    }

    window.PandyaProgress = {
        get: read,
        unlocked,
        characterAvailable(number) {
            return Number.isInteger(number) && number >= 1 && number <= 3 && read().completed >= (number - 1) * 3;
        },
        selectCharacter(number) {
            if (!this.characterAvailable(number)) return false;
            const state = read();
            state.selected = number;
            state.activated = Math.max(state.activated, number);
            save(state);
            return true;
        },
        completeLevel(level) {
            const state = read();
            if (!Number.isInteger(level) || level < 1 || level > unlocked(state)) return unlocked(state);
            state.completed = Math.max(state.completed, level);
            save(state);
            return unlocked(state);
        },
        pendingMilestone() {
            const state = read();
            if (state.completed >= 3 && state.activated < 2) return 3;
            if (state.completed >= 6 && state.activated < 3) return 6;
            return 0;
        },
        reset() {
            save({ completed: 0, activated: 1, selected: 1 });
        }
    };
})();
