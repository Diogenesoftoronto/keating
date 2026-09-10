module.exports = async context => {
  const { stageOffline } = await import("./stage-offline.mjs");
  const arch = ["ia32", "x64", "armv7l", "arm64", "universal"][context.arch];
  await stageOffline(context.electronPlatformName, arch);
};
