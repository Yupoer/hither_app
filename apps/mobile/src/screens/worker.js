const fs = require('fs');

const file = 'c:/Users/alexs/Desktop/BZ/hither/hither_app/apps/mobile/src/screens/MapScreen.tsx';
let content = fs.readFileSync(file, 'utf-8');

// 1. rawDestinations
content = content.replace(
`  const rawDestinations: Destination[] = (state?.destinations ?? []).filter(
    (d) => (d.subgroupId ?? undefined) === (activeScopeId ?? undefined),
  );`,
`  const rawDestinations: Destination[] = useMemo(() => {
    return (state?.destinations ?? []).filter(
      (d) => (d.subgroupId ?? undefined) === (activeScopeId ?? undefined),
    );
  }, [state?.destinations, activeScopeId]);`
);

// 2. dismissConfirmCard
content = content.replace(
`  function dismissConfirmCard() {
    setConfirmCardReady(false);
    setPendingPlace(null);
  }`,
`  const dismissConfirmCard = useCallback(() => {
    setConfirmCardReady(false);
    setPendingPlace(null);
  }, []);`
);

// 3. openPaywall
content = content.replace(
`  function openPaywall(trigger?: TranslationKey) {
    setPaywallTrigger(trigger);
    setPaywallVisible(true);
  }`,
`  const openPaywall = useCallback((trigger?: TranslationKey) => {
    setPaywallTrigger(trigger);
    setPaywallVisible(true);
  }, []);`
);

// 4. persistMeetTime
content = content.replace(
`  function persistMeetTime(destinationId: string, value: Date | null) {
    setDestinationMeetTime(destinationId, value ? value.toISOString() : null)
      .then(() => refresh())
      .catch(() => Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg')));
  }`,
`  const persistMeetTime = useCallback((destinationId: string, value: Date | null) => {
    setDestinationMeetTime(destinationId, value ? value.toISOString() : null)
      .then(() => refresh())
      .catch(() => Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg')));
  }, [refresh, t]);`
);

// 5. openMeetTimePicker
content = content.replace(
`  function openMeetTimePicker(dest: Destination) {
    if (!canEditItinerary) return;
    const initial = dest.meetAt ? new Date(dest.meetAt) : new Date();
    setMeetTimeEditor({ id: dest.id, value: initial });
  }`,
`  const openMeetTimePicker = useCallback((dest: Destination) => {
    if (!canEditItinerary) return;
    const initial = dest.meetAt ? new Date(dest.meetAt) : new Date();
    setMeetTimeEditor({ id: dest.id, value: initial });
  }, [canEditItinerary]);`
);

// 6. locateMe
content = content.replace(
`  async function locateMe() {
    refresh();
    const coords = (await refreshDeviceLocation()) ?? deviceCoords;
    if (coords) mapRef.current?.centerOn(coords);
  }`,
`  const locateMe = useCallback(async () => {
    refresh();
    const coords = (await refreshDeviceLocation()) ?? deviceCoords;
    if (coords) mapRef.current?.centerOn(coords);
  }, [refresh, refreshDeviceLocation, deviceCoords]);`
);

// 7. fitAllMembers
content = content.replace(
`  function fitAllMembers() {
    mapRef.current?.fitToMembers();
  }`,
`  const fitAllMembers = useCallback(() => {
    mapRef.current?.fitToMembers();
  }, []);`
);

// 8. handlePickDestination
content = content.replace(
`  async function handlePickDestination(place: PlaceResult) {
    if (!groupId) return;
    if (!isPro && destinations.length >= FREE_LIMITS.destinationsPerItinerary) {
      openPaywall('paywall.triggerDestinations');
      return;
    }
    try {
      await addDestination(
        groupId,
        {
          title: place.name,
          address: place.address,
          coordinates: place.coordinates,
        },
        myScopeId,
      );
      logEvent('destination_add', { source: 'search' });
      setSelectedIndex(destinations.length);
      mapRef.current?.centerOn(place.coordinates);
      refresh();
    } catch (e) {
      logError('destination_add_failed', e, { source: 'search' });
      Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
    }
  }`,
`  const handlePickDestination = useCallback(async (place: PlaceResult) => {
    if (!groupId) return;
    if (!isPro && destinations.length >= FREE_LIMITS.destinationsPerItinerary) {
      openPaywall('paywall.triggerDestinations');
      return;
    }
    try {
      await addDestination(
        groupId,
        {
          title: place.name,
          address: place.address,
          coordinates: place.coordinates,
        },
        myScopeId,
      );
      logEvent('destination_add', { source: 'search' });
      setSelectedIndex(destinations.length);
      mapRef.current?.centerOn(place.coordinates);
      refresh();
    } catch (e) {
      logError('destination_add_failed', e, { source: 'search' });
      Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
    }
  }, [groupId, isPro, destinations.length, openPaywall, myScopeId, refresh, t]);`
);

