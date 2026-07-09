import type { TranslationKey } from '../../i18n';
import { WANTED_OPTIONS, type WantedOption } from '../content';
import makeBrowserStep from './BrowserStep';

const LABEL_KEY: Record<WantedOption, TranslationKey> = {
  liveLocation: 'onboarding.c3.liveLocation',
  meetReminders: 'onboarding.c3.meetReminders',
  sharedItinerary: 'onboarding.c3.sharedItinerary',
  tripRecap: 'onboarding.c3.tripRecap',
};

export default makeBrowserStep(
  'C3_wanted',
  'wanted',
  'onboarding.c3.title',
  WANTED_OPTIONS,
  LABEL_KEY,
);
