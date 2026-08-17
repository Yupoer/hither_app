export type MyStatusKind = 'follow' | 'solo' | 'away';

export const STATUS_SHARE_CLUSTER_GAP = 8;

const STATUS_ICONS: Record<MyStatusKind, 'people' | 'walk' | 'exit-outline'> = {
  follow: 'people',
  solo: 'walk',
  away: 'exit-outline',
};

export function statusIconForKind(kind: MyStatusKind): 'people' | 'walk' | 'exit-outline' {
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
