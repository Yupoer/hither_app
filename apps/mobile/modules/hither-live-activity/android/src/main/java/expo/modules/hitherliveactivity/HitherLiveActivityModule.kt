package expo.modules.hitherliveactivity

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

/**
 * Android Live Update bridge — mirrors the iOS ActivityKit method surface so
 * shared JS (`liveActivity.ts` / `useLiveActivity` / `backgroundJourney`) can
 * start, update, and end navigation notifications without a Platform fork.
 *
 * Handles are stable navigation session ids (not ActivityKit activity ids).
 */
class HitherLiveActivityModule : Module() {
  private val context: Context
    get() = appContext.reactContext
      ?: appContext.currentActivity
      ?: throw IllegalStateException("No Android context for HitherLiveActivity")

  override fun definition() = ModuleDefinition {
    Name("HitherLiveActivity")

    Function("isSupported") {
      HitherLiveUpdateService.isSupported()
    }

    AsyncFunction("startGroupActivity") { state: Map<String, Any?> ->
      val sessionId = stringOf(state, "navigationSessionId")
        ?.takeIf { it.isNotBlank() }
        ?: UUID.randomUUID().toString()
      val live = toLiveState(state, sessionId)
      HitherLiveUpdateService.start(context, live)
      mapOf(
        "activityId" to sessionId,
        "pushToken" to null,
      )
    }

    AsyncFunction("updateGroupActivity") { handle: String, state: Map<String, Any?> ->
      val live = toLiveState(state, handle)
      HitherLiveUpdateService.update(context, handle, live)
    }

    AsyncFunction("updateAllGroupActivities") { state: Map<String, Any?> ->
      val sessionId = stringOf(state, "navigationSessionId") ?: ""
      val live = toLiveState(state, sessionId)
      HitherLiveUpdateService.updateAll(context, live)
    }

    AsyncFunction("endGroupActivity") { handle: String ->
      HitherLiveUpdateService.end(context, handle)
    }

    AsyncFunction("endAllGroupActivities") {
      HitherLiveUpdateService.endAll(context)
    }

    // iOS-only push-to-start / observe — no-ops on Android.
    AsyncFunction("startPushToStartTokenObservation") { }
    AsyncFunction("observeExistingActivities") { }
  }

  private fun toLiveState(
    state: Map<String, Any?>,
    sessionId: String,
  ): HitherLiveUpdateService.LiveUpdateState {
    return HitherLiveUpdateService.LiveUpdateState(
      sessionId = sessionId,
      groupName = stringOf(state, "groupName") ?: "Hither",
      gatheringTitle = stringOf(state, "gatheringTitle") ?: "集合點",
      distanceMeters = doubleOf(state, "distanceMeters"),
      etaSeconds = doubleOf(state, "etaSeconds"),
      progress = doubleOf(state, "progress"),
      travelMode = stringOf(state, "travelMode"),
      status = stringOf(state, "status"),
      estimateOnly = boolOf(state, "estimateOnly") == true,
    )
  }

  private fun stringOf(map: Map<String, Any?>, key: String): String? {
    val v = map[key] ?: return null
    return when (v) {
      is String -> v
      else -> v.toString()
    }
  }

  private fun doubleOf(map: Map<String, Any?>, key: String): Double? {
    val v = map[key] ?: return null
    return when (v) {
      is Number -> v.toDouble()
      is String -> v.toDoubleOrNull()
      else -> null
    }
  }

  private fun boolOf(map: Map<String, Any?>, key: String): Boolean? {
    val v = map[key] ?: return null
    return when (v) {
      is Boolean -> v
      is Number -> v.toInt() != 0
      is String -> v.equals("true", ignoreCase = true)
      else -> null
    }
  }
}
