import SwiftUI

struct Destination: Identifiable {
    let id = UUID()
    let name: String
    let arrivalTime: String
    let type: DestinationType
    let label: String
}

struct MapView: View {
    @State private var searchText = ""
    
    let teamPins = [
        MapPin(avatar: "👨🏻‍💼", position: CGPoint(x: 120, y: 320)),
        MapPin(avatar: "👩🏼‍💼", position: CGPoint(x: 270, y: 250)),
        MapPin(avatar: "👨🏻‍🦲", position: CGPoint(x: 300, y: 540))
    ]
    
    let destinations = [
        Destination(name: "Golden Gate Bridge", arrivalTime: "Arriving in 10 minutes", type: .generic, label: "Next destination"),
        Destination(name: "Fisherman's Wharf", arrivalTime: "Arriving in 45 minutes", type: .generic, label: "Upcoming destination"),
        Destination(name: "Alcatraz Island", arrivalTime: "Arriving in 1.5 hours", type: .summit, label: "Final destination")
    ]
    
    var body: some View {
        VStack(spacing: 0) {
            // Map Content
            ZStack {
                // Map Background
                LinearGradient(
                    gradient: Gradient(colors: [
                        Color(red: 0.94, green: 0.94, blue: 0.96),
                        Color(red: 0.90, green: 0.90, blue: 0.92)
                    ]),
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
                
                // Map Grid Pattern (simulated)
                VStack(spacing: 20) {
                    ForEach(0..<15) { _ in
                        HStack(spacing: 20) {
                            ForEach(0..<10) { _ in
                                Circle()
                                    .fill(Color.white.opacity(0.3))
                                    .frame(width: 2, height: 2)
                            }
                        }
                    }
                }
                .opacity(0.4)
                
                // Search Bar
                VStack {
                    HStack {
                        HStack(spacing: HitherDesignSystem.Spacing.sm) {
                            Image(systemName: "magnifyingglass")
                                .foregroundColor(HitherDesignSystem.Colors.gray400)
                                .font(.system(size: 16))
                            
                            TextField("Search destinations", text: $searchText)
                                .font(HitherDesignSystem.Typography.body)
                        }
                        .padding(.horizontal, HitherDesignSystem.Spacing.md)
                        .padding(.vertical, HitherDesignSystem.Spacing.sm)
                        .background(Color.white)
                        .cornerRadius(HitherDesignSystem.CornerRadius.medium)
                        .hitherShadow(HitherDesignSystem.Shadow.small)
                        
                        Spacer()
                        
                        // Current Location Button
                        Button(action: {}) {
                            Image(systemName: "location.circle")
                                .font(.system(size: 20, weight: .medium))
                                .foregroundColor(HitherDesignSystem.Colors.gray600)
                                .frame(width: 40, height: 40)
                                .background(Color.white)
                                .cornerRadius(HitherDesignSystem.CornerRadius.medium)
                                .hitherShadow(HitherDesignSystem.Shadow.small)
                        }
                    }
                    .padding(.horizontal, HitherDesignSystem.Spacing.md)
                    .padding(.top, HitherDesignSystem.Spacing.md)
                    
                    Spacer()
                }
                
                // Team Member Pins
                ForEach(teamPins.indices, id: \.self) { index in
                    TeamPin(avatar: teamPins[index].avatar)
                        .position(teamPins[index].position)
                }
                
                // Location Pins - Fixed positioning to match reference
                // Red Location Pin
                Image(systemName: "mappin")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundColor(HitherDesignSystem.Colors.primary)
                    .position(CGPoint(x: 70, y: 180))
                
                // Restaurant Pin  
                VStack {
                    Image(systemName: "fork.knife")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)
                        .frame(width: 30, height: 30)
                        .background(HitherDesignSystem.Colors.primary)
                        .clipShape(Circle())
                    
                    Image(systemName: "arrowtriangle.down.fill")
                        .font(.system(size: 8))
                        .foregroundColor(HitherDesignSystem.Colors.primary)
                        .offset(y: -2)
                }
                .position(CGPoint(x: 320, y: 420))
                
                // Map placeholder (image placeholder) - Repositioned to match reference
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.white)
                    .frame(width: 120, height: 80)
                    .overlay(
                        VStack(spacing: 4) {
                            Image(systemName: "photo")
                                .font(.system(size: 20))
                                .foregroundColor(HitherDesignSystem.Colors.gray400)
                            
                            Text("Image")
                                .font(.caption)
                                .foregroundColor(HitherDesignSystem.Colors.gray400)
                        }
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(HitherDesignSystem.Colors.gray300, lineWidth: 1)
                    )
                    .position(CGPoint(x: 180, y: 400))
            }
            
            // Horizontal Scrolling Destination Cards
            HorizontalDestinationCards(destinations: destinations)
        }
        .background(HitherDesignSystem.Colors.background)
    }
}

