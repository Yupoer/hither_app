export const MAP_SHEET_ACTION_HALO = 8;
export const MAP_SHEET_ACTION_HIT_SIZE = 48;
export const MAP_SHEET_ACTION_VISUAL_SIZE = MAP_SHEET_ACTION_HIT_SIZE;
export const MAP_SHEET_ACTION_ICON_SIZE = 20;
export const MAP_SHEET_EDGE_INSET = 16;
export const MAP_SHEET_CORNER_RADIUS = 44;
export const SHEET_CORNER_ACTION_INSET = MAP_SHEET_CORNER_RADIUS - MAP_SHEET_ACTION_HIT_SIZE / 2;
export const MAP_FLOATING_EDGE_INSET = 12;
export const MAP_GATHERING_CORNER_RADIUS = 28;
export const MAP_ISLAND_ACTION_HEIGHT = 60;
export const MAP_ISLAND_BOTTOM_INSET = MAP_SHEET_CORNER_RADIUS - MAP_ISLAND_ACTION_HEIGHT / 2;
export const MAP_FLOATING_GRABBER_HEIGHT = SHEET_CORNER_ACTION_INSET;
export const MAP_ISLAND_HEIGHT = MAP_FLOATING_GRABBER_HEIGHT + MAP_ISLAND_ACTION_HEIGHT + MAP_ISLAND_BOTTOM_INSET;
export const MAP_SHEET_GRABBER_HEIGHT = 14;
export const D6_SURFACE_COLORS = {
  thin: ['rgba(47,62,59,.33)', 'rgba(28,43,40,.35)'],
  thick: ['rgba(42,54,52,.56)', 'rgba(25,37,35,.73)'],
} as const;
export const D6_SURFACE_BORDER_COLOR = '#ffffff67';
export const D6_SURFACE_SOLID_COLOR = '#26302E';
export const MAP_SHEET_COMPACT_GRABBER_HEIGHT = 9;
export const OVERLAY_SHEET_GRABBER_HEIGHT = SHEET_CORNER_ACTION_INSET;
export const MAP_SHEET_PANE_TABS_HEIGHT = { ios: 54, android: 84 } as const;

export type SheetHeaderActionKind = 'close' | 'commit' | 'share' | 'back' | 'more' | 'favorite' | 'favorited';

export const SHEET_HEADER_SYMBOLS = {
  close: 'xmark',
  commit: 'checkmark',
  share: 'square.and.arrow.up',
  back: 'chevron.left',
  more: 'ellipsis',
  favorite: 'heart',
  favorited: 'heart.fill',
} as const satisfies Record<SheetHeaderActionKind, string>;
