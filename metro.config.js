const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");
const config = getDefaultConfig(__dirname);

config.resolver = config.resolver || {};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "react-native-maps") {
    return {
      filePath: path.resolve(__dirname, "lib/react-native-maps-web-stub.js"),
      type: "sourceFile",
    };
  }
  // Force the CJS build of @clerk/react's legacy entry point (reached via
  // @clerk/expo/legacy, which requires it internally) on every platform.
  // Its ESM (.mjs) build transitively pulls in @clerk/shared's raw
  // `import.meta.env` reference. On web that's a hard SyntaxError once
  // bundled into a non-`type="module"` script (Metro's web export output
  // isn't a module); on Android/iOS, Hermes doesn't support `import.meta`
  // at all and crashes with "import.meta is not supported". The .cjs
  // file's own internal requires resolve as CJS too, so this doesn't just
  // move the problem one hop down the tree.
  if (moduleName === "@clerk/react/legacy") {
    // require.resolve() on a deep path is blocked by the package's own
    // exports map (same restriction that caused the problem in the first
    // place) -- so derive the dist/ dir from the main entry instead.
    const distDir = path.dirname(require.resolve("@clerk/react"));
    return {
      filePath: path.join(distDir, "legacy.cjs"),
      type: "sourceFile",
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, {
  input: "./global.css",
});
