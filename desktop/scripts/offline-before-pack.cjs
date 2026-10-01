module.exports = async context => {
  const { stageOffline } = await import("./stage-offline.mjs");
  const { stageOnnxRuntime } = await import("./stage-onnx-runtime.mjs");
  const arch = ["ia32", "x64", "armv7l", "arm64", "universal"][context.arch];
  await stageOnnxRuntime({ appDirectory: context.packager.info.appDir, platform: context.electronPlatformName, arch });
  await stageOffline(context.electronPlatformName, arch);
};
