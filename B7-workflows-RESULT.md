# B7 workflows 完成報告

本分區原有39個effect已全部轉換，14個MapScreen hooks共26個、3個tour檔案共13個。現為31個具名mount工作與2項只調整本hook React state的reset；另4組依序共用setup。原始16/29的brief數字已校正，完整表如下。

原始基準c7b40b9，foundation72ea1a2，共用gate9fea7dc已保留merge ancestry。整合group3954509（含foreground key collision修正）與identity759db03，必要衝突僅做consumer/lifecycle語義合併。

## 實作及caller

- owner、draft、refs、route buffers、receipt集合、timer世代與tour snapshot仍留原長壽命hook。每個動態job在具名child container比較原始Object.is欄位，單調generation只key自己的commit child。沒有generic依賴runner、render native/storage/RPC寫入或新依賴。
- trip draft與Solo確認reset只調整同一hook React state。其他會寫ref、Session、outbox、RPC或native的工作都留在commit。
- draft convergence/rollback/scope、role publication/rejection、gathering reset/channel及tour preparation/measurement各自合併為明確有序setup；draft/role只執行本次原dependency有變化的具名操作，committed generation由React state記錄，Strict replay仍重播原mounted closure。每個tour job都先發布自己的typed committed input，避免依賴sibling mirror順序。
- MapScreen五個真實return paths統一以相同outer Fragment的第一child安裝groupDataLifecycle；每個domain另有固定key boundary。已移除merge產生的重複lifecycle JSX與重複解構，loading/passive/empty/main均只安裝一次。
- SubgroupActions合成真useSubgroupInvites.lifecycle；invites再合成真useForegroundReconcile回傳值。coordination/gathering亦各自合成foreground job。所有直接Probes與mocks已渲染lifecycle。
- useGroupFeatureTour.ts與routeReorderTour.ts改為.tsx，使用真正JSX傳遞refs以通過未降級的React Compiler refs規則。所有source contract paths隨之更新。

## 驗證

- 最後一次24 suites / 274 tests通過，JSON在R/B7-workflows-final-jest.json。包含同reference、同值新reference、callback更新、A/B/A、未提交Suspense render、native ID晚到cleanup、雙job相同generation、真nested三hook、同步subscribe及Strict replay。
- tsc --noEmit通過；test:meta L1+L2通過；分區eslint零errors，既有hook warnings保留，tour三檔與新增nested測試零warnings。git diff --check通過。
- source AST審計本分區零direct React effect calls，31次useMountEffect。R/B7-workflows-AUDIT.json記錄原行號、完整dependency tuple及目前計數。

## 逐effect對照

