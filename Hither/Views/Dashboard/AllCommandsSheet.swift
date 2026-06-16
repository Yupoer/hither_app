//
//  AllCommandsSheet.swift
//  Hither
//
//  Created by Claude on 2025/8/5.
//

import SwiftUI

struct AllCommandsSheet: View {
    @EnvironmentObject private var authService: AuthenticationService
    @EnvironmentObject private var groupService: GroupService
    let commandService: CommandService
    
    // REMOVED: LiveActivityService - Live Activity functionality removed in Phase A2
    
    @Environment(\.presentationMode) var presentationMode
    @Environment(\.colorScheme) private var colorScheme
    
    @State private var isLoading = false
    @State private var lastCommandSent: CommandType?
    @State private var recentCommands: [CommandType] = []
    @State private var liveActivityCommands: [CommandType] = []
    @State private var isDragging = false
    @State private var draggedCommand: CommandType?
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Live Activity Commands Section
                VStack(spacing: 16) {
                    HStack {
                        Text("live_activity_commands".localized)
                            .font(.headline)
                            .fontWeight(.semibold)
                        Spacer()
                        Text("(拖曳兩個指令)".localized)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.horizontal)
                    
                    // Live Activity Commands Display
                    HStack(spacing: 12) {
                        ForEach(0..<2) { index in
                            if index < liveActivityCommands.count {
                                LiveActivityCommandSlot(
                                    command: liveActivityCommands[index],
                                    isLoading: isLoading && lastCommandSent == liveActivityCommands[index],
                                    onRemove: {
                                        removeLiveActivityCommand(at: index)
                                    },
                                    onSend: {
                                        Task {
                                            await sendCommand(liveActivityCommands[index])
                                        }
                                    }
                                )
                            } else {
                                EmptyLiveActivitySlot(slotNumber: index + 1)
                            }
                        }
                        Spacer()
                    }
                    .padding(.horizontal)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(DarkBlueTheme(isDark: colorScheme == .dark).card)
                            .stroke(DarkBlueTheme(isDark: colorScheme == .dark).border, lineWidth: 1)
                    )
                    .padding(.horizontal)
                    
