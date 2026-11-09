/**
 * Unified input: relative touch/mouse dragging (the ship never hides under the finger),
 * keyboard, and gamepad. A second finger, the on-screen button, Space or gamepad A fires
 * the pulse; the press time is recorded so the game can judge it against the beat.
 */
export interface InputCallbacks {
  onPulse: () => void;
  onPause: () => void;
  onAnyKey?: (key: string) => void;
}

export class Input {
  mx = 0;
  my = 0;
  focus = false;
  /** accumulated drag in CSS pixels */
  dragPx = 0;
  dragPy = 0;
  private keys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number }>();
  private movePointer: number | null = null;
  enabled = false;
  private padPrev: boolean[] = [];
  usingTouch = false;
  usingPad = false;

  constructor(
    private surface: HTMLElement,
    private cb: InputCallbacks,
  ) {
    surface.addEventListener('pointerdown', this.onDown, { passive: false });
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pointers.clear();
      this.movePointer = null;
    });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    this.usingTouch = e.pointerType === 'touch';
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.movePointer === null) {
      this.movePointer = e.pointerId;
      try {
        this.surface.setPointerCapture(e.pointerId);
      } catch {
        /* not supported */
      }
    } else {
      // any extra finger triggers the pulse
      this.cb.onPulse();
    }
    if (e.pointerType === 'mouse' && e.button === 2) this.cb.onPulse();
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (e.pointerId === this.movePointer && this.enabled) {
      e.preventDefault();
      this.dragPx += e.clientX - p.x;
      this.dragPy += e.clientY - p.y;
    }
    p.x = e.clientX;
    p.y = e.clientY;
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (e.pointerId === this.movePointer) {
      this.movePointer = null;
      // hand movement over to a finger that is still down
      const next = this.pointers.keys().next();
      if (!next.done) this.movePointer = next.value;
    }
  };

  private onKey = (e: KeyboardEvent): void => {
    const k = e.key;
    this.cb.onAnyKey?.(k);
    if (!this.enabled) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(k.length === 1 ? k.toLowerCase() : k);
    if (k === ' ' || k === 'x' || k === 'X' || k === 'k' || k === 'K' || k === 'j' || k === 'J') this.cb.onPulse();
    if (k === 'Escape' || k === 'p' || k === 'P') this.cb.onPause();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key;
    this.keys.delete(k.length === 1 ? k.toLowerCase() : k);
  };

  /** Poll keyboard + gamepad into mx/my/focus. Call once per frame. */
  poll(): void {
    const k = this.keys;
    let x = 0;
    let y = 0;
    if (k.has('ArrowLeft') || k.has('a')) x -= 1;
    if (k.has('ArrowRight') || k.has('d')) x += 1;
    if (k.has('ArrowUp') || k.has('w')) y += 1;
    if (k.has('ArrowDown') || k.has('s')) y -= 1;
    let focus = k.has('Shift') || k.has('z');
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const dead = 0.18;
      if (Math.abs(ax) > dead || Math.abs(ay) > dead) {
        x += ax;
        y -= ay;
        this.usingPad = true;
      }
      const b = pad.buttons;
      if (b[14]?.pressed) x -= 1;
      if (b[15]?.pressed) x += 1;
      if (b[12]?.pressed) y += 1;
      if (b[13]?.pressed) y -= 1;
      if (b[5]?.pressed || b[7]?.pressed || b[4]?.pressed) focus = true;
      const pressed = (i: number): boolean => !!b[i]?.pressed && !this.padPrev[i];
      if (this.enabled && (pressed(0) || pressed(2))) this.cb.onPulse();
      if (pressed(9)) this.cb.onPause();
      this.padPrev = b.map((btn) => btn.pressed);
      break;
    }
    this.mx = Math.max(-1, Math.min(1, x));
    this.my = Math.max(-1, Math.min(1, y));
    this.focus = focus;
  }

  /** Gamepad menu navigation: returns 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' edges. */
  menuPoll(): string | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const b = pad.buttons;
      const prev = this.padPrev;
      const edge = (i: number): boolean => !!b[i]?.pressed && !prev[i];
      let out: string | null = null;
      if (edge(12)) out = 'up';
      else if (edge(13)) out = 'down';
      else if (edge(14)) out = 'left';
      else if (edge(15)) out = 'right';
      else if (edge(0)) out = 'ok';
      else if (edge(1)) out = 'back';
      this.padPrev = b.map((btn) => btn.pressed);
      return out;
    }
    return null;
  }

  takeDrag(): [number, number] {
    const d: [number, number] = [this.dragPx, this.dragPy];
    this.dragPx = 0;
    this.dragPy = 0;
    return d;
  }

  reset(): void {
    this.keys.clear();
    this.dragPx = this.dragPy = 0;
  }
}
