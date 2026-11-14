import { APP_TEXT_SIZE } from '../../theme/typeScale';
import React, { useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput, type AppTextInputRef } from '../../components/AppText';
import Pressable from '../../components/MotionPressable';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useMountEffect } from '../../hooks/useMountEffect';
import { useTranslation } from '../../i18n';
import { INVITE_CODE_LENGTH, normalizeInviteCode } from '../../navigation/teamEntry';
import NativeGlassButton from '../../components/NativeGlassButton';
import { ENTRY_ACCENT } from './EntryVisuals';

export default function EntryCodeInput({ onJoin, onCreate, rejected }: {
  onJoin: (code: string) => void;
  onCreate: () => void;
  rejected: boolean;
}) {
  const { t } = useTranslation();
  const input = useRef<AppTextInputRef>(null);
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const offset = useSharedValue(0);
  const codeMotion = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  useMountEffect(() => {
    if (!rejected) return;
    const step = { duration: 50, reduceMotion: ReduceMotion.System };
    offset.set(withSequence(
      withTiming(-11, step), withTiming(9, step), withTiming(-6, step), withTiming(3, step), withTiming(0, step),
    ));
  });

  function updateCode(value: string) {
    const normalized = normalizeInviteCode(value);
    setCode(normalized);
    if (normalized.length !== INVITE_CODE_LENGTH || normalized === code) return;
    Keyboard.dismiss();
    setCode('');
    onJoin(normalized);
  }

  return (
    <View>
      <Animated.View style={codeMotion}>
        <Pressable
          accessible={false}
          style={styles.boxes}
          onPress={() => input.current?.focus()}
        >
          {Array.from({ length: INVITE_CODE_LENGTH }, (_, index) => (
            <View key={index} style={[
              styles.cell,
              index === 3 && styles.cellBreak,
              index === code.length && (focused || (!rejected && !code)) && styles.cellActive,
            ]}>
              <Text style={styles.character}>{code[index]}</Text>
            </View>
          ))}
          <TextInput
            ref={input}
            value={code}
            onChangeText={updateCode}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            accessibilityLabel={t('group.codeLabel')}
            testID="auth-code"
            autoCapitalize="characters"
            autoCorrect={false}
            keyboardAppearance="dark"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            caretHidden
            style={styles.input}
          />
        </Pressable>
      </Animated.View>
      <Text style={styles.divider}>{t('entry.or')}</Text>
      <NativeGlassButton
        label={t('entry.createTeam')}
        accessibilityLabel={t('entry.createTeam')}
        testID="role-create"
        variant="glass"
        shape="capsule"
        layout="fill"
        height={56}
        fontSize={17}
        fontWeight="bold"
        foregroundColor="#fff"
        onPress={onCreate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  boxes: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  cell: {
    maxWidth: 48, flex: 1, height: 60, borderRadius: 16, alignItems: 'center',
    justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  cellBreak: { marginLeft: 10 },
  cellActive: { borderWidth: 2, borderColor: ENTRY_ACCENT },
  character: { fontSize: APP_TEXT_SIZE.heading, fontWeight: '800', fontStyle: 'italic', color: '#fff' },
  input: { ...StyleSheet.absoluteFill, opacity: 0.02, color: 'transparent' },
  divider: { textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontSize: APP_TEXT_SIZE.caption, marginVertical: 12 },
});
