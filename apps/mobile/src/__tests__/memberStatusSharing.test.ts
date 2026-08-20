import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Alert } from 'react-native';
import { confirmAction } from '../utils/confirm';
import {
  locationSharingConfirmCopy,
  STATUS_SHARE_CLUSTER_GAP,
  statusIconForKind,
} from '../screens/MapScreen/memberStatusSharing';
import { translations } from '../i18n';

const mapScreen = readFileSync(join(__dirname, '..', 'screens', 'MapScreen.tsx'), 'utf8');

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Alert: { alert: jest.fn() },
}));

describe('member status + location sharing seam', () => {
  it('maps follow/solo/away to the same picker icons', () => {
    expect(statusIconForKind('follow')).toBe('people');
    expect(statusIconForKind('solo')).toBe('walk');
    expect(statusIconForKind('stealth')).toBe('eye-off-outline');
    expect(STATUS_SHARE_CLUSTER_GAP).toBe(8);
  });

  it('confirms turning sharing on with the existing settings copy', () => {
    expect(locationSharingConfirmCopy(true)).toEqual({
      titleKey: 'settings.locationSharing',
      bodyKey: 'settings.locationSharingHint',
      destructive: false,
    });
    expect(translations.zh['settings.locationSharing']).toBe('分享我的位置');
    expect(translations.zh['settings.locationSharingHint']).toContain('關閉後停止向隊友更新位置');
  });

  it('confirms turning sharing off with stop-sharing copy', () => {
    expect(locationSharingConfirmCopy(false)).toEqual({
      titleKey: 'settings.locationSharingStopTitle',
      bodyKey: 'settings.locationSharingStopHint',
      destructive: true,
    });
    expect(translations.zh['settings.locationSharingStopTitle']).toBe('停止分享位置');
    expect(translations.zh['settings.locationSharingStopHint']).toBe('隊友將看不到你的即時位置。');
    expect(translations.en['settings.locationSharingStopTitle']).toBe('Stop sharing location');
  });

  it('does not toggle when the confirm is cancelled', () => {
    const alertMock = Alert.alert as jest.Mock;
    alertMock.mockClear();
    const onConfirm = jest.fn();
    const copy = locationSharingConfirmCopy(false);
    confirmAction(
      {
        title: translations.zh[copy.titleKey],
        message: translations.zh[copy.bodyKey],
        destructive: copy.destructive,
      },
      onConfirm,
    );
    const buttons = alertMock.mock.calls[0][2] as Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }>;
    expect(onConfirm).not.toHaveBeenCalled();
    buttons.find((b) => b.style === 'cancel')?.onPress?.();
    expect(onConfirm).not.toHaveBeenCalled();
    buttons.find((b) => b.style === 'destructive')?.onPress?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('keeps the members share button red when off and confirms before toggle', () => {
    const barStart = mapScreen.indexOf('styles.myStatusBar');
    const barEnd = mapScreen.indexOf('RefreshLocationsButton', barStart);
    const bar = mapScreen.slice(barStart, barEnd);
    expect(bar).toContain('testID="members-location-sharing"');
    expect(bar).toContain('color={glass.danger}');
    expect(bar).toContain('activeColor={accent}');
    expect(bar).toContain('NativeMenuHost');
    const handlerStart = mapScreen.indexOf('const handleSharingEnabledChangeAnimated');
    const handler = mapScreen.slice(handlerStart, handlerStart + 700);
    expect(handler).toContain('confirmAction');
    expect(handler).toContain('locationSharingConfirmCopy');
    expect(handler).toContain('revertSharingIcon');
    expect(handler.indexOf('confirmAction')).toBeLessThan(handler.indexOf('handleSharingEnabledChange(nextEnabled)'));
    expect(bar).toContain('revertEpoch={sharingIconEpoch}');
    expect(mapScreen).toContain('requestLocationPermission');
  });
});
