/**
 * OTA-09 coordination request UI: list, detail (respond / override / outcome),
 * and minimal leader create form. Pull-to-refresh; navigation stays independent.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { glass, accentMix } from '../../../glass';
import { useTranslation, type TranslationKey } from '../../../i18n';
import { lightTap, mediumTap } from '../../../utils/haptics';
import type { CoordinationOption, CoordinationPolicy } from '../../../types';
import type {
  CoordinationRequestView,
  UseCoordinationRequestsResult,
} from '../hooks/useCoordinationRequests';

const DEFAULT_DEADLINE_MINUTES = 30;

export interface CoordinationRequestsPanelProps {
  accent: string;
  isLeader: boolean;
  /** MapScreen shared styles (listGroup, listRow, chip, …). */
  styles: Record<string, unknown>;
  coordination: UseCoordinationRequestsResult;
}

function formatDeadline(iso: string, localeHint: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  try {
    return new Date(ms).toLocaleString(localeHint === 'en' ? 'en-US' : 'zh-TW', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function optionLabelForRequest(
  request: CoordinationRequestView,
  optionId: string | null | undefined,
): string | null {
  if (!optionId) return null;
  return request.options.find((o) => o.id === optionId)?.label ?? optionId;
}

function statusKey(status: CoordinationRequestView['status']): TranslationKey {
  switch (status) {
    case 'open':
      return 'coordination.status.open';
    case 'resolved':
      return 'coordination.status.resolved';
    case 'expired':
      return 'coordination.status.expired';
    case 'cancelled':
      return 'coordination.status.cancelled';
    default:
      return 'coordination.status.open';
  }
}



export const CoordinationRequestsPanel = React.memo(function CoordinationRequestsPanel({
  accent,
  isLeader,
  styles: parentStyles,
  coordination,
}: CoordinationRequestsPanelProps) {
  const { t, language } = useTranslation();
  const {
    requests,
    loading,
    refreshing,
    busyRequestId,
    error,
    refresh,
    createRequest,
    respond,
    override,
    cancel,
  } = coordination;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [subject, setSubject] = useState('');
  const [optionA, setOptionA] = useState('');
  const [optionB, setOptionB] = useState('');
  const [policy, setPolicy] = useState<CoordinationPolicy>('majority');
  const [creating, setCreating] = useState(false);

  const selected = useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId],
  );

  const openCreate = useCallback(() => {
    lightTap();
    setShowCreate(true);
    setSelectedId(null);
  }, []);

  const closeCreate = useCallback(() => {
    setShowCreate(false);
    setSubject('');
    setOptionA('');
    setOptionB('');
    setPolicy('majority');
  }, []);

  const handleCreate = useCallback(async () => {
    const trimmed = subject.trim();
    if (!trimmed || creating) return;
    mediumTap();
    setCreating(true);
    const aLabel = optionA.trim() || t('coordination.optionKeep');
    const bLabel = optionB.trim() || t('coordination.optionChange');
    const options: CoordinationOption[] = [
      { id: 'opt_a', label: aLabel, kind: 'keep_current' },
      { id: 'opt_b', label: bLabel, kind: 'itinerary' },
    ];
    const deadline = new Date(Date.now() + DEFAULT_DEADLINE_MINUTES * 60_000).toISOString();
    const created = await createRequest({
      subject: trimmed,
      subjectKind: 'itinerary',
      options,
      deadline,
      policy,
      defaultOutcome: options[0]!.id,
    });
    setCreating(false);
    if (created) {
      closeCreate();
      setSelectedId(created.id);
    }
  }, [subject, optionA, optionB, policy, creating, createRequest, closeCreate, t]);

  const handleRespond = useCallback(
    async (requestId: string, optionId: string) => {
      if (busyRequestId) return;
      mediumTap();
      await respond(requestId, optionId);
    },
    [busyRequestId, respond],
  );

  const handleOverride = useCallback(
    async (requestId: string, optionId: string) => {
      if (busyRequestId) return;
      mediumTap();
      await override(requestId, optionId);
    },
    [busyRequestId, override],
  );

  const handleCancel = useCallback(
    async (requestId: string) => {
      if (busyRequestId) return;
      mediumTap();
      const ok = await cancel(requestId);
      if (ok) setSelectedId(null);
    },
    [busyRequestId, cancel],
  );

  const listStyles = parentStyles as {
    overlayBody?: object;
    listGroup?: object;
    listRow?: object;
    listRowTitle?: object;
    listRowTrailing?: object;
    overlayHint?: object;
    sectionLabel?: object;
    grow?: object;
    chip?: object;
    chipText?: object;
    chipGhost?: object;
    splitActions?: object;
  };

  if (showCreate && isLeader) {
    return (
      <ScrollView
        contentContainerStyle={listStyles.overlayBody}
        testID="coordination-create-form"
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={closeCreate}
          style={local.backRow}
          accessibilityRole="button"
          accessibilityLabel={t('coordination.back')}
          testID="coordination-create-back"
        >
          <Ionicons name="chevron-back" size={18} color={accent} />
          <Text style={[local.backLabel, { color: accent }]}>{t('coordination.back')}</Text>
        </Pressable>

        <Text style={listStyles.sectionLabel}>{t('coordination.createTitle')}</Text>
        <View style={listStyles.listGroup}>
          <TextInput
            style={local.input}
            value={subject}
            onChangeText={setSubject}
            placeholder={t('coordination.subjectPlaceholder')}
            placeholderTextColor={glass.textTertiary}
            accessibilityLabel={t('coordination.subjectPlaceholder')}
            testID="coordination-subject-input"
          />
          <TextInput
            style={local.input}
            value={optionA}
            onChangeText={setOptionA}
            placeholder={t('coordination.optionAPlaceholder')}
            placeholderTextColor={glass.textTertiary}
            testID="coordination-option-a"
          />
          <TextInput
            style={local.input}
            value={optionB}
            onChangeText={setOptionB}
            placeholder={t('coordination.optionBPlaceholder')}
            placeholderTextColor={glass.textTertiary}
            testID="coordination-option-b"
          />
        </View>

        <Text style={listStyles.sectionLabel}>{t('coordination.policy')}</Text>
        <View style={[listStyles.splitActions, { paddingHorizontal: 4, gap: 8 }]}>
          {(['majority', 'unanimity', 'timeout_default', 'organizer_override'] as CoordinationPolicy[]).map(
            (p) => {
              const selectedPolicy = policy === p;
              const key = `coordination.policy.${p}` as TranslationKey;
              return (
                <Pressable
                  key={p}
                  style={[
                    listStyles.chip,
                    selectedPolicy && {
                      backgroundColor: accentMix(accent, 24),
                      borderColor: accentMix(accent, 50),
                    },
                  ]}
                  onPress={() => {
                    lightTap();
                    setPolicy(p);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedPolicy }}
                  testID={`coordination-policy-${p}`}
                >
                  <Text style={listStyles.chipText}>{t(key)}</Text>
                </Pressable>
              );
            },
          )}
        </View>

        <Text style={listStyles.overlayHint}>
          {t('coordination.deadlineHint', { minutes: String(DEFAULT_DEADLINE_MINUTES) })}
        </Text>

        <Pressable
          style={[
            local.primaryBtn,
            { backgroundColor: accentMix(accent, 32), borderColor: accentMix(accent, 60) },
            (creating || !subject.trim()) && { opacity: 0.5 },
          ]}
          onPress={() => void handleCreate()}
          disabled={creating || !subject.trim()}
          accessibilityRole="button"
          accessibilityLabel={t('coordination.submit')}
          testID="coordination-create-submit"
        >
          {creating ? (
            <ActivityIndicator color={accent} />
          ) : (
            <Text style={[local.primaryBtnLabel, { color: accent }]}>
              {t('coordination.submit')}
            </Text>
          )}
        </Pressable>
        {error ? <Text style={local.error}>{error}</Text> : null}
      </ScrollView>
    );
  }

  if (selected) {
    const busy = busyRequestId === selected.id;
    const isOpen = selected.status === 'open';
    const outcomeLabel = optionLabelForRequest(selected, selected.resolvedOutcome);
    return (
      <ScrollView
        contentContainerStyle={listStyles.overlayBody}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={accent}
          />
        }
        testID="coordination-detail"
      >
        <Pressable
          onPress={() => {
            lightTap();
            setSelectedId(null);
          }}
          style={local.backRow}
          accessibilityRole="button"
          accessibilityLabel={t('coordination.back')}
          testID="coordination-detail-back"
        >
          <Ionicons name="chevron-back" size={18} color={accent} />
          <Text style={[local.backLabel, { color: accent }]}>{t('coordination.back')}</Text>
        </Pressable>

        <View style={listStyles.listGroup}>
          <View style={listStyles.listRow}>
            <View style={listStyles.grow}>
              <Text style={listStyles.listRowTitle}>{selected.subject}</Text>
              <Text style={listStyles.overlayHint}>
                {t(statusKey(selected.status))}
                {' · '}
                {t('coordination.responseCount', { count: selected.responseCount })}
                {' · '}
                {t('coordination.deadline', {
                  time: formatDeadline(selected.deadline, language),
                })}
              </Text>
              {!isOpen && outcomeLabel ? (
                <Text style={[listStyles.overlayHint, { color: glass.ok }]}>
                  {t('coordination.outcome', { label: outcomeLabel })}
                  {selected.resolutionSource
                    ? ` · ${t(`coordination.source.${selected.resolutionSource}` as TranslationKey)}`
                    : ''}
                </Text>
              ) : null}
              {isOpen && selected.myOptionId ? (
                <Text style={listStyles.overlayHint}>
                  {t('coordination.myResponse', {
                    label: optionLabelForRequest(selected, selected.myOptionId) ?? '',
                  })}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        {isOpen ? (
          <>
            <Text style={listStyles.sectionLabel}>{t('coordination.chooseOption')}</Text>
            <View style={listStyles.listGroup}>
              {selected.options.map((opt) => {
                const picked = selected.myOptionId === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    style={[
                      listStyles.listRow,
                      picked && { backgroundColor: accentMix(accent, 16) },
                      busy && { opacity: 0.5 },
                    ]}
                    onPress={() => void handleRespond(selected.id, opt.id)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityState={{ selected: picked, disabled: busy }}
                    accessibilityLabel={opt.label}
                    testID={`coordination-option-${opt.id}`}
                  >
                    <Text style={listStyles.listRowTitle}>{opt.label}</Text>
                    {picked ? (
                      <Ionicons name="checkmark-circle" size={18} color={accent} />
                    ) : (
                      <Ionicons name="ellipse-outline" size={18} color={glass.textTertiary} />
                    )}
                  </Pressable>
                );
              })}
            </View>
            <Text style={listStyles.overlayHint}>{t('coordination.silenceOk')}</Text>

            {isLeader ? (
              <>
                <Text style={listStyles.sectionLabel}>{t('coordination.leaderActions')}</Text>
                <View style={[listStyles.splitActions, { paddingHorizontal: 4, gap: 8, flexWrap: 'wrap' }]}>
                  {selected.options.map((opt) => (
                    <Pressable
                      key={`ov-${opt.id}`}
                      style={[
                        listStyles.chip,
                        { backgroundColor: accentMix(accent, 24), borderColor: accentMix(accent, 50) },
                        busy && { opacity: 0.5 },
                      ]}
                      onPress={() => void handleOverride(selected.id, opt.id)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('coordination.override')}: ${opt.label}`}
                      testID={`coordination-override-${opt.id}`}
                    >
                      <Text style={listStyles.chipText}>
                        {t('coordination.override')}: {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    style={[listStyles.chipGhost, busy && { opacity: 0.5 }]}
                    onPress={() => void handleCancel(selected.id)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={t('coordination.cancel')}
                    testID="coordination-cancel"
                  >
                    <Text style={listStyles.chipText}>{t('coordination.cancel')}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </>
        ) : null}

        {error ? <Text style={local.error}>{error}</Text> : null}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={listStyles.overlayBody}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={accent}
        />
      }
      testID="coordination-list"
    >
      {isLeader ? (
        <Pressable
          style={[
            local.primaryBtn,
            { backgroundColor: accentMix(accent, 24), borderColor: accentMix(accent, 50) },
          ]}
          onPress={openCreate}
          accessibilityRole="button"
          accessibilityLabel={t('coordination.create')}
          testID="coordination-open-create"
        >
          <Ionicons name="add" size={18} color={accent} />
          <Text style={[local.primaryBtnLabel, { color: accent }]}>
            {t('coordination.create')}
          </Text>
        </Pressable>
      ) : null}

      {loading && requests.length === 0 ? (
        <View style={local.center}>
          <ActivityIndicator color={accent} />
          <Text style={listStyles.overlayHint}>{t('coordination.loading')}</Text>
        </View>
      ) : null}

      {!loading && requests.length === 0 ? (
        <Text style={listStyles.overlayHint} testID="coordination-empty">
          {t('coordination.empty')}
        </Text>
      ) : null}

      {requests.map((req) => {
        const outcomeLabel = optionLabelForRequest(req, req.resolvedOutcome);
        return (
          <Pressable
            key={req.id}
            style={listStyles.listGroup}
            onPress={() => {
              lightTap();
              setSelectedId(req.id);
            }}
            accessibilityRole="button"
            accessibilityLabel={req.subject}
            testID={`coordination-row-${req.id}`}
          >
            <View style={listStyles.listRow}>
              <View style={listStyles.grow}>
                <Text style={listStyles.listRowTitle} numberOfLines={2}>
                  {req.subject}
                </Text>
                <Text style={listStyles.overlayHint} numberOfLines={2}>
                  {t(statusKey(req.status))}
                  {' · '}
                  {t('coordination.responseCount', { count: req.responseCount })}
                  {' · '}
                  {t('coordination.deadline', {
                    time: formatDeadline(req.deadline, language),
                  })}
                </Text>
                {req.status !== 'open' && outcomeLabel ? (
                  <Text style={[listStyles.overlayHint, { color: glass.ok }]} numberOfLines={1}>
                    {t('coordination.outcome', { label: outcomeLabel })}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={glass.textTertiary} />
            </View>
          </Pressable>
        );
      })}

      {error ? <Text style={local.error}>{error}</Text> : null}
    </ScrollView>
  );
});

const local = StyleSheet.create({
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  backLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  input: {
    marginHorizontal: 12,
    marginVertical: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: glass.fill,
    color: glass.textPrimary,
    fontSize: 15,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  primaryBtnLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  center: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
  },
  error: {
    color: glass.danger,
    fontSize: 13,
    marginTop: 8,
  },
});
