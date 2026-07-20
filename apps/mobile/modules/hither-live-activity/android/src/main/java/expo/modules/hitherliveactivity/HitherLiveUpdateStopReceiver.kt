package expo.modules.hitherliveactivity

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Handles the "停止導航" action on the ongoing navigation notification. */
class HitherLiveUpdateStopReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val sessionId = intent?.getStringExtra("sessionId") ?: return
    HitherLiveUpdateService.end(context, sessionId)
  }
}
