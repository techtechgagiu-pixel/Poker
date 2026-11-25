/** Standard Gamepad API mapping (Xbox / DualSense / DualShock in "standard" layout). Browser support varies. */
type Handler = (cmd: string) => void;
const handlers = new Set<Handler>();
const prev: Record<number, boolean> = {};
let raf = 0; let lastAxis = 0;
const MAP: Record<number, string> = { 0: 'select', 1: 'cancel', 2: 'discard', 3: 'sort', 4: 'take', 5: 'draw', 9: 'settings', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 7: 'close' };
function poll() {
  const pads = navigator.getGamepads?.() ?? [];
  for (const p of pads) {
    if (!p) continue;
    for (const [i, cmd] of Object.entries(MAP)) {
      const pressed = !!p.buttons[+i]?.pressed;
      if (pressed && !prev[+i]) handlers.forEach((h) => h(cmd));
      prev[+i] = pressed;
    }
    const now = performance.now();
    if (now - lastAxis > 180) {
      const [x, y] = [p.axes[0] ?? 0, p.axes[1] ?? 0];
      const cmd = x < -0.6 ? 'left' : x > 0.6 ? 'right' : y < -0.6 ? 'up' : y > 0.6 ? 'down' : null;
      if (cmd) { lastAxis = now; handlers.forEach((h) => h(cmd)); }
    }
  }
  raf = handlers.size ? requestAnimationFrame(poll) : 0;
}
export function onPad(h: Handler) {
  handlers.add(h);
  if (!raf && 'getGamepads' in navigator) raf = requestAnimationFrame(poll);
  return () => { handlers.delete(h); if (!handlers.size && raf) { cancelAnimationFrame(raf); raf = 0; } };
}
window.addEventListener('gamepadconnected', () => { document.body.classList.add('controller-mode'); if (handlers.size && !raf) raf = requestAnimationFrame(poll); });
