import ActivityKit
import SwiftUI
import WidgetKit

// Live Activity UI: the lock-screen banner + Dynamic Island presentations for
// the group "heading to gathering point" journey. Data comes from
// `HitherGroupAttributes` (started/updated by the app's HitherLiveActivity
// module). Mirrors the in-app JourneyBanner so both views read alike.

@main
struct HitherWidgetBundle: WidgetBundle {
  var body: some Widget {
    HitherLiveActivityWidget()
  }
}

struct HitherLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: HitherGroupAttributes.self) { context in
      // Lock screen / banner.
      LockScreenView(context: context)
        .padding()
        .activityBackgroundTint(Color.black.opacity(0.6))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label("Hither", systemImage: "figure.walk")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        DynamicIslandExpandedRegion(.trailing) {
          if let distance = context.state.formattedDistance {
            Text(distance).font(.caption).bold()
          }
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.state.gatheringTitle ?? context.attributes.groupName)
            .font(.headline)
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          if let eta = context.state.formattedEta {
            Text(eta).font(.caption2).foregroundStyle(.secondary)
          }
        }
      } compactLeading: {
        Image(systemName: "figure.walk")
      } compactTrailing: {
        Text(context.state.formattedDistance ?? "")
          .font(.caption2)
      } minimal: {
        Image(systemName: "figure.walk")
      }
    }
  }
}

private struct LockScreenView: View {
  let context: ActivityViewContext<HitherGroupAttributes>

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: "location.fill")
        .foregroundStyle(.tint)
      VStack(alignment: .leading, spacing: 2) {
        Text("Heading to gathering point")
          .font(.caption2)
          .foregroundStyle(.secondary)
        Text(context.state.gatheringTitle ?? context.attributes.groupName)
          .font(.headline)
          .lineLimit(1)
      }
      Spacer()
      VStack(alignment: .trailing, spacing: 2) {
        if let distance = context.state.formattedDistance {
          Text(distance).font(.subheadline).bold()
        }
        if let eta = context.state.formattedEta {
          Text(eta).font(.caption2).foregroundStyle(.secondary)
        }
      }
    }
  }
}
