import ActivityKit
import SwiftUI
import WidgetKit
import Foundation

// Live Activity UI: the lock-screen banner + Dynamic Island presentations for
// the group "heading to gathering point" journey. Styled after the Hither
// "Gather Card" redesign — a dark glass surface, the shepherd-crook brand mark,
// the transit glyph, "正在前往" + ETA, a flock progress bar and member-emoji
// avatars. The accent follows the app's active theme (passed as `accentHex` in)
// the state); everything else reads from the same live stop as the in-app
// gather card. Data comes from `HitherGroupAttributes` (started / updated by
// the app's HitherLiveActivity module); this target only draws it.

// MARK: - Brand

private enum Brand {
  // Fallback accent (lantern amber) — used only when the app doesn't pass a
  // theme accent. The live value comes from `ContentState.accentColor`.
  static let accent = Color(red: 0xF5 / 255, green: 0xB1 / 255, blue: 0x42 / 255)
  static let card = Color.black
  static let textPrimary = Color(red: 0xF5 / 255, green: 0xF7 / 255, blue: 0xFB / 255)
  static let textSecondary = Color(white: 0.85)
  static let track = Color(white: 0.4)
  // Deterministic member-avatar palette from the design.
  static let avatarColors: [Color] = [
    Color(red: 0x2a / 255, green: 0x34 / 255, blue: 0x50 / 255),
    Color(red: 0x34 / 255, green: 0x50 / 255, blue: 0x7a / 255),
    Color(red: 0x4a / 255, green: 0x3a / 255, blue: 0x6a / 255),
    Color(red: 0x6a / 255, green: 0x4a / 255, blue: 0x3a / 255),
  ]
}

private extension Color {
  /// Text accents must remain readable against the actual opaque surface.
  static func accessibleAccent(hexString: String?, lightBackground: Bool) -> Color {
    let hex = (hexString ?? "#F5B142").replacingOccurrences(of: "#", with: "")
    guard hex.count == 6, let value = UInt64(hex, radix: 16) else {
      return lightBackground ? .black : .white
    }
    func linear(_ byte: UInt64) -> Double {
      let s = Double(byte) / 255
      return s <= 0.04045 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
    }
    let luminance = 0.2126 * linear((value >> 16) & 255)
      + 0.7152 * linear((value >> 8) & 255) + 0.0722 * linear(value & 255)
    let contrast = lightBackground ? 1.05 / (luminance + 0.05) : (luminance + 0.05) / 0.05
    return contrast >= 4.5 ? Color(hexString: hex)! : lightBackground ? .black : .white
  }
  /// Parse a "#RRGGBB" hex string (the app's theme accent). Nil on bad input.
  init?(hexString: String?) {
    guard var s = hexString else { return nil }
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt64(s, radix: 16) else { return nil }
    self.init(
      red: Double((v >> 16) & 0xFF) / 255,
      green: Double((v >> 8) & 0xFF) / 255,
      blue: Double(v & 0xFF) / 255
    )
  }
}

// MARK: - Crook brand mark

/// Shepherd's crook, the design's SVG path `M24 52 L24 20 C24 6 9 6 9 21`
/// (viewBox 0 0 40 56), stroked with round caps.
private struct CrookShape: Shape {
  func path(in rect: CGRect) -> Path {
    let sx = rect.width / 40
    let sy = rect.height / 56
    func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
      CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
    }
    var path = Path()
    path.move(to: pt(24, 52))
    path.addLine(to: pt(24, 20))
    path.addCurve(to: pt(9, 21), control1: pt(24, 6), control2: pt(9, 6))
    return path
  }
}

private struct Crook: View {
  var size: CGFloat
  var color: Color
  var body: some View {
    CrookShape()
      .stroke(color, style: StrokeStyle(lineWidth: size * 5 / 56, lineCap: .round, lineJoin: .round))
      .frame(width: size * 40 / 56, height: size)
  }
}

@main
struct HitherWidgetBundle: WidgetBundle {
  var body: some Widget {
    HitherLiveActivityWidget()
  }
}

