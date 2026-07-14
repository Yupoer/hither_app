import type { ImageSourcePropType } from 'react-native';
import type { TranslationKey } from '../../i18n';
import { WHY_OPTIONS, type WhyOption } from '../content';
import { OnboardingIcons } from '../icons';
import makeBrowserStep from './BrowserStep';

const LABEL_KEY: Record<WhyOption, TranslationKey> = {
  findPeople: 'onboarding.c1.findPeople',
  fearLost: 'onboarding.c1.fearLost',
  planTrip: 'onboarding.c1.planTrip',
  curious: 'onboarding.c1.curious',
};

const ICONS: Record<WhyOption, ImageSourcePropType> = {
  findPeople: OnboardingIcons.search,
  fearLost: OnboardingIcons.worried,
  planTrip: OnboardingIcons.map,
  curious: OnboardingIcons.sparkles,
};

export default makeBrowserStep(
  'C1_why',
  'why',
  'onboarding.c1.kicker',
  'onboarding.c1.title',
  WHY_OPTIONS,
  LABEL_KEY,
  ICONS,
);