// 9. handleKmlImport
content = content.replace(
`  async function handleKmlImport(items: KmlPlacemark[], onProgress: (done: number) => void) {
    if (!groupId) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await addDestination(
        groupId,
        { title: item.name, coordinates: { latitude: item.latitude, longitude: item.longitude } },
        myScopeId,
      );
      onProgress(i + 1);
    }
    logEvent('kml_import', { count: items.length });
    refresh();
  }`,
`  const handleKmlImport = useCallback(async (items: KmlPlacemark[], onProgress: (done: number) => void) => {
    if (!groupId) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await addDestination(
        groupId,
        { title: item.name, coordinates: { latitude: item.latitude, longitude: item.longitude } },
        myScopeId,
      );
      onProgress(i + 1);
    }
    logEvent('kml_import', { count: items.length });
    refresh();
  }, [groupId, myScopeId, refresh]);`
);

// 10. handleMomentumEnd
content = content.replace(
`  function handleMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (destinations.length === 0) return;
    const index = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
    const clamped = Math.max(0, Math.min(index, destinations.length - 1));
    if (clamped !== selectedIndex) {
      setSelectedIndex(clamped);
      logEvent('carousel_swipe', { index: clamped });
      mapRef.current?.centerOn(destinations[clamped].coordinates);
    }
  }`,
`  const handleMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (destinations.length === 0) return;
    const index = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
    const clamped = Math.max(0, Math.min(index, destinations.length - 1));
    if (clamped !== selectedIndex) {
      setSelectedIndex(clamped);
      logEvent('carousel_swipe', { index: clamped });
      mapRef.current?.centerOn(destinations[clamped].coordinates);
    }
  }, [destinations, windowWidth, selectedIndex]);`
);

// 11. copyCode
content = content.replace(
`  async function copyCode() {
    if (!group) return;
    lightTap();
    logEvent('code_copy');
    await Clipboard.setStringAsync(group.inviteCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  }`,
`  const copyCode = useCallback(async () => {
    if (!group) return;
    lightTap();
    logEvent('code_copy');
    await Clipboard.setStringAsync(group.inviteCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  }, [group]);`
);

// 12. shareCode
content = content.replace(
`  async function shareCode() {
    if (!group) return;
    lightTap();
    logEvent('code_share');
    await Share.share({ message: t('map.shareMsg', { code: group.inviteCode }) });
  }`,
`  const shareCode = useCallback(async () => {
    if (!group) return;
    lightTap();
    logEvent('code_share');
    await Share.share({ message: t('map.shareMsg', { code: group.inviteCode }) });
  }, [group, t]);`
);

// 13. openProfile
content = content.replace(
`  function openProfile() {
    lightTap();
    setProfileName(user?.name ?? '');
    setProfileAvatar(user?.avatar);
    setProfileColor(user?.avatarColor);
    setOverlay('profile');
  }`,
`  const openProfile = useCallback(() => {
    lightTap();
    setProfileName(user?.name ?? '');
    setProfileAvatar(user?.avatar);
    setProfileColor(user?.avatarColor);
    setOverlay('profile');
  }, [user?.name, user?.avatar, user?.avatarColor]);`
);

