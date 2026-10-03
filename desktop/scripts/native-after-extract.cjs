// Dependency collection can resolve hoisted packages outside the generated app.
// Apply exclusions before Electron Builder constructs its copy matchers; never
// mutate installed dependencies or remove entries from an already packed ASAR.
const applied = new WeakMap();
module.exports = async context => {
  const platform = context.electronPlatformName;
  const arch = ["ia32", "x64", "armv7l", "arm64", "universal"][context.arch];
  if (!["linux", "darwin", "win32"].includes(platform) || !arch || arch === "universal") throw new Error("Invalid native copy target.");
  const options = context.packager.platformSpecificBuildOptions;
  const previous = applied.get(options);
  const original = previous && options.files === previous.files ? previous.original : options.files;
  const filters = [
    `!**/prebuilds/!(${platform}-*)/**/*`,
    `!**/prebuilds/${platform}-!(${arch}|${arch}+*|*+${arch}|*+${arch}+*)/**/*`,
    `!**/bin/napi-v*/!(${platform})/**/*`,
    `!**/bin/napi-v*/${platform}/!(${arch})/**/*`,
  ];
  options.files = [...(original == null ? [] : Array.isArray(original) ? original : [original]), ...filters];
  // A packager can build multiple architectures with the same options object.
  // Replace our prior target filters instead of accumulating incompatible ones.
  applied.set(options, { original, files: options.files });
};
