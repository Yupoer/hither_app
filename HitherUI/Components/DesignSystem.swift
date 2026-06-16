import SwiftUI

// Proper enum-based type system instead of string matching hack
enum DestinationType {
    case trailhead, lake, summit, generic
    
    var icon: String {
        switch self {
        case .trailhead: return "figure.hiking"
        case .lake: return "drop"
        case .summit: return "flag"
        case .generic: return "location"
        }
    }
    
    var color: Color {
        switch self {
        case .lake: return .blue
        default: return .pink
        }
    }
}

struct HitherDesignSystem {
    
    struct Colors {
        static let primary = Color(hex: "EA2A33")
        static let primaryDark = Color(hex: "D12129")
        
        static let gray50 = Color(hex: "F9FAFB")
        static let gray100 = Color(hex: "F3F4F6") 
        static let gray200 = Color(hex: "E5E7EB")
        static let gray300 = Color(hex: "D1D5DB")
        static let gray400 = Color(hex: "9CA3AF")
        static let gray500 = Color(hex: "6B7280")
        static let gray600 = Color(hex: "4B5563")
        static let gray700 = Color(hex: "374151")
        static let gray800 = Color(hex: "1F2937")
        static let gray900 = Color(hex: "111827")
        
        static let success = Color(hex: "10B981")
        static let warning = Color(hex: "F59E0B")
        static let error = Color(hex: "EF4444")
        static let info = Color(hex: "3B82F6")
        
        static let blue = Color(hex: "3B82F6")
        static let backgroundBlue = Color(hex: "EFF6FF")
        
        static let cardBackground = Color.white
        static let background = Color(hex: "F8FAFC")
        
        static let onlineGreen = Color(hex: "22C55E")
        static let offlineGray = Color(hex: "94A3B8")
    }
    
    struct Typography {
        static let largeTitle = Font.largeTitle.weight(.bold)
        static let title1 = Font.title.weight(.bold)
        static let title2 = Font.title2.weight(.semibold)
        static let title3 = Font.title3.weight(.medium)
        static let headline = Font.headline.weight(.semibold)
        static let body = Font.body
        static let callout = Font.callout
        static let subheadline = Font.subheadline
        static let footnote = Font.footnote
        static let caption1 = Font.caption
        static let caption2 = Font.caption2
    }
    
    struct Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 32
        static let xxl: CGFloat = 48
    }
    
    struct CornerRadius {
        static let small: CGFloat = 8
        static let medium: CGFloat = 12
        static let large: CGFloat = 16
        static let extraLarge: CGFloat = 24
        static let circle: CGFloat = 50
    }
    
    struct Shadow {
        static let small = HitherShadow(
            color: Color.black.opacity(0.1),
            radius: 4,
            x: 0,
            y: 2
        )
        
        static let medium = HitherShadow(
            color: Color.black.opacity(0.15),
            radius: 8,
            x: 0,
            y: 4
        )
        
        static let large = HitherShadow(
            color: Color.black.opacity(0.2),
            radius: 16,
            x: 0,
            y: 8
        )
    }
}

struct HitherShadow {
    let color: Color
    let radius: CGFloat
    let x: CGFloat
    let y: CGFloat
}

// Color extension for hex support
extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }

        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue:  Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// View modifiers
extension View {
    func hitherPrimaryButton() -> some View {
        self
            .foregroundColor(.white)
            .padding(.vertical, HitherDesignSystem.Spacing.md)
            .padding(.horizontal, HitherDesignSystem.Spacing.lg)
            .background(HitherDesignSystem.Colors.primary)
            .cornerRadius(HitherDesignSystem.CornerRadius.medium)
            .font(HitherDesignSystem.Typography.headline)
    }
    
    func hitherSecondaryButton() -> some View {
        self
            .foregroundColor(HitherDesignSystem.Colors.gray700)
            .padding(.vertical, HitherDesignSystem.Spacing.md)
            .padding(.horizontal, HitherDesignSystem.Spacing.lg)
            .background(Color.white)
            .overlay(
                RoundedRectangle(cornerRadius: HitherDesignSystem.CornerRadius.medium)
                    .stroke(HitherDesignSystem.Colors.gray300, lineWidth: 1)
            )
            .cornerRadius(HitherDesignSystem.CornerRadius.medium)
            .font(HitherDesignSystem.Typography.headline)
    }
    
    func hitherCard() -> some View {
        self
            .background(HitherDesignSystem.Colors.cardBackground)
            .cornerRadius(HitherDesignSystem.CornerRadius.large)
            .shadow(
                color: HitherDesignSystem.Shadow.small.color,
                radius: HitherDesignSystem.Shadow.small.radius,
                x: HitherDesignSystem.Shadow.small.x,
                y: HitherDesignSystem.Shadow.small.y
            )
    }
    
    func hitherShadow(_ shadow: HitherShadow = HitherDesignSystem.Shadow.small) -> some View {
        self.shadow(
            color: shadow.color,
            radius: shadow.radius,
            x: shadow.x,
            y: shadow.y
        )
    }
}