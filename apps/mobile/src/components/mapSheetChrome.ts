export const MAP_SHEET_ACTION_HALO = 8;
export const MAP_SHEET_ACTION_HIT_SIZE = 44;
export const MAP_SHEET_ACTION_VISUAL_SIZE = 44;
export const MAP_SHEET_ACTION_ICON_SIZE = 17;
export const MAP_SHEET_EDGE_INSET = 16;
export const MAP_SHEET_CORNER_RADIUS = 26;
export const SHEET_CORNER_ACTION_INSET = MAP_SHEET_EDGE_INSET - (MAP_SHEET_ACTION_HIT_SIZE - MAP_SHEET_ACTION_VISUAL_SIZE) / 2;
export const MAP_FLOATING_EDGE_INSET = 12;
/** iOS 26 system sheets place their 44pt toolbar buttons 16pt from the sheet's top and side edges. */
export const SHEET_CORNER_BUTTON_INSET = 16;

/** A leading sheet title clears the rounded corner by more than the corner button does. */
export const SHEET_CORNER_TITLE_INSET = 20;

/**
 * Margins that move a header row's corner actions to `SHEET_CORNER_BUTTON_INSET` when the row
 * already sits `top` below the sheet edge and `side` in from its sides. A `trailing` row starts
 * with its title, which sits at `SHEET_CORNER_TITLE_INSET`.
 */
export function sheetCornerHeaderInset(top: number, side: number, sides: 'trailing' | 'both' = 'trailing') {
  const horizontal = SHEET_CORNER_BUTTON_INSET - side;
  return sides === 'both'
    ? { marginTop: SHEET_CORNER_BUTTON_INSET - top, marginHorizontal: horizontal }
    : { marginTop: SHEET_CORNER_BUTTON_INSET - top, marginRight: horizontal, marginLeft: SHEET_CORNER_TITLE_INSET - side };
}
export const MAP_GATHERING_CORNER_RADIUS = MAP_SHEET_CORNER_RADIUS;
export const MAP_ISLAND_ACTION_HEIGHT = 50;
export const MAP_ISLAND_CORNER_RADIUS = 42;
export const MAP_ISLAND_BODY_FADE_HEIGHT = 48;
export const MAP_FLOATING_GRABBER_HEIGHT = 32;
export const MAP_ISLAND_GRABBER_HEIGHT = 22;
export const MAP_ISLAND_BOTTOM_INSET = MAP_ISLAND_GRABBER_HEIGHT;
export const MAP_ISLAND_SIDE_INSET = MAP_SHEET_EDGE_INSET;
export const MAP_ISLAND_HEIGHT = MAP_ISLAND_GRABBER_HEIGHT + MAP_ISLAND_ACTION_HEIGHT + MAP_ISLAND_BOTTOM_INSET;
export const MAP_SHEET_GRABBER_HEIGHT = 14;
export const D6_SURFACE_COLORS = {
  thin: ['rgba(47,62,59,.33)', 'rgba(28,43,40,.35)'],
  thick: ['rgba(42,54,52,.56)', 'rgba(25,37,35,.73)'],
} as const;
export const D6_SURFACE_BORDER_COLOR = '#ffffff67';
export const D6_SURFACE_SOLID_COLOR = '#26302E';
export const D6_TRIGGER_SHADOW_COLOR = '#354FC5';
export const MAP_SHEET_COMPACT_GRABBER_HEIGHT = 9;
export const SETTINGS_SHEET_CONTENT_INSET = 24;
export const SETTINGS_CHEVRON_SIZE = 17;
export const SETTINGS_CHEVRON_COLOR = 'rgba(255,255,255,0.68)';
export const OVERLAY_SHEET_GRABBER_HEIGHT = 20;
export const MAP_SHEET_PANE_TABS_HEIGHT = { ios: 54, android: 84 } as const;

export type SheetHeaderActionKind = 'close' | 'commit' | 'share' | 'back' | 'more' | 'favorite' | 'favorited';

export const SHEET_HEADER_SYMBOLS = {
  close: 'xmark',
  commit: 'checkmark',
  share: 'square.and.arrow.up',
  back: 'chevron.backward',
  more: 'ellipsis',
  favorite: 'heart',
  favorited: 'heart.fill',
} as const satisfies Record<SheetHeaderActionKind, string>;
