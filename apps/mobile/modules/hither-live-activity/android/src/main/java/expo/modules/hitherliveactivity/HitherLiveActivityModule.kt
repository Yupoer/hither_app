package expo.modules.hitherliveactivity

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// SCAFFOLD (Phase B) — Android no-op. Live Activities are iOS-only; this
// stub just keeps the module name resolvable so shared JS does not crash.
class HitherLiveActivityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HitherLiveActivity")

    Function("isSupported") { false }
    AsyncFunction("startGroupActivity") { _: Map<String, Any?> -> null }
    AsyncFunction("updateGroupActivity") { _: String, _: Map<String, Any?> -> }
    AsyncFunction("endGroupActivity") { _: String -> }
    AsyncFunction("endAllGroupActivities") { }
  }
}