| 原始檔案與行號 | 原dependency identity | 規則 | 新工作與安裝點 | cleanup owner / 保留mount原因 |
| --- | --- | --- | --- | --- |
| screens/MapScreen/hooks/useCarouselSelection.ts:39 | `[destinations.length, windowWidth, scrollToIndex]` | 6 | CarouselBoundsScroll; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；只提交native scroll，不重掛carousel。 |
| screens/MapScreen/hooks/useCarouselSelection.ts:50 | `[selectedIndex, destinations.length, scrollToIndex]` | 6 | CarouselSelectionScroll; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；保留programmatic selection與舊momentum隔離。 |
| screens/MapScreen/hooks/useGatherCardExpansion.ts:90 | `[clearTimer, defaultExpanded, replaceOverrides]` | 6 | GatherCardDefaultsReset; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；只清timer與overrides，tour pause owner保留。 |
| screens/MapScreen/hooks/useGatherCardExpansion.ts:95 | `[clearTimer]` | 6 | GatherCardTimerLifetime; MapScreen groupDataLifecycle / all 5 return paths | clearTimer；timer與pause狀態跨job保留。 |
| screens/MapScreen/hooks/usePendingPlaceEntrance.ts:14 | `[pendingPlace, progress, sheetHeight, visible]` | 6 | PendingPlaceMotion; MapScreen groupDataLifecycle / all 5 return paths | 清timeout並取消progress；shared values與shownPlace留hook。 |
| screens/MapScreen/hooks/useMemberPresence.ts:163 | `[members, soloOverride, user?.id]` | 3 | own React state adjustment; MapScreen groupDataLifecycle / all 5 return paths | 規則3；server追上optimistic Solo時只重設本hook state，沒有render外部寫入。 |
| screens/MapScreen/hooks/useMemberPresence.ts:177 | `[user?.id]` | 6 | MemberNotificationPreferencesLoad; MapScreen groupDataLifecycle / all 5 return paths | alive=false；舊帳號promise不得寫回。 |
| screens/MapScreen/hooks/useMeetTimeEditor.ts:64 | `[nextMeet?.id, nextMeet?.meetAt, nextMeet?.meetRedMinutes, nextMeet?.title, meetRedMin, t]` | 6 | MeetTimeReminders; MapScreen groupDataLifecycle / all 5 return paths | cancelled=true、取消IDs與off；晚到native ID立即取消。 |
| screens/MapScreen/hooks/useRouteDraft.ts:155 | `[rawDestinations, destinations, setDestinations]` | 6 | RouteDraftReconciliation / reconcileDraftAgainstServer; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；dirty與draft refs留穩定owner。 |
| screens/MapScreen/hooks/useRouteDraft.ts:161 | `[openOperations, setDestinations]` | 6 | RouteDraftReconciliation / rollbackRejectedItinerary; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；保留reverse sequence rollback與handled set。 |
| screens/MapScreen/hooks/useRouteDraft.ts:179 | `[scopeId, reset, setEditorScopeId]` | 6 | RouteDraftReconciliation / resetDraftScope; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；只重設scope的draft owner。 |
| screens/MapScreen/hooks/useRouteDraft.ts:184 | `[group, draftTripDays, draftDepartureDate]` | 3 | own React state adjustment; MapScreen groupDataLifecycle / all 5 return paths | 規則3；server確認trip欄位後只清本hook React state。 |
| screens/MapScreen/hooks/useGroupRole.ts:88 | `[dataSource, me, group, groupId, membership?.role, membership?.group.id, setMembership]` | 6 | GroupRoleReconciliation / publishRemoteMembership; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；committed remote role仍回寫Session。 |
| screens/MapScreen/hooks/useGroupRole.ts:95 | `[openOperations, roleContext, refresh]` | 6 | GroupRoleReconciliation / reconcileItineraryRoleRejections; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；handled set、roleContext與refresh保持。 |
| screens/MapScreen/hooks/useGroupRole.ts:108 | `[arrivalOperations, userId, roleContext]` | 6 | GroupRoleReconciliation / reconcileArrivalRoleRejections; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；arrival actor/role rejection身份保持。 |
| screens/MapScreen/hooks/useGatheringWorkflow.ts:51 | `[]` | 6 | hook mount guard; MapScreen groupDataLifecycle / all 5 return paths | mountedRef=false；長壽命hook guard。 |
| screens/MapScreen/hooks/useGatheringWorkflow.ts:75 | `[workflowContext]` | 6 | GatheringWorkflowChannelCommit (ordered reset); MapScreen groupDataLifecycle / all 5 return paths | 與channel setup合併；reset先於loader，context仍經load identity觸發。 |
| screens/MapScreen/hooks/useGatheringWorkflow.ts:153 | `[arrivalOperations, arrivalSessionScope, remoteArrivals, rawDestinations, userId]` | 6 | ArrivalReceiptCompaction; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；保留active undo tombstone與leader correction收據判定。 |
| screens/MapScreen/hooks/useGatheringWorkflow.ts:219 | `[groupId, loadGatheringWorkflow, scheduleWorkflowReload]` | 6 | GatheringWorkflowChannel; MapScreen groupDataLifecycle / all 5 return paths | 清coalescing timer與removeChannel；所有世代/in-flight refs留hook。 |
| screens/MapScreen/hooks/useGatheringCompletion.ts:279 | `[ allScopedDestinations, activeDestinationArrivals, executeAutoCompleteStop, navTargetId, sessionEligibleMembers, groupId, canEditItinerary, members, t, ]` | 6 | CommittedGatheringCompletion; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；durable completion intent、lease與error handling原樣保持。 |
| screens/MapScreen/hooks/useStoreEntitlements.ts:73 | `[groupId, refreshStoreEntitlements, isPro]` | 6 | GroupStoreEntitlementLoad; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；保留group/generation fence、新group fail-closed與same-group不閃鎖。 |
| screens/MapScreen/hooks/useStragglerReporting.ts:37 | `[stragglers, isLeader, groupId]` | 6 | CommittedStragglerReport; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；committed新成員觀察發RPC，id set留hook。 |
| screens/MapScreen/hooks/useVisitHistory.ts:86 | `[overlay, loadHistory]` | 6 | VisitedHistoryLoad; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；保留local-first history與request counter。 |
| screens/MapScreen/hooks/useSubgroupActions.ts:61 | `[mySubgroupId, refreshSentInvites]` | 6 | SentSubgroupInvitesLoad; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；load保留best-effort錯誤處理。 |
| screens/MapScreen/hooks/useSubgroupActions.ts:67 | `[mySubgroupId, refreshSentInvites, sentInvites.length, members.length]` | 6 | SentSubgroupInvitesPoll; MapScreen groupDataLifecycle / all 5 return paths | clearInterval；保留pending invite/member length身份。 |
| screens/MapScreen/hooks/useCoordinationRequests.ts:157 | `[active, groupId, load, scheduleReload]` | 6 | CoordinationRequestsChannel; MapScreen groupDataLifecycle / all 5 return paths | 清reload timer與removeChannel；single-flight/pending rerun owner不重掛。 |
| featureTour/useGroupFeatureTour.ts:137 | `[ steps, input.measureTarget, input.accountPreferences, input.accountId, input.onTourActiveChange, input.tourDestinationId, input.expandCard, input.pauseAutoCollapse, input.resumeAutoCollapse, input.setSheetMid, input.selectSheetPane, ]` | 6 | GroupTourInputPublication; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；typed committed snapshot，只在commit發布。 |
| featureTour/useGroupFeatureTour.ts:225 | `[reevaluate, input.accountId, input.accountPreferences?.groupFeatureTourCompleted]` | 6 | GroupTourCompletionLoad; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；保留account/local/reset/pending sync gate。 |
| featureTour/useGroupFeatureTour.ts:230 | `[ gateReady, tourCompleted, ctrl.active, input.groupId, input.destinationCount, input.passiveMode, input.denseChrome, ]` | 6 | GroupTourEligibilityLoad; MapScreen groupDataLifecycle / all 5 return paths | cancelled=true；保持onboarding/group/passive eligibility。 |
| featureTour/useGroupFeatureTour.ts:272 | `[ctrl.active]` | 6 | GroupTourActiveNotification; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；active notification仍以active變動為身份。 |
| featureTour/useGroupFeatureTour.ts:281 | `[ctrl.active, ctrl.stepIndex, requestedStep]` | 6 | GroupTourTargetMeasurementCommit (ordered preparation); MapScreen groupDataLifecycle / all 5 return paths | 與measurement同setup；先發布input，再prepare，再measure，appliedStep guard阻止額外重播。 |
| featureTour/useGroupFeatureTour.ts:302 | `[ ctrl.active, ctrl.stepIndex, requestedStep, input.tourDestinationId, input.selectedDestinationId, measureNonce, ]` | 6 | GroupTourTargetMeasurement; MapScreen groupDataLifecycle / all 5 return paths | cancelled=true；measurement generation、requested/committed snapshot、nonce與selection catch-up留hook。 |
| featureTour/routeReorderTour.ts:297 | `[input.measureTarget, input.scrollToTarget, input.accountPreferences, input.accountId]` | 6 | RouteTourInputPublication; MapScreen groupDataLifecycle / all 5 return paths | 原本無cleanup；typed committed snapshot支援callback-only更新。 |
| featureTour/routeReorderTour.ts:324 | `[reevaluate, input.accountId, input.accountPreferences?.routeReorderTourCompleted]` | 6 | RouteTourCompletionLoad; MapScreen groupDataLifecycle / all 5 return paths | reevaluate cancellation；保留account-scoped local與pending讀取。 |
| featureTour/routeReorderTour.ts:329 | `[ input.routeOverlayOpenComplete, input.isLeader, input.canEditItinerary, input.gatheringPointCount, input.accountPreferences?.routeReorderTourCompleted, loaded, localCompleted, tourEligible, ]` | 6 | RouteTourEligibilityMeasurement; MapScreen groupDataLifecycle / all 5 return paths | cancelled=true；六target retry/generation/openComplete gate保留，Next/Prev不重掛owner。 |
| featureTour/GroupFeatureTourOverlay.tsx:87 | `[]` | 6 | component keyboard subscription; Overlay unconditional JSX | 移除三個keyboard listeners；原本mount-only。 |
| featureTour/GroupFeatureTourOverlay.tsx:118 | `[visible]` | 6 | TourOverlayAndroidBack; Overlay unconditional JSX | remove BackHandler；僅visible時安裝。 |
| featureTour/GroupFeatureTourOverlay.tsx:126 | `[ foreground, visible, stepKey, title, body, ctaLabel, targetRect, placementRect, targetKind, reduceMotion, opacity, ]` | 6 | TourOverlaySnapshotFade; Overlay unconditional JSX | 原本無cleanup；保留fade generation與copy/geometry atomic snapshot，沒有新增stop語意。 |
| featureTour/GroupFeatureTourOverlay.tsx:199 | `[foreground, visible, title, ctaLabel]` | 6 | TourOverlayAccessibilityFocus; Overlay unconditional JSX | clearTimeout；foreground/visible/title/CTA原身份，背景不focus。 |

沒有push、cloud變更、dependency安裝、原dirty hither_app修改或其他owner本體的獨立遷移。
未跑整個App的Jest/global lint/changed coverage，交root在最終合併HEAD集中執行；未做native iPhone keyboard、accessibility focus、Reanimated或實際捲動驗收。
