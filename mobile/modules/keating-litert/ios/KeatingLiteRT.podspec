Pod::Spec.new do |s|
  s.name = 'KeatingLiteRT'
  s.version = '1.0.0'
  s.summary = 'Native offline LiteRT-LM inference for Keating'
  s.homepage = 'https://keating.help'
  s.license = 'Apache-2.0'
  s.author = 'Diogenes'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'KeatingLiteRTBinary', '= 0.16.0'
  s.source_files = '*.swift'
end
