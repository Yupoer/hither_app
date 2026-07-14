import type { ImageSourcePropType } from 'react-native';
import type { ThemeName } from '../theme';
import type { MascotId } from './content';

/**
 * Flat solid color-block onboarding icons (style locked to approved samples
 * 55/58/63). Transparent PNG assets (user-keyed).
 */
export const OnboardingIcons = {
  leader: require('../../assets/icons/onboarding/crook.png') as ImageSourcePropType,
  follower: require('../../assets/icons/onboarding/sheep.png') as ImageSourcePropType,
  browser: require('../../assets/icons/onboarding/eyes.png') as ImageSourcePropType,

  plane: require('../../assets/icons/onboarding/plane.png') as ImageSourcePropType,
  city: require('../../assets/icons/onboarding/city.png') as ImageSourcePropType,
  family: require('../../assets/icons/onboarding/family.png') as ImageSourcePropType,
  party: require('../../assets/icons/onboarding/party.png') as ImageSourcePropType,

  ramen: require('../../assets/icons/onboarding/ramen.png') as ImageSourcePropType,
  walk: require('../../assets/icons/onboarding/walk.png') as ImageSourcePropType,
  map: require('../../assets/icons/onboarding/map.png') as ImageSourcePropType,
  leaf: require('../../assets/icons/onboarding/leaf.png') as ImageSourcePropType,
  clock: require('../../assets/icons/onboarding/clock.png') as ImageSourcePropType,
  snail: require('../../assets/icons/onboarding/snail.png') as ImageSourcePropType,

  camera: require('../../assets/icons/onboarding/camera.png') as ImageSourcePropType,
  shopping: require('../../assets/icons/onboarding/shopping.png') as ImageSourcePropType,
  nature: require('../../assets/icons/onboarding/nature.png') as ImageSourcePropType,
  temple: require('../../assets/icons/onboarding/temple.png') as ImageSourcePropType,
  nightlife: require('../../assets/icons/onboarding/nightlife.png') as ImageSourcePropType,

  search: require('../../assets/icons/onboarding/search.png') as ImageSourcePropType,
  worried: require('../../assets/icons/onboarding/worried.png') as ImageSourcePropType,
  sparkles: require('../../assets/icons/onboarding/sparkles.png') as ImageSourcePropType,
  friends: require('../../assets/icons/onboarding/friends.png') as ImageSourcePropType,
  couple: require('../../assets/icons/onboarding/couple.png') as ImageSourcePropType,
  briefcase: require('../../assets/icons/onboarding/briefcase.png') as ImageSourcePropType,

  pin: require('../../assets/icons/onboarding/pin.png') as ImageSourcePropType,
  bell: require('../../assets/icons/onboarding/bell.png') as ImageSourcePropType,
  notepad: require('../../assets/icons/onboarding/notepad.png') as ImageSourcePropType,
  book: require('../../assets/icons/onboarding/book.png') as ImageSourcePropType,

  flag: require('../../assets/icons/onboarding/flag.png') as ImageSourcePropType,
  calendar: require('../../assets/icons/onboarding/calendar.png') as ImageSourcePropType,

  memberCool: require('../../assets/icons/onboarding/member-cool.png') as ImageSourcePropType,
  memberFox: require('../../assets/icons/onboarding/member-fox.png') as ImageSourcePropType,
  memberCompass: require('../../assets/icons/onboarding/member-compass.png') as ImageSourcePropType,
  memberBackpack: require('../../assets/icons/onboarding/member-backpack.png') as ImageSourcePropType,

  theme: {
    night: require('../../assets/icons/night_light.png') as ImageSourcePropType,
    day: require('../../assets/icons/morning_light.png') as ImageSourcePropType,
    dusk: require('../../assets/icons/dusk.png') as ImageSourcePropType,
    forest: require('../../assets/icons/forest.png') as ImageSourcePropType,
  } satisfies Record<ThemeName, ImageSourcePropType>,

  mascot: {
    collie: require('../../assets/icons/onboarding/mascot-collie.png') as ImageSourcePropType,
    retriever: require('../../assets/icons/onboarding/mascot-retriever.png') as ImageSourcePropType,
    koala: require('../../assets/icons/onboarding/mascot-koala.png') as ImageSourcePropType,
    cat: require('../../assets/icons/onboarding/mascot-cat.png') as ImageSourcePropType,
  } satisfies Record<MascotId, ImageSourcePropType>,
} as const;
