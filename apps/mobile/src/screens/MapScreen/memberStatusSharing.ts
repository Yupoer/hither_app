import type { PresenceMacroKind } from '../../utils/presenceMacros';

export type MyStatusKind = PresenceMacroKind;

export const STATUS_SHARE_CLUSTER_GAP = 8;

const STATUS_ICONS: Record<MyStatusKind, 'people' | 'walk' | 'eye-off-outline'> = {
  follow: 'people',
  solo: 'walk',
  stealth: 'eye-off-outline',
};

export function statusIconForKind(kind: MyStatusKind): 'people' | 'walk' | 'eye-off-outline' {
  return STATUS_ICONS[kind];
}

export function locationSharingConfirmCopy(nextEnabled: boolean): {
  titleKey: 'settings.locationSharing' | 'settings.locationSharingStopTitle';
  bodyKey: 'settings.locationSharingHint' | 'settings.locationSharingStopHint';
  destructive: boolean;
} {
  if (nextEnabled) {
    return {
      titleKey: 'settings.locationSharing',
      bodyKey: 'settings.locationSharingHint',
      destructive: false,
    };
  }
  return {
    titleKey: 'settings.locationSharingStopTitle',
    bodyKey: 'settings.locationSharingStopHint',
    destructive: true,
  };
}