// 14. closeProfile
content = content.replace(
`  function closeProfile() {
    setOverlay(null);
    const nickname = profileName.trim();
    const fields: { nickname?: string; avatar?: string; avatarColor?: string } = {};
    if (nickname && nickname !== user?.name) fields.nickname = nickname;
    if (profileAvatar && profileAvatar !== user?.avatar) fields.avatar = profileAvatar;
    if (profileColor && profileColor !== user?.avatarColor) fields.avatarColor = profileColor;
    if (!fields.nickname && !fields.avatar && !fields.avatarColor) return;
    logEvent('profile_save', { changed: Object.keys(fields) });
    updateProfile(fields)
      .then(() => refresh())
      .catch((e) => {
        logError('profile_save_failed', e);
        Alert.alert(
          t('profile.saveFailed'),
          e instanceof Error ? e.message : undefined,
        );
      });
  }`,
`  const closeProfile = useCallback(() => {
    setOverlay(null);
    const nickname = profileName.trim();
    const fields: { nickname?: string; avatar?: string; avatarColor?: string } = {};
    if (nickname && nickname !== user?.name) fields.nickname = nickname;
    if (profileAvatar && profileAvatar !== user?.avatar) fields.avatar = profileAvatar;
    if (profileColor && profileColor !== user?.avatarColor) fields.avatarColor = profileColor;
    if (!fields.nickname && !fields.avatar && !fields.avatarColor) return;
    logEvent('profile_save', { changed: Object.keys(fields) });
    updateProfile(fields)
      .then(() => refresh())
      .catch((e) => {
        logError('profile_save_failed', e);
        Alert.alert(
          t('profile.saveFailed'),
          e instanceof Error ? e.message : undefined,
        );
      });
  }, [profileName, profileAvatar, profileColor, user?.name, user?.avatar, user?.avatarColor, updateProfile, refresh, t]);`
);

// 15. toggleSolo
content = content.replace(
`  async function toggleSolo(next: boolean) {
    if (!groupId) return;
    selectionTick();
    logEvent('solo_toggle', { groupId, next });
    setSoloOverride(next);
    try {
      await setSolo(groupId, next);
      // memberships is realtime-subscribed (useGroupState); its debounced
      // reload refreshes \`members\` and clears the override above once it
      // matches — no need to force an extra fetch here.
    } catch (e) {
      logError('solo_toggle_failed', e, { groupId, next });
      setSoloOverride(null);
      Alert.alert(t('solo.failed'), e instanceof Error ? e.message : undefined);
    }
  }`,
`  const toggleSolo = useCallback(async (next: boolean) => {
    if (!groupId) return;
    selectionTick();
    logEvent('solo_toggle', { groupId, next });
    setSoloOverride(next);
    try {
      await setSolo(groupId, next);
    } catch (e) {
      logError('solo_toggle_failed', e, { groupId, next });
      setSoloOverride(null);
      Alert.alert(t('solo.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [groupId, t]);`
);

// 16. confirmLeaveMainGroup
content = content.replace(
`  async function confirmLeaveMainGroup(): Promise<boolean> {
    const dismissed = await AsyncStorage.getItem(LEAVE_GROUP_WARN_KEY);
    if (dismissed === '1') return true;
    return new Promise((resolve) => {
      Alert.alert(
        t('subgroup.leaveWarnTitle'),
        t('subgroup.leaveWarnBody'),
        [
          {
            text: t('subgroup.leaveWarnDontShow'),
            onPress: () => {
              void AsyncStorage.setItem(LEAVE_GROUP_WARN_KEY, '1');
              resolve(true);
            },
          },
          { text: t('subgroup.leaveWarnConfirm'), onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    });
  }`,
`  const confirmLeaveMainGroup = useCallback(async (): Promise<boolean> => {
    const dismissed = await AsyncStorage.getItem(LEAVE_GROUP_WARN_KEY);
    if (dismissed === '1') return true;
    return new Promise((resolve) => {
      Alert.alert(
        t('subgroup.leaveWarnTitle'),
        t('subgroup.leaveWarnBody'),
        [
          {
            text: t('subgroup.leaveWarnDontShow'),
            onPress: () => {
              void AsyncStorage.setItem(LEAVE_GROUP_WARN_KEY, '1');
              resolve(true);
            },
          },
          { text: t('subgroup.leaveWarnConfirm'), onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    });
  }, [t]);`
);

// 17. handleAcceptInvite
content = content.replace(
`  async function handleAcceptInvite(inviteId: string) {
    if (!(await confirmLeaveMainGroup())) return;
    mediumTap();
    logEvent('invite_accept', { inviteId });
    try {
      await acceptInvite(inviteId);
      logEvent('invite_accept_ok', { inviteId });
      refresh();
    } catch (e) {
      logError('invite_accept_failed', e, { inviteId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }`,
`  const handleAcceptInvite = useCallback(async (inviteId: string) => {
    if (!(await confirmLeaveMainGroup())) return;
    mediumTap();
    logEvent('invite_accept', { inviteId });
    try {
      await acceptInvite(inviteId);
      logEvent('invite_accept_ok', { inviteId });
      refresh();
    } catch (e) {
      logError('invite_accept_failed', e, { inviteId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [confirmLeaveMainGroup, acceptInvite, refresh, t]);`
);

