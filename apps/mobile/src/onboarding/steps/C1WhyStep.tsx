import type { TranslationKey } from '../../i18n';
import { WHY_OPTIONS, type WhyOption } from '../content';
import makeBrowserStep from './BrowserStep';

const LABEL_KEY: Record<WhyOption, TranslationKey> = {
  findPeople: 'onboarding.c1.findPeople',
  fearLost: 'onboarding.c1.fearLost',
  planTrip: 'onboarding.c1.planTrip',
  curious: 'onboarding.c1.curious',
};

const EMOJI: Record<WhyOption, string> = {
  findPeople: '🔍',
  fearLost: '😰',
  planTrip: '🗺️',
  curious: '✨',
};

export default makeBrowserStep(
  'C1_why',
  'why',
  'onboarding.c1.kicker',
  'onboarding.c1.title',
  WHY_OPTIONS,
  LABEL_KEY,
  EMOJI,
);
