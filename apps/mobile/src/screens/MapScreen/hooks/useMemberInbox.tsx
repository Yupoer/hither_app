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
type InboxReadOwner = { key: string; revision: number };

let channelSequence = 0;

function InboxSubscription({
  groupId, userId, attach, reload, loadSeen,
}: {
  groupId: string;
  userId: string;
  attach: () => () => void;
  reload: () => Promise<void>;
  loadSeen: () => Promise<void>;
}) {
  useMountEffect(() => {
    const detach = attach();
    void loadSeen();
    void reload();
    const channel = supabase.channel(`member-inbox:${groupId}:${++channelSequence}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'commands', filter: `target_user_id=eq.${userId}`,
      }, () => { void reload(); })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') void reload();
      });
    return () => {
      detach();
      void supabase.removeChannel(channel);
    };
  });
  return useForegroundReconcile(true, reload);
}

export function useMemberInbox(groupId: string | null, userId: string | undefined) {
  const key = groupId && userId ? `member-inbox-seen:${groupId}:${userId}` : '';
  const readOwner = useRef<InboxReadOwner | null>(null);
  const [snapshot, setSnapshot] = useState<InboxSnapshot>({ key, requests: [], seen: {} });
  if (snapshot.key !== key) setSnapshot({ key, requests: [], seen: {} });

  const attach = useCallback(() => {
    readOwner.current = { key, revision: 0 };
    return () => { readOwner.current = null; };
  }, [key]);

  const reload = useCallback(async () => {
    const owner = readOwner.current;
    if (!groupId || !userId || owner?.key !== key) return;
    const revision = ++owner.revision;
    try {
      const requests = await fetchPendingStartRequests(groupId, userId);
      if (readOwner.current === owner && owner.revision === revision) {
        setSnapshot(prev => prev.key === key ? { ...prev, requests } : prev);
      }
    } catch (error) {
      logError('member_inbox_load_failed', error);
    }
  }, [groupId, userId, key]);

  const loadSeen = useCallback(async () => {
    const owner = readOwner.current;
    if (owner?.key !== key) return;
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw && readOwner.current === owner) {
        const seen: Record<string, true> = JSON.parse(raw);
        setSnapshot(prev => prev.key === key ? { ...prev, seen: { ...seen, ...prev.seen } } : prev);
      }
    } catch (error) {
      logError('member_inbox_read_state_load_failed', error);
    }
  }, [key]);

  const markSeen = useCallback((ids: readonly string[]) => {
    if (!key || ids.length === 0) return;
    const seen = Object.fromEntries(ids.map(id => [id, true] as const));
    setSnapshot(prev => prev.key === key ? { ...prev, seen: { ...prev.seen, ...seen } } : prev);
    void AsyncStorage.mergeItem(key, JSON.stringify(seen))
      .catch(error => { logError('member_inbox_read_state_save_failed', error); });
  }, [key]);

  const removeRequest = useCallback((id: string) => {
    if (readOwner.current?.key !== key) return;
    setSnapshot(prev => prev.key === key ? { ...prev, requests: prev.requests.filter(request => request.id !== id) } : prev);
    void reload();
  }, [key, reload]);

  return {
    requests: snapshot.key === key ? snapshot.requests : [],
    seen: snapshot.key === key ? snapshot.seen : {},
    markSeen,
    removeRequest,
    lifecycle: groupId && userId
      ? <InboxSubscription key={key} groupId={groupId} userId={userId} attach={attach} reload={reload} loadSeen={loadSeen} />
      : null,
  };
}
