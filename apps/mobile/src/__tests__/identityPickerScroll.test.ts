import React from 'react';
import { ScrollView, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { EmojiCarousel } from '../screens/MapScreen/components/IdentityPicker';
import { AVATAR_EMOJI } from '../constants/avatars';
import { selectionTick } from '../utils/haptics';

jest.mock('react-native', () => ({ ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: (styles: object) => styles } }));
jest.mock('../components/MotionPressable', () => ({ __esModule: true, default: 'Pressable' }));
jest.mock('../components/HitherText', () => ({ HitherText: 'Text' }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ language: 'en' }) }));
jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => false }));
jest.mock('../utils/haptics', () => ({ selectionTick: jest.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('ticks each crossed avatar while dragging and coasting, and commits only the final avatar once', () => {
  const onChange = jest.fn();
  let tree: ReactTestRenderer;
  act(() => { tree = create(React.createElement(EmojiCarousel, { avatar: AVATAR_EMOJI[0], color: '#E0634A', onChange, prefix: 'profile' })); });
  try {
    act(() => tree.root.findByType(View).props.onLayout({ nativeEvent: { layout: { width: 350 } } }));
    const scroll = () => tree.root.findByType(ScrollView).props;
    const event = (index: number, velocity = 0) => ({ nativeEvent: { contentOffset: { x: index * 70 }, velocity: { x: velocity } } });
    act(() => scroll().onScrollBeginDrag());
    act(() => scroll().onScroll(event(1)));
    act(() => scroll().onScroll(event(1.2)));
    act(() => scroll().onScroll(event(3)));
    expect(selectionTick).toHaveBeenCalledTimes(3);
    expect(onChange).not.toHaveBeenCalled();
    const highlighted = () => AVATAR_EMOJI.filter(emoji =>
      tree.root.findByProps({ testID: `profile-avatar-${emoji}` }).props.style.some((style: unknown) =>
        !!style && typeof style === 'object' && 'transform' in style));
    expect(highlighted()).toEqual([AVATAR_EMOJI[3]]);
    act(() => scroll().onScrollEndDrag(event(3, 1)));
    act(() => scroll().onScroll(event(4)));
    expect(selectionTick).toHaveBeenCalledTimes(4);
    expect(onChange).not.toHaveBeenCalled();
    act(() => scroll().onMomentumScrollEnd(event(4)));
    expect(onChange.mock.calls).toEqual([[AVATAR_EMOJI[4]]]);
    act(() => scroll().onMomentumScrollEnd(event(4)));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(selectionTick).toHaveBeenCalledTimes(4);
  } finally { act(() => tree.unmount()); }
});
