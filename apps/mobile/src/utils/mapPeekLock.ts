/**
 * Peek-locked map surface used to oversize+translate MapView. Full-screen maps
 * pass halfPeek=0 so the surface is edge-to-edge with no letterbox.
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
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  width?: number;
  height?: number;
  transform?: [{ translateX: number }, { translateY: number }];
} {
  const shift = Math.max(0, halfPeek);
  if (shift === 0) {
    return {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    };
  }
  return {
    position: 'absolute',
    width: windowWidth + shift,
    height: windowHeight + shift,
    transform: [{ translateX: shift }, { translateY: shift }],
  };
}
