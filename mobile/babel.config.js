module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 ships its Babel plugin from react-native-worklets.
    // Must stay last in the plugins list.
    plugins: ['react-native-worklets/plugin'],
  };
};
