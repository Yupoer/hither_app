Pod::Spec.new do |s|
  s.name           = 'HitherMaps'
  s.version        = '0.1.0'
  s.summary        = 'Hither MapKit search / directions native module (scaffold)'
  s.description    = 'Thin Expo module backing src/native/maps.ts on iOS.'
  s.author         = ''
  s.homepage       = 'https://hither.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
