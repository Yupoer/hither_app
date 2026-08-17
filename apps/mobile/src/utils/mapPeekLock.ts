/**
 * Peek-locked map surface: shift the whole MapView down+right by half the
 * peek sheet height and oversize it so the extra pixels fill the corner.
 */
export function halfPeekOffset(peekHeight: number): number {
  return Math.max(0, peekHeight) / 2;
}

export function oversizedMapStyle(
  windowWidth: number,
  windowHeight: number,
  halfPeek: number,
): {
  position: 'absolute';
  width: number;
  height: number;
  transform: [{ translateX: number }, { translateY: number }];
} {
  const shift = Math.max(0, halfPeek);
  return {
    position: 'absolute',
    width: windowWidth + shift,
    height: windowHeight + shift,
    transform: [{ translateX: shift }, { translateY: shift }],
  };
}