struct MapPin {
    let avatar: String
    let position: CGPoint
}

struct TeamPin: View {
    let avatar: String
    
    var body: some View {
        ZStack {
            Circle()
                .fill(Color.white)
                .frame(width: 44, height: 44)
                .hitherShadow(HitherDesignSystem.Shadow.medium)
            
            Circle()
                .fill(HitherDesignSystem.Colors.gray100)
                .frame(width: 38, height: 38)
            
            Text(avatar)
                .font(.system(size: 18))
        }
    }
}

struct HorizontalDestinationCards: View {
    let destinations: [Destination]
    
    var body: some View {
        VStack(spacing: 0) {
            // Drag Handle
            RoundedRectangle(cornerRadius: 2)
                .fill(HitherDesignSystem.Colors.gray300)
                .frame(width: 36, height: 4)
                .padding(.top, HitherDesignSystem.Spacing.sm)
                .padding(.bottom, HitherDesignSystem.Spacing.xs)
            
            // Horizontal Scrolling Cards
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 16) {
                    ForEach(destinations) { destination in
                        HorizontalDestinationCard(destination: destination)
                            .frame(width: 350)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollIndicators(.hidden)
            .frame(height: 120)
            .padding(.horizontal, HitherDesignSystem.Spacing.md)
        }
        .background(Color.white)
        .clipShape(UnevenRoundedRectangle(cornerRadii: .init(
            topLeading: HitherDesignSystem.CornerRadius.large,
            topTrailing: HitherDesignSystem.CornerRadius.large
        )))
        .hitherShadow(HitherDesignSystem.Shadow.large)
    }
}

struct HorizontalDestinationCard: View {
    let destination: Destination
    
    var body: some View {
        VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.sm) {
            Text(destination.label)
                .font(HitherDesignSystem.Typography.title3)
                .foregroundColor(HitherDesignSystem.Colors.gray900)
            
            HStack(spacing: HitherDesignSystem.Spacing.md) {
                // Icon with background
                ZStack {
                    RoundedRectangle(cornerRadius: HitherDesignSystem.CornerRadius.medium)
                        .fill(destination.type.color.opacity(0.15))
                        .frame(width: 48, height: 48)
                    
                    Image(systemName: destination.type.icon)
                        .font(.system(size: 24, weight: .medium))
                        .foregroundColor(destination.type.color)
                }
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(destination.name)
                        .font(HitherDesignSystem.Typography.headline)
                        .foregroundColor(HitherDesignSystem.Colors.gray900)
                    
                    Text(destination.arrivalTime)
                        .font(HitherDesignSystem.Typography.callout)
                        .foregroundColor(HitherDesignSystem.Colors.gray500)
                }
                
                Spacer()
            }
        }
        .padding(HitherDesignSystem.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}



#Preview("Map View") {
    MapView()
}

#Preview("Team Pin") {
    HStack(spacing: 20) {
        TeamPin(avatar: "👨🏻‍💼")
        TeamPin(avatar: "👩🏼‍💼")
        TeamPin(avatar: "👨🏻‍🦲")
    }
    .padding()
    .background(HitherDesignSystem.Colors.background)
}