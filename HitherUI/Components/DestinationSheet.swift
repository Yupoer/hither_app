import SwiftUI

// Unified destination sheet that handles both compact and detailed views
// Replaces the old separate DestinationSheet and DestinationDetailsSheet components
struct DestinationSheet: View {
    let title: String
    let time: String
    let type: DestinationType
    let currentProgress: Int
    let totalSteps: Int
    
    init(
        title: String,
        time: String,
        type: DestinationType = .generic,
        currentProgress: Int = 0,
        totalSteps: Int = 3
    ) {
        self.title = title
        self.time = time
        self.type = type
        self.currentProgress = currentProgress
        self.totalSteps = totalSteps
    }
    
    var body: some View {
        VStack(spacing: HitherDesignSystem.Spacing.sm) {
            HStack(spacing: HitherDesignSystem.Spacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Next destination")
                        .font(HitherDesignSystem.Typography.caption1)
                        .foregroundColor(HitherDesignSystem.Colors.gray500)
                    
                    HStack(spacing: HitherDesignSystem.Spacing.xs) {
                        Image(systemName: type.icon)
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(type.color)
                        
                        Text(title)
                            .font(HitherDesignSystem.Typography.headline)
                            .foregroundColor(HitherDesignSystem.Colors.gray900)
                    }
                    
                    Text(time)
                        .font(HitherDesignSystem.Typography.callout)
                        .foregroundColor(HitherDesignSystem.Colors.gray500)
                }
                Spacer()
            }
            .padding(.horizontal, HitherDesignSystem.Spacing.lg)
            .padding(.top, HitherDesignSystem.Spacing.md)
            
            HStack(spacing: 4) {
                ForEach(0..<totalSteps, id: \.self) { index in
                    Circle()
                        .fill(index == currentProgress ? type.color : HitherDesignSystem.Colors.gray300)
                        .frame(width: 8, height: 8)
                }
            }
            .padding(.bottom, HitherDesignSystem.Spacing.md)
        }
        .background(Color.white)
        .cornerRadius(HitherDesignSystem.CornerRadius.large)
        .hitherShadow(HitherDesignSystem.Shadow.medium)
        .padding(.horizontal, HitherDesignSystem.Spacing.md)
        .padding(.bottom, HitherDesignSystem.Spacing.sm)
    }
}

#Preview("Destination Sheet - Default") {
    VStack(spacing: HitherDesignSystem.Spacing.lg) {
        DestinationSheet(
            title: "Golden Gate Bridge",
            time: "Arriving in 10 minutes",
            type: .generic
        )
        
        DestinationSheet(
            title: "Summit Lake",
            time: "Arriving in 25 minutes",
            type: .lake,
            currentProgress: 1
        )
        
        DestinationSheet(
            title: "Eagle Peak Trailhead",
            time: "Arriving in 45 minutes",
            type: .trailhead,
            currentProgress: 2
        )
    }
    .padding()
    .background(HitherDesignSystem.Colors.background)
}

#Preview("Destination Sheet - Custom Progress") {
    DestinationSheet(
        title: "Eagle Peak Summit",
        time: "Summit in 15 minutes",
        type: .summit,
        currentProgress: 1,
        totalSteps: 5
    )
    .padding()
    .background(HitherDesignSystem.Colors.background)
}