                    Divider()
                        .padding(.vertical, 8)
                }
                
                // Recent Commands Section (if any)
                if !recentCommands.isEmpty {
                    VStack(spacing: 16) {
                        HStack {
                            Text("recent_commands".localized)
                                .font(.headline)
                                .fontWeight(.semibold)
                            Spacer()
                        }
                        .padding(.horizontal)
                        
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 12) {
                            ForEach(recentCommands.prefix(6), id: \.self) { command in
                                AllCommandsButton(
                                    command: command,
                                    isLoading: isLoading && lastCommandSent == command,
                                    action: {
                                        Task {
                                            await sendCommand(command)
                                        }
                                    }
                                )
                                .disabled(isLoading)
                            }
                        }
                        .padding(.horizontal)
                        
                        Divider()
                            .padding(.vertical, 8)
                    }
                }
                
                // All Commands Section
                ScrollView {
                    VStack(spacing: 16) {
                        HStack {
                            Text("all_commands".localized)
                                .font(.headline)
                                .fontWeight(.semibold)
                            Spacer()
                        }
                        .padding(.horizontal)
                        
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 12) {
                            ForEach(CommandType.leaderCommands, id: \.self) { command in
                                DraggableCommandButton(
                                    command: command,
                                    isLoading: isLoading && lastCommandSent == command,
                                    onTap: {
                                        Task {
                                            await sendCommand(command)
                                        }
                                    },
                                    onDrag: { command in
                                        addToLiveActivityCommands(command)
                                    }
                                )
                                .disabled(isLoading)
                            }
                        }
                        .padding(.horizontal)
                    }
                    .padding(.bottom, 20)
                }
            }
            .navigationTitle("commands".localized)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("done".localized) {
                        presentationMode.wrappedValue.dismiss()
                    }
                    .font(.body)
                    .fontWeight(.medium)
                    .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).primary)
                }
            }
        }
        .onAppear {
            loadRecentCommands()
            loadLiveActivityCommands()
        }
    }
    
    private func sendCommand(_ type: CommandType) async {
        guard let currentGroup = groupService.currentGroup,
              let currentUser = authService.currentUser else {
            return
        }
        
        isLoading = true
        lastCommandSent = type
        
        await commandService.sendQuickCommand(
            type: type,
            groupId: currentGroup.id,
            groupName: currentGroup.name,
            senderId: currentUser.id,
            senderName: currentUser.displayName
        )
        
        // Update recent commands
        updateRecentCommands(type)
        
        // Brief delay to show success feedback
        try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
        
        isLoading = false
        lastCommandSent = nil
    }
    
    private func loadRecentCommands() {
        // Load from UserDefaults or use empty array for now
        if let data = UserDefaults.standard.data(forKey: "recentCommands"),
           let commands = try? JSONDecoder().decode([CommandType].self, from: data) {
            recentCommands = commands
        }
    }
    
    private func updateRecentCommands(_ command: CommandType) {
        // Remove if already exists and add to front
        recentCommands.removeAll { $0 == command }
        recentCommands.insert(command, at: 0)
        
        // Keep only top 6 recent commands
        recentCommands = Array(recentCommands.prefix(6))
        
        // Save to UserDefaults
        if let data = try? JSONEncoder().encode(recentCommands) {
            UserDefaults.standard.set(data, forKey: "recentCommands")
        }
    }
    
    private func loadLiveActivityCommands() {
        // REMOVED: LiveActivityService.getCommands() - Live Activity functionality removed in Phase A2
        liveActivityCommands = [] // Empty array since Live Activities are disabled
    }
    
    private func saveLiveActivityCommands() {
        // REMOVED: LiveActivityService.saveCommands() and updateButtonConfiguration() - Live Activity functionality removed in Phase A2
        // No-op since Live Activities are disabled
    }
    
    private func addToLiveActivityCommands(_ command: CommandType) {
        // Don't add if already exists
        guard !liveActivityCommands.contains(command) else { return }
        
        // Add command to live activity commands
        if liveActivityCommands.count < 2 {
            liveActivityCommands.append(command)
            
            // Set button type to command when drag command is added
            updateButtonType(at: liveActivityCommands.count - 1, type: "command")
        } else {
            // Replace the first command if full
            liveActivityCommands[0] = liveActivityCommands[1]
            liveActivityCommands[1] = command
            
            // Ensure both are set to command type
            updateButtonType(at: 0, type: "command")
            updateButtonType(at: 1, type: "command")
        }
        
        saveLiveActivityCommands()
    }
    
    private func updateButtonType(at index: Int, type: String) {
        var buttonTypes = getButtonTypes()
        
        // Ensure array has enough elements
        while buttonTypes.count <= index {
            buttonTypes.append(index == 0 ? "command" : "more")
        }
        
        buttonTypes[index] = type
        saveButtonTypes(buttonTypes)
    }
    
    private func getButtonTypes() -> [String] {
        // REMOVED: LiveActivityService.getButtonTypes() - Live Activity functionality removed in Phase A2
        return ["command", "more"] // Default configuration (Live Activities disabled)
    }
    
    private func saveButtonTypes(_ types: [String]) {
        // REMOVED: LiveActivityService.saveButtonTypes() and updateButtonConfiguration() - Live Activity functionality removed in Phase A2
        // No-op since Live Activities are disabled
    }
    
    private func removeLiveActivityCommand(at index: Int) {
        guard index < liveActivityCommands.count else { return }
        liveActivityCommands.remove(at: index)
        
        // Reset button type to "more" when command is removed
        updateButtonType(at: index, type: "more")
        
        saveLiveActivityCommands()
    }
    
    // Note: updateLiveActivityButtons method removed - now using dedicated updateButtonConfiguration method
}

// MARK: - Live Activity Command Slot
struct LiveActivityCommandSlot: View {
    let command: CommandType
    let isLoading: Bool
    let onRemove: () -> Void
    let onSend: () -> Void
    
    @Environment(\.colorScheme) private var colorScheme
    
