/** One clock, three equally spaced phases; no independent animation drift. */
export function loadingDotOffset(phase: number, index: number): number {
  'worklet';
  return -10 * (1 - Math.cos(2 * Math.PI * (phase - index / 3)));
}