// 18. handleDeclineInvite
content = content.replace(
`  async function handleDeclineInvite(inviteId: string) {
    selectionTick();
    logEvent('invite_decline', { inviteId });
    try {
      await declineInvite(inviteId);
    } catch (e) {
      logError('invite_decline_failed', e, { inviteId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }`,
`  const handleDeclineInvite = useCallback(async (inviteId: string) => {
    selectionTick();
    logEvent('invite_decline', { inviteId });
    try {
      await declineInvite(inviteId);
    } catch (e) {
      logError('invite_decline_failed', e, { inviteId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [declineInvite, t]);`
);

// 19. handleInvite
content = content.replace(
`  async function handleInvite(subgroupId: string, inviteeId: string) {
    mediumTap();
    logEvent('invite_send', { subgroupId, inviteeId });
    // Virtual mates aren't real Supabase users — mock the invite: they always
    // accept, so drop them straight into my subgroup (client-side) and refresh.
    if (isVirtualMember(inviteeId)) {
      assignVirtualToSubgroup(inviteeId, subgroupId);
      setInviteSheetOpen(false);
      refresh();
      Alert.alert(t('subgroup.inviteSent'));
      return;
    }
    try {
      await inviteToSubgroup(subgroupId, inviteeId);
      logEvent('invite_send_ok', { subgroupId, inviteeId });
      // Demo has no realtime channel to nudge the invite list, and simulates
      // the invitee replying with a join-request — pull it in so the pending
      // approve/decline card shows immediately.
      if (isDemoGroup(groupId)) refreshInvites();
      void refreshSentInvites(subgroupId);
      Alert.alert(t('subgroup.inviteSent'));
    } catch (e) {
      logError('invite_send_failed', e, { subgroupId, inviteeId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }`,
`  const handleInvite = useCallback(async (subgroupId: string, inviteeId: string) => {
    mediumTap();
    logEvent('invite_send', { subgroupId, inviteeId });
    if (isVirtualMember(inviteeId)) {
      assignVirtualToSubgroup(inviteeId, subgroupId);
      setInviteSheetOpen(false);
      refresh();
      Alert.alert(t('subgroup.inviteSent'));
      return;
    }
    try {
      await inviteToSubgroup(subgroupId, inviteeId);
      logEvent('invite_send_ok', { subgroupId, inviteeId });
      if (isDemoGroup(groupId)) refreshInvites();
      void refreshSentInvites(subgroupId);
      Alert.alert(t('subgroup.inviteSent'));
    } catch (e) {
      logError('invite_send_failed', e, { subgroupId, inviteeId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [groupId, refresh, refreshInvites, refreshSentInvites, t]);`
);

// 20. doSelfSplit
content = content.replace(
`  async function doSelfSplit() {
    if (!groupId) return;
    if (!(await confirmLeaveMainGroup())) return;
    mediumTap();
    logEvent('team_create', { groupId });
    try {
      await selfSplit(
        groupId,
        t('subgroup.selfSplitName', { name: user?.name ?? t('group.travelerFallback') }),
      );
      logEvent('team_create_ok', { groupId });
      refresh();
    } catch (e) {
      logError('team_create_failed', e, { groupId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }`,
`  const doSelfSplit = useCallback(async () => {
    if (!groupId) return;
    if (!(await confirmLeaveMainGroup())) return;
    mediumTap();
    logEvent('team_create', { groupId });
    try {
      await selfSplit(
        groupId,
        t('subgroup.selfSplitName', { name: user?.name ?? t('group.travelerFallback') }),
      );
      logEvent('team_create_ok', { groupId });
      refresh();
    } catch (e) {
      logError('team_create_failed', e, { groupId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [groupId, confirmLeaveMainGroup, t, user?.name, refresh]);`
);

// 21. doSelfMerge
content = content.replace(
`  async function doSelfMerge() {
    if (!groupId) return;
    selectionTick();
    logEvent('team_leave', { groupId });
    try {
      if (myScopeId) {
        const subDests = state?.destinations?.filter(d => d.subgroupId === myScopeId) ?? [];
        for (const d of subDests) {
          await deleteDestination(groupId, d.id).catch(() => {});
        }
      }
      await selfMerge(groupId);
      logEvent('team_leave_ok', { groupId });
      refresh();
    } catch (e) {
      logError('team_leave_failed', e, { groupId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }`,
`  const doSelfMerge = useCallback(async () => {
    if (!groupId) return;
    selectionTick();
    logEvent('team_leave', { groupId });
    try {
      if (myScopeId) {
        const subDests = state?.destinations?.filter(d => d.subgroupId === myScopeId) ?? [];
        for (const d of subDests) {
          await deleteDestination(groupId, d.id).catch(() => {});
        }
      }
      await selfMerge(groupId);
      logEvent('team_leave_ok', { groupId });
      refresh();
    } catch (e) {
      logError('team_leave_failed', e, { groupId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [groupId, myScopeId, state?.destinations, refresh, t]);`
);