struct HitherLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: HitherGroupAttributes.self) { context in
      LockScreenView(context: context)
        .modifier(LockScreenBackground())
        .activitySystemActionForegroundColor(context.state.accentColor)
    } dynamicIsland: { context in
      let accent = context.state.accentColor
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          // Leading identity = active travel mode (not crook brand mark).
          TravelModeBadge(symbol: context.state.modeSymbol, accent: accent, size: 42)
            .accessibilityLabel(context.state.modeAccessibilityLabel)
        }
        DynamicIslandExpandedRegion(.trailing) {
          VStack(alignment: .trailing, spacing: 0) {
            if context.state.etaSeconds != nil {
              EstimatedEta(state: context.state)
                .font(.system(size: 18, weight: .bold))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(Brand.textPrimary)
              if let d = context.state.formattedDistance {
                Text(d).font(.system(size: 12)).foregroundStyle(Brand.textSecondary)
              }
            }
          }
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            // No duplicate transport icon before「正在前往」— mode is leading only.
            Text("正在前往")
              .font(.system(size: 11, weight: .bold))
              .tracking(0.6)
              .foregroundStyle(accent)
            DestinationTitle(
              text: context.state.displayTitle(fallbackGroupName: context.attributes.groupName)
            )
              .font(.system(size: 16, weight: .semibold))
              .foregroundStyle(Brand.textPrimary)
              .layoutPriority(0)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.bottom) {
          // BUG-19: match Lock Screen — progress+percent, then avatar stack.
          VStack(spacing: 10) {
            ProgressRow(value: context.state.clampedProgress, accent: accent)
            HStack {
              AvatarStack(
                emojis: context.state.avatarEmojis,
                arrived: context.state.avatarArrived
              )
              Spacer()
              if let s = context.state.arrivalStatus {
                Text(s).font(.system(size: 12.5)).foregroundStyle(Brand.textSecondary)
              }
            }
          }
          .padding(.top, 2)
        }
      } compactLeading: {
        // Compact: travel mode only (no crook + mode pair).
        Image(systemName: context.state.modeSymbol)
          .font(.system(size: 14, weight: .semibold))
          .foregroundStyle(accent)
          .accessibilityLabel(context.state.modeAccessibilityLabel)
      } compactTrailing: {
        EstimatedEta(state: context.state, compact: true)
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(accent)
      } minimal: {
        Image(systemName: context.state.modeSymbol)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(accent)
          .accessibilityLabel(context.state.modeAccessibilityLabel)
      }
      .keylineTint(accent)
    }
  }
}

private struct DestinationTitle: View {
  let text: String

  var body: some View {
    Text(text)
      .lineLimit(2)
      .fixedSize(horizontal: false, vertical: true)
      .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
      .accessibilityLabel(text)
  }
}

/// Native glass on iOS 26; readable material fallback on earlier systems.
private struct LockScreenBackground: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content
        // Keep text outside the glass view: applying glass to the entire
        // content hid the foreground in lock-screen host QA.
        .background {
          RoundedRectangle(cornerRadius: 24)
            .fill(.clear)
            .glassEffect(.regular)
        }
        .activityBackgroundTint(.clear)
    } else {
      content
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
        .activityBackgroundTint(.clear)
    }
  }
}

// MARK: - Lock screen

private struct LockScreenView: View {
  let context: ActivityViewContext<HitherGroupAttributes>
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    let light = colorScheme != .dark
    let background: Color = light ? .white : .black
    let primary: Color = light ? .black : Brand.textPrimary
    let secondary = Color(white: light ? 0.27 : 0.85)
    let accent = Color.accessibleAccent(hexString: context.state.accentHex, lightBackground: light)
    return VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .top, spacing: 10) {
        TravelModeBadge(symbol: context.state.modeSymbol, accent: accent, size: 40, plate: background)
          .accessibilityLabel(context.state.modeAccessibilityLabel)
          .fixedSize()
        VStack(alignment: .leading, spacing: 3) {
          Text("正在前往")
            .font(.system(size: 10.5, weight: .bold))
            .foregroundStyle(accent)
          DestinationTitle(text: context.state.displayTitle(fallbackGroupName: context.attributes.groupName))
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(primary)
        }
        .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
      }
      // ETA has its own row: neither a long title nor large type can push it
      // beyond the lock-screen host's width.
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        if context.state.etaSeconds != nil {
          EstimatedEta(state: context.state)
            .font(.system(size: 18, weight: .bold))
            .foregroundStyle(primary)
            .lineLimit(2)
            .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
        }
        if let distance = context.state.formattedDistance {
          Text(distance).font(.system(size: 12))
            .foregroundStyle(secondary)
            .lineLimit(2)
            .frame(minWidth: 0, maxWidth: .infinity, alignment: .trailing)
        }
      }
      ProgressRow(value: context.state.clampedProgress, accent: accent,
        textColor: secondary, trackColor: Color(white: light ? 0.55 : 0.4))
      HStack(spacing: 8) {
        AvatarStack(emojis: context.state.avatarEmojis, arrived: context.state.avatarArrived, outline: background)
          .frame(maxWidth: .infinity, alignment: .leading)
        if let status = context.state.arrivalStatus {
          Text(status).font(.system(size: 12.5, weight: .medium))
            .foregroundStyle(secondary)
            .lineLimit(2)
            .frame(minWidth: 0, maxWidth: .infinity, alignment: .trailing)
        }
      }
    }
    .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }

}

