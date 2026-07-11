const fs = require('fs');
const file = 'c:/Users/alexs/Desktop/BZ/hither/hither_app/apps/mobile/src/screens/MapScreen.tsx';
let content = fs.readFileSync(file, 'utf-8');

let regex = /<BottomSheet\s+height=\{heightSV\}[\s\S]*?onHeaderHeight=\{setSheetHeaderH\}\s+header=\{([\s\S]*?)\}\s*>([\s\S]*?)<\/BottomSheet>/;
let match = content.match(regex);
if (match) {
  let headerContent = match[1];
  let childrenContent = match[2];

  let sheetHeaderDef = "  const sheetHeader = useMemo(() => (" + headerContent + "), [styles, canEditItinerary, t, user?.avatarColor, accent, user?.avatar, user?.name, openProfile, setSearchVisible]);\n";

  let deps = [
    "styles", "t", "members.length", "isPro", "FREE_LIMITS", "pendingInvites",
    "handleAcceptInvite", "handleDeclineInvite", "accent", "topFlock",
    "renderFlockRow", "subgroups", "flock", "mySubgroupId", "sentInvites",
    "handleInvite", "shareCode", "copyCode", "codeCopied", "destinations.length",
    "canEditItinerary", "group", "isLeader", "groupId", "stragglerOverride",
    "persistStragglerConfig", "optimisticStragglerThresholdM", "openPaywall",
    "dark", "setOverlay", "setKmlVisible", "setSearchVisible"
  ].join(", ");

  let sheetChildrenDef = "  const sheetChildren = useMemo(() => (\n    <>" + childrenContent + "</>\n  ), [" + deps + "]);\n";

  let replacement = "<BottomSheet\n        height={heightSV}\n        detents={detents}\n        index={detent}\n        onIndexChange={setDetent}\n        bottomInset={insets.bottom}\n        onHeaderHeight={setSheetHeaderH}\n        header={sheetHeader}\n      >\n        {sheetChildren}\n      </BottomSheet>";

  let newContent = content.replace(match[0], replacement);
  
  let insertIndex = newContent.indexOf('  if (loading && !state) {');
  newContent = newContent.substring(0, insertIndex) + sheetHeaderDef + sheetChildrenDef + newContent.substring(insertIndex);
  
  fs.writeFileSync(file, newContent, 'utf-8');
  console.log('Success');
} else {
  console.log('Match not found');
}
