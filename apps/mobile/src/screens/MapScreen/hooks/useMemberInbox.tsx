import React, { useCallback, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchPendingStartRequests } from '../../../api/client';
import type { PendingStartRequest } from '../../../api/services/NotificationService';
import { supabase } from '../../../api/supabase';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { useForegroundReconcile } from '../../../state/useForegroundReconcile';
import { logError } from '../../../utils/activityLog';

type InboxSnapshot = {
  key: string;
  requests: PendingStartRequest[];
  seen: Readonly<Record<string, true>>;
};

let channelSequence = 0;

function InboxSubscription({
  groupId, userId, reload, loadSeen,
}: {
  groupId: string;
  userId: string;
  reload: () => Promise<void>;
  loadSeen: () => Promise<void>;
}) {
  useMountEffect(() => {
    void loadSeen();
    void reload();
    const channel = supabase.channel(`member-inbox:${groupId}:${++channelSequence}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'commands', filter: `target_user_id=eq.${userId}`,
      }, () => { void reload(); })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') void reload();
      });
    return () => { void supabase.removeChannel(channel); };
  });
  return useForegroundReconcile(true, reload);
}

export function useMemberInbox(groupId: string | null, userId: string | undefined) {
  const key = groupId && userId ? `member-inbox-seen:${groupId}:${userId}` : '';
  const identity = useRef(key);
  identity.current = key;
  const fetchVersion = useRef(0);
  const [snapshot, setSnapshot] = useState<InboxSnapshot>({ key, requests: [], seen: {} });
  if (snapshot.key !== key) setSnapshot({ key, requests: [], seen: {} });

  const reload = useCallback(async () => {
    if (!groupId || !userId) return;
    const version = ++fetchVersion.current;
    try {
      const requests = await fetchPendingStartRequests(groupId, userId);
      if (identity.current === key && version === fetchVersion.current) {
        setSnapshot(prev => ({ ...prev, requests }));
      }
    } catch (error) {
      logError('member_inbox_load_failed', error);
    }
  }, [groupId, userId, key]);

  const loadSeen = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw && identity.current === key) {
        const seen: Record<string, true> = JSON.parse(raw);
        setSnapshot(prev => ({ ...prev, seen: { ...seen, ...prev.seen } }));
      }
    } catch (error) {
      logError('member_inbox_read_state_load_failed', error);
    }
  }, [key]);

  const markSeen = useCallback((ids: readonly string[]) => {
    if (!key || ids.length === 0) return;
    const seen = Object.fromEntries(ids.map(id => [id, true] as const));
    setSnapshot(prev => ({ ...prev, seen: { ...prev.seen, ...seen } }));
    void AsyncStorage.mergeItem(key, JSON.stringify(seen))
      .catch(error => { logError('member_inbox_read_state_save_failed', error); });
  }, [key]);

  const removeRequest = useCallback((id: string) => {
    if (identity.current !== key) return;
    ++fetchVersion.current;
    setSnapshot(prev => ({ ...prev, requests: prev.requests.filter(request => request.id !== id) }));
    void reload();
  }, [key, reload]);

  return {
    requests: snapshot.key === key ? snapshot.requests : [],
    seen: snapshot.key === key ? snapshot.seen : {},
    markSeen,
    removeRequest,
    lifecycle: groupId && userId
      ? <InboxSubscription key={key} groupId={groupId} userId={userId} reload={reload} loadSeen={loadSeen} />
      : null,
  };
}
