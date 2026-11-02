// On phones a floating tooltip sits under the finger and hides the lines being
// read, so it is pinned to a band reserved above the plot instead. Desktop keeps
// the floating tooltip, nudged away from the pointer. Band styling: app/mobile.css.
export const PINNED_TOOLTIP_BAND = 52;

export function tooltipPlacement(mobile: boolean) {
  return mobile
    ? { position: { x: 0, y: 0 }, wrapperStyle: { width: '100%' } }
    : { offset: 24 };
}

export function chartTopMargin(top: number, mobile: boolean) {
  return mobile ? top + PINNED_TOOLTIP_BAND : top;
}
