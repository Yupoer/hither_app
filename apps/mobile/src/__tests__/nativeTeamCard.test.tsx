import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import NativeTeamCard from '../components/NativeTeamCard.ios';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../state/PreferencesContext', () => ({
  usePreferences: () => ({ textScale: 1 }),
}));

it('keeps a rounded team-card header and expanded actions independently tappable', () => {
  const onPress = jest.fn();
  const onAction = jest.fn();
  const screen = render(
    <NativeTeamCard
      teamName="週末散步"
      subtitle="三位成員"
      groupEmoji="🌲"
      members={[]}
      extraCount={0}
      expanded
      onPress={onPress}
      accessibilityLabel="收合隊伍"
    >
      <Pressable onPress={onAction} accessibilityRole="button" accessibilityLabel="開啟隊伍">
        <Text>開啟</Text>
      </Pressable>
    </NativeTeamCard>,
  );
  const header = screen.getByRole('button', { name: '收合隊伍' });
  const action = screen.getByRole('button', { name: '開啟隊伍' });
  expect(header.props.accessibilityState).toEqual({ expanded: true });
  expect(StyleSheet.flatten(screen.UNSAFE_getAllByType(View)[0].props.style)).toMatchObject({
    borderRadius: 24,
    overflow: 'hidden',
  });
  expect(within(header).queryByRole('button', { name: '開啟隊伍' })).toBeNull();
  fireEvent.press(action);
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(onPress).not.toHaveBeenCalled();
  fireEvent.press(header);
  expect(onPress).toHaveBeenCalledTimes(1);
});
