# Tokyo QA：Tour 與完成按鈕修復

2026-10-04（Asia/Taipei），base `f511489`。對照來源為 QA root 的 `review/FINDING-002-tour-tooltip-disappeared.md` 與 `review/FINDING-003-overlay-done-accessibility.md`。

- **FINDING-002**：報告顯示 iOS17 SwiftUI Host 仍掛載但文案／CTA 消失，單純重掛未完全解決。選帶 `697713f` 的 Tour 步驟 key、`ReactNativeTourCard.tsx` 與按 Liquid Glass capability 分支的 iOS wrapper；一般平台 reexport RN card，避免 platform import 循環。較舊 iOS 不使用 SwiftUI Host；iOS26 保留原生卡片。RN disabled 時移除 callback，Previous 同樣有 disabled accessibility state。
- **FINDING-003**：報告的完成按鈕可見但 AX／點擊隨 overlay 狀態不一致；舊 iOS 沒有 RN fallback 是已確認的 source 缺口，Host 問題仍是候選根因。iOS header 現由一個 48pt RN Pressable 擁有 callback、label、disabled state 與按下回饋。iOS26 內部只放 native Image＋Liquid Glass 裝飾，沒有第二個 SwiftUI Button；裝飾層 `pointerEvents="none"`、AX hidden 並保留 RN wrapper。iOS17 使用抽出的 `ReactNativeSheetHeaderAction.tsx`。Settings 原生 sheet 直接使用的 `SheetHeaderActionContent` 仍保留 Button 與原 callback。

本範圍沒有修改 `foregroundUi.ts`、MapScreen、BottomSheet、Simulator、主樹或 Git 歷史。Tour 依賴現有 `useForegroundUi`，不需要 `697713f` 的獨立 `useAppState` 改動。

從 `apps/mobile` 重跑：

```sh
npm test -- --runInBand --silent src/__tests__/sheetHeaderActionBehavior.test.ts src/__tests__/tourCardLayout.test.ts src/__tests__/groupFeatureTourOverlayFix.test.ts src/__tests__/groupFeatureTourI18nVerification.test.ts src/__tests__/nativeUiContracts.test.ts src/__tests__/addPlaceTour.test.ts src/__tests__/routeReorderTour.test.ts
npm run typecheck
```

當次結果：**7 suites／77 tests PASS**，typecheck exit 0，`git diff --check` 通過。最後補 RN fallback 裝飾層 AX／pointer isolation 後，header 4 tests 另行重跑通過。

新 `sheetHeaderActionBehavior.test.ts` 使用實際 header／fallback 元件與 mock 原生葉節點，驗證 capability 兩分支只有一個可操作／AX button、48pt 控制區、callback 一次、disabled 不回呼、commit→close 後的新 callback／label，以及原生 Settings Button 仍可操作。Tour 回歸驗證 avatar→settings→final 文案與操作、disabled callback、步驟重掛與同一步 remeasure 保持 instance；既有 modern SwiftUI 路徑也覆蓋。

測試不能量測真實 UIKit／SwiftUI AX tree、Host frame、native hit routing 或 Liquid Glass 畫面。尚未本輪 cold restart／重跑 iOS17 與 iOS26 UI；以前 QA fallback 的 Simulator PASS 是歷史證據，不當作本次 binary 驗收。正式 review 可核對 React 契約與隔離層，原生視覺與實際 touch acceptance 必須另驗。
