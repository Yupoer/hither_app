package expo.modules.hitherliveactivity

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Android navigation Live Update / ongoing notification.
 *
 * API 36+: Notification.ProgressStyle when available.
 * API 24–35: NotificationCompat ongoing notification.
 * Custom remote layouts are forbidden (promoted notification restriction).
 */
object HitherLiveUpdateService {
  private const val TAG = "HitherLiveUpdate"
  private const val CHANNEL_ID = "hither_navigation"
  private const val CHANNEL_NAME = "導航進度"
  private const val PREFS = "hither_live_update"
  private const val KEY_SESSIONS = "sessions_json"
  private const val THROTTLE_MS = 5_000L
  private const val THROTTLE_DISTANCE_M = 20.0

  data class LiveUpdateState(
    val sessionId: String,
    val groupName: String,
    val gatheringTitle: String,
    val distanceMeters: Double?,
    val etaSeconds: Double?,
    val progress: Double?,
    val travelMode: String?,
    val status: String?,
    val estimateOnly: Boolean = false,
  )

  private data class ThrottleKey(
    val atMs: Long,
    val distanceMeters: Double?,
  )

  private val lastPublish = ConcurrentHashMap<String, ThrottleKey>()

  fun isSupported(): Boolean = true

  fun start(context: Context, state: LiveUpdateState): String {
    ensureChannel(context)
    persistSession(context, state)
    publish(context, state, force = true)
    return state.sessionId
  }

  fun update(context: Context, sessionId: String, state: LiveUpdateState) {
    val merged = state.copy(sessionId = sessionId)
    persistSession(context, merged)
    publish(context, merged, force = false)
  }

  fun updateAll(context: Context, state: LiveUpdateState) {
    val sessions = loadSessions(context)
    if (sessions.isEmpty()) {
      // No active session handle — treat as upsert for the provided session id.
      if (state.sessionId.isNotBlank()) {
        start(context, state)
      }
      return
    }
    for (existing in sessions.values) {
      val merged = existing.copy(
        groupName = state.groupName.ifBlank { existing.groupName },
        gatheringTitle = state.gatheringTitle.ifBlank { existing.gatheringTitle },
        distanceMeters = state.distanceMeters ?: existing.distanceMeters,
        etaSeconds = state.etaSeconds ?: existing.etaSeconds,
        progress = state.progress ?: existing.progress,
        travelMode = state.travelMode ?: existing.travelMode,
        status = state.status ?: existing.status,
        estimateOnly = state.estimateOnly,
      )
      persistSession(context, merged)
      publish(context, merged, force = false)
    }
  }

  fun end(context: Context, sessionId: String) {
    cancelNotification(context, sessionId)
    removeSession(context, sessionId)
    lastPublish.remove(sessionId)
  }

