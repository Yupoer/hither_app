# 3. Functional Requirements

## 3.1. MVP Core Features ✅ **v2.0 已實施**

### 3.1.1. Group Management ✅ **已實施**
*   **User Authentication (Firebase Authentication):** ✅ Users can sign up and log in using Apple ID, Google, or email. The system assigns a unique UID to each user upon login.
*   **Create Group:** ✅ Any user can create a new group and automatically becomes the "Leader." The group name and event date can be set during creation.
*   **Invite & Join:** ✅ The leader can generate a time-limited invitation link or QR Code. **(v2.1 規格細化)** 預設時效為 24 小時，領隊在創建時可選擇不同時效（例如：1 小時、12 小時、3 天），以適應不同活動需求。Other users can join the group as "Followers" by clicking the link or scanning the QR Code.
*   **Group Information (Firestore):** ✅ Stores basic group info (name, ID). Stores a member list, including each member's UID, role (Leader/Follower), and nickname.

### 3.1.2. 📍 Real-time Location Module ✅ **已實施**
*   **Map View (Google Maps):** ✅ Displays the real-time location of all members on a map with different icons (e.g., a crown for the Leader, dots for Followers). Users can zoom and pan the map. Provides standard, satellite, and hybrid map modes. **升級為 Google Maps SDK 以獲得更好的性能和功能。**
*   **Location Updates (CoreLocation & Firestore):** ✅ The app, in background mode, periodically fetches the user's GPS location. **(v2.1 規格細化)** 更新頻率由領隊選擇的兩種模式管理：
    * **(a) 標準模式 (預設):** 根據成員移動速度在 30-90 秒間自動調整更新頻率，以優化電池續航。
    * **(b) 精準模式:** 將更新頻率提升至 15-30 秒，適用於需要高即時性的場景。
*   **Map Search (Google Places API):** ✅ **新增功能** - Integrated Google Places search bar for finding and navigating to specific locations.

### 3.1.3. 🧭 Directional Awareness Module ✅ **已實施**
*   **Relative Direction & Distance Guidance:** ✅ Provides a non-map "Compass Mode." The screen displays a large arrow that always points toward the leader. The distance to the leader is shown below or inside the arrow (e.g., "150 meters").
*   **Precision Finding (NearbyInteraction - for supported devices):** ✅ This feature can be enabled when members are less than 50 meters apart and their devices support UWB chips. The interface provides more precise directional cues and distance, similar to the AirTag finding experience.

### 3.1.4. 📣 Broadcast Command Module ✅ **已實施**
*   **Quick Commands:** ✅ The leader's interface provides several preset quick command buttons, such as: "Gather," "Depart," "Rest," "Be careful," "Go Left," "Go Right." Tapping a command sends it to all followers via FCM push notifications and in-app alerts.
*   **Custom Messages:** ✅ The leader can send short text or voice messages to the entire group. Messages are displayed prominently within the app and accompanied by a push notification.

### 3.1.5. ⛳ Itinerary Adjustment Module ✅ **已實施**
*   **Simple Itinerary Points:** ✅ The leader can set several key points on the map (e.g., meeting point, lunch spot, destination). These points are marked on all members' maps.
*   **Real-time Adjustments:** ✅ The leader can add, delete, or move itinerary points at any time. Any changes are synced in real-time via Firestore, and an "Itinerary Updated" push notification (UserNotifications) is sent to all members.
*   **Google Routes Integration:** ✅ **新增功能** - Routes are calculated using Google Routes API for better accuracy and real-time traffic information.

## 3.2. Post-MVP Features ✅ **已實施**

### 3.2.1. Follower Request System ✅ **已實施**
*   **Make a Request:** ✅ The follower interface provides shortcut buttons to make requests, such as: "Request a break," "Request to add a stop," "Request to change itinerary." A short description can be attached to the request (e.g., "I need to use the restroom").
*   **Notification Mechanism:** ✅ Requests are sent to the leader (primary notification) and other followers (secondary notification).

### 3.2.2. Leader Decision System ✅ **已實施**
*   **Review Interface:** ✅ The leader receives a notification card with "Approve" and "Decline" buttons. The leader can see who made the request, its content, and location.
*   **Result Sync:** ✅ The leader's decision is sent back to all members and displayed as "Request Approved" or "Request Declined."

## 3.3. Additional Implemented Features 🆕

### 3.3.1. DarkBlue Theme System ✅ **已實施**
*   **OKLCH Color Space:** Advanced color system for better visual consistency across light and dark modes.
*   **Theme Components:** Complete set of themed UI components (buttons, cards, text fields, toggles).
*   **Automatic Mode Switching:** Seamless adaptation to system light/dark mode preferences.

### 3.3.2. Multi-language Support ✅ **已實施**
*   **Localization:** Full support for multiple languages with dynamic language switching.
*   **Cultural Adaptation:** Proper text formatting and layout for different regions.

### 3.3.3. Development Tools ✅ **已實施**
*   **Testing Interface:** Built-in development tools for testing location scenarios.
*   **Mock Data:** Ability to simulate different group and location configurations for testing.

### 3.3.4. Enhanced User Experience ✅ **已實施**
*   **Onboarding Flow:** Comprehensive introduction to app features and capabilities.
*   **Error Handling:** Robust error handling with user-friendly error messages and recovery options.
*   **Loading States:** Pleasant loading animations and progress indicators throughout the app.

## 3.4. Tech Stack & Implementation ✅ **完全實施**
*   **iOS Frameworks:**
    *   **CoreLocation:** ✅ To get GPS positions and calculate distances between members.
    *   **Google Maps SDK for iOS:** ✅ **升級** - To display maps, pins, and routes with enhanced performance.
    *   **NearbyInteraction:** ✅ To implement high-precision close-range finding.
    *   **ActivityKit:** ✅ To display real-time information on the Lock Screen, like distance to the leader or the next stop.
    *   **UserNotifications:** ✅ To send local/remote push notifications for arrival alerts, broadcast commands, and status changes.
*   **Backend (Firebase):**
    *   **Authentication:** ✅ To handle user login and identity verification.
    *   **Firestore:** ✅ As the primary real-time database for storing group, member, location, itinerary, and request data.
    *   **Cloud Messaging (FCM):** ✅ To push important notifications in real-time when the app is closed or in the background.
*   **Google APIs:** 🆕
    *   **Routes API:** ✅ For accurate route calculation and navigation.
    *   **Places API (New):** ✅ For location search and autocomplete functionality.
*   **Theme System:** 🆕
    *   **OKLCH Color Space:** ✅ Advanced color management for consistent theming.
    *   **SwiftUI Integration:** ✅ Seamless integration with Apple's declarative UI framework.