// 22. archiveAllForTest
content = content.replace(
`  async function archiveAllForTest() {
    if (!groupId) return;
    mediumTap();
    try {
      for (const dest of destinations) {
        // Best-effort archive (mirrors the real arrival flow) — if the
        // visited_waypoints table isn't migrated yet, still drop the stop so
        // the itinerary clears; history just won't populate until it exists.
        try {
          await recordVisitedWaypoint(groupId, dest.title, dest.coordinates);
        } catch (recordErr) {
          logError('history_record_failed', recordErr, { groupId, dest: dest.id });
        }
        await deleteDestination(groupId, dest.id);
      }
      await stopNavigation();
      refresh();
    } catch (e) {
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }`,
`  const archiveAllForTest = useCallback(async () => {
    if (!groupId) return;
    mediumTap();
    try {
      for (const dest of destinations) {
        try {
          await recordVisitedWaypoint(groupId, dest.title, dest.coordinates);
        } catch (recordErr) {
          logError('history_record_failed', recordErr, { groupId, dest: dest.id });
        }
        await deleteDestination(groupId, dest.id);
      }
      await stopNavigation();
      refresh();
    } catch (e) {
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [groupId, destinations, stopNavigation, refresh, t]);`
);

// 23. openFeedback
content = content.replace(
`  async function openFeedback() {
    lightTap();
    let uri: string | null = null;
    try {
      uri = await captureScreen({ format: 'jpg', quality: 0.6, result: 'tmpfile' });
    } catch {
      uri = null;
    }
    setFeedbackShot(uri);
    setOverlay('feedback');
  }`,
`  const openFeedback = useCallback(async () => {
    lightTap();
    let uri: string | null = null;
    try {
      uri = await captureScreen({ format: 'jpg', quality: 0.6, result: 'tmpfile' });
    } catch {
      uri = null;
    }
    setFeedbackShot(uri);
    setOverlay('feedback');
  }, []);`
);

// 24. confirmLeave
content = content.replace(
`  function confirmLeave() {
    confirmAction(
      {
        title: t('group.leaveTitle'),
        message: t('group.leaveMsg'),
        confirmLabel: t('group.leaveConfirm'),
        destructive: true,
      },
      () => {
        logEvent('group_leave', { groupId, isLeader });
        leaveGroup();
        navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] });
      },
    );
  }`,
`  const confirmLeave = useCallback(() => {
    confirmAction(
      {
        title: t('group.leaveTitle'),
        message: t('group.leaveMsg'),
        confirmLabel: t('group.leaveConfirm'),
        destructive: true,
      },
      () => {
        logEvent('group_leave', { groupId, isLeader });
        leaveGroup();
        navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] });
      },
    );
  }, [t, groupId, isLeader, leaveGroup, navigation]);`
);

// 25. confirmSignOut
content = content.replace(
`  function confirmSignOut() {
    confirmAction(
      {
        title: t('settings.signOutTitle'),
        message: t('settings.signOutMsg'),
        confirmLabel: t('settings.signOut'),
        destructive: true,
      },
      () => {
        logEvent('sign_out');
        void signOut();
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      },
    );
  }`,
`  const confirmSignOut = useCallback(() => {
    confirmAction(
      {
        title: t('settings.signOutTitle'),
        message: t('settings.signOutMsg'),
        confirmLabel: t('settings.signOut'),
        destructive: true,
      },
      () => {
        logEvent('sign_out');
        void signOut();
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      },
    );
  }, [t, signOut, navigation]);`
);

// 26. closeUpgrade
content = content.replace(
`  function closeUpgrade() {
    setUpgradeVisible(false);
    setUpgradeEmail('');
    setUpgradePassword('');
    setUpgradeError(null);
  }`,
`  const closeUpgrade = useCallback(() => {
    setUpgradeVisible(false);
    setUpgradeEmail('');
    setUpgradePassword('');
    setUpgradeError(null);
  }, []);`
);

