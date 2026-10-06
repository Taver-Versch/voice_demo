export function onXRSelect(event) {
  const cursorEl = document.querySelector("a-cursor");
  if (!cursorEl || !cursorEl.components.raycaster) return;

  const intersectedEls = cursorEl.components.raycaster.intersectedEls;
  if (intersectedEls.length === 0) return;

  intersectedEls[0].emit("click");
}
