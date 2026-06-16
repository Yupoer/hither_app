import SwiftUI

struct ItineraryItem: Identifiable {
    let id = UUID()
    let title: String
    let time: String
    let description: String
    let type: DestinationType
}

struct ItineraryView: View {
    @State private var itineraryItems = [
        ItineraryItem(
            title: "Eagle Peak Trailhead",
            time: "9:00 AM",
            description: "Start of hike",
            type: .trailhead
        ),
        ItineraryItem(
            title: "Summit Lake",
            time: "1:30 PM", 
            description: "Lunch break",
            type: .lake
        ),
        ItineraryItem(
            title: "Eagle Peak Summit",
            time: "2:30 PM",
            description: "Destination",
            type: .summit
        )
    ]
    
    @State private var selectedItem: ItineraryItem?
    
    private func moveItem(from source: IndexSet, to destination: Int) {
        itineraryItems.move(fromOffsets: source, toOffset: destination)
    }
    
    private func deleteItem(at offsets: IndexSet) {
        itineraryItems.remove(atOffsets: offsets)
    }
    
    var body: some View {
        VStack(spacing: HitherDesignSystem.Spacing.lg) {
            CurrentDestinationCard()
                .padding(.horizontal, HitherDesignSystem.Spacing.lg)
            
            List {
                Section("Upcoming Destinations") {
                    ForEach(itineraryItems) { item in
                        ItineraryItemRow(item: item)
                            .onTapGesture { selectedItem = item }
                    }
                    .onMove(perform: moveItem)
                    .onDelete(perform: deleteItem)
                    
                    Button("Add Waypoint") {
                        // Placeholder action - non-functional as requested
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, HitherDesignSystem.Spacing.md)
                    .foregroundColor(HitherDesignSystem.Colors.gray500)
                    .font(HitherDesignSystem.Typography.headline)
                    .background(
                        RoundedRectangle(cornerRadius: HitherDesignSystem.CornerRadius.medium)
                            .strokeBorder(HitherDesignSystem.Colors.gray300, style: StrokeStyle(lineWidth: 1, dash: [5]))
                    )
                    .buttonStyle(PlainButtonStyle())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            }
            .listStyle(PlainListStyle())
        }
        .background(HitherDesignSystem.Colors.background)
        .sheet(item: $selectedItem) { item in
            UnifiedDestinationSheet(
                title: item.title,
                time: item.time,
                address: "\(item.title) Location",
                notes: item.description,
                type: item.type,
                mode: .details
            )
        }
    }
}

struct CurrentDestinationCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.sm) {
            Text("CURRENT DESTINATION")
                .font(HitherDesignSystem.Typography.caption1)
                .foregroundColor(Color(red: 0.8, green: 0.4, blue: 0.6))
                .fontWeight(.semibold)
            
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Ranger Station")
                        .font(HitherDesignSystem.Typography.title1)
                        .foregroundColor(Color(red: 0.8, green: 0.4, blue: 0.6))
                        .fontWeight(.bold)
                    
                    Text("8:00 AM - Meetup and briefing")
                        .font(HitherDesignSystem.Typography.body)
                        .foregroundColor(Color(red: 0.8, green: 0.4, blue: 0.6))
                }
                
                Spacer()
                
                Image(systemName: "chevron.right")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(Color(red: 0.8, green: 0.4, blue: 0.6))
            }
        }
        .padding(HitherDesignSystem.Spacing.lg)
        .background(
            LinearGradient(
                gradient: Gradient(colors: [
                    Color(red: 0.98, green: 0.92, blue: 0.95),
                    Color(red: 0.95, green: 0.88, blue: 0.92)
                ]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .cornerRadius(HitherDesignSystem.CornerRadius.large)
        .hitherShadow(HitherDesignSystem.Shadow.small)
    }
}

struct ItineraryItemRow: View {
    let item: ItineraryItem
    
    var body: some View {
        HStack(spacing: HitherDesignSystem.Spacing.md) {
            ZStack {
                Circle()
                    .fill(item.type.color.opacity(0.15))
                    .frame(width: 40, height: 40)
                
                Image(systemName: item.type.icon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(item.type.color)
            }
            
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(HitherDesignSystem.Typography.headline)
                    .foregroundColor(HitherDesignSystem.Colors.gray900)
                
                Text("\(item.time) - \(item.description)")
                    .font(HitherDesignSystem.Typography.callout)
                    .foregroundColor(HitherDesignSystem.Colors.gray500)
            }
            
            Spacer()
            
            // Drag hint icon
            Image(systemName: "line.3.horizontal")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(HitherDesignSystem.Colors.gray400)
        }
        .padding(HitherDesignSystem.Spacing.md)
        .background(Color.white)
        .cornerRadius(HitherDesignSystem.CornerRadius.medium)
        .hitherShadow(HitherDesignSystem.Shadow.small)
    }
}

enum SheetMode {
    case compact, details
}

struct UnifiedDestinationSheet: View {
    let title: String
    let time: String
    let address: String
    let notes: String
    let type: DestinationType
    let mode: SheetMode
    
    var body: some View {
        switch mode {
        case .compact:
            compactView
        case .details:
            detailsView
        }
    }
    
    private var compactView: some View {
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
            .padding(HitherDesignSystem.Spacing.md)
        }
        .background(Color.white)
        .cornerRadius(HitherDesignSystem.CornerRadius.large)
        .hitherShadow(HitherDesignSystem.Shadow.medium)
    }
    
    private var detailsView: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.lg) {
                    Text(title)
                        .font(HitherDesignSystem.Typography.largeTitle)
                        .foregroundColor(HitherDesignSystem.Colors.gray900)
                        .fontWeight(.bold)
                    
                    HStack(spacing: HitherDesignSystem.Spacing.sm) {
                        Image(systemName: "location")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(HitherDesignSystem.Colors.gray500)
                        
                        Text(address)
                            .font(HitherDesignSystem.Typography.body)
                            .foregroundColor(HitherDesignSystem.Colors.gray700)
                    }
                    
                    HStack(spacing: HitherDesignSystem.Spacing.sm) {
                        Image(systemName: "note.text")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(HitherDesignSystem.Colors.gray500)
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text(time)
                                .font(HitherDesignSystem.Typography.headline)
                                .foregroundColor(HitherDesignSystem.Colors.gray900)
                            
                            Text(notes)
                                .font(HitherDesignSystem.Typography.body)
                                .foregroundColor(HitherDesignSystem.Colors.gray700)
                        }
                    }
                    
                    Button("Get Directions") {
                        // Handle directions
                    }
                    .hitherPrimaryButton()
                    .padding(.top, HitherDesignSystem.Spacing.md)
                    
                    Spacer()
                }
                .padding(HitherDesignSystem.Spacing.lg)
            }
        }
        .presentationDetents([.medium, .large])
    }
}

#Preview("Itinerary View") {
    ItineraryView()
}