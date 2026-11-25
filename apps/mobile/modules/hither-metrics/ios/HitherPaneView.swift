import ExpoModulesCore
import UIKit

final class HitherPaneView: ExpoView {
  var panelHeight: CGFloat = 0 { didSet { applyCurrentFrames() } }
  var closedHeight: CGFloat = 0 { didSet { if oldValue != closedHeight { invalidateReference() } } }
  var referenceHeight: CGFloat = 0 { didSet {
    if oldValue != referenceHeight {
      updateScrollInsets(logicalHeight: max(0, referenceHeight - closedHeight), visibleHeight: geometry(height: panelHeight).body.height)
      invalidateReference()
    }
  } }
  var grabberHeight: CGFloat = 0 { didSet { if oldValue != grabberHeight { invalidateReference() } } }
  var direction = 1 { didSet { if oldValue != direction { invalidateReference() } } }
  var cornerRadius: CGFloat = 0 { didSet { scheduleFrameUpdate() } }
  var contentVisible = false { didSet {
    if oldValue != contentVisible {
      if !contentVisible {
        for scroll in scrolls { if let view = scroll.view { view.contentInset.bottom = scroll.bottomInset } }
        scrolls.removeAll(keepingCapacity: true)
      }
      invalidateReference()
    }
  } }

  private weak var surface: UIView?
  private weak var header: UIView?
  private weak var body: UIView?
  private weak var grabber: UIView?
  private weak var footer: UIView?
  private weak var decoration: UIView?
  private var referenceDirty = true
  private var lastSize = CGSize.zero
  private struct ScrollViewport {
    weak var view: UIScrollView?
    let bottomInset: CGFloat
  }
  private var scrolls: [ScrollViewport] = []
  private var lastAppliedFrame: HitherPaneGeometry?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
  }

  // Expo's Swift base omits Fabric's command declaration; retain the native selector.
  @objc(handleCommand:args:)
  func handlePanelCommand(_ command: NSString, args: NSArray) {
    if command == "contentDidLayout" {
      invalidateReference()
      return
    }
    guard command == "setPanelHeight", let value = args.firstObject as? NSNumber else { return }
    panelHeight = CGFloat(value.doubleValue)
  }

  override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    invalidateReference()
  }

  override func willRemoveSubview(_ subview: UIView) {
    super.willRemoveSubview(subview)
    if subview === surface { surface = nil }
    invalidateReference()
  }

  func invalidateReference() {
    referenceDirty = true
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard bounds.width > 0, bounds.height > 0 else { return }
    resolveSlots()
    if lastSize != bounds.size {
      lastSize = bounds.size
      referenceDirty = true
    }
    if referenceDirty {
      let previous = scrolls
      scrolls.removeAll(keepingCapacity: true)
      if let body { collectScrolls(body, previous: previous) }
      referenceDirty = false
    }
    applyCurrentFrames(force: true)
  }

  private func scheduleFrameUpdate() {
    setNeedsLayout()
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard geometry(height: panelHeight).visible.contains(point) else { return nil }
    return super.hitTest(point, with: event)
  }

  private func resolveSlots() {
    for view in subviews {
      switch view.accessibilityIdentifier {
      case "d6-native-surface": surface = view
      case "d6-native-header": header = view
      case "d6-native-body": body = view
      case "d6-native-grabber": grabber = view
      case "d6-native-footer": footer = view
      case "d6-native-decoration": decoration = view
      default: break
      }
    }
  }

  private func geometry(height: CGFloat) -> HitherPaneGeometry {
    HitherPaneGeometry(width: bounds.width, maximumHeight: bounds.height,
      height: HitherPaneGeometry.pixelAligned(height, scale: traitCollection.displayScale),
      closed: closedHeight, grabberHeight: grabberHeight, direction: direction)
  }

  private func applyCurrentFrames(force: Bool = false) {
    guard bounds.width > 0, bounds.height > 0 else { return }
    let frame = geometry(height: panelHeight)
    guard force || referenceDirty || frame != lastAppliedFrame else { return }
    lastAppliedFrame = frame
    // Committing a transaction here would flush layout synchronously inside gesture delivery, which
    // recurses through iOS 26 glass views until the main thread overflows its stack.
    let actionsWereDisabled = CATransaction.disableActions()
    CATransaction.setDisableActions(true)
    defer { CATransaction.setDisableActions(actionsWereDisabled) }
    setFrame(frame.visible, on: surface)
    setFrame(frame.header, on: header)
    if let body {
      body.clipsToBounds = true
      setFrame(frame.body, on: body)
      updateScrollInsets(logicalHeight: max(0, referenceHeight - closedHeight), visibleHeight: frame.body.height)
    }
    setFrame(frame.grabber, on: grabber)
    setFrame(frame.footer, on: footer)
    if let decoration {
      decoration.clipsToBounds = true
      decoration.layer.cornerRadius = cornerRadius
      setFrame(CGRect(x: 0, y: frame.visible.minY, width: bounds.width, height: closedHeight), on: decoration)
    }
  }

  private func setFrame(_ frame: CGRect, on view: UIView?) {
    if let view, view.frame != frame { view.frame = frame }
  }

  private func updateScrollInsets(logicalHeight: CGFloat, visibleHeight: CGFloat) {
    let hidden = max(0, logicalHeight - visibleHeight)
    for scroll in scrolls {
      guard let view = scroll.view else { continue }
      let bottom = scroll.bottomInset + hidden
      if view.contentInset.bottom != bottom { view.contentInset.bottom = bottom }
    }
  }

  private func collectScrolls(_ view: UIView, previous: [ScrollViewport], vertical: Bool = false) {
    if let scroll = view as? UIScrollView {
      if vertical {
        let bottom = previous.first(where: { $0.view === scroll })?.bottomInset ?? scroll.contentInset.bottom
        scrolls.append(ScrollViewport(view: scroll, bottomInset: bottom))
      }
      return
    }
    for child in view.subviews {
      collectScrolls(child, previous: previous, vertical: vertical || child.accessibilityIdentifier == "d6-route-scroll" || child.accessibilityIdentifier == "d6-team-scroll")
    }
  }
}

