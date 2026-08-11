const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Root workspace packages compile with TypeScript NodeNext and therefore use
// explicit `.js` relative specifiers. During an Expo source build those files
// are still `.ts`; retry only failed relative `.js` requests without the
// extension so Metro can select the platform-appropriate TypeScript source.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    }
    throw error;
  }
};

module.exports = config;