/// Leading identity tile: active travel-mode SF Symbol on accent plate.
private struct TravelModeBadge: View {
  let symbol: String
  let accent: Color
  var size: CGFloat = 44
  var plate: Color = Color(red: 0.18, green: 0.15, blue: 0.10)
  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 12)
        .fill(plate)
        .frame(width: size, height: size)
      Image(systemName: symbol)
        .font(.system(size: size * 0.42, weight: .semibold))
        .foregroundStyle(accent)
    }
  }
}

// MARK: - Pieces

/// Progress transition timing (#147): ~600ms ease on Lock Screen + Dynamic Island.
/// Reduce Motion uses a short fade-style update (no long size-move animation).
private enum ProgressMotion {
  static let durationSeconds: Double = 0.6
  static let reduceMotionDurationSeconds: Double = 0.12

  static func animation(reduceMotion: Bool) -> Animation {
    if reduceMotion {
      return .easeInOut(duration: reduceMotionDurationSeconds)
    }
    return .easeInOut(duration: durationSeconds)
  }
}

private struct ProgressBar: View {
  let value: Double
  let accent: Color
  var trackColor: Color = Brand.track
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(trackColor)
        Capsule()
          .fill(accent)
          .frame(width: max(6, geo.size.width * value))
          // Animate width to the latest target (including first 0→60%).
          .animation(ProgressMotion.animation(reduceMotion: reduceMotion), value: value)
      }
    }
    .frame(height: 6)
  }
}

/// Progress bar + percent label — shared by Lock Screen and expanded Dynamic Island.
private struct ProgressRow: View {
  let value: Double?
  let accent: Color
  var textColor: Color = Brand.textSecondary
  var trackColor: Color = Brand.track
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let pct = value.map { Int((min(1, max(0, $0)) * 100).rounded()) }
    return HStack(spacing: 8) {
      ProgressBar(value: value ?? 0, accent: accent, trackColor: trackColor)
      Text(pct.map { "\($0)%" } ?? "—")
        .font(.system(size: 12, weight: .semibold).monospacedDigit())
        .foregroundStyle(textColor)
        .frame(minWidth: 34, alignment: .trailing)
        .contentTransition(.numericText())
        .animation(ProgressMotion.animation(reduceMotion: reduceMotion), value: pct)
    }
  }
}

private struct AvatarStack: View {
  let emojis: [String]
  let arrived: [Bool]
  var outline: Color = Brand.card
  var body: some View {
    HStack(spacing: -7) {
      ForEach(Array(emojis.prefix(4).enumerated()), id: \.offset) { i, emoji in
        let isArrived = arrived.indices.contains(i) && arrived[i]
        ZStack {
          Circle().fill(Brand.avatarColors[i % Brand.avatarColors.count])
          if !emoji.isEmpty {
            Text(emoji).font(.system(size: 12))
          }
        }
        .frame(width: 24, height: 24)
        .overlay(Circle().stroke(outline, lineWidth: 1.5))
        .overlay(alignment: .bottomTrailing) {
          if isArrived {
            Image(systemName: "checkmark.circle.fill")
              .font(.system(size: 10, weight: .bold)).foregroundStyle(.white, .black)
          }
        }
      }
    }
  }
}

// MARK: - Presentation helpers

/// ETA is an estimate from the latest delivered snapshot, never a ticking timer.
private struct EstimatedEta: View {
  let state: HitherGroupAttributes.ContentState
  var compact = false