    var body: some View {
        VStack(spacing: 6) {
            HStack {
                Button(action: onSend) {
                    VStack(spacing: 4) {
                        Image(systemName: command.icon)
                            .font(.system(size: 20))
                            .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).primary)
                        
                        Text(command.displayName)
                            .font(.caption2)
                            .fontWeight(.medium)
                            .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).foreground)
                            .lineLimit(1)
                    }
                }
                .buttonStyle(PlainButtonStyle())
                
                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundColor(.red)
                }
                .buttonStyle(PlainButtonStyle())
            }
        }
        .frame(width: 80, height: 60)
        .background(DarkBlueTheme(isDark: colorScheme == .dark).muted.opacity(0.3))
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(DarkBlueTheme(isDark: colorScheme == .dark).primary, lineWidth: 1)
        )
    }
}

// MARK: - Empty Live Activity Slot
struct EmptyLiveActivitySlot: View {
    let slotNumber: Int
    
    @Environment(\.colorScheme) private var colorScheme
    
    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "plus.circle.dashed")
                .font(.system(size: 24))
                .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).mutedForeground)
            
            Text("按鈕 \(slotNumber)")
                .font(.caption2)
                .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).mutedForeground)
        }
        .frame(width: 80, height: 60)
        .background(DarkBlueTheme(isDark: colorScheme == .dark).muted.opacity(0.1))
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(DarkBlueTheme(isDark: colorScheme == .dark).border, lineWidth: 1)
        )
    }
}

// MARK: - Draggable Command Button
struct DraggableCommandButton: View {
    let command: CommandType
    let isLoading: Bool
    let onTap: () -> Void
    let onDrag: (CommandType) -> Void
    
    @Environment(\.colorScheme) private var colorScheme
    @State private var dragOffset = CGSize.zero
    
    var body: some View {
        VStack(spacing: 8) {
            if isLoading {
                ProgressView()
                    .scaleEffect(1.0)
                    .tint(DarkBlueTheme(isDark: colorScheme == .dark).primary)
            } else {
                Image(systemName: command.icon)
                    .font(.system(size: 28))
                    .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).primary)
            }
            
            Text(command.displayName)
                .font(.caption)
                .fontWeight(.medium)
                .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).foreground)
                .lineLimit(2)
                .multilineTextAlignment(.center)
        }
        .frame(height: 85)
        .frame(maxWidth: .infinity)
        .background(DarkBlueTheme(isDark: colorScheme == .dark).card)
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(
                    isLoading ? DarkBlueTheme(isDark: colorScheme == .dark).primary : DarkBlueTheme(isDark: colorScheme == .dark).border,
                    lineWidth: isLoading ? 2 : 1
                )
                .animation(.easeInOut(duration: 0.2), value: isLoading)
        )
        .scaleEffect(dragOffset == .zero ? 1.0 : 0.95)
        .offset(dragOffset)
        .onTapGesture {
            onTap()
        }
        .gesture(
            DragGesture()
                .onChanged { value in
                    dragOffset = value.translation
                }
                .onEnded { value in
                    withAnimation(.spring()) {
                        dragOffset = .zero
                    }
                    
                    // If dragged up significantly, add to Live Activity commands
                    if value.translation.height < -50 {
                        onDrag(command)
                        
                        // Show haptic feedback
                        let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                        impactFeedback.impactOccurred()
                    }
                }
        )
        .disabled(isLoading)
    }
}

struct AllCommandsButton: View {
    let command: CommandType
    let isLoading: Bool
    let action: () -> Void
    
    @Environment(\.colorScheme) private var colorScheme
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                if isLoading {
                    ProgressView()
                        .scaleEffect(1.0)
                        .tint(DarkBlueTheme(isDark: colorScheme == .dark).primary)
                } else {
                    Image(systemName: command.icon)
                        .font(.system(size: 28))
                        .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).primary)
                }
                
                Text(command.displayName)
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(DarkBlueTheme(isDark: colorScheme == .dark).foreground)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
            .frame(height: 85)
            .frame(maxWidth: .infinity)
            .background(DarkBlueTheme(isDark: colorScheme == .dark).card)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(
                        isLoading ? DarkBlueTheme(isDark: colorScheme == .dark).primary : DarkBlueTheme(isDark: colorScheme == .dark).border,
                        lineWidth: isLoading ? 2 : 1
                    )
                    .animation(.easeInOut(duration: 0.2), value: isLoading)
            )
        }
        .buttonStyle(PlainButtonStyle())
        .disabled(isLoading)
    }
}