  fun endAll(context: Context) {
    val sessions = loadSessions(context)
    for (id in sessions.keys) {
      cancelNotification(context, id)
      lastPublish.remove(id)
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .remove(KEY_SESSIONS)
      .apply()
  }

  fun handleFcmData(context: Context, data: Map<String, String>) {
    val category = data["category"] ?: return
    when (category) {
      "navigation_session", "journey", "arrival" -> {
        val sessionId = data["sessionId"]
          ?: data["navigationSessionId"]
          ?: data["session_id"]
        val groupId = data["groupId"] ?: data["group_id"]
        val destination = data["gatheringTitle"]
          ?: data["title"]
          ?: data["destinationTitle"]
        val status = data["status"]
        if (sessionId.isNullOrBlank() && groupId.isNullOrBlank()) {
          Log.d(TAG, "ignore FCM $category: missing group/session")
          return
        }
        val resolvedSession = sessionId?.takeIf { it.isNotBlank() }
          ?: "group-${groupId}"
        if (
          status == "paused" ||
          status == "ended" ||
          status == "complete" ||
          category == "arrival" && data["end"] == "true"
        ) {
          end(context, resolvedSession)
          return
        }
        val distance = data["distanceMeters"]?.toDoubleOrNull()
          ?: data["distance_m"]?.toDoubleOrNull()
        val eta = data["etaSeconds"]?.toDoubleOrNull()
          ?: data["eta_seconds"]?.toDoubleOrNull()
        val progress = data["progress"]?.toDoubleOrNull()
        start(
          context,
          LiveUpdateState(
            sessionId = resolvedSession,
            groupName = data["groupName"] ?: "Hither",
            gatheringTitle = destination ?: "集合點",
            distanceMeters = distance,
            etaSeconds = eta,
            progress = progress,
            travelMode = data["travelMode"],
            status = status,
            estimateOnly = data["estimateOnly"] == "true",
          ),
        )
      }
      else -> {
        // General alerts are handled by expo-notifications.
      }
    }
  }

  private fun publish(context: Context, state: LiveUpdateState, force: Boolean) {
    if (!force) {
      val prev = lastPublish[state.sessionId]
      val now = System.currentTimeMillis()
      if (prev != null) {
        val dt = now - prev.atMs
        val dd = if (state.distanceMeters != null && prev.distanceMeters != null) {
          kotlin.math.abs(state.distanceMeters - prev.distanceMeters)
        } else {
          Double.MAX_VALUE
        }
        if (dt < THROTTLE_MS && dd < THROTTLE_DISTANCE_M) {
          return
        }
      }
    }
    lastPublish[state.sessionId] = ThrottleKey(
      atMs = System.currentTimeMillis(),
      distanceMeters = state.distanceMeters,
    )

    ensureChannel(context)
    val notificationId = notificationIdFor(state.sessionId)
    val notification = buildNotification(context, state)
    try {
      NotificationManagerCompat.from(context).notify(notificationId, notification)
    } catch (e: SecurityException) {
      Log.w(TAG, "notification permission denied", e)
    }
  }

  private fun buildNotification(context: Context, state: LiveUpdateState): Notification {
    val title = state.gatheringTitle.ifBlank { "集合點" }
    val distanceText = formatDistance(state.distanceMeters)
    val etaLabel = if (state.estimateOnly) "估算" else "路線預估"
    val etaText = formatEta(state.etaSeconds)
    val body = listOfNotNull(
      distanceText,
      if (etaText != null) "$etaLabel $etaText" else null,
    ).joinToString(" · ").ifBlank { "導航進行中" }

    val progressPercent = ((state.progress ?: 0.0).coerceIn(0.0, 1.0) * 100).roundToInt()
      .coerceIn(0, 100)

    val contentIntent = launchAppIntent(context)
    val stopIntent = stopActionIntent(context, state.sessionId)

    // Android 16 / API 36: progress-centric Notification.ProgressStyle when available.
    // Resolved via reflection so the module still compiles on older compileSdk.
    // Contract: Notification.ProgressStyle + Build.VERSION.SDK_INT >= 36 + setOngoing(true).
    if (Build.VERSION.SDK_INT >= 36) {
      try {
        val progressStyleClass = Class.forName("android.app.Notification\$ProgressStyle")
        val progressStyle = progressStyleClass.getDeclaredConstructor().newInstance()
        progressStyleClass.getMethod("setProgress", Int::class.javaPrimitiveType)
          .invoke(progressStyle, progressPercent)
        val builder = Notification.Builder(context, CHANNEL_ID)
          .setSmallIcon(android.R.drawable.ic_menu_mylocation)
          .setContentTitle(title)
          .setContentText(body)
          .setVisibility(Notification.VISIBILITY_PUBLIC)
          .setOngoing(true)
          .setOnlyAlertOnce(true)
          .setContentIntent(contentIntent)
        // setStyle(Notification.Style)
        val styleClass = Class.forName("android.app.Notification\$Style")
        builder.javaClass.getMethod("setStyle", styleClass).invoke(builder, progressStyle)
        try {
          builder.javaClass.getMethod(
            "setRequestPromotedOngoing",
            Boolean::class.javaPrimitiveType,
          ).invoke(builder, true)
        } catch (_: Throwable) {
          // OEM / SDK may not expose promotion; standard ongoing is enough.
        }
        return builder.build()
      } catch (e: Throwable) {
        Log.d(TAG, "ProgressStyle unavailable, falling back", e)
      }
    }

    return NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_menu_mylocation)
      .setContentTitle(title)
      .setContentText(body)
      .setSubText(state.groupName)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
      .setProgress(100, progressPercent, false)
      .setContentIntent(contentIntent)
      .addAction(0, "停止導航", stopIntent)
      .build()
  }