  var body: some View {
    if compact {
      if let eta = state.shortEta {
        Text(HitherGroupAttributes.ContentState.usesEnglish(state.language) ? "~" + eta : "約" + eta)
      } else {
        Text(state.formattedDistance ?? "")
      }
    } else if let eta = state.etaText {
      Text(HitherGroupAttributes.ContentState.usesEnglish(state.language)
        ? "Est. " + (eta.unit.isEmpty ? eta.value : "\(eta.value) \(eta.unit)")
        : "約" + (eta.unit.isEmpty ? eta.value : "\(eta.value) \(eta.unit)"))
    }
  }
}

private extension HitherGroupAttributes.ContentState {
  /// The app's theme accent (from `accentHex`), or the brand fallback.
  var accentColor: Color { Color.accessibleAccent(hexString: accentHex, lightBackground: false) }

  /// Gathering point title when present; team/group name only as fallback.
  /// Prefixes destination emoji when set (Ticket 07), same fallback as JS resolve.
  func displayTitle(fallbackGroupName: String) -> String {
    let emoji = destinationEmoji?.trimmingCharacters(in: .whitespacesAndNewlines)
    let hasEmoji = emoji.map { !$0.isEmpty } ?? false
    if let t = gatheringTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty {
      return hasEmoji ? "\(emoji!) \(t)" : t
    }
    let g = fallbackGroupName.trimmingCharacters(in: .whitespacesAndNewlines)
    let base = g.isEmpty ? "集合點" : g
    return hasEmoji ? "\(emoji!) \(base)" : base
  }

  /// SF Symbol for the active travel mode (transit glyph).
  var modeSymbol: String {
    switch travelMode {
    case "drive": return "car.fill"
    case "transit": return "bus.fill"
    default: return "figure.walk"
    }
  }

  /// Accessible text for the leading travel-mode identity.
  var modeAccessibilityLabel: String {
    switch travelMode {
    case "drive": return "開車"
    case "transit": return "大眾運輸"
    default: return "步行"
    }
  }

  /// Emojis to draw in the flock stack — the passed avatars, or blank circles
  /// sized to the member count when no emojis are available.
  var avatarEmojis: [String] {
    if let e = memberEmojis, !e.isEmpty { return Array(e.prefix(4)) }
    let n = min(memberCount ?? 0, 4)
    return Array(repeating: "", count: n)
  }

  var avatarArrived: [Bool] {
    let count = avatarEmojis.count
    guard let arrived = memberArrived else {
      return Array(repeating: false, count: count)
    }
    return (0..<count).map { arrived.indices.contains($0) && arrived[$0] }
  }

  /// Compact ETA for the narrow Dynamic Island regions.
  var shortEta: String? {
    guard let s = etaSeconds else { return nil }
    return HitherGroupAttributes.ContentState.formattedDuration(
      fromSeconds: s,
      language: language
    )
  }

  /// Hero ETA block. en keeps value+unit under 1h; zh is a single localized string.
  var etaText: (value: String, unit: String)? {
    guard let s = etaSeconds else { return nil }
    if HitherGroupAttributes.ContentState.usesEnglish(language) {
      let m = Int((s / 60).rounded())
      if m < 1 { return (value: "<1", unit: "min") }
      if m < 60 { return (value: "\(m)", unit: "min") }
      return (
        value: HitherGroupAttributes.ContentState.compactDuration(fromMinutes: m),
        unit: ""
      )
    }
    return (
      value: HitherGroupAttributes.ContentState.formattedDuration(
        fromSeconds: s,
        language: language
      ),
      unit: ""
    )
  }

  /// Progress clamped to 0...1, defaulting to 0 when unknown.
  var clampedProgress: Double? { progress.map { min(1, max(0, $0)) } }

  /// "2 / 4 已抵達" — the expanded island's arrival caption (nil without a count).
  var arrivalStatus: String? {
    guard let total = memberCount, total > 0 else { return nil }
    return "\(gatheredCount ?? 0) / \(total) 已抵達"
  }

  /// "2 位已抵達 · 1 人在路上" — the lock screen's flock line.
  var flockStatus: String? {
    guard let total = memberCount, total > 0 else { return nil }
    let gathered = gatheredCount ?? 0
    let enroute = max(0, total - gathered)
    return "\(gathered) 位已抵達 · \(enroute) 人在路上"
  }
}
