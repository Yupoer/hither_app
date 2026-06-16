# 4. Design & UX

## 4.1. Key UI Flows
*   **Onboarding:** A clean set of introductory screens explaining the app's core values (Safety, Sync, Stay Connected), guiding the user to log in.
*   **Main Interface (Map View):** Centered around the map, clearly marking the user and all members. A bottom or side panel provides the leader with quick access to "Broadcast Command" and "Itinerary Management." For followers, it provides buttons for "Directional Awareness" and "Make a Request."
*   **Directional Awareness Interface (Compass/AR View):** A minimalist design with only a large directional arrow and distance number, eliminating all unnecessary distractions.
*   **Communication Interface:** A timeline format that clearly and chronologically displays all commands from the leader and system notifications.

## 4.2. Design Principles
*   **Ease of Use First:** Operations must be intuitive, allowing even users less familiar with digital products (like seniors) to use it easily. This is especially critical for leaders who need to operate the app quickly while managing a group.
*   **Information Clarity:** On any screen, the most important information (like direction, distance, latest command) must be the most prominent.
*   **Battery Optimization:** Design and development must prioritize battery life to prevent the app from being a power drain.
*   **Status Transparency:** Users need to be clearly aware of the app's current connection status, location accuracy, etc.

## 🆕 4.3. 資訊架構與導航 (v2.1 更新)
為了提升 App 的易用性並更好地服務不同角色，v2.1 將採用新的資訊架構。

* **新的底部導航結構 (New Bottom Navigation Structure):**
    App 的主導航將統一為四個分頁，此結構對領隊 (Leader) 和追隨者 (Follower) 保持一致：
    1.  **主控台 (Dashboard)**
    2.  **地圖 (Map)**
    3.  **行程 (Itinerary)**
    4.  **設定 (Settings)**

* **核心頁面變更 (Core Page Changes):**
    * **新增「主控台」分頁**: 此分頁將作為用戶進入群組後的主頁。內容會根據用戶角色動態調整，為領隊提供「指揮中心」，為追隨者提供「狀態中心」。
    * **移除「指令」分頁**: 其核心功能將整合至領隊的「主控台」頁面，以提高操作效率。
    * **移除「方向」分頁**: 其核心的羅盤尋找功能將轉為「情境操作」，當追隨者在「地圖」分頁上點擊領隊頭像時觸發，使其更符合使用直覺。
