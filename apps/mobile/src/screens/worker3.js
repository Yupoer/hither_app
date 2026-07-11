const fs = require('fs');
const file = 'c:/Users/alexs/Desktop/BZ/hither/hither_app/apps/mobile/src/screens/MapScreen.tsx';
let content = fs.readFileSync(file, 'utf-8');

// Find:
//       <BottomSheet
//         height={heightSV}
//         ...
//       </BottomSheet>

let regex = /<BottomSheet\s+height=\{heightSV\}[\s\S]*?onHeaderHeight=\{setSheetHeaderH\}\s+header=\{([\s\S]*?)\}\s*>([\s\S]*?)<\/BottomSheet>/;

let match = content.match(regex);
if (match) {
  let headerContent = match[1];
  let childrenContent = match[2];
  
  let sheetHeaderDef = \`
  const sheetHeader = useMemo(() => (\${headerContent}), [styles, canEditItinerary, t, user?.avatarColor, accent, user?.avatar, user?.name, openProfile]);
\`;

  let sheetChildrenDef = \`
  const sheetChildren = useMemo(() => (
    <>\${childrenContent}</>
  ), [styles, t, members.length, isPro, pendingInvites, handleAcceptInvite, handleDeclineInvite, accent, topFlock, renderFlockRow, subgroups, flock, mySubgroupId, sentInvites, handleInvite, shareCode, copyCode, codeCopied, destinations.length, canEditItinerary, group, isLeader, groupId, stragglerOverride, persistStragglerConfig, optimisticStragglerThresholdM, openPaywall, dark, setOverlay, setKmlVisible]);
\`;

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

  let newContent = content.replace(match[0], replacement);
  
  // Insert definitions before `if (loading && !state) {`
  let insertIndex = newContent.indexOf('  if (loading && !state) {');
  newContent = newContent.substring(0, insertIndex) + sheetHeaderDef + sheetChildrenDef + newContent.substring(insertIndex);
  
  fs.writeFileSync(file, newContent, 'utf-8');
  console.log('Success');
} else {
  console.log('Match not found');
}
