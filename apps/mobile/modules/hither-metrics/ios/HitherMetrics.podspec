Pod::Spec.new do |s|
  s.name           = 'HitherMetrics'
  s.version        = '0.1.0'
  s.summary        = 'Bounded MetricKit payload spool for Hither'
  s.description    = 'Collects MetricKit payloads and exposes acknowledged drain/remove APIs.'
  s.author         = ''
  s.homepage       = 'https://hither.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
