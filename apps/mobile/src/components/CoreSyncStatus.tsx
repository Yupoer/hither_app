import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CoreOperation, CoreOperationType } from '../types/coreData';
import type { TranslationKey } from '../i18n';

interface Props {
  operations: CoreOperation[];
  actorId: string | null;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  onResolve: (operation: CoreOperation, action: 'discard' | 'reapply') => Promise<void>;
  describeError: (error: unknown) => string;
}

const operationLabels: Record<CoreOperationType, TranslationKey> = {
  start_gathering: 'coreData.actionStart', switch_gathering: 'coreData.actionSwitch',
  end_gathering: 'coreData.actionEnd', record_arrival: 'coreData.actionArrival',
  add_destination: 'coreData.actionAdd', edit_destination: 'coreData.actionEdit',
  delete_destination: 'coreData.actionDelete', reorder_destinations: 'coreData.actionReorder',
  set_destination_meet_time: 'coreData.actionMeetTime', complete_destination: 'coreData.actionComplete',
  submit_gather_point_request: 'coreData.actionSuggest', resolve_gather_point_request: 'coreData.actionResolveSuggestion',
  set_navigation_response: 'coreData.actionRespond', replace_snapshot: 'coreData.actionUpdate',
};

/** A compact persistent receipt; never implies that an offline mutation reached the team. */
export default function CoreSyncStatus({ operations, actorId, t, onResolve, describeError }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = operations.filter(op => actorId && (op.actorId ?? op.payload.actorId) === actorId && op.status !== 'acked');
  if (!own.length) return null;
  const conflict = own.find(op => op.status === 'conflict');
  const delayed = own.find(op => op.status === 'failed' && op.lastError);
  const resolve = async (action: 'discard' | 'reapply') => {
    if (!conflict || busy) return;
    setBusy(true);
    setError(null);
    try { await onResolve(conflict, action); }
    catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  };
  const payloadTitle = conflict?.payload.title
    ?? (conflict?.payload.patch as { title?: string } | undefined)?.title
    ?? (conflict?.payload.destination as { title?: string } | undefined)?.title;
  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <Pressable onPress={() => setExpanded(value => !value)} accessibilityRole="button"
        accessibilityState={{ expanded }} style={styles.toggle}>
        <Text style={styles.text}>{t(conflict ? 'coreData.syncConflict' : 'coreData.pendingSync')} · {own.length}</Text>
      </Pressable>
      {expanded && !conflict && delayed ? <Text style={styles.text}>{describeError(delayed.lastError)}</Text> : null}
      {expanded && conflict ? <>
        <Text style={styles.text}>{t(operationLabels[conflict.operationType])}</Text>
        <Text style={styles.text}>{t('coreData.conflictExplanation')}</Text>
        <Text style={styles.text}>{describeError(conflict.conflictResult)}</Text>
        {typeof payloadTitle === 'string' ? <Text style={styles.text}>{payloadTitle}</Text> : null}
        {conflict.conflictResult?.code === 'stale_version' ? <Text style={styles.text}>{t('coreData.versionDifference', {
          local: conflict.entityVersion, remote: conflict.conflictResult?.serverEntityVersion ?? '—',
        })}</Text> : null}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void resolve('discard'); }} style={styles.button}>
            <Text style={styles.text}>{t('coreData.discardLocal')}</Text>
          </Pressable>
          {conflict.conflictResult?.code === 'stale_version' ?
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void resolve('reapply'); }} style={styles.button}>
              <Text style={styles.text}>{t('coreData.reapplyLocal')}</Text>
            </Pressable> : null}
        </View>
      </> : null}
      {error ? <Text style={styles.text}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#172331', borderRadius: 14, paddingHorizontal: 12, paddingBottom: 4 },
  toggle: { minHeight: 44, justifyContent: 'center' },
  text: { color: '#fff', fontSize: 13, paddingVertical: 3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
});
