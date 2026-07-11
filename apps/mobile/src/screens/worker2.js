const fs = require('fs');
const file = 'c:/Users/alexs/Desktop/BZ/hither/hither_app/apps/mobile/src/screens/MapScreen.tsx';
let content = fs.readFileSync(file, 'utf-8');

// The original BottomSheet call:
//       <BottomSheet
//         height={heightSV}
//         detents={detents}
//         index={detent}
//         onIndexChange={setDetent}
//         bottomInset={insets.bottom}
//         onHeaderHeight={setSheetHeaderH}
//         header={
//           /* Search row + account avatar — pinned over the scroll content on
//              BottomSheet's frosted header veil (Apple-Maps look). */
//           <View style={styles.searchRow}>

const headerStart = \`<BottomSheet
        height={heightSV}
        detents={detents}
        index={detent}
        onIndexChange={setDetent}
        bottomInset={insets.bottom}
        onHeaderHeight={setSheetHeaderH}
        header={
          /* Search row + account avatar — pinned over the scroll content on
             BottomSheet's frosted header veil (Apple-Maps look). */
          <View style={styles.searchRow}>
              <Pressable
                style={styles.searchField}
                onPress={() => (canEditItinerary ? setSearchVisible(true) : undefined)}
                accessibilityRole="button"
                accessibilityLabel={t('map.searchA11y')}
              >
                <Ionicons name="search" size={17} color={glass.textSecondary} />
                <Text style={styles.searchPlaceholder}>{t('map.searchPlaces')}</Text>
              </Pressable>
            <Pressable
              style={[styles.avatar, { backgroundColor: user?.avatarColor ?? accent }]}
              onPress={openProfile}
              accessibilityRole="button"
              accessibilityLabel={t('profile.title')}
            >
              {user?.avatar ? (
                <Text style={styles.avatarEmoji}>{user.avatar}</Text>
              ) : (
                <Text style={styles.avatarText}>
                  {(user?.name ?? '?').slice(0, 1).toUpperCase()}
                </Text>
              )}
            </Pressable>
          </View>
        }
      >\`;

const newHeaderStart = \`const sheetHeader = useMemo(() => (
          <View style={styles.searchRow}>
              <Pressable
                style={styles.searchField}
                onPress={() => (canEditItinerary ? setSearchVisible(true) : undefined)}
                accessibilityRole="button"
                accessibilityLabel={t('map.searchA11y')}
              >
                <Ionicons name="search" size={17} color={glass.textSecondary} />
                <Text style={styles.searchPlaceholder}>{t('map.searchPlaces')}</Text>
              </Pressable>
            <Pressable
              style={[styles.avatar, { backgroundColor: user?.avatarColor ?? accent }]}
              onPress={openProfile}
              accessibilityRole="button"
              accessibilityLabel={t('profile.title')}
            >
              {user?.avatar ? (
                <Text style={styles.avatarEmoji}>{user.avatar}</Text>
              ) : (
                <Text style={styles.avatarText}>
                  {(user?.name ?? '?').slice(0, 1).toUpperCase()}
                </Text>
              )}
            </Pressable>
          </View>
        ), [styles, canEditItinerary, t, user?.avatarColor, accent, user?.avatar, user?.name, openProfile]);

  const sheetChildren = useMemo(() => (
    <>
        {/* Flock — first section, Apple-Maps-style heading. Members with no\`;

// Now extract children... The children start right after `      >` of `<BottomSheet ... >`.
// It starts with `        {/* Flock — first section, Apple-Maps-style heading...`
// and ends right before `      </BottomSheet>`

let childrenStartText = \`        {/* Flock — first section, Apple-Maps-style heading. Members with no
            subgroup list first; each subgroup renders as its own card. */}
        <View style={styles.headingRow}>\`;

let childrenEndText = \`          <Pressable style={styles.dangerBtn} onPress={confirmSignOut} accessibilityRole="button">
            <Text style={styles.dangerText}>{t('settings.signOut')}</Text>
          </Pressable>
        </ScrollView>
      </OverlaySheet>\`;
// Wait, the children end right before \`      </BottomSheet>\`.
// Let's find \`</BottomSheet>\` and replace it.

// It's safer to just split by the strings.
let split1 = content.split(headerStart);
if (split1.length === 2) {
  let rest = split1[1];
  let split2 = rest.split(\`      </BottomSheet>\`);
  if (split2.length >= 2) {
    let childrenContent = split2[0]; // This is the children content
    
    // Construct the new code
    let replacement = \`<BottomSheet
        height={heightSV}
        detents={detents}
        index={detent}
        onIndexChange={setDetent}
        bottomInset={insets.bottom}
        onHeaderHeight={setSheetHeaderH}
        header={sheetHeader}
      >
        {sheetChildren}
      </BottomSheet>\`;
      
    // I need to insert \`sheetHeader\` and \`sheetChildren\` useMemo blocks before the return statement.
    // Let's find the \`return (\` block in MapScreen.
    let returnSplit = content.split(\`  if (loading && !state) {
    return (
      <View style={styles.loading}>\`);
      
    if (returnSplit.length === 2) {
      let sheetHeaderDef = \`
  const sheetHeader = useMemo(() => (
    <View style={styles.searchRow}>
      <Pressable
        style={styles.searchField}
        onPress={() => (canEditItinerary ? setSearchVisible(true) : undefined)}
        accessibilityRole="button"
        accessibilityLabel={t('map.searchA11y')}
      >
        <Ionicons name="search" size={17} color={glass.textSecondary} />
        <Text style={styles.searchPlaceholder}>{t('map.searchPlaces')}</Text>
      </Pressable>
      <Pressable
        style={[styles.avatar, { backgroundColor: user?.avatarColor ?? accent }]}
        onPress={openProfile}
        accessibilityRole="button"
        accessibilityLabel={t('profile.title')}
      >
        {user?.avatar ? (
          <Text style={styles.avatarEmoji}>{user.avatar}</Text>
        ) : (
          <Text style={styles.avatarText}>
            {(user?.name ?? '?').slice(0, 1).toUpperCase()}
          </Text>
        )}
      </Pressable>
    </View>
  ), [styles, canEditItinerary, t, user?.avatarColor, accent, user?.avatar, user?.name, openProfile]);
\`;

      let sheetChildrenDef = \`
  const sheetChildren = useMemo(() => (
    <>\${childrenContent}</>
  ), [styles, t, members.length, isPro, pendingInvites, handleAcceptInvite, handleDeclineInvite, accent, topFlock, renderFlockRow, subgroups, flock, mySubgroupId, sentInvites, handleInvite, shareCode, copyCode, codeCopied, destinations.length, canEditItinerary, group, isLeader, groupId, stragglerOverride, persistStragglerConfig, optimisticStragglerThresholdM, openPaywall, dark, setOverlay, setKmlVisible]);
\`;
      
      let newTop = returnSplit[0] + sheetHeaderDef + sheetChildrenDef + \`  if (loading && !state) {
    return (
      <View style={styles.loading}>\`;
      
      // Then replace the BottomSheet block in newTop + returnSplit[1]
      let finalContent = newTop + returnSplit[1];
      
      let bsToReplace = headerStart + childrenContent + \`      </BottomSheet>\`;
      let finalReplacedContent = finalContent.replace(bsToReplace, replacement);
      
      fs.writeFileSync(file, finalReplacedContent, 'utf-8');
      console.log('Success');
    } else {
      console.log('Failed to find return');
    }
  } else {
    console.log('Failed to find </BottomSheet>');
  }
} else {
  console.log('Failed to find headerStart');
}
