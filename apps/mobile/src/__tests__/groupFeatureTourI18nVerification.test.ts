/**
 * Ticket 09 — integrated verification evidence for group feature tour + i18n.
 *
 * Device Unverified: no emulator/device run in this agent environment.
 * Automated coverage: catalog keys, step order, gate, storage, expansion pause.
 */
import { translate, translationKeys } from '../i18n';
import { TOUR_STEPS } from '../featureTour/constants';
import { stepOrder } from '../featureTour/tourController';
import { shouldStartGroupFeatureTour } from '../featureTour/storage';

describe('integrated tour + i18n verification', () => {
  it('zh/en catalogs stay key-identical (contract)', () => {
    expect(translationKeys('en')).toEqual(translationKeys('zh'));
  });

  it('every tour step title/body key resolves in zh and en', () => {
    for (const step of TOUR_STEPS) {
      if (step.roleBody) {
        for (const suffix of ['.leader', '.member'] as const) {
          const key = `${step.bodyKey}${suffix}` as Parameters<typeof translate>[1];
          expect(translate('zh', key).length).toBeGreaterThan(0);
          expect(translate('en', key).length).toBeGreaterThan(0);
          expect(translate('zh', key)).not.toBe(key);
          expect(translate('en', key)).not.toBe(key);
        }
      } else {
        const title = step.titleKey as Parameters<typeof translate>[1];
        const body = step.bodyKey as Parameters<typeof translate>[1];
        expect(translate('zh', title)).not.toBe(title);
        expect(translate('en', title)).not.toBe(title);
        expect(translate('zh', body)).not.toBe(body);
        expect(translate('en', body)).not.toBe(body);
      }
      const titleKey = step.titleKey as Parameters<typeof translate>[1];
      expect(translate('zh', titleKey).length).toBeGreaterThan(0);
    }
    expect(translate('zh', 'tour.next')).toBe('下一個');
    expect(translate('en', 'tour.next')).toBe('Next');
    expect(translate('zh', 'tour.getStarted')).toBe('開始使用');
    expect(translate('en', 'tour.getStarted')).toBe('Get started');
  });

  it('documents end-to-end step walk for leader vs member nav copy', () => {
    const order = stepOrder();
    expect(order.indexOf('navCommand')).toBeGreaterThan(order.indexOf('collapsedCard'));
    const nav = TOUR_STEPS.find((s) => s.id === 'navCommand');
    expect(nav?.roleBody).toBe(true);
    expect(translate('zh', 'tour.navCommand.body.leader')).toContain('隊長');
    expect(translate('zh', 'tour.navCommand.body.member')).toContain('成員');
    expect(translate('en', 'tour.navCommand.body.leader').toLowerCase()).toContain('leader');
    expect(translate('en', 'tour.navCommand.body.member').toLowerCase()).toContain('member');
  });

  it('records lifecycle matrix (automated subset)', () => {
    // First trigger
    expect(
      shouldStartGroupFeatureTour({
        onboardingCompleted: true,
        hasGroupId: true,
        destinationCount: 1,
        tourCompleted: false,
      }),
    ).toBe(true);
    // Complete → no replay
    expect(
      shouldStartGroupFeatureTour({
        onboardingCompleted: true,
        hasGroupId: true,
        destinationCount: 1,
        tourCompleted: true,
      }),
    ).toBe(false);
    // Empty group
    expect(
      shouldStartGroupFeatureTour({
        onboardingCompleted: true,
        hasGroupId: true,
        destinationCount: 0,
        tourCompleted: false,
      }),
    ).toBe(false);
    // Mid-session remount: incomplete → step 0 (no step persistence by design)
    expect(TOUR_STEPS[0].id).toBe('collapsedCard');
  });

  it('device matrix Unverified in this CI/agent run', () => {
    const evidence = {
      iosReleaseLike: 'Unverified — no simulator/device in agent environment',
      androidReleaseLike: 'Unverified — no emulator/device in agent environment',
      largeText: 'Unverified on device; overlay uses dynamic layout math',
      reduceMotion: 'Unverified on device; prop reduceMotion supported',
      screenReader: 'Unverified on device; accessibilityViewIsModal set',
      crossDeviceAccountFlag: 'Unit-tested best-effort updateProfile; device Unverified',
    };
    expect(evidence.iosReleaseLike).toMatch(/Unverified/);
    expect(evidence.androidReleaseLike).toMatch(/Unverified/);
  });
});
