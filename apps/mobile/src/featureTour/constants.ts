/** Local AsyncStorage key for one-time group feature tour completion. */
export const GROUP_FEATURE_TOUR_STORAGE_KEY = 'hither.groupFeatureTour.v1';

/** Highlight target ids measured by MapScreen refs. */
export type TourTargetId =
  | 'gatherCard'
  | 'arrivalProgress'
  | 'externalMaps'
  | 'navCommand'
  | 'transport'
  | 'personalArrive'
  | 'meetTime'
  | 'paneMembers'
  | 'paneRoute'
  | 'paneTools'
  | 'paneStore'
  | 'avatar'
  | 'settings'
  | 'addPlaceFavoriteStar'
  | 'addPlaceCenter';

export type TourStepId =
  | 'collapsedCard'
  | 'expandedCard'
  | 'arrivalProgress'
  | 'externalMaps'
  | 'navCommand'
  | 'transport'
  | 'personalArrive'
  | 'meetTime'
  | 'paneMembers'
  | 'paneRoute'
  | 'paneTools'
  | 'paneStore'
  | 'avatar'
  | 'settings'
  | 'getStarted';

export interface TourStepDef {
  id: TourStepId;
  /** Layout target; null for final get-started (center card only). */
  target: TourTargetId | null;
  titleKey: string;
  bodyKey: string;
  /** When true, bodyKey.leader / bodyKey.member variants are used. */
  roleBody?: boolean;
  /** Force expand gather card when entering this step. */
  expandCard?: boolean;
  /** Pause auto-collapse while on/after this gathering step. */
  pauseAutoCollapse?: boolean;
  /** Raise sheet to mid detent (Stage Two). */
  openStageTwo?: boolean;
  /** Select sheet pane when entering. */
  sheetPane?: 'members' | 'route' | 'tools' | 'store';
  /** Final CTA uses getStarted label. */
  final?: boolean;
}

/** Control availability used to filter steps that target optional chrome. */
export interface TourControlAvailability {
  /** When false, skip the navigation-command step (e.g. navCmd.kind === 'hidden'). */
  navCommandVisible: boolean;
  /** When false, skip the personal-arrival step (showArrivalControl === false). */
  personalArriveVisible: boolean;
}

/**
 * Derive the live step plan from the full catalog + current control availability.
 * Always includes gathering/Stage Two/header/final; omits controls not on screen.
 */
export function buildTourSteps(
  availability: TourControlAvailability,
): TourStepDef[] {
  return TOUR_STEPS.filter((step) => {
    if (step.id === 'navCommand' && !availability.navCommandVisible) return false;
    if (step.id === 'personalArrive' && !availability.personalArriveVisible) return false;
    return true;
  });
}

/** Fixed catalog order: gathering card → Stage Two panes → header → done. */
export const TOUR_STEPS: readonly TourStepDef[] = [
  {
    id: 'collapsedCard',
    target: 'gatherCard',
    titleKey: 'tour.collapsedCard.title',
    bodyKey: 'tour.collapsedCard.body',
  },
  {
    id: 'expandedCard',
    target: 'gatherCard',
    titleKey: 'tour.expandedCard.title',
    bodyKey: 'tour.expandedCard.body',
    expandCard: true,
    pauseAutoCollapse: true,
  },
  {
    id: 'arrivalProgress',
    target: 'arrivalProgress',
    titleKey: 'tour.arrivalProgress.title',
    bodyKey: 'tour.arrivalProgress.body',
    expandCard: true,
    pauseAutoCollapse: true,
  },
  {
    id: 'externalMaps',
    target: 'externalMaps',
    titleKey: 'tour.externalMaps.title',
    bodyKey: 'tour.externalMaps.body',
    expandCard: true,
    pauseAutoCollapse: true,
  },
  {
    id: 'navCommand',
    target: 'navCommand',
    titleKey: 'tour.navCommand.title',
    bodyKey: 'tour.navCommand.body',
    roleBody: true,
    expandCard: true,
    pauseAutoCollapse: true,
  },
  {
    id: 'transport',
    target: 'transport',
    titleKey: 'tour.transport.title',
    bodyKey: 'tour.transport.body',
    expandCard: true,
    pauseAutoCollapse: true,
  },
  {
    id: 'personalArrive',
    target: 'personalArrive',
    titleKey: 'tour.personalArrive.title',
    bodyKey: 'tour.personalArrive.body',
    expandCard: true,
    pauseAutoCollapse: true,
  },
  {
    id: 'meetTime',
    target: 'meetTime',
    titleKey: 'tour.meetTime.title',
    bodyKey: 'tour.meetTime.body',
    expandCard: true,
    pauseAutoCollapse: true,
  },
  {
    id: 'paneMembers',
    target: 'paneMembers',
    titleKey: 'tour.paneMembers.title',
    bodyKey: 'tour.paneMembers.body',
    openStageTwo: true,
    sheetPane: 'members',
  },
  {
    id: 'paneRoute',
    target: 'paneRoute',
    titleKey: 'tour.paneRoute.title',
    bodyKey: 'tour.paneRoute.body',
    openStageTwo: true,
    sheetPane: 'route',
  },
  {
    id: 'paneTools',
    target: 'paneTools',
    titleKey: 'tour.paneTools.title',
    bodyKey: 'tour.paneTools.body',
    openStageTwo: true,
    sheetPane: 'tools',
  },
  {
    id: 'paneStore',
    target: 'paneStore',
    titleKey: 'tour.paneStore.title',
    bodyKey: 'tour.paneStore.body',
    openStageTwo: true,
    sheetPane: 'store',
  },
  {
    id: 'avatar',
    target: 'avatar',
    titleKey: 'tour.avatar.title',
    bodyKey: 'tour.avatar.body',
  },
  {
    id: 'settings',
    target: 'settings',
    titleKey: 'tour.settings.title',
    bodyKey: 'tour.settings.body',
  },
  {
    id: 'getStarted',
    target: null,
    titleKey: 'tour.done.title',
    bodyKey: 'tour.done.body',
    final: true,
  },
] as const;
