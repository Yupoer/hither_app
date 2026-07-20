package expo.modules.hithermetrics

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.RandomAccessFile

/**
 * Android runtime metrics for diagnostics.
 *
 * Full MetricKit-style crash/ANR spool is not available; [drainPayloads]
 * returns an empty list until a reliable local source exists. Do not invent
 * a third-party crash SDK here.
 */
class HitherMetricsModule : Module() {
  private val prefsName = "hither_metrics"
  private val keyCollection = "collection_enabled"
  private val keyPhase = "launch_phase"
  private val keyPhaseBuild = "launch_phase_build"
  private val keyPhaseAt = "launch_phase_at"
  private val keyPrevPhase = "prev_launch_phase"
  private val keyPrevBuild = "prev_launch_build"
  private val keyPrevAt = "prev_launch_at"

  private val context: Context
    get() = appContext.reactContext
      ?: appContext.currentActivity
      ?: throw IllegalStateException("No Android context for HitherMetrics")

  override fun definition() = ModuleDefinition {
    Name("HitherMetrics")

    AsyncFunction("drainPayloads") {
      // No reliable crash/ANR spool yet — explicit empty, not fabricated events.
      emptyList<Map<String, Any>>()
    }

    AsyncFunction("removePayloads") { _: List<String> ->
      // no-op until spool exists
    }

    AsyncFunction("samplePerformance") { _: Double ->
      if (!isCollectionEnabled()) return@AsyncFunction null
      sampleRuntime()
    }

    AsyncFunction("setCollectionEnabled") { enabled: Boolean ->
      context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(keyCollection, enabled)
        .apply()
      enabled
    }

    AsyncFunction("purgePayloads") {
      // Clear launch breadcrumbs; no MetricKit files on Android.
      context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
        .edit()
        .remove(keyPhase)
        .remove(keyPhaseBuild)
        .remove(keyPhaseAt)
        .remove(keyPrevPhase)
        .remove(keyPrevBuild)
        .remove(keyPrevAt)
        .apply()
    }

    AsyncFunction("previousLaunch") {
      val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      val phase = prefs.getString(keyPrevPhase, null) ?: return@AsyncFunction null
      val build = prefs.getString(keyPrevBuild, null) ?: ""
      val recordedAt = prefs.getLong(keyPrevAt, 0L)
      mapOf(
        "phase" to phase,
        "build" to build,
        "recordedAt" to recordedAt.toDouble(),
      )
    }

    AsyncFunction("markLaunchPhase") { phase: String ->
      val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      val build = try {
        val pinfo = context.packageManager.getPackageInfo(context.packageName, 0)
        pinfo.versionName ?: ""
      } catch (_: Throwable) {
        ""
      }
      val existingPhase = prefs.getString(keyPhase, null)
      val existingBuild = prefs.getString(keyPhaseBuild, null)
      val existingAt = prefs.getLong(keyPhaseAt, 0L)
      val editor = prefs.edit()
      if (existingPhase != null && existingPhase != "stable") {
        editor.putString(keyPrevPhase, existingPhase)
        editor.putString(keyPrevBuild, existingBuild ?: build)
        editor.putLong(keyPrevAt, if (existingAt > 0) existingAt else System.currentTimeMillis())
      }
      editor
        .putString(keyPhase, phase)
        .putString(keyPhaseBuild, build)
        .putLong(keyPhaseAt, System.currentTimeMillis())
        .apply()
    }
  }

  private fun isCollectionEnabled(): Boolean {
    return context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      .getBoolean(keyCollection, false)
  }

  private fun sampleRuntime(): Map<String, Any?> {
    val runtime = Runtime.getRuntime()
    val memInfo = ActivityManager.MemoryInfo()
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
    am?.getMemoryInfo(memInfo)

    val pssMb = try {
      val debugInfo = android.os.Debug.MemoryInfo()
      android.os.Debug.getMemoryInfo(debugInfo)
      debugInfo.totalPss / 1024.0 // kB → MB
    } catch (_: Throwable) {
      // Fallback: JVM heap used.
      (runtime.totalMemory() - runtime.freeMemory()) / (1024.0 * 1024.0)
    }

    val cpuTimeMs = try {
      // Process CPU time in ms (user + system) via /proc/self/stat ticks when available.
      val clockTicks = 100.0
      val line = RandomAccessFile("/proc/self/stat", "r").use { it.readLine() }
      val parts = line.split(" ")
      // fields 14 utime, 15 stime (1-indexed) → indices 13, 14
      val utime = parts.getOrNull(13)?.toLongOrNull() ?: 0L
      val stime = parts.getOrNull(14)?.toLongOrNull() ?: 0L
      ((utime + stime) / clockTicks) * 1000.0
    } catch (_: Throwable) {
      null
    }

    val displayMaxFps = try {
      val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        context.display?.refreshRate?.toDouble()
      } else {
        @Suppress("DEPRECATION")
        wm.defaultDisplay?.refreshRate?.toDouble()
      }
    } catch (_: Throwable) {
      null
    }

    val battery = readBattery()
    val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
    val lowPower = try {
      pm?.isPowerSaveMode
    } catch (_: Throwable) {
      null
    }
    val thermal = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && pm != null) {
        when (pm.currentThermalStatus) {
          PowerManager.THERMAL_STATUS_NONE -> "nominal"
          PowerManager.THERMAL_STATUS_LIGHT -> "fair"
          PowerManager.THERMAL_STATUS_MODERATE -> "serious"
          PowerManager.THERMAL_STATUS_SEVERE,
          PowerManager.THERMAL_STATUS_CRITICAL,
          PowerManager.THERMAL_STATUS_EMERGENCY,
          PowerManager.THERMAL_STATUS_SHUTDOWN,
          -> "critical"
          else -> null
        }
      } else {
        null
      }
    } catch (_: Throwable) {
      null
    }

    val activity = appContext.currentActivity
    val appState = when {
      activity == null -> "background"
      activity.isFinishing -> "inactive"
      else -> "active"
    }

    return mapOf(
      "cpuPercent" to null, // instantaneous % needs a windowed delta; leave null
      "cpuTimeMs" to cpuTimeMs,
      "memoryMb" to pssMb,
      "uiFps" to null,
      "frameTimeP95Ms" to null,
      "missedFrameRatio" to null,
      "displayMaxFps" to displayMaxFps,
      "batteryLevel" to battery.level,
      "batteryState" to battery.state,
      "lowPowerMode" to lowPower,
      "thermalState" to thermal,
      "appState" to appState,
      "deviceModel" to Build.MODEL,
      "osVersion" to "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
    )
  }

  private data class BatterySample(val level: Double?, val state: String?)

  private fun readBattery(): BatterySample {
    return try {
      val intent = context.registerReceiver(
        null,
        IntentFilter(Intent.ACTION_BATTERY_CHANGED),
      ) ?: return BatterySample(null, null)
      val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
      val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
      val pct = if (level >= 0 && scale > 0) level.toDouble() / scale.toDouble() else null
      val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
      val state = when (status) {
        BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
        BatteryManager.BATTERY_STATUS_FULL -> "full"
        BatteryManager.BATTERY_STATUS_DISCHARGING,
        BatteryManager.BATTERY_STATUS_NOT_CHARGING,
        -> "unplugged"
        else -> null
      }
      BatterySample(pct, state)
    } catch (_: Throwable) {
      BatterySample(null, null)
    }
  }
}
