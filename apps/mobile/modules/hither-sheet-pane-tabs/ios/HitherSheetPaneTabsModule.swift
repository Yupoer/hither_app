import SwiftUI
import ExpoModulesCore

private let sheetPaneTabCount = 4
private let sheetPaneSelectorHeight: CGFloat = 54
private let sheetPaneIndicatorHeight: CGFloat = 46
private let sheetPaneIndicatorWidthRatio: CGFloat = 0.88

final class HitherSheetPaneTabsProps: ExpoSwiftUI.ViewProps {
  @Field var labels: [String] = []
  @Field var selectedIndex: Int = 0
  var onSelectionChange = EventDispatcher()
}

struct HitherSheetPaneTabsView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject var props: HitherSheetPaneTabsProps
  @Namespace private var glassNamespace
  @State private var currentIndex: Int
  @State private var dragMode: DragMode = .undecided
  @State private var dragCenter: CGFloat?
  @State private var deferredSelectedIndex: Int?

  private enum DragMode: Equatable {
    case undecided
    case horizontal
    case vertical
  }

  init(props: HitherSheetPaneTabsProps) {
    self.props = props
    _currentIndex = State(initialValue: Self.clampIndex(props.selectedIndex))
  }

  var body: some SwiftUI.View {
    GeometryReader { geometry in
      selector(width: geometry.size.width)
    }
    .frame(height: sheetPaneSelectorHeight)
    .onAppear {
      currentIndex = Self.clampIndex(props.selectedIndex)
    }
    .onChange(of: props.selectedIndex) { nextIndex in
      let next = Self.clampIndex(nextIndex)
      if dragMode == .undecided {
        withAnimation(selectionAnimation) {
          currentIndex = next
          dragCenter = nil
        }
      } else {
        deferredSelectedIndex = next
      }
    }
  }

  @ViewBuilder
  private func selector(width: CGFloat) -> some SwiftUI.View {
    ZStack {
      glassLayer(width: width)
      tabContent(width: width)
    }
    .frame(maxWidth: .infinity, maxHeight: sheetPaneSelectorHeight)
    .contentShape(Rectangle())
    // simultaneousGesture lets the existing BottomSheet pan retain vertical
    // ownership while this view handles only a confirmed horizontal drag.
    .simultaneousGesture(
      DragGesture(minimumDistance: 8, coordinateSpace: .local)
        .onChanged { value in
          handleDragChanged(value, width: width)
        }
        .onEnded { _ in
          handleDragEnded(width: width)
        }
    )
  }

  @ViewBuilder
  private func glassLayer(width: CGFloat) -> some SwiftUI.View {
#if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      GlassEffectContainer(spacing: 0) {
        ZStack {
          Capsule()
            .fill(.clear)
            .frame(maxWidth: .infinity)
            .frame(height: sheetPaneSelectorHeight)
            .glassEffect(.clear, in: Capsule())
            .glassEffectID("sheet-pane-track", in: glassNamespace)

          indicatorShape(width: width)
            .glassEffect(
              .regular.interactive(),
              in: Capsule()
            )
            .glassEffectID("sheet-pane-indicator", in: glassNamespace)
            .offset(x: indicatorOffset(for: width))
        }
      }
    } else {
      fallbackGlassLayer(width: width)
    }
#else
    fallbackGlassLayer(width: width)
