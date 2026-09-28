const { withProjectBuildGradle, createRunOncePlugin } = require('@expo/config-plugins');

/** RN package's default latest.integration Maven dependency must not float between releases. */
function withJuliaOnnx(config) {
  return withProjectBuildGradle(config, result => {
    const marker = '// keating-julia-onnx-pin';
    if (!result.modResults.contents.includes(marker)) result.modResults.contents += `
${marker}
subprojects {
  configurations.configureEach {
    resolutionStrategy.eachDependency { dependency ->
      if (dependency.requested.group == 'com.microsoft.onnxruntime' && dependency.requested.name == 'onnxruntime-android') {
        dependency.useVersion '1.24.3'
      }
    }
  }
  plugins.withId('com.android.library') {
    if (project.name == 'onnxruntime-react-native') {
      android.defaultConfig.externalNativeBuild.cmake.arguments '-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,max-page-size=16384'
    }
  }
}
`;
    return result;
  });
}
module.exports = createRunOncePlugin(withJuliaOnnx, 'keating-julia-onnx', '1.24.3');
