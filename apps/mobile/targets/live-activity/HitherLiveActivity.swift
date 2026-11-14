import ActivityKit
import CoreText
import SwiftUI
import WidgetKit

private typealias Presentation = HitherGroupAttributes.ContentState.Presentation
private typealias Face = HitherGroupAttributes.ContentState.Face

@main
struct HitherWidgetBundle: WidgetBundle {
  var body: some Widget {
    HitherLiveActivityWidget()
  }
}

struct HitherLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: HitherGroupAttributes.self) { context in
      let presentation = context.state.presentation(groupName: context.attributes.groupName)
      LiveActivityCard(presentation: presentation, expanded: false)
        .widgetURL(presentation.url)
    } dynamicIsland: { context in
      let presentation = context.state.presentation(groupName: context.attributes.groupName)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.bottom) {
          LiveActivityCard(presentation: presentation, expanded: true)
        }
      } compactLeading: {
        StopBadge(presentation: presentation, size: 24, showsCheck: !presentation.isTraveling)
      } compactTrailing: {
        if presentation.phase == .allArrived {
          Image(systemName: "checkmark")
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(presentation.displayColor(light: false))
        } else {
          Text(presentation.compactLabel)
            .font(ActivityTypography.number(20))
            .foregroundStyle(presentation.displayColor(light: false))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        }
      } minimal: {
        MinimalActivity(presentation: presentation)
      }
      .keylineTint(presentation.accent)
      .widgetURL(presentation.url)
    }
  }
}

private struct LiveActivityCard: View {
  let presentation: Presentation
  var expanded: Bool
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.isLuminanceReduced) private var reducedLuminance

  var body: some View {
    let light = !expanded && colorScheme == .light
    let color = presentation.displayColor(light: light)
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        if expanded {
          StopBadge(presentation: presentation, size: 24, showsCheck: !presentation.isTraveling)
        } else {
          Image(systemName: "mappin.circle.fill")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: 20, height: 20)
            .accessibilityHidden(true)
        }
        Text(presentation.title)
          .font(.system(size: 17, weight: .bold))
          .lineLimit(1)
          .frame(maxWidth: .infinity, alignment: .leading)
        Headline(presentation: presentation, color: color)
      }
      switch presentation.phase {
      case .enRoute, .late:
        HStack(spacing: 12) {
          RouteTrack(presentation: presentation, outline: light ? .white : .black)
          if let meetTime = presentation.meetTime {
            Label {
              Text(meetTime, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
            } icon: {
              Image(systemName: "clock")
                .accessibilityHidden(true)
            }
            .labelStyle(.titleAndIcon)
            .foregroundStyle(color)
          } else {
            Text(presentation.countLabel)
              .foregroundStyle(.secondary)
          }
        }
        .font(.system(size: 15, weight: .bold).monospacedDigit())
        .lineLimit(1)
      case .arrivedWaiting:
        HStack(spacing: 6) {
          ForEach(Array(presentation.memberFaces.enumerated()), id: \.offset) { _, face in
            AvatarBadge(face: face, size: 26)
              .overlay(Circle().strokeBorder(face.arrived ? presentation.accent : .clear, lineWidth: 2))
              .opacity(face.arrived ? 1 : reducedLuminance ? 0.55 : 0.30)
          }
        }
      case .allArrived:
        EmptyView()
      }
    }
    .foregroundStyle(expanded ? Color.white : Color.primary)
    .padding(.horizontal, expanded ? 4 : 16)
    .padding(.vertical, expanded ? 2 : 14)
    .frame(maxWidth: .infinity, minHeight: expanded ? nil : 84)
    .accessibilityElement(children: .combine)
  }
}

private struct Headline: View {
  let presentation: Presentation
  let color: Color

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 2) {
      switch presentation.phase {
      case .enRoute, .late:
        if let minutes = presentation.etaMinutes {
          Text(minutes.formatted())
            .font(ActivityTypography.number(40))
          Text(presentation.etaUnit)
            .font(.system(size: 15, weight: .bold))
        } else {
          Text("–").font(ActivityTypography.number(40))
        }
      case .arrivedWaiting:
        Text(presentation.countLabel).font(ActivityTypography.number(40))
      case .allArrived:
        Image(systemName: "checkmark")
          .font(.system(size: 29, weight: .semibold))
          .accessibilityLabel(Text(presentation.english ? "Everyone arrived" : "全員到齊"))
      }
    }
    .foregroundStyle(color)
    .lineLimit(1)
    .minimumScaleFactor(0.65)
    .layoutPriority(1)
  }
}

