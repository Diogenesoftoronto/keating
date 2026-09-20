require 'json'
manifest = JSON.parse(File.read(File.join(__dir__, '..', 'assets.json')))
# Local path pods do not run prepare_command. Prepare explicitly while evaluating
# this podspec so source/header globs and vendored framework already exist.
script = File.expand_path('../../../scripts/prepare-needle.mjs', __dir__)
raise 'Could not prepare the verified Needle iOS SDK' unless system('node', script, '--ios-xcframework')
assets = "../.generated/#{manifest.fetch('revision')}"
Pod::Spec.new do |s|
  s.name = 'KeatingNeedle'
  s.version = '1.0.0'
  s.summary = 'Pinned local Needle embeddings for Keating'
  s.homepage = 'https://keating.help'
  s.license = 'Apache-2.0'
  s.author = 'Diogenes'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.{swift,h,mm}', '../cpp/NeedleEngine.hpp'
  s.public_header_files = 'NeedleBridge.h'
  s.vendored_frameworks = "#{assets}/Needle.xcframework"
  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => "$(inherited) \"$(PODS_TARGET_SRCROOT)/#{assets}\" \"$(PODS_TARGET_SRCROOT)/#{assets}/ios-arm64\""
  }
  s.frameworks = 'Foundation', 'Accelerate'
  s.libraries = 'c++'
end
