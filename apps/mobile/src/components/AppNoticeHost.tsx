import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../state/SessionContext';
import { useTranslation } from '../i18n';
import { clearAppNotices, dismissAppNotice, subscribeAppNotices, type AppNotice } from '../state/appNotice';
import AppNoticeContent from './AppNoticeContent';
export default function AppNoticeHost() {
  const { user } = useSession();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [notice, setNotice] = useState<AppNotice | null>(null);
  useEffect(() => { clearAppNotices(); return clearAppNotices; }, [user?.id]);
  useEffect(() => subscribeAppNotices(setNotice), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => dismissAppNotice(notice.id), notice.onAction ? 12000 : 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return <View accessibilityLiveRegion="polite" style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, zIndex: 2000 }}>
    <AppNoticeContent notice={notice} dismiss={() => dismissAppNotice(notice.id)} closeLabel={t('common.close')} />
  </View>;
}
