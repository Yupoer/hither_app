import type { ImageSourcePropType } from 'react-native';
import type { TranslationKey } from '../../i18n';
import { COMPANION_OPTIONS, type CompanionOption } from '../content';
import { OnboardingIcons } from '../icons';
import makeBrowserStep from './BrowserStep';

const LABEL_KEY: Record<CompanionOption, TranslationKey> = {
  family: 'onboarding.c2.family',
  friends: 'onboarding.c2.friends',
  partner: 'onboarding.c2.partner',
  colleagues: 'onboarding.c2.colleagues',
};

const ICONS: Record<CompanionOption, ImageSourcePropType> = {
  family: OnboardingIcons.family,
  friends: OnboardingIcons.friends,
  partner: OnboardingIcons.couple,
  colleagues: OnboardingIcons.briefcase,
};

export default makeBrowserStep(
  'C2_companions',
  'companions',
  'onboarding.c2.kicker',
  'onboarding.c2.title',
  COMPANION_OPTIONS,
  LABEL_KEY,
  ICONS,
);
