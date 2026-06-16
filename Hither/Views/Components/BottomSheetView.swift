//
//  BottomSheetView.swift
//  Hither
//
//  Draggable bottom sheet for displaying itinerary information
//

import SwiftUI

struct BottomSheetView<Content: View>: View {
    @State private var offset: CGFloat = 0
    @State private var lastOffset: CGFloat = 0
    @GestureState private var gestureOffset: CGFloat = 0
    @State private var isDragging: Bool = false
    
    let content: Content
    let collapsedHeight: CGFloat = 50
    let halfExpandedHeight: CGFloat = 160
    let onStateChange: ((Bool) -> Void)?
    
    private var isExpanded: Bool {
        offset <= -(halfExpandedHeight - collapsedHeight) / 2
    }
    
    private var currentHeight: CGFloat {
        return collapsedHeight - offset + gestureOffset
    }
    
    init(onStateChange: ((Bool) -> Void)? = nil, @ViewBuilder content: () -> Content) {
        self.content = content()
        self.onStateChange = onStateChange
    }
    
    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                // Grabber Handle with enhanced visual feedback
                RoundedRectangle(cornerRadius: 3)
                    .fill(isDragging ? Color.primary.opacity(0.8) : Color.secondary.opacity(0.6))
                    .frame(width: isDragging ? 42 : 36, height: 5)
                    .padding(.top, 8)
                    .padding(.bottom, 12)
                    .animation(.easeInOut(duration: 0.2), value: isDragging)
                
                // Content
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .frame(width: geometry.size.width, height: max(currentHeight, collapsedHeight))
            .background(Color(.systemBackground))
            .cornerRadius(16, corners: [.topLeft, .topRight])
            .shadow(color: Color.black.opacity(0.15), radius: 20, x: 0, y: -5)
            .offset(y: geometry.size.height - currentHeight)
            .gesture(
                DragGesture()
                    .updating($gestureOffset) { value, state, transaction in
                        state = value.translation.height
                        
                        // Update dragging state with animation
                        if !isDragging {
                            withAnimation(.easeInOut(duration: 0.1)) {
                                isDragging = true
                            }
                        }
                    }
                    .onEnded { value in
                        // Reset dragging state
                        withAnimation(.easeInOut(duration: 0.1)) {
                            isDragging = false
                        }
                        
                        let newOffset = lastOffset + value.translation.height
                        let velocity = value.predictedEndTranslation.height - value.translation.height
                        
                        let newSnappedOffset = snapToNearestPosition(offset: newOffset, velocity: velocity)
                        let wasExpanded = isExpanded
                        
                        // Use smoother spring animation
                        withAnimation(.interpolatingSpring(mass: 0.8, stiffness: 300, damping: 30, initialVelocity: velocity * 0.1)) {
                            offset = newSnappedOffset
                            lastOffset = newSnappedOffset
                        }
                        
                        // Animated state change notification for smooth UI transitions
                        let isNowExpanded = newSnappedOffset <= -(halfExpandedHeight - collapsedHeight) / 2
                        if wasExpanded != isNowExpanded {
                            withAnimation(.easeInOut(duration: 0.3)) {
                                onStateChange?(isNowExpanded)
                            }
                        }
                    }
            )
        }
        .onAppear {
            // Start in collapsed state
            offset = 0
            lastOffset = 0
        }
        .animation(.interpolatingSpring(mass: 0.8, stiffness: 300, damping: 30), value: offset)
    }
    
    private func snapToNearestPosition(offset: CGFloat, velocity: CGFloat) -> CGFloat {
        // Calculate target positions relative to collapsed state
        let collapsedOffset: CGFloat = 0
        let halfExpandedOffset = -(halfExpandedHeight - collapsedHeight)
        
        // Improved velocity thresholds for more responsive gestures
        let thresholdVelocity: CGFloat = 200
        
        if velocity < -thresholdVelocity {
            // Fast upward swipe - expand to half
            return halfExpandedOffset
        } else if velocity > thresholdVelocity {
            // Fast downward swipe - collapse
            return collapsedOffset
        } else {
            // Slow movement - snap to nearest with improved threshold
            let midPoint = halfExpandedOffset * 0.6  // Make expansion easier (60% threshold instead of 50%)
            if offset > midPoint {
                return collapsedOffset
            } else {
                return halfExpandedOffset
            }
        }
    }
}

extension View {
    func cornerRadius(_ radius: CGFloat, corners: UIRectCorner) -> some View {
        clipShape(RoundedCorner(radius: radius, corners: corners))
    }
}

struct RoundedCorner: Shape {
    var radius: CGFloat = .infinity
    var corners: UIRectCorner = .allCorners

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}