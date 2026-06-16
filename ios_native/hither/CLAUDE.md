# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rule
📋 STEP 1: READ REQUIREMENTS
Claude, read the rules in u/CLAUDE.md, then use MCP tool sequential thinking and proceed to the next step.
STOP. Before reading further, confirm you understand:
1. This is a code reuse and consolidation project
2. Creating new files requires exhaustive justification  
3. Every suggestion must reference existing code
4. Violations of these rules make your response invalid

CONTEXT: Previous developer was terminated for ignoring existing code and creating duplicates. You must prove you can work within existing architecture.

MANDATORY PROCESS:
1. Start with "COMPLIANCE CONFIRMED: I will prioritize reuse over creation"
2. Analyze existing code BEFORE suggesting anything new
3. Reference specific files from the provided analysis
4. Include validation checkpoints throughout your response
5. End with compliance confirmation

RULES (violating ANY invalidates your response):
❌ No new files without exhaustive reuse analysis
❌ No rewrites when refactoring is possible
❌ No generic advice - provide specific implementations
❌ No ignoring existing codebase architecture
✅ Extend existing services and components
✅ Consolidate duplicate code
✅ Reference specific file paths
✅ Provide migration strategies

FINAL REMINDER: If you suggest creating new files, explain why existing files cannot be extended. If you recommend rewrites, justify why refactoring won't work.
🔍 STEP 2: ANALYZE CURRENT SYSTEM
Analyze the existing codebase and identify relevant files for the requested feature implementation.
Then proceed to Step 3.
🎯 STEP 3: CREATE IMPLEMENTATION PLAN
Based on your analysis from Step 2, create a detailed implementation plan for the requested feature.
Then proceed to Step 4.
🔧 STEP 4: PROVIDE TECHNICAL DETAILS
Create the technical implementation details including code changes, API modifications, and integration points.
Then proceed to Step 5.
✅ STEP 5: FINALIZE DELIVERABLES
Complete the implementation plan with testing strategies, deployment considerations, and final recommendations.
🎯 INSTRUCTIONS
Follow each step sequentially. Complete one step before moving to the next. Use the findings from each previous step to inform the next step.

## Project Overview

Hither is an iOS app for group movement management during activities like hiking, touring, and family outings. It solves the problem of leaders losing track of group members and inefficient communication during group activities. The app provides real-time location tracking, directional guidance, and group communication features to help leaders manage groups safely and efficiently.

### Target Users
- Professional tour leaders/guides managing large groups
- Family trip organizers keeping elderly and children together
- Outdoor activity enthusiasts leading hiking/cycling groups
- School field trip/company outing coordinators

### Success Metrics (from PRD)
- 10,000 Monthly Active Users (MAU)
- 5,000+ groups created within 6 months
- 80% of active groups use core features weekly
- 4.5+ App Store rating
- 40% next-month retention rate

## Tech Stack

- **iOS:** SwiftUI app targeting iOS with Xcode project structure
- **Backend:** Firebase (Authentication, Firestore, Cloud Messaging)
- **Core Frameworks:**
  - CoreLocation: GPS positioning and distance calculations
  - MapKit: Map display and route visualization  
  - NearbyInteraction: UWB-based precision finding for close-range guidance
  - ActivityKit: Lock screen Live Activities for distance display
  - UserNotifications: Push notifications for commands and alerts

## Development Commands

### Building and Testing
```bash
# Build the project
xcodebuild -project Hither.xcodeproj -scheme Hither build

# Run tests
xcodebuild -project Hither.xcodeproj -scheme Hither test

# Run UI tests
xcodebuild -project Hither.xcodeproj -scheme Hither -destination 'platform=iOS Simulator,name=iPhone 15' test
```

**IMPORTANT:** Always compile to make sure it can work before finishing any task.

### Opening in Xcode
```bash
open Hither.xcodeproj
```

## Architecture

### MVP Core Features (from PRD)

#### 📍 Real-time Location Module
- **Map View (MapKit):** Real-time location display of all members with role-based icons (crown for Leader, dots for Followers)
- **Location Updates:** Background GPS tracking every 30-60 seconds, synced via Firestore with battery optimization when stationary
- Standard/satellite/hybrid map modes

#### 🧭 Directional Awareness Module  
- **Compass Mode:** Large arrow always pointing toward leader with distance display
- **Precision Finding (NearbyInteraction):** UWB-based precise guidance for <50m range on supported devices (similar to AirTag experience)

