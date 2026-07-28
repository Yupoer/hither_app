jest.mock('react-native', () => ({
  Linking: { openURL: jest.fn(() => Promise.resolve()) },
  Platform: { OS: 'ios' },
  Alert: { alert: jest.fn() },
}));

import { Alert } from 'react-native';
import {
  buildNavigationUrl,
  presentExternalMapsChooser,
  type ExternalMapsProvider,
} from '../native/externalNavigation';
import type { Destination } from '../types';

const taipei101 = {
  id: 'd1',
  title: 'Taipei 101 / 台北101',
  coordinates: { latitude: 25.0339, longitude: 121.5645 },
  order: 0,
  day: 1,
} as Destination;

describe('buildNavigationUrl', () => {
  it('builds a Google Maps walking URL with encoded destination', () => {
    const url = buildNavigationUrl('google', taipei101, 'walk');
    expect(url).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=25.0339%2C121.5645&travelmode=walking',
    );
    expect(url).toContain('google.com/maps/dir');
    expect(url).toContain('travelmode=walking');
  });

  it('maps drive and transit modes for Google Maps', () => {
    expect(buildNavigationUrl('google', taipei101, 'drive')).toContain('travelmode=driving');
    expect(buildNavigationUrl('google', taipei101, 'transit')).toContain('travelmode=transit');
  });

  it('builds an Apple Maps URL', () => {
    const url = buildNavigationUrl('apple', taipei101, 'walk');
    expect(url).toContain('maps.apple.com');
    expect(url).toContain('daddr=25.0339');
    expect(url).toContain('dirflg=w');
    expect(url).toMatch(/q=/);
  });

  it('encodes special characters via URLSearchParams (no raw title concatenation)', () => {
    const dest = {
      ...taipei101,
      title: 'A&B=C?D',
    } as Destination;
    const url = buildNavigationUrl('apple', dest, 'walk');
    expect(url).not.toContain('A&B=C?D');
    expect(url).toContain('maps.apple.com');
  });

  it('accepts either provider regardless of platform default', () => {
    const providers: ExternalMapsProvider[] = ['google', 'apple'];
    for (const provider of providers) {
      const url = buildNavigationUrl(provider, taipei101, 'walk');
      if (provider === 'google') {
        expect(url).toContain('google.com/maps');
      } else {
        expect(url).toContain('maps.apple.com');
      }
    }
  });
});

describe('presentExternalMapsChooser', () => {
  it('offers Google Maps, Apple Maps, and cancel; opens only on selection', () => {
    const open = jest.fn(() => Promise.resolve());
    const alert = jest.fn() as unknown as typeof Alert.alert;

    presentExternalMapsChooser(
      taipei101,
      'walk',
      {
        title: 'Open in maps',
        googleLabel: 'Google Maps',
        appleLabel: 'Apple Maps',
        cancelLabel: 'Cancel',
      },
      { alert, open },
    );

    expect(alert).toHaveBeenCalledTimes(1);
    const [, , buttons] = (alert as jest.Mock).mock.calls[0] as [
      string,
      undefined,
      Array<{ text: string; onPress?: () => void; style?: string }>,
    ];
    expect(buttons.map((b) => b.text)).toEqual(['Google Maps', 'Apple Maps', 'Cancel']);
    expect(buttons[2]?.style).toBe('cancel');
    expect(open).not.toHaveBeenCalled();

    buttons[0]?.onPress?.();
    expect(open).toHaveBeenCalledWith(taipei101, 'walk', 'google');

    buttons[1]?.onPress?.();
    expect(open).toHaveBeenCalledWith(taipei101, 'walk', 'apple');
  });

  it('surfaces an alert when the selected maps app fails to open', async () => {
    const open = jest.fn(() => Promise.reject(new Error('cannot open')));
    const alert = jest.fn() as unknown as typeof Alert.alert;

    presentExternalMapsChooser(
      taipei101,
      'walk',
      {
        title: 'Open in maps',
        googleLabel: 'Google Maps',
        appleLabel: 'Apple Maps',
        cancelLabel: 'Cancel',
        openFailedTitle: 'Failed',
        openFailedMessage: 'Could not open maps',
      },
      { alert, open },
    );

    const [, , buttons] = (alert as jest.Mock).mock.calls[0] as [
      string,
      undefined,
      Array<{ text: string; onPress?: () => void }>,
    ];
    buttons[0]?.onPress?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(alert).toHaveBeenCalledWith('Failed', 'Could not open maps');
  });
});
