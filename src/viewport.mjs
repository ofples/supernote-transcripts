// Some Android hosts overlay the keyboard; others resize the viewport.
// Take the smaller available height so a resized viewport is not subtracted twice.
export function availableModalHeight(viewport, keyboardHiddenHeight, keyboard) {
  return Math.max(0, Math.min(viewport, keyboardHiddenHeight - Math.max(0, keyboard)));
}