#### 📣 Broadcast Command Module
- **Quick Commands:** Preset buttons for "Gather," "Depart," "Rest," "Be careful," directional commands
- **Custom Messages:** Text/voice messages sent to entire group via FCM push notifications

#### ⛳ Itinerary Adjustment Module
- **Itinerary Points:** Leader sets key points (meeting spot, lunch, destination) marked on all maps
- **Real-time Adjustments:** Add/delete/move points with instant Firestore sync and push notifications

#### Group Management
- **Authentication:** Apple ID, Google, or email login via Firebase Auth
- **Group Creation:** Leader creates group, generates time-limited invitation links/QR codes
- **Member Roles:** Leader (crown icon) vs Followers (dot icons) with different UI capabilities

### Post-MVP Features (from PRD)
- **Follower Request System:** "Request a break," "Request to add stop," etc. with approval workflow
- **Leader Decision System:** Review interface with approve/decline for follower requests

### Key Design Patterns
- SwiftUI declarative UI with real-time Firestore listeners
- Background location updates with battery optimization based on movement  
- Role-based UI (Leader vs Follower interfaces with different capabilities)
- Real-time synchronization using Firestore observers
- Push notification integration for group communication

### Design Principles (from PRD)
- **Ease of Use First:** Intuitive for all ages, especially seniors
- **Information Clarity:** Most important info (direction, distance, commands) prominently displayed
- **Battery Optimization:** Minimize power drain during extended outdoor use
- **Status Transparency:** Clear connection status and location accuracy indicators

### Current State
- **FULLY IMPLEMENTED** - All PRD features completed and functional
- Complete SwiftUI app with Firebase integration
- All MVP and core features implemented according to PRD specifications
- Role-based interfaces for Leaders and Followers
- Real-time synchronization via Firestore
- ActivityKit Live Activities and push notifications integrated
- Battery optimization and comprehensive error handling implemented

### Implementation Status
✅ **Group Management** - Firebase Auth, group creation, invitations, QR codes
✅ **Real-time Location** - CoreLocation, MapKit, Firestore sync, battery optimization  
✅ **Directional Awareness** - Compass mode, NearbyInteraction, precision finding
✅ **Broadcast Commands** - Quick commands, custom messages, real-time notifications
✅ **Itinerary Management** - Waypoints, real-time sync, leader/follower workflows
✅ **Role-based UI/UX** - Leader vs Follower interfaces, visual indicators
✅ **ActivityKit Integration** - Lock Screen Live Activities, Dynamic Island
✅ **Push Notifications** - Categories, actions, permission handling
✅ **Battery Optimization** - Adaptive location tracking, low battery alerts
✅ **Error Handling** - Comprehensive error states, retry mechanisms, status indicators

### Key User Scenarios (from PRD)
1. **Hiking:** Leader monitors member positions on trail, sends rest commands, handles weather changes
2. **Theme Park:** Family splits up, uses precision finding to reunite, manages stop requests with approval workflow

## Firebase Dependencies
The project uses Firebase Swift Package Manager dependencies:
- FirebaseCore
- FirebaseAuth  
- FirebaseFirestore

Location of Firebase config: `Hither/GoogleService-Info.plist`

## Git Commit Guidelines

**IMPORTANT:** When making commits, do NOT include any of the following in commit messages:
- "Generated with Claude"
- "Co-authored-by: Claude"
- Any reference to AI assistance or code generation
- Generic AI-generated footers or signatures

Keep commit messages concise, descriptive, and focused on the actual changes made.

## DarkBlue Theme System

The app uses a comprehensive theme system called **DarkBlue** that provides consistent design tokens across all UI components.

### Location
- **File:** `Hither/Views/Components/DarkBlueThemeSystem.swift`
- **Type:** OKLCH color space-based theme system

### Components Available
- **DarkBlueCard:** Themed card container with proper shadows and borders
- **DarkBlueButton:** Primary button component with variants (primary, secondary, accent, muted)
- **DarkBlueSectionHeader:** Themed section headers with gradient text
- **DarkBlueTextField:** Input fields with proper theming
- **DarkBlueToggle:** Toggle switches with theme colors
- **DarkBlueStandardButton:** Standard buttons with theme colors

