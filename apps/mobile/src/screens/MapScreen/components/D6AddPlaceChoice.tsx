import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HitherText } from '../../../components/HitherText';
import Pressable from '../../../components/MotionPressable';
import { APP_TEXT_SIZE } from '../../../theme/typeScale';

export type PlaceChoiceOption = {
  testID: string;
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
};

export type AddPlaceChoiceProps = {
  label: string;
  value: string;
  testID: string;
  options: readonly PlaceChoiceOption[];
  expanded: boolean;
  onToggle: () => void;
};

export default function AddPlaceChoice({ label, value, testID, options, expanded, onToggle }: AddPlaceChoiceProps) {
  const content = <>
    <HitherText style={styles.label}>{label}</HitherText>
    <HitherText style={styles.value} numberOfLines={1} ellipsizeMode="middle">{value}</HitherText>
    {options.length > 0 ? <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color="#C2CCEF" /> : null}
  </>;

  if (!options.length) return <View testID={testID} style={styles.choice}>{content}</View>;

  return <>
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{ text: value }}
      accessibilityState={{ expanded }} onPress={onToggle} style={[styles.choice, expanded && styles.expanded]}>
      {content}
    </Pressable>
    {expanded ? (
      <ScrollView testID={testID + '-options'} style={styles.options} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {options.map(option => (
          <Pressable key={option.testID} testID={option.testID} accessibilityRole="button" accessibilityState={{ selected: option.selected }}
            onPress={option.onPress} style={[styles.option, option.selected && styles.selected]}>
            <View style={styles.grow}>
              <HitherText style={styles.optionTitle}>{option.label}</HitherText>
              {option.description ? <HitherText style={styles.optionDetail}>{option.description}</HitherText> : null}
            </View>
            <View style={styles.mark}>{option.selected ? <Ionicons name="checkmark" size={20} color="#B4C4FF" /> : null}</View>
          </Pressable>
        ))}
      </ScrollView>
    ) : null}
  </>;
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  choice: { flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: 10, paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 14, backgroundColor: '#ffffff12' },
  expanded: { backgroundColor: '#879DFF2b' },
  label: { color: '#fff', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600', flexShrink: 0 },
  value: { color: '#D7DFFD', fontSize: APP_TEXT_SIZE.caption, flex: 1, textAlign: 'right' },
  options: { flexGrow: 0, maxHeight: 184, backgroundColor: '#090C18a8', borderRadius: 14 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 7, paddingHorizontal: 13 },
  selected: { backgroundColor: '#879DFF24' },
  optionTitle: { color: '#fff', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  optionDetail: { color: '#C1C8DA', fontSize: APP_TEXT_SIZE.caption, marginTop: 2 },
  mark: { width: 22, alignItems: 'center' },
});
