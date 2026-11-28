/**
 * Tap-to-choose for suggestion lists (search, store search, address suggestions).
 * A row is chosen only when the finger lifts within 8px of where it went down: a drag scrolls the list instead.
 * While pressed the row gets the .pressed class (shadow); after lifting it stays for 150ms, then onTap(row) runs.
 * onDrag() runs once when a press turns into a drag (e.g. to put the keyboard away).
 */
export function tapList(list, selector, onTap, { onDrag } = {}) {
  let p = null;
  const unpress = () => { if (p) p.t.classList.remove('pressed'); p = null; };
  list.addEventListener('pointerdown', (e) => {
    const t = e.target.closest(selector);
    if (!t || !list.contains(t)) return;
    p = { t, x: e.clientX, y: e.clientY, id: e.pointerId };
    t.classList.add('pressed');
  });
  list.addEventListener('pointermove', (e) => {
    if (!p || e.pointerId !== p.id) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) { unpress(); if (onDrag) onDrag(); }
  });
  // The browser cancels the pointer when it takes over to scroll: that is a drag too.
  list.addEventListener('pointercancel', () => { if (p) { unpress(); if (onDrag) onDrag(); } });
  list.addEventListener('pointerup', (e) => {
    if (!p || e.pointerId !== p.id) return;
    const t = p.t; p = null;
    e.preventDefault();
    setTimeout(() => { t.classList.remove('pressed'); if (t.isConnected) onTap(t); }, 150);
  });
  // Mouse/touch: keep focus in the text box while pressing a row; the tap itself is handled above.
  list.addEventListener('mousedown', (e) => { if (e.target.closest(selector)) e.preventDefault(); });
  list.addEventListener('click', (e) => { if (e.target.closest(selector)) e.preventDefault(); });
  // Keyboard (Enter/Space on a focused row) still works.
  list.addEventListener('keydown', (e) => {
    const t = e.target.closest(selector);
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onTap(t); }
  });
}
