const appJson = require('./app.json');

module.exports = () => ({
  ...appJson.expo,

  android: {
  ...appJson.expo.android,

  googleServicesFile:
    process.env.GOOGLE_SERVICES_JSON || './google-services.json',

  permissions: [
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_LOCATION',
  ],

  blockedPermissions: [
    'android.permission.RECORD_AUDIO',
  ],
},

  ios: {
    ...appJson.expo.ios,
    infoPlist: {
      ...appJson.expo.ios.infoPlist,
      UIBackgroundModes: ['location'],
    },
  },
});