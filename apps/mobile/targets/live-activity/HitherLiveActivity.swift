import ActivityKit
import SwiftUI
import WidgetKit

// Live Activity UI: the lock-screen banner + Dynamic Island presentations for
// the group "heading to gathering point" journey. Styled after the Hither
// "Gather Card" redesign — a dark glass surface, the shepherd-crook brand mark,
// the transit glyph, "前往集合點 · GATHERING AT" + ETA, a flock progress bar and
// member-emoji avatars. The accent follows the app's active theme (passed as
// `accentHex` in the state); everything else reads from the same live stop as
// the in-app gather card. Data comes from `HitherGroupAttributes` (started /
// updated by the app's HitherLiveActivity module); this target only draws it.

// MARK: - Brand

private enum Brand {
  // Fallback accent (lantern amber) — used only when the app doesn't pass a
  // theme accent. The live value comes from `ContentState.accentColor`.
  static let accent = Color(red: 0x58 / 255, green: 0xD6 / 255, blue: 0x8D / 255)
  static let card = Color.black
  static let textPrimary = Color(red: 0xF5 / 255, green: 0xF7 / 255, blue: 0xFB / 255)
  static let textSecondary = Color(white: 1, opacity: 0.6)
  static let track = Color(white: 1, opacity: 0.14)
  // Deterministic member-avatar palette from the design.
  static let avatarColors: [Color] = [
    Color(red: 0x2a / 255, green: 0x34 / 255, blue: 0x50 / 255),
    Color(red: 0x34 / 255, green: 0x50 / 255, blue: 0x7a / 255),
    Color(red: 0x4a / 255, green: 0x3a / 255, blue: 0x6a / 255),
    Color(red: 0x6a / 255, green: 0x4a / 255, blue: 0x3a / 255),
  ]
}

private extension Color {
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
        .activityBackgroundTint(Brand.card)
        .activitySystemActionForegroundColor(context.state.accentColor)
    } dynamicIsland: { context in
      let accent = context.state.accentColor
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ZStack {
            RoundedRectangle(cornerRadius: 12)
              .fill(accent.opacity(0.22))
              .frame(width: 42, height: 42)
            Crook(size: 25, color: accent)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          VStack(alignment: .trailing, spacing: 0) {
            if let eta = context.state.etaText {
              Text("\(eta.value) \(eta.unit)")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Brand.textPrimary)
              if let d = context.state.formattedDistance {
                Text(d).font(.system(size: 12)).foregroundStyle(Brand.textSecondary)
              }
            }
          }
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            Text("前往集合點 · GATHERING AT")
              .font(.system(size: 11, weight: .bold))
              .tracking(0.6)
              .foregroundStyle(accent)
            Text(context.state.gatheringTitle ?? context.attributes.groupName)
              .font(.system(size: 16, weight: .semibold))
              .foregroundStyle(Brand.textPrimary)
              .lineLimit(1)
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
        HStack(spacing: 6) {
          Crook(size: 16, color: accent)
          Image(systemName: context.state.modeSymbol)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(accent)
        }
      } compactTrailing: {
        Text(context.state.shortEta ?? context.state.formattedDistance ?? "")
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(accent)
      } minimal: {
        Crook(size: 15, color: accent)
      }
      .keylineTint(accent)
    }
  }
}

// MARK: - Lock screen

private struct LockScreenView: View {
  let context: ActivityViewContext<HitherGroupAttributes>