private struct RouteTrack: View {
  let presentation: Presentation
  let outline: Color
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    GeometryReader { geometry in
      let first: CGFloat = 12
      let last = max(first, geometry.size.width - 13)
      let length = last - first
      let avatarX = first + length * presentation.progress
      ZStack(alignment: .leading) {
        Capsule()
          .fill(Color.gray.opacity(0.32))
          .frame(width: length, height: 4)
          .offset(x: first)
        Capsule()
          .fill(presentation.accent)
          .frame(width: length * presentation.progress, height: 4)
          .offset(x: first)
        AvatarBadge(face: presentation.selfFace, size: 24)
          .background(Circle().stroke(outline, lineWidth: 4))
          .position(x: avatarX, y: 13)
        StopBadge(presentation: presentation, size: 26)
          .position(x: last, y: 13)
      }
      .animation(reduceMotion ? nil : .easeInOut(duration: 0.6), value: presentation.progress)
    }
    .frame(height: 26)
    .accessibilityLabel(Text(presentation.english ? "Route progress" : "路程進度"))
    .accessibilityValue(Text(presentation.progress.formatted(.percent.precision(.fractionLength(0)))))
  }
}

private struct StopBadge: View {
  let presentation: Presentation
  let size: CGFloat
  var showsCheck = false

  var body: some View {
    ZStack {
      Circle().fill(Color(hex: presentation.dayColorHex) ?? Color(rgb: 0xA35FC9))
      if showsCheck {
        Image(systemName: "checkmark")
          .font(.system(size: 13, weight: .bold))
          .foregroundStyle(.white)
      } else {
        Text(presentation.icon)
          .font(.system(size: 13))
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

private struct AvatarBadge: View {
  let face: Face?
  let size: CGFloat

  var body: some View {
    ZStack {
      Circle().fill(Color(hex: face?.colorHex) ?? Color(rgb: 0xDCE5EF))
      if let emoji = face?.emoji, !emoji.isEmpty {
        Text(emoji).font(.system(size: size == 24 ? 14 : 15))
      } else {
        Image(systemName: "person.fill")
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(Color(rgb: 0x34445A))
      }
    }
    .frame(width: size, height: size)
  }
}

private struct MinimalActivity: View {
  let presentation: Presentation

  var body: some View {
    GeometryReader { geometry in
      let size = min(37, geometry.size.width, geometry.size.height)
      let narrow = size < 32
      let label = presentation.phase == .arrivedWaiting
        ? narrow ? presentation.arrived.formatted() : presentation.countLabel
        : presentation.etaMinutes?.formatted() ?? "–"
      let progress = presentation.phase == .allArrived ? 1
        : presentation.isTraveling ? presentation.progress : presentation.arrivalRatio
      ZStack {
        Circle().strokeBorder(.white.opacity(0.18), lineWidth: 3)
        Circle()
          .inset(by: 1.5)
          .trim(from: 0, to: progress)
          .stroke(presentation.displayColor(light: false), style: StrokeStyle(lineWidth: 3, lineCap: .round))
          .rotationEffect(.degrees(-90))
        if presentation.phase == .allArrived {
          Image(systemName: "checkmark")
            .font(.system(size: narrow ? 11 : 14, weight: .bold))
        } else {
          Text(label)
            .font(ActivityTypography.number(narrow ? 11 : 14))
            .lineLimit(1)
            .minimumScaleFactor(0.55)
            .padding(.horizontal, 5)
        }
      }
      .foregroundStyle(.white)
      .frame(width: size, height: size)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .frame(idealWidth: 37, idealHeight: 37)
  }
}

private enum ActivityTypography {
  private static let numberFont: String? = {
    guard let url = Bundle.main.url(forResource: "BarlowCondensed-ExtraBoldItalic", withExtension: "ttf") else {
      return nil
    }
    CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    return "BarlowCondensed-ExtraBoldItalic"
  }()

  static func number(_ size: CGFloat) -> Font {
    if let numberFont { return .custom(numberFont, size: size, relativeTo: .title) }
    return .system(size: size, weight: .heavy).width(.condensed).italic()
  }
}

private extension Presentation {
  var accent: Color { Color(hex: accentHex) ?? Color(rgb: 0x4C6FFF) }
  var compactLabel: String {
    if phase == .arrivedWaiting { return countLabel }
    guard let minutes = etaMinutes else { return "–" }
    return "\(minutes)\(english ? "m" : "分")"
  }
  var url: URL? {
    URL(string: phase == .arrivedWaiting ? "hither://live-activity/team" : "hither://live-activity/journey")
  }

  func displayColor(light: Bool) -> Color {
    if phase == .late { return Color(rgb: light ? 0xC26A00 : 0xFF9F0A) }
    if light { return Color(hex: accentHex, brightness: 0.82) ?? Color(rgb: 0x3E5BD1) }
    return accent
  }
}

private extension Color {
  init(rgb: UInt64, brightness: Double = 1) {
    self.init(
      red: Double((rgb >> 16) & 0xFF) / 255 * brightness,
      green: Double((rgb >> 8) & 0xFF) / 255 * brightness,
      blue: Double(rgb & 0xFF) / 255 * brightness
    )
  }

  init?(hex: String?, brightness: Double = 1) {
    guard let raw = hex else { return nil }
    let value = raw.hasPrefix("#") ? String(raw.dropFirst()) : raw
    guard value.count == 6, let rgb = UInt64(value, radix: 16) else { return nil }
    self.init(rgb: rgb, brightness: brightness)
  }
}
