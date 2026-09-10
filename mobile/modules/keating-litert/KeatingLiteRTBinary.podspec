# Same versioned C API binary and SHA-256 as Google's v0.16.0 Package.swift.
# CocoaPods downloads SDK code only; no model weights are packaged.
Pod::Spec.new do |s|
  s.name = 'KeatingLiteRTBinary'
  s.version = '0.16.0'
  s.summary = 'Google LiteRT-LM C API for iOS'
  s.homepage = 'https://github.com/google-ai-edge/LiteRT-LM'
  s.license = 'Apache-2.0'
  s.author = 'Google LLC'
  s.platforms = { :ios => '16.4' }
  s.source = {
    :http => 'https://github.com/google-ai-edge/LiteRT-LM/releases/download/v0.16.0/CLiteRTLM.xcframework.zip',
    :sha256 => '4e0f683da07566ee79c143d2d58d387f77052b0e6a41562c969e5d2728fc9f4b'
  }
  s.vendored_frameworks = 'CLiteRTLM.xcframework'
  s.frameworks = 'Foundation', 'Metal', 'Accelerate'
  s.libraries = 'c++'
end