  var body: some View {
    let accent = context.state.accentColor
    return VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .top, spacing: 12) {
        ZStack {
          RoundedRectangle(cornerRadius: 12)
            .fill(accent.opacity(0.22))
            .frame(width: 44, height: 44)
          Crook(size: 25, color: accent)
        }
        VStack(alignment: .leading, spacing: 3) {
          HStack(spacing: 5) {
            Image(systemName: context.state.modeSymbol)
              .font(.system(size: 10, weight: .bold))
            Text("前往集合點 · GATHERING AT")
          }
          .font(.system(size: 10.5, weight: .bold))
          .tracking(0.45)
          .foregroundStyle(accent)
          Text(context.state.gatheringTitle ?? context.attributes.groupName)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Brand.textPrimary)
            .lineLimit(1)
        }
        Spacer(minLength: 6)
        if let eta = context.state.etaText {
          VStack(alignment: .trailing, spacing: 1) {
            Text("\(eta.value) \(eta.unit)")
              .font(.system(size: 22, weight: .bold))
              .foregroundStyle(Brand.textPrimary)
            if let distance = context.state.formattedDistance {
              Text(distance)
                .font(.system(size: 12))
                .foregroundStyle(Brand.textSecondary)
            }
          }
        }
      }

      // BUG-05: progress percentage next to the bar (Lock Screen + Island share ProgressRow).
      ProgressRow(value: context.state.clampedProgress, accent: accent)

      HStack {
        AvatarStack(
          emojis: context.state.avatarEmojis,
          arrived: context.state.avatarArrived
        )
        Spacer()
        if let status = context.state.arrivalStatus {
          Text(status)
            .font(.system(size: 12.5, weight: .medium))
            .foregroundStyle(Brand.textSecondary)
        }
      }
    }
    .padding(16)
  }

}

// MARK: - Pieces

private struct ProgressBar: View {
  let value: Double
  let accent: Color
  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(Brand.track)
        Capsule().fill(accent).frame(width: max(6, geo.size.width * value))
      }
    }
    .frame(height: 6)
  }
}

/// Progress bar + percent label — shared by Lock Screen and expanded Dynamic Island.
private struct ProgressRow: View {
  let value: Double
  let accent: Color
  var body: some View {
    let pct = Int((min(1, max(0, value)) * 100).rounded())
    return HStack(spacing: 8) {
      ProgressBar(value: value, accent: accent)
      Text("\(pct)%")
        .font(.system(size: 12, weight: .semibold).monospacedDigit())
        .foregroundStyle(Brand.textSecondary)
        .frame(minWidth: 34, alignment: .trailing)
    }
  }
}

private struct AvatarStack: View {
  let emojis: [String]
  let arrived: [Bool]
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
        .overlay(Circle().stroke(Brand.card, lineWidth: 1.5))
        .opacity(isArrived ? 1 : 0.35)
        .saturation(isArrived ? 1 : 0.25)
      }
    }
  }
}

// MARK: - Presentation helpers

private extension HitherGroupAttributes.ContentState {
  /// The app's theme accent (from `accentHex`), or the brand fallback.
  var accentColor: Color { Color(hexString: accentHex) ?? Brand.accent }

  /// SF Symbol for the active travel mode (transit glyph).
  var modeSymbol: String {
    switch travelMode {
    case "drive": return "car.fill"
    case "transit": return "bus.fill"
    default: return "figure.walk"
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

  /// Compact ETA for the narrow Dynamic Island regions ("4 min", "now", "2 hr").
  var shortEta: String? {
    guard let s = etaSeconds else { return nil }
    let m = Int((s / 60).rounded())
    if m < 1 { return "now" }
    if m < 60 { return "\(m) min" }
    return "\(m / 60) hr"
  }

  /// Big number + small unit for the hero ETA block ("12" / "min").
  var etaText: (value: String, unit: String)? {
    guard let s = etaSeconds else { return nil }
    let m = Int((s / 60).rounded())
    if m < 1 { return (value: "<1", unit: "min") }
    if m < 60 { return (value: "\(m)", unit: "min") }
    let h = m / 60
    let mm = m % 60
    return mm == 0 ? (value: "\(h)", unit: "hr") : (value: "\(h):\(String(format: "%02d", mm))", unit: "hr")
  }

  /// Progress clamped to 0...1, defaulting to 0 when unknown.
  var clampedProgress: Double { min(1, max(0, progress ?? 0)) }

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
