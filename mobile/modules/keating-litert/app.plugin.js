const { withPodfile, withGradleProperties, withSettingsGradle } = require('expo/config-plugins');

/** Local Expo autolinking discovers the bridge. This declares its binary pod source. */
module.exports = function withKeatingLiteRT(config) {
  config = withSettingsGradle(config, (mod) => {
    if (!mod.modResults.contents.includes("include ':keating-litert-sdk'")) {
      mod.modResults.contents += "\ninclude ':keating-litert-sdk'\nproject(':keating-litert-sdk').projectDir = new File(rootDir, '../modules/keating-litert/sdk')\n";
    }
    return mod;
  });
  config = withGradleProperties(config, (mod) => {
    const entry = mod.modResults.find((item) => item.type === 'property' && item.key === 'android.minSdkVersion');
    if (entry) entry.value = String(Math.max(26, Number(entry.value) || 26));
    else mod.modResults.push({ type: 'property', key: 'android.minSdkVersion', value: '26' });
    return mod;
  });
  return withPodfile(config, (mod) => {
    const declaration = "  pod 'KeatingLiteRTBinary', :podspec => '../modules/keating-litert/KeatingLiteRTBinary.podspec'";
    if (!mod.modResults.contents.includes("pod 'KeatingLiteRTBinary'")) {
      if (!mod.modResults.contents.includes('use_expo_modules!')) throw new Error('Could not locate the Expo target for LiteRT.');
      mod.modResults.contents = mod.modResults.contents.replace('use_expo_modules!', `use_expo_modules!\n${declaration}`);
    }
    return mod;
  });
};