final class HitherPaneGradientView: ExpoView {
  override class var layerClass: AnyClass { CAGradientLayer.self }

  func setColors(_ colors: [UIColor]) {
    (layer as? CAGradientLayer)?.colors = colors.map(\.cgColor)
  }
}

final class HitherPaneSurfaceView: ExpoView {
  let gradient = CAGradientLayer()
  var solidColor = UIColor.clear { didSet { updateTransparency() } }
  var blurIntensity = 48.0 { didSet { blurAnimator?.fractionComplete = max(0, min(1, blurIntensity / 100)) } }
  var cornerRadius: CGFloat = 0 { didSet {
    gradient.cornerRadius = cornerRadius
    if #available(iOS 26.0, *) {
      let radius = UICornerRadius(floatLiteral: cornerRadius)
      effectView.cornerConfiguration = .corners(topLeftRadius: radius, topRightRadius: radius,
        bottomLeftRadius: radius, bottomRightRadius: radius)
    }
  } }
  private let effectView = UIVisualEffectView()
  private var effectInstalled = false
  private var blurAnimator: UIViewPropertyAnimator?
  private var transparencyObserver: NSObjectProtocol?
  private var reducedTransparency = UIAccessibility.isReduceTransparencyEnabled

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    effectView.overrideUserInterfaceStyle = .dark
    effectView.isUserInteractionEnabled = false
    effectView.clipsToBounds = true
    addSubview(effectView)
    gradient.actions = ["bounds": NSNull(), "position": NSNull(), "cornerRadius": NSNull()]
    gradient.masksToBounds = true
    layer.addSublayer(gradient)
    transparencyObserver = NotificationCenter.default.addObserver(
      forName: UIAccessibility.reduceTransparencyStatusDidChangeNotification, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      self.reducedTransparency = UIAccessibility.isReduceTransparencyEnabled
      self.updateTransparency()
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      blurAnimator?.stopAnimation(true)
      blurAnimator = nil
      effectView.effect = nil
      effectInstalled = false
    } else { setNeedsLayout() }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard bounds.width > 0, bounds.height > 0 else { return }
    if effectView.frame != bounds { effectView.frame = bounds }
    if gradient.frame != bounds { gradient.frame = bounds }
    updateTransparency()
  }

  func setColors(_ colors: [UIColor]) { gradient.colors = colors.map(\.cgColor) }

  private func updateTransparency() {
    let reduced = reducedTransparency
    layer.backgroundColor = reduced ? solidColor.cgColor : nil
    gradient.isHidden = reduced
    effectView.isHidden = reduced
    guard !reduced, !effectInstalled, window != nil, bounds.width > 0, bounds.height > 0 else { return }
    effectInstalled = true
    if #available(iOS 26.0, *) {
      let glass = UIGlassEffect(style: .regular)
      glass.isInteractive = false
      effectView.effect = glass
    } else {
      let animator = UIViewPropertyAnimator(duration: 1, curve: .linear) { [weak self] in
        self?.effectView.effect = UIBlurEffect(style: .dark)
      }
      animator.fractionComplete = max(0, min(1, blurIntensity / 100))
      blurAnimator = animator
    }
  }

  deinit {
    blurAnimator?.stopAnimation(true)
    if let transparencyObserver { NotificationCenter.default.removeObserver(transparencyObserver) }
  }
}
