import ActivityKit
import SwiftUI
import WidgetKit

// Live Activity UI: the lock-screen banner + Dynamic Island presentations for
// the group "heading to gathering point" journey. Styled after Uber's trip
// Live Activity — a clean dark card, a prominent ETA, and an origin→destination
// route line — but in Hither's lantern-amber brand. Data comes from
// `HitherGroupAttributes` (started/updated by the app's HitherLiveActivity
// module); this target only draws it.

// MARK: - Brand

private enum Brand {
  // Lantern amber accent (matches src/theme.ts `accent`).
  static let accent = Color(red: 0xF5 / 255, green: 0xB1 / 255, blue: 0x42 / 255)
  static let card = Color(red: 0x0E / 255, green: 0x13 / 255, blue: 0x20 / 255)
  static let textPrimary = Color(red: 0xF5 / 255, green: 0xF7 / 255, blue: 0xFB / 255)
  static let textSecondary = Color(red: 0x9A / 255, green: 0xA6 / 255, blue: 0xBF / 255)
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
        .activitySystemActionForegroundColor(Brand.accent)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ZStack {
            Circle().fill(Brand.accent.opacity(0.18)).frame(width: 36, height: 36)
            Image(systemName: "figure.walk")
              .font(.system(size: 16, weight: .bold))
              .foregroundStyle(Brand.accent)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          EtaBadge(text: context.state.shortEta)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            Text("HEADING TO")
              .font(.system(size: 10, weight: .bold))
              .tracking(1.2)
              .foregroundStyle(Brand.accent)
            Text(context.state.gatheringTitle ?? context.attributes.groupName)
              .font(.system(size: 16, weight: .bold))
              .foregroundStyle(Brand.textPrimary)
              .lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.bottom) {
          RouteLine(
            origin: context.attributes.groupName,
            destination: context.state.gatheringTitle ?? "Gathering point",
            distance: context.state.formattedDistance
          )
          .padding(.top, 2)
        }
      } compactLeading: {
        Image(systemName: "figure.walk")
          .font(.system(size: 14, weight: .bold))
          .foregroundStyle(Brand.accent)
      } compactTrailing: {
        Text(context.state.shortEta ?? context.state.formattedDistance ?? "")
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(Brand.accent)
      } minimal: {
        Image(systemName: "figure.walk")
          .font(.system(size: 13, weight: .bold))
          .foregroundStyle(Brand.accent)
      }
      .keylineTint(Brand.accent)
    }
  }
}

// MARK: - Lock screen

private struct LockScreenView: View {
  let context: ActivityViewContext<HitherGroupAttributes>

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading, spacing: 10) {
        // Header: status label + destination title.
        VStack(alignment: .leading, spacing: 3) {
          Text("HEADING TO GATHERING POINT")
            .font(.system(size: 11, weight: .bold))
            .tracking(1.0)
            .foregroundStyle(Brand.accent)
          Text(context.state.gatheringTitle ?? context.attributes.groupName)
            .font(.system(size: 20, weight: .bold))
            .foregroundStyle(Brand.textPrimary)
            .lineLimit(1)
        }
        // Route line: group origin → destination, with distance.
        RouteLine(
          origin: context.attributes.groupName,
          destination: context.state.gatheringTitle ?? "Gathering point",
          distance: context.state.formattedDistance
        )
      }
      Spacer(minLength: 8)
      // Big ETA block on the right, Uber-style.
      VStack(alignment: .trailing, spacing: 0) {
        if let eta = context.state.etaText {
          Text(eta.value)
            .font(.system(size: 30, weight: .heavy))
            .foregroundStyle(Brand.textPrimary)
          Text(eta.unit)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Brand.textSecondary)
        } else {
          ZStack {
            Circle().fill(Brand.accent.opacity(0.18)).frame(width: 48, height: 48)
            Image(systemName: "location.fill")
              .font(.system(size: 20, weight: .bold))
              .foregroundStyle(Brand.accent)
          }
        }
      }
    }
    .padding(16)
  }
}

// MARK: - Pieces

private struct EtaBadge: View {
  let text: String?
  var body: some View {
    if let text {
      Text(text)
        .font(.system(size: 14, weight: .bold))
        .foregroundStyle(Brand.card)
        .lineLimit(1)
        .fixedSize()
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Capsule().fill(Brand.accent))
    }
  }
}

// Origin → destination route line, mimicking Uber's pickup/dropoff dots.
private struct RouteLine: View {
  let origin: String
  let destination: String
  let distance: String?

  var body: some View {
    HStack(spacing: 8) {
      VStack(spacing: 0) {
        Circle().stroke(Brand.accent, lineWidth: 2).frame(width: 9, height: 9)
        Rectangle().fill(Brand.accent.opacity(0.45)).frame(width: 2, height: 12)
        Circle().fill(Brand.accent).frame(width: 9, height: 9)
      }
      VStack(alignment: .leading, spacing: 6) {
        Text(origin)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(Brand.textSecondary)
          .lineLimit(1)
        HStack(spacing: 6) {
          Text(destination)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Brand.textPrimary)
            .lineLimit(1)
          if let distance {
            Text("· \(distance)")
              .font(.system(size: 12, weight: .medium))
              .foregroundStyle(Brand.accent)
          }
        }
      }
      Spacer(minLength: 0)
    }
  }
}

// MARK: - ETA split helper

private extension HitherGroupAttributes.ContentState {
  /// Splits the formatted ETA into a big number + small unit for the lock-screen
  /// hero block (e.g. "12" / "min").
  var etaText: (value: String, unit: String)? {
    guard let s = etaSeconds else { return nil }
    let minutes = Int((s / 60).rounded())
    if minutes < 1 { return (value: "<1", unit: "min") }
    if minutes < 60 { return (value: "\(minutes)", unit: "min") }
    let h = minutes / 60
    let m = minutes % 60
    return m == 0 ? (value: "\(h)", unit: "hr") : (value: "\(h):\(String(format: "%02d", m))", unit: "hr")
  }

  /// Compact ETA for the narrow Dynamic Island regions — no "about" prefix and
  /// collapses to hours so the trailing badge never truncates (e.g. "12 hr").
  var shortEta: String? {
    guard let s = etaSeconds else { return nil }
    let minutes = Int((s / 60).rounded())
    if minutes < 1 { return "now" }
    if minutes < 60 { return "\(minutes) min" }
    return "\(minutes / 60) hr"
  }
}
