Pod::Spec.new do |s|
  s.name           = 'HitherLiveActivity'
  s.version        = '0.1.0'
  s.summary        = 'Hither ActivityKit Live Activity native module (scaffold)'
  s.description    = 'Thin Expo module backing src/native/liveActivity.ts on iOS.'
  s.author         = ''
  s.homepage       = 'https://hither.app'
  # Must be <= the app's iOS deployment target (16.4) or expo-modules-autolinking
  # treats the module as "not supporting iOS" and silently drops the pod ??which
  # made requireOptionalNativeModule('HitherLiveActivity') return null and no
  # Live Activity ever started. All ActivityKit calls are guarded at runtime with
  # `#available(iOS 16.2, *)`, so a lower deployment floor is safe here.
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