  private fun launchAppIntent(context: Context): PendingIntent {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent().apply { setPackage(context.packageName) }
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(
      context,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun stopActionIntent(context: Context, sessionId: String): PendingIntent {
    val intent = Intent(context, HitherLiveUpdateStopReceiver::class.java).apply {
      putExtra("sessionId", sessionId)
    }
    return PendingIntent.getBroadcast(
      context,
      notificationIdFor(sessionId),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun cancelNotification(context: Context, sessionId: String) {
    NotificationManagerCompat.from(context).cancel(notificationIdFor(sessionId))
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val existing = manager.getNotificationChannel(CHANNEL_ID)
    if (existing != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "集合導航進度與剩餘距離"
      setLockscreenVisibility(Notification.VISIBILITY_PUBLIC)
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  fun notificationIdFor(sessionId: String): Int {
    // Stable positive id from session UUID / string hash.
    return try {
      val uuid = UUID.fromString(sessionId)
      (uuid.mostSignificantBits xor uuid.leastSignificantBits).toInt() and 0x7fffffff
    } catch (_: IllegalArgumentException) {
      (sessionId.hashCode() and 0x7fffffff).let { if (it == 0) 1 else it }
    }
  }

  private fun formatDistance(meters: Double?): String? {
    if (meters == null || !meters.isFinite()) return null
    val m = max(0.0, meters)
    return if (m >= 1000) {
      String.format("%.1f km", m / 1000.0)
    } else {
      "${m.roundToInt()} m"
    }
  }

  private fun formatEta(seconds: Double?): String? {
    if (seconds == null || !seconds.isFinite()) return null
    val s = max(0.0, seconds).roundToInt()
    val h = s / 3600
    val m = (s % 3600) / 60
    return when {
      h > 0 -> "${h} 小時 ${m} 分"
      m > 0 -> "${m} 分鐘"
      else -> "不到 1 分鐘"
    }
  }

  private fun loadSessions(context: Context): MutableMap<String, LiveUpdateState> {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_SESSIONS, null) ?: return mutableMapOf()
    return try {
      val obj = JSONObject(raw)
      val out = mutableMapOf<String, LiveUpdateState>()
      val keys = obj.keys()
      while (keys.hasNext()) {
        val id = keys.next()
        val item = obj.getJSONObject(id)
        out[id] = LiveUpdateState(
          sessionId = id,
          groupName = item.optString("groupName", "Hither"),
          gatheringTitle = item.optString("gatheringTitle", "集合點"),
          distanceMeters = item.optDouble("distanceMeters").takeIf {
            item.has("distanceMeters") && !item.isNull("distanceMeters")
          },
          etaSeconds = item.optDouble("etaSeconds").takeIf {
            item.has("etaSeconds") && !item.isNull("etaSeconds")
          },
          progress = item.optDouble("progress").takeIf {
            item.has("progress") && !item.isNull("progress")
          },
          travelMode = item.optString("travelMode", null),
          status = item.optString("status", null),
          estimateOnly = item.optBoolean("estimateOnly", false),
        )
      }
      out
    } catch (_: Throwable) {
      mutableMapOf()
    }
  }

  private fun persistSession(context: Context, state: LiveUpdateState) {
    val sessions = loadSessions(context)
    sessions[state.sessionId] = state
    val obj = JSONObject()
    for ((id, s) in sessions) {
      obj.put(
        id,
        JSONObject().apply {
          put("groupName", s.groupName)
          put("gatheringTitle", s.gatheringTitle)
          if (s.distanceMeters != null) put("distanceMeters", s.distanceMeters)
          if (s.etaSeconds != null) put("etaSeconds", s.etaSeconds)
          if (s.progress != null) put("progress", s.progress)
          if (s.travelMode != null) put("travelMode", s.travelMode)
          if (s.status != null) put("status", s.status)
          put("estimateOnly", s.estimateOnly)
        },
      )
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_SESSIONS, obj.toString())
      .apply()
  }

  private fun removeSession(context: Context, sessionId: String) {
    val sessions = loadSessions(context)
    sessions.remove(sessionId)
    if (sessions.isEmpty()) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .remove(KEY_SESSIONS)
        .apply()
      return
    }
    val obj = JSONObject()
    for ((id, s) in sessions) {
      obj.put(
        id,
        JSONObject().apply {
          put("groupName", s.groupName)
          put("gatheringTitle", s.gatheringTitle)
          if (s.distanceMeters != null) put("distanceMeters", s.distanceMeters)
          if (s.etaSeconds != null) put("etaSeconds", s.etaSeconds)
          if (s.progress != null) put("progress", s.progress)
          if (s.travelMode != null) put("travelMode", s.travelMode)
          if (s.status != null) put("status", s.status)
          put("estimateOnly", s.estimateOnly)
        },
      )
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_SESSIONS, obj.toString())
      .apply()
  }
}