// 27. submitUpgrade
content = content.replace(
`  async function submitUpgrade() {
    if (!upgradeCanSubmit) return;
    setUpgradeBusy(true);
    setUpgradeError(null);
    try {
      await upgradeToEmailAccount(upgradeEmail.trim(), upgradePassword);
      Alert.alert(t('account.section'), t('account.upgradeSent'));
      closeUpgrade();
    } catch (e) {
      setUpgradeError(e instanceof Error ? e.message : t('account.upgradeSent'));
    } finally {
      setUpgradeBusy(false);
    }
  }`,
`  const submitUpgrade = useCallback(async () => {
    if (!upgradeCanSubmit) return;
    setUpgradeBusy(true);
    setUpgradeError(null);
    try {
      await upgradeToEmailAccount(upgradeEmail.trim(), upgradePassword);
      Alert.alert(t('account.section'), t('account.upgradeSent'));
      closeUpgrade();
    } catch (e) {
      setUpgradeError(e instanceof Error ? e.message : t('account.upgradeSent'));
    } finally {
      setUpgradeBusy(false);
    }
  }, [upgradeCanSubmit, upgradeEmail, upgradePassword, upgradeToEmailAccount, t, closeUpgrade]);`
);

// 28. resetPrefs
content = content.replace(
`  async function resetPrefs() {
    logEvent('reset_prefs');
    try {
      await saveOnboardingProfile({});
    } catch (e) {
      logError('reset_prefs_failed', e);
      console.warn('[settings] resetPrefs saveOnboardingProfile failed', e);
    }
    await AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY);
    Alert.alert(t('settings.resetPrefs'), t('settings.resetPrefsDone'));
  }`,
`  const resetPrefs = useCallback(async () => {
    logEvent('reset_prefs');
    try {
      await saveOnboardingProfile({});
    } catch (e) {
      logError('reset_prefs_failed', e);
      console.warn('[settings] resetPrefs saveOnboardingProfile failed', e);
    }
    await AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY);
    Alert.alert(t('settings.resetPrefs'), t('settings.resetPrefsDone'));
  }, [t]);`
);

// 29. confirmResetPrefs
content = content.replace(
`  function confirmResetPrefs() {
    confirmAction(
      {
        title: t('settings.resetPrefs'),
        message: t('settings.resetPrefsConfirm'),
        confirmLabel: t('settings.resetPrefs'),
        destructive: true,
      },
      () => void resetPrefs(),
    );
  }`,
`  const confirmResetPrefs = useCallback(() => {
    confirmAction(
      {
        title: t('settings.resetPrefs'),
        message: t('settings.resetPrefsConfirm'),
        confirmLabel: t('settings.resetPrefs'),
        destructive: true,
      },
      () => void resetPrefs(),
    );
  }, [t, resetPrefs]);`
);

// 30. persistStragglerConfig
content = content.replace(
`  function persistStragglerConfig(enabled: boolean, thresholdM: number) {
    if (!groupId) return;
    setStragglerOverride(enabled);
    setOptimisticStragglerThresholdM(thresholdM);
    setStragglerConfig(groupId, enabled, thresholdM)
      .then(() => refresh())
      .catch(() => {
        setStragglerOverride(null);
        setOptimisticStragglerThresholdM(null);
        Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
      });
  }`,
`  const persistStragglerConfig = useCallback((enabled: boolean, thresholdM: number) => {
    if (!groupId) return;
    setStragglerOverride(enabled);
    setOptimisticStragglerThresholdM(thresholdM);
    setStragglerConfig(groupId, enabled, thresholdM)
      .then(() => refresh())
      .catch(() => {
        setStragglerOverride(null);
        setOptimisticStragglerThresholdM(null);
        Alert.alert(t('map.setFailedTitle'), t('map.setFailedMsg'));
      });
  }, [groupId, refresh, t]);`
);

// 31. renderFlockRow
content = content.replace(
`  const renderFlockRow = (f: (typeof flock)[number], last: boolean) => {`,
`  const renderFlockRow = useCallback((f: (typeof flock)[number], last: boolean) => {`
);

content = content.replace(
`                )}
          </View>
        )}
      </View>
    );
  };`,
`                )}
          </View>
        )}
      </View>
    );
  }, [user?.id, styles, accent, t, toggleSolo, doSelfMerge, doSelfSplit]);`
);

fs.writeFileSync(file, content, 'utf-8');