### Usage
```swift
// Card usage
.darkBlueCard(cornerRadius: 16)

// Button usage
DarkBlueButton(variant: .primary, action: { }) {
    Text("Button Text")
}

// Text field usage
DarkBlueTextField(
    placeholder: "Enter text",
    text: $textBinding,
    icon: "textformat",
    iconColor: .blue
)
```

### Color System
The theme uses OKLCH color space for better color accuracy and supports both light and dark modes automatically. Colors are calculated based on CSS design tokens converted to Swift.

### Complete CSS Variables
```css
:root {
  --background: oklch(0.9842 0.0034 247.8575);
  --foreground: oklch(0.1363 0.0364 259.2010);
  --card: oklch(1.0000 0 0);
  --card-foreground: oklch(0.1363 0.0364 259.2010);
  --popover: oklch(1.0000 0 0);
  --popover-foreground: oklch(0.1363 0.0364 259.2010);
  --primary: oklch(0.5461 0.2152 262.8809);
  --primary-foreground: oklch(1.0000 0 0);
  --secondary: oklch(0.9683 0.0069 247.8956);
  --secondary-foreground: oklch(0.2077 0.0398 265.7549);
  --muted: oklch(0.9683 0.0069 247.8956);
  --muted-foreground: oklch(0.5544 0.0407 257.4166);
  --accent: oklch(0.9705 0.0142 254.6042);
  --accent-foreground: oklch(0.3791 0.1378 265.5222);
  --destructive: oklch(0.6368 0.2078 25.3313);
  --destructive-foreground: oklch(1.0000 0 0);
  --border: oklch(0.9288 0.0126 255.5078);
  --input: oklch(0.9288 0.0126 255.5078);
  --ring: oklch(0.5461 0.2152 262.8809);
  --sidebar: oklch(1.0000 0 0);
  --sidebar-foreground: oklch(0.3717 0.0392 257.2870);
  --sidebar-primary: oklch(0.5461 0.2152 262.8809);
  --sidebar-primary-foreground: oklch(1.0000 0 0);
  --sidebar-accent: oklch(0.9705 0.0142 254.6042);
  --sidebar-accent-foreground: oklch(0.3791 0.1378 265.5222);
  --sidebar-border: oklch(0.9288 0.0126 255.5078);
  --sidebar-ring: oklch(0.5461 0.2152 262.8809);
  --radius: 0.75rem;
  --shadow: 0px 8px 24px -8px hsl(215.0000 20.2247% 65.0980% / 0.10);
}

.dark {
  --background: oklch(0.1363 0.0364 259.2010);
  --foreground: oklch(0.9842 0.0034 247.8575);
  --card: oklch(0.2077 0.0398 265.7549);
  --card-foreground: oklch(0.9842 0.0034 247.8575);
  --popover: oklch(0.1363 0.0364 259.2010);
  --popover-foreground: oklch(0.9842 0.0034 247.8575);
  --primary: oklch(0.6231 0.1880 259.8145);
  --primary-foreground: oklch(1.0000 0 0);
  --secondary: oklch(0.2795 0.0368 260.0310);
  --secondary-foreground: oklch(0.9288 0.0126 255.5078);
  --muted: oklch(0.2795 0.0368 260.0310);
  --muted-foreground: oklch(0.7107 0.0351 256.7878);
  --accent: oklch(0.2823 0.0874 267.9352);
  --accent-foreground: oklch(0.9288 0.0126 255.5078);
  --destructive: oklch(0.3958 0.1331 25.7230);
  --destructive-foreground: oklch(0.9842 0.0034 247.8575);
  --border: oklch(0.2795 0.0368 260.0310);
  --input: oklch(0.2795 0.0368 260.0310);
  --ring: oklch(0.6231 0.1880 259.8145);
  --sidebar: oklch(0.2077 0.0398 265.7549);
  --sidebar-foreground: oklch(0.9288 0.0126 255.5078);
  --sidebar-primary: oklch(0.6231 0.1880 259.8145);
  --sidebar-primary-foreground: oklch(1.0000 0 0);
  --sidebar-accent: oklch(0.2823 0.0874 267.9352);
  --sidebar-accent-foreground: oklch(0.9288 0.0126 255.5078);
  --sidebar-border: oklch(0.2795 0.0368 260.0310);
  --sidebar-ring: oklch(0.6231 0.1880 259.8145);
  --shadow: 0px 8px 24px -8px hsl(0 0% 0% / 0.25);
}
```

