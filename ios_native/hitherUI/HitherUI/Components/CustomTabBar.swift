import SwiftUI

struct TabBarItem {
    let title: String
    let iconName: String
    let tag: Int
    
    static let defaultItems = [
        TabBarItem(title: "Dashboard", iconName: "square.grid.2x2", tag: 0),
        TabBarItem(title: "Map", iconName: "map", tag: 1), 
        TabBarItem(title: "Itinerary", iconName: "list.bullet.clipboard", tag: 2),
        TabBarItem(title: "Settings", iconName: "gearshape", tag: 3)
    ]
}

struct CustomTabBar: View {
    let items: [TabBarItem]
    @Binding var selectedTab: Int
    
    var body: some View {
        HStack(spacing: 0) {
            ForEach(items, id: \.tag) { item in
                TabBarButton(
                    item: item,
                    isSelected: selectedTab == item.tag
                ) {
                    selectedTab = item.tag
                }
                .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 49)
        .background(Color.white)
        .overlay(
            Rectangle()
                .frame(height: 0.5)
                .foregroundColor(HitherDesignSystem.Colors.gray200),
            alignment: .top
        )
    }
}

struct TabBarButton: View {
    let item: TabBarItem
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: item.iconName)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(isSelected ? HitherDesignSystem.Colors.primary : HitherDesignSystem.Colors.gray400)
                
                Text(item.title)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(isSelected ? HitherDesignSystem.Colors.primary : HitherDesignSystem.Colors.gray400)
            }
            .padding(.vertical, 6)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

struct TabBarContainer<Content: View>: View {
    let items: [TabBarItem]
    @State private var selectedTab = 0
    let content: (Int) -> Content
    
    init(items: [TabBarItem], @ViewBuilder content: @escaping (Int) -> Content) {
        self.items = items
        self.content = content
    }
    
    var body: some View {
        VStack(spacing: 0) {
            content(selectedTab)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            
            CustomTabBar(items: items, selectedTab: $selectedTab)
        }
    }
}

#Preview("Custom Tab Bar") {
    CustomTabBar(
        items: TabBarItem.defaultItems,
        selectedTab: .constant(0)
    )
}

#Preview("Tab Bar Container") {
    TabBarContainer(items: TabBarItem.defaultItems) { selectedTab in
        switch selectedTab {
        case 0:
            VStack {
                Spacer()
                Text("Dashboard View")
                    .font(.largeTitle)
                    .foregroundColor(HitherDesignSystem.Colors.primary)
                Spacer()
            }
            .background(HitherDesignSystem.Colors.background)
            
        case 1:
            VStack {
                Spacer()
                Text("Map View")
                    .font(.largeTitle)
                    .foregroundColor(HitherDesignSystem.Colors.blue)
                Spacer()
            }
            .background(HitherDesignSystem.Colors.background)
            
        case 2:
            VStack {
                Spacer()
                Text("Itinerary View")
                    .font(.largeTitle)
                    .foregroundColor(HitherDesignSystem.Colors.primary)
                Spacer()
            }
            .background(HitherDesignSystem.Colors.background)
            
        case 3:
            VStack {
                Spacer()
                Text("Settings View")
                    .font(.largeTitle)
                    .foregroundColor(HitherDesignSystem.Colors.primary)
                Spacer()
            }
            .background(HitherDesignSystem.Colors.background)
            
        default:
            EmptyView()
        }
    }
}