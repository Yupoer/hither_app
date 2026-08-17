Pod::Spec.new do |s|
  s.name           = 'HitherMenu'
  s.version        = '0.1.0'
  s.summary        = 'Attached UIMenu host for RoleSelect language'
  s.description    = 'Thin Expo view module: iOS UIButton.menu + showsMenuAsPrimaryAction.'
  s.author         = ''
  s.homepage       = 'https://hither.app'
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