### Design Principles
- Automatic dark/light mode adaptation
- OKLCH color space for perceptual uniformity
- Consistent corner radius (12px default)
- Proper shadow and border treatments
- Accessible color contrasts
- Complete destructive color support
- Sidebar theming for navigation components

## Google Maps Integration

### API Configuration
- **API Key:** `AIzaSyCx0cyeUy7O4HEdZcGSlElYJibPVT5ciZQ`
- **Allowed APIs:**
  - Routes API
  - Places API (New)
  - Maps SDK for iOS

### Implementation Requirements
When implementing Google Maps to replace Apple MapKit:
1. Use Google Maps SDK for iOS for map display
2. Use Google Places API for location search and autocomplete
3. Use Google Routes API for navigation and route calculation
4. Maintain existing functionality while leveraging Google's services
5. Implement search bar with Google Places autocomplete on map page

### Security Note
The API key is restricted to only the specified APIs for security. Do not attempt to use other Google Maps APIs with this key.

## Complete Dark Theme CSS Variables

The DarkBlue theme includes comprehensive dark mode support with the following complete CSS variable set:

```css
.dark {
  --background: oklch(0.1363 0.0364 259.2010);
  --foreground: oklch(0.9842 0.0034 247.8575);
  --card: oklch(0.2077 0.0398 265.7549);
  --card-foreground: oklch(0.9842 0.0034 247.8575);
  --popover: oklch(0.1363 0.0364 259.2010);
  --popover-foreground: oklch(0.9842 0.0034 247.8575);
  --primary: oklch(0.6231 0.1880 259.8145);
  --primary-foreground: oklch(1.0000 0 0);
  --secondary: oklch(0.2795 0.0368 260.0310);
  --secondary-foreground: oklch(0.9288 0.0126 255.5078);
  --muted: oklch(0.2795 0.0368 260.0310);
  --muted-foreground: oklch(0.7107 0.0351 256.7878);
  --accent: oklch(0.2823 0.0874 267.9352);
  --accent-foreground: oklch(0.9288 0.0126 255.5078);
  --destructive: oklch(0.3958 0.1331 25.7230);
  --destructive-foreground: oklch(0.9842 0.0034 247.8575);
  --border: oklch(0.2795 0.0368 260.0310);
  --input: oklch(0.2795 0.0368 260.0310);
  --ring: oklch(0.6231 0.1880 259.8145);
  --sidebar: oklch(0.1363 0.0364 259.2010);
  --sidebar-foreground: oklch(0.7107 0.0351 256.7878);
  --sidebar-primary: oklch(0.6231 0.1880 259.8145);
  --sidebar-primary-foreground: oklch(1.0000 0 0);
  --sidebar-accent: oklch(0.2823 0.0874 267.9352);
  --sidebar-accent-foreground: oklch(0.9288 0.0126 255.5078);
  --sidebar-border: oklch(0.2795 0.0368 260.0310);
}
```

### Theme Implementation Status
- ✅ DarkBlueThemeSystem.swift - Complete theme system with OKLCH color support
- ✅ All UI components migrated from LiquidGlass to DarkBlue
- ✅ Button variants: primary, secondary, accent, muted, destructive
- ✅ Card components with shadows and border styling
- ✅ Text field components with theme-aware colors
- ✅ Toggle components with theme-aware accent colors
- ✅ Automatic light/dark mode detection and switching

### Current Implementation Files
- `Hither/Views/Components/DarkBlueThemeSystem.swift` - Main theme system
- `Hither/Views/Map/MapView.swift` - Updated to use Google Maps Native SDK
- `Hither/Views/Map/GoogleMapsNativeView.swift` - Native iOS SDK Google Maps component
- `Hither/Views/Map/MapSearchBar.swift` - Google Places search with autocomplete (Places API)
- `Hither/Services/GoogleMapsService.swift` - Google Maps API integration (Routes & Places API only)

### Google Maps SDK Installation Required
To use the native Google Maps implementation, you must add the Google Maps SDK for iOS dependency:
1. In Xcode, go to File → Add Package Dependencies
2. Add: `https://github.com/googlemaps/ios-maps-sdk`
3. Configure the SDK with the provided API key in AppDelegate

**Important**: Only the following APIs are authorized for use:
- Routes API (for directions)
- Places API (New) (for search/autocomplete)  
- Maps SDK for iOS (for native map display)