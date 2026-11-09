// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  openRouteServiceApiKey:
    'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZkZDI3YjRmNmNiMTQwODdhNTM3MzZjMDc5MGY5MmQ1IiwiaCI6Im11cm11cjY0In0=',
  firebase: {
    apiKey: 'AIzaSyD_VJ81JwkbFBNTaFqnUtnE9gEjvUprnwg',
    authDomain: 'activity12f2.firebaseapp.com',
    databaseURL:
      'https://activity12f2-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'activity12f2',
    storageBucket: 'activity12f2.firebasestorage.app',
    messagingSenderId: '611492854491',
    appId: '1:611492854491:web:0b22c61e877ed8dff92afe',
    measurementId: 'G-CPWD4Q4CLQ',
  },
  cloudinary: {
    cloudName: 'dmj90as7x',
    uploadPreset: 'carefinder_facility_photos',
    folder: 'carefinder/facilities',
  },
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
