import ExpoModulesCore

// SCAFFOLD (Phase B) — ActivityKit Live Activity native module.
//
// Backs the JS boundary `apps/mobile/src/native/liveActivity.ts`. There is
// NO Expo Go fallback for Live Activities, so this module is the only real
// implementation path (EAS Dev Build). Port from the existing service +
// attributes + widget:
//   ios_native/hither/Hither/Services/LiveActivityService.swift
//   ios_native/hither/Hither/Models/ActivityAttributes.swift
//   ios_native/hither/Widgets/WidgetsLiveActivity.swift
// Device/system integration only — group state comes from RN + Supabase.
//
// Exported names/shapes MUST match liveActivity.ts:
//   isSupported(): boolean
//   startGroupActivity(state): Promise<string | null>   // handle
//   updateGroupActivity(handle, state): Promise<void>
//   endGroupActivity(handle): Promise<void>
public class HitherLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HitherLiveActivity")

    Function("isSupported") { () -> Bool in
      // TODO(Phase B): ActivityAuthorizationInfo().areActivitiesEnabled on iOS 16.1+
      return false
    }

    AsyncFunction("startGroupActivity") { (state: [String: Any]) -> String? in
      // TODO(Phase B): Activity.request(...) and return the activity id.
      return nil
    }

    AsyncFunction("updateGroupActivity") { (handle: String, state: [String: Any]) in
      // TODO(Phase B): Activity.update(...) for the matching id.
    }

    AsyncFunction("endGroupActivity") { (handle: String) in
      // TODO(Phase B): Activity.end(...) for the matching id.
    }
  }
}
