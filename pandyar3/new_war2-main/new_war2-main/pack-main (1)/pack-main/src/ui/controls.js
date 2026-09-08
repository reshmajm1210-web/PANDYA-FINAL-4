/**
 * Input layer: virtual joystick (touch + mouse), hold/tap buttons and a
 * keyboard mapping. Everything is normalised into a small command surface:
 *
 *   onMove(direction)   -1 back · 0 idle · 1 forward
 *   onAction(name)      'attack' | 'weapon' | 'heal' | 'bow'
 *   onHold(name, down)  'defend'
 */
export class Controls {
  constructor({ onMove, onAction, onHold }) {
    this.onMove = onMove;
    this.onAction = onAction;
    this.onHold = onHold;
    this.direction = 0;
    this.enabled = true;

    this.#bindJoystick();
    this.#bindButtons();
    this.#bindKeyboard();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.#emitMove(0);
  }

  #emitMove(direction) {
    if (this.direction === direction) return;
    this.direction = direction;
    this.onMove(direction);
  }

  #bindJoystick() {
    const pad = document.querySelector('[data-joystick]');
    const stick = document.querySelector('[data-stick]');
    if (!pad || !stick) return;

    const radius = () => pad.clientWidth * 0.28;
    let pointerId = null;
    let origin = { x: 0, y: 0 };

    const move = (event) => {
      if (pointerId !== event.pointerId) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      const max = radius();
      const length = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(1, length / max);
      const nx = (dx / length) * clamped * max;
      const ny = (dy / length) * clamped * max;
      stick.style.transform = `translate(${nx}px, ${ny}px)`;

      // Forward is "towards the enemy" = up or right on the pad.
      const axis = -ny / max + nx / max * 0.55;
      if (!this.enabled) return;
      this.#emitMove(axis > 0.28 ? 1 : axis < -0.28 ? -1 : 0);
    };

    const end = (event) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      pad.classList.remove('is-active');
      stick.style.transform = '';
      this.#emitMove(0);
    };

    pad.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.pad__key')) return;
      pointerId = event.pointerId;
      const rect = pad.getBoundingClientRect();
      origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      pad.setPointerCapture(event.pointerId);
      pad.classList.add('is-active');
      move(event);
    });
    pad.addEventListener('pointermove', move);
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  }

  #bindButtons() {
    for (const node of document.querySelectorAll('[data-action]')) {
      const name = node.dataset.action;
      node.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (!this.enabled) return;
        node.classList.add('is-down');
        this.onAction(name);
      });
      const release = () => node.classList.remove('is-down');
      node.addEventListener('pointerup', release);
      node.addEventListener('pointerleave', release);
      node.addEventListener('pointercancel', release);
    }

    for (const node of document.querySelectorAll('[data-hold]')) {
      const name = node.dataset.hold;
      const down = (event) => {
        event.preventDefault();
        if (!this.enabled) return;
        node.classList.add('is-down');
        node.setPointerCapture?.(event.pointerId);
        if (name === 'forward') this.#emitMove(1);
        else if (name === 'back') this.#emitMove(-1);
        else this.onHold(name, true);
      };
      const up = () => {
        node.classList.remove('is-down');
        if (name === 'forward' || name === 'back') this.#emitMove(0);
        else this.onHold(name, false);
      };
      node.addEventListener('pointerdown', down);
      node.addEventListener('pointerup', up);
      node.addEventListener('pointerleave', up);
      node.addEventListener('pointercancel', up);
    }
  }

  #bindKeyboard() {
    const pressed = new Set();
    const moveKeys = { KeyW: 1, ArrowUp: 1, KeyD: 1, ArrowRight: 1, KeyS: -1, ArrowDown: -1, KeyA: -1, ArrowLeft: -1 };

    const evaluateMove = () => {
      let direction = 0;
      for (const code of pressed) if (moveKeys[code]) direction = moveKeys[code];
      this.#emitMove(direction);
    };

    window.addEventListener('keydown', (event) => {
      if (event.repeat || !this.enabled) return;
      const code = event.code;
      if (moveKeys[code]) {
        pressed.add(code);
        evaluateMove();
        event.preventDefault();
        return;
      }
      if (code === 'KeyJ' || code === 'Space') {
        this.onAction('attack');
        event.preventDefault();
      } else if (code === 'KeyK' || code === 'ShiftLeft') {
        this.onHold('defend', true);
      } else if (code === 'KeyL') {
        this.onAction('weapon');
      } else if (code === 'KeyH') {
        this.onAction('heal');
      } else if (code === 'KeyB') {
        this.onAction('bow');
      }
    });

    window.addEventListener('keyup', (event) => {
      const code = event.code;
      if (moveKeys[code]) {
        pressed.delete(code);
        evaluateMove();
      } else if (code === 'KeyK' || code === 'ShiftLeft') {
        this.onHold('defend', false);
      }
    });

    window.addEventListener('blur', () => {
      pressed.clear();
      this.#emitMove(0);
      this.onHold('defend', false);
    });
  }
}
