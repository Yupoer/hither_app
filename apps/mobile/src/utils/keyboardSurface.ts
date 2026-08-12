/**
 * Shared keyboard inset math for absolute/scroll surfaces (#172).
 * Gap is fixed at 12pt between keyboard top and interactive surface.
 */

export const KEYBOARD_SURFACE_GAP_PT = 12;

/**
 * `bottom` offset for an absolute-positioned card above the keyboard.
 * When the keyboard is closed, returns the safe-area base bottom.
 * When open, pins the card `gap` points above the keyboard top.
 */
export function keyboardAvoidBottomOffset(input: {
  /** Distance from screen bottom when keyboard is closed (includes safe area). */
  baseBottom: number;
  /** Keyboard height from screen bottom (0 when dismissed). */
  keyboardHeight: number;
  /** Gap between keyboard top and card bottom. Default 12pt. */
  gap?: number;
}): number {
  const gap = input.gap ?? KEYBOARD_SURFACE_GAP_PT;
  const kb = Math.max(0, input.keyboardHeight);
  if (kb <= 0) return Math.max(0, input.baseBottom);
  return Math.max(input.baseBottom, kb + gap);
}

/**
 * Extra bottom padding for ScrollView content so a focused field can scroll
 * above the keyboard with a fixed gap.
 */
export function keyboardScrollPaddingBottom(input: {
  safeAreaBottom: number;
  keyboardHeight: number;
  gap?: number;
}): number {
  const gap = input.gap ?? KEYBOARD_SURFACE_GAP_PT;
  const kb = Math.max(0, input.keyboardHeight);
  if (kb <= 0) return Math.max(0, input.safeAreaBottom);
  return kb + gap;
}
