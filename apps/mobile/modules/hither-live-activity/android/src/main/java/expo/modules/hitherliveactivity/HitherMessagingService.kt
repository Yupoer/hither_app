package expo.modules.hitherliveactivity

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Handles FCM data messages that update the Android navigation Live Update.
 * General alert notifications remain handled by expo-notifications.
 *
 * Only processes navigation_session / journey / arrival categories that carry
 * enough identity (group/session/destination). Missing fields are ignored.
 */
class HitherMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    if (data.isEmpty()) return
    val category = data["category"] ?: return
    if (category !in setOf("navigation_session", "journey", "arrival")) {
      return
    }
    try {
      HitherLiveUpdateService.handleFcmData(applicationContext, data)
    } catch (e: Throwable) {
      Log.w(TAG, "failed to handle navigation FCM data", e)
    }
  }

  override fun onNewToken(token: String) {
    // Token rotation is registered from JS via expo-notifications.
    Log.d(TAG, "FCM token rotated (length=${token.length})")
  }

  companion object {
    private const val TAG = "HitherMessaging"
  }
}