#endif
  }

  private func fallbackGlassLayer(width: CGFloat) -> some SwiftUI.View {
    ZStack {
      Capsule()
        .fill(.clear)
        .background(.ultraThinMaterial, in: Capsule())
        .frame(maxWidth: .infinity)
        .frame(height: sheetPaneSelectorHeight)

      indicatorShape(width: width)
        .background(.thinMaterial, in: Capsule())
        .offset(x: indicatorOffset(for: width))
    }
  }

  private func indicatorShape(width: CGFloat) -> some SwiftUI.View {
    Capsule()
      .fill(.clear)
      .frame(width: indicatorWidth(for: width), height: sheetPaneIndicatorHeight)
  }

  private func indicatorOffset(for width: CGFloat) -> CGFloat {
    indicatorCenter(for: width) - width / 2
  }

  private func tabContent(width: CGFloat) -> some SwiftUI.View {
    let highlightedIndex = previewIndex(for: width)
    return HStack(spacing: 0) {
      ForEach(0..<sheetPaneTabCount, id: \.self) { index in
        Image(systemName: Self.symbols[index])
          .font(.system(size: 23, weight: .semibold))
          .foregroundStyle(.white)
          .opacity(index == highlightedIndex ? 1 : 0.65)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .contentShape(Rectangle())
          .accessibilityElement(children: .combine)
          .accessibilityLabel(label(for: index))
          .accessibilityAddTraits(.isButton)
          .accessibilityAddTraits(index == currentIndex ? .isSelected : [])
          .onTapGesture {
            commitSelection(index)
          }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: sheetPaneSelectorHeight)
  }

  private static let symbols = [
    "person.2.fill",
    "map.fill",
    "wrench.and.screwdriver.fill",
    "bag.fill",
  ]

  private func label(for index: Int) -> String {
    guard props.labels.indices.contains(index) else { return "" }
    return props.labels[index]
  }

  private var selectionAnimation: Animation {
    .spring(response: 0.28, dampingFraction: 0.82)
  }

  private func indicatorWidth(for width: CGFloat) -> CGFloat {
    max(0, width / CGFloat(sheetPaneTabCount) * sheetPaneIndicatorWidthRatio)
  }

  private func indicatorCenter(for width: CGFloat) -> CGFloat {
    if let dragCenter {
      return dragCenter
    }
    return width / CGFloat(sheetPaneTabCount) * (CGFloat(currentIndex) + 0.5)
  }

  private func previewIndex(for width: CGFloat) -> Int {
    let cellWidth = width / CGFloat(sheetPaneTabCount)
    guard cellWidth > 0 else { return currentIndex }
    return Self.clampIndex(Int(((indicatorCenter(for: width) / cellWidth) - 0.5).rounded()))
  }

  private func handleDragChanged(_ value: DragGesture.Value, width: CGFloat) {
    switch dragMode {
    case .undecided:
      guard abs(value.translation.width) > abs(value.translation.height) else {
        dragMode = .vertical
        return
      }
      dragMode = .horizontal
      dragCenter = clampedCenter(value.location.x, width: width)
    case .horizontal:
      dragCenter = clampedCenter(value.location.x, width: width)
    case .vertical:
      break
    }
  }

  private func handleDragEnded(width: CGFloat) {
    switch dragMode {
    case .horizontal:
      let center = dragCenter ?? indicatorCenter(for: width)
      let cellWidth = width / CGFloat(sheetPaneTabCount)
      let target = Self.clampIndex(Int(((center / cellWidth) - 0.5).rounded()))
      deferredSelectedIndex = nil
      dragMode = .undecided
      withAnimation(selectionAnimation) {
        currentIndex = target
        dragCenter = nil
      }
      emitSelectionIfNeeded(target)
    case .vertical, .undecided:
      let deferred = deferredSelectedIndex
      deferredSelectedIndex = nil
      dragMode = .undecided
      dragCenter = nil
      if let deferred {
        withAnimation(selectionAnimation) {
          currentIndex = deferred
        }
      }
    }
  }

  private func commitSelection(_ index: Int) {
    let target = Self.clampIndex(index)
    guard target != currentIndex || dragCenter != nil else { return }
    deferredSelectedIndex = nil
    dragMode = .undecided
    withAnimation(selectionAnimation) {
      currentIndex = target
      dragCenter = nil
    }
    emitSelectionIfNeeded(target)
  }

  private func emitSelectionIfNeeded(_ index: Int) {
    guard props.selectedIndex != index else { return }
    props.onSelectionChange(["index": index])
  }

  private func clampedCenter(_ center: CGFloat, width: CGFloat) -> CGFloat {
    let half = indicatorWidth(for: width) / 2
    return min(max(center, half), max(half, width - half))
  }

  private static func clampIndex(_ index: Int) -> Int {
    min(sheetPaneTabCount - 1, max(0, index))
  }
}

public class HitherSheetPaneTabsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HitherSheetPaneTabs")
    View(HitherSheetPaneTabsView.self)
  }
}
