export function createInput() {
  const keys = new Set();
  const once = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code); once.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  const down = (...codes) => codes.some((c) => keys.has(c));
  return {
    get throttle() { return (down('KeyW', 'ArrowUp') ? 1 : 0) - (down('KeyS', 'ArrowDown') ? 1 : 0); },
    get steer() { return (down('KeyA', 'ArrowLeft') ? 1 : 0) - (down('KeyD', 'ArrowRight') ? 1 : 0); },
    get handbrake() { return down('Space'); },
    pressed(code) { const p = once.has(code); once.delete(code); return p; },
    pressedNow(code) { return keys.has(code); },
    endFrame() { once.clear(); },
    // programmatic override (used for automated testing)
    override: null,
  };
}
