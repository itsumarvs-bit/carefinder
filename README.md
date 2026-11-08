# CareFinder

CareFinder is a mobile-first Ionic Angular directory for discovering healthcare facilities. It uses Firebase Authentication and Cloud Firestore when configured, Leaflet with OpenStreetMap tiles for the facility map, browser geolocation on request, and Google Maps links for external directions.

## Requirements and local development

- Node.js 20.19+ or 22.12+ (the generated toolchain was checked with Node 24.21.0)
- npm
- Ionic CLI 7.2+ (or use the locally installed packages through npm scripts)
- A Firebase project for authentication, live facility data, favorites, and administration

```powershell
npm install
npm start
```

Open the local URL printed by the Angular development server. The app can be browsed without Firebase using four explicitly labeled demonstration facilities. These are not real verified listings; replace them with validated records before production.

## Firebase setup

1. Create a Firebase project and register a Web app in the Firebase console.
2. Enable Email/Password under **Authentication → Sign-in method**.
3. Create a Cloud Firestore database.
4. Copy the Firebase Web app configuration into both:
   - `src/environments/environment.ts`
   - `src/environments/environment.prod.ts`
5. Deploy `firestore.rules` before using the app:

   ```powershell
   npx firebase-tools login
   npx firebase-tools use --add
   npx firebase-tools deploy --only firestore:rules
   ```

   Select the Firebase project that matches the configuration. Firebase Web configuration values identify a project and are not service-account credentials. Never put Admin SDK private keys in this app. Restrict the Firebase API key to the relevant web origins / Android app and configure quotas in Google Cloud.
6. Create the four collections' demonstration documents in the Firestore Console only if desired. Use `firestore/sample-facilities.json` as source data, create each document under `facilities` with the shown document ID, add `createdAt` and `updatedAt` as Firestore timestamps, and keep `isVerified` false. The file intentionally omits server timestamps; direct import does not bypass Firestore rules.
7. Use the Firebase Authentication email templates for password reset delivery. The app does not provision administrator roles.

Firebase settings are public client configuration, but must be paired with strict Firestore rules. A Firebase client key is not authorization. The rules allow public reads only for active facilities, owner-only favorites and profile data, and facility changes only for authenticated users with the trusted `admin` custom claim.

### Provision administrators securely

Do not set a user's role from the client or rely on the `users/{uid}.role` field. An existing project owner must grant the claim from a trusted, access-controlled environment using the Firebase Admin SDK, for example `admin.auth().setCustomUserClaims(uid, { admin: true })`. Protect that environment and its credentials; never include credentials in this repository or frontend bundle. Have the user sign out and sign back in after claims are granted. Revoke with `setCustomUserClaims(uid, { admin: false })` or clear claims using trusted Admin SDK tooling. Firestore rules independently enforce this claim on every admin read/write.

## Data model

### `facilities/{facilityId}`

Required: `name` (string), `category` (`hospital`, `clinic`, `pharmacy`, or `health_center`), `address` (string), `isVerified` (boolean), `isActive` (boolean), `createdAt` and `updatedAt` (timestamps). Imported OpenStreetMap candidates may have an empty `name` or `address`; the public UI labels those values as not provided rather than inventing data.

Optional: `slug`, `description`, `barangay`, `city`, `province`, `region`, `contactNumber`, `email`, `website`, `latitude` and `longitude` (both numbers, together), `imageUrl`, `services` (string array), `amenities` (string array), `operatingHours` (weekday-keyed map), and `timeZone` (IANA time zone, e.g. `Asia/Manila`). Unknown or incomplete operating schedules are displayed as **Hours unavailable**. Hours use 24-hour `HH:mm`; overnight closing times earlier than opening times are supported.

OpenStreetMap imports use deterministic IDs `osm_node_{osmId}`, `osm_way_{osmId}`, or `osm_relation_{osmId}` and store top-level `osmType`, `osmId`, `source: "openstreetmap"`, and `geographicReview`. The immutable `sourceData` map retains original OSM tags, URL, coordinates, name/category/address/contact data, attribution, and dataset provenance. The normal facility fields remain administrator-editable; re-imports skip existing IDs and never overwrite those corrections. New imports are unverified and active. Changes to source snapshots are blocked by Firestore Rules.

The browse view reads active Firestore documents and performs case-insensitive name, address, city, barangay, province, and service substring matching on the client. This avoids pretending Firestore supports arbitrary full-text queries. For a large directory, integrate a dedicated search index (such as Algolia or Typesense), configure its access controls, and document its costs and data synchronization.

### `users/{uid}` and `users/{uid}/favorites/{facilityId}`

User IDs are Firebase Authentication UIDs. A profile contains `uid`, `displayName`, `email`, `role` (created as `user`), `createdAt`, and `updatedAt`. Ordinary profile edits cannot change the role. A favorite document ID is the facility ID and contains `facilityId` and `createdAt`. Favorites sync through Firestore for the same signed-in account.

## Maps and location

- Leaflet displays saved facility coordinates and live healthcare places from OpenStreetMap on the map. The map opens centered on the Philippines; zoom in to level 8 or closer to search the visible area for mapped hospitals, clinics/doctors, pharmacies, dentists, and health centers. Pan or zoom to load other areas across the country. This viewport-based search avoids an oversized query for the entire Philippines.
- OpenStreetMap is community-maintained, so facility coverage, names, and addresses vary by location and are not independently verified by CareFinder. Results are for discovery and should be confirmed with the facility. A place absent from the map is not proof that no facility exists there. Live results require an internet connection and the public Overpass API can be temporarily unavailable or rate-limited.
- OpenStreetMap data is available under the Open Database License; retain the map attribution. No Google Maps API key is needed for the embedded map.
- OpenStreetMap tile use is subject to the public tile service's usage policy; use an appropriate provider for production-scale traffic and retain attribution.
- Geolocation is requested only after the user presses **Use my location**. If permission is denied or unavailable, search and the facility list remain usable.
- Distance ordering is Haversine straight-line distance, never driving distance or travel time.
- Directions open an external Google Maps URL using coordinates when available or the address otherwise. There is no traffic or turn-by-turn claim.
- On a browser, geolocation requires a secure context (HTTPS or localhost). Android device testing requires Android Studio and a configured Android SDK.

## Administration

Once a trusted administrator claim is assigned, sign in and visit **Profile → Admin dashboard**. Admins can create, edit, activate/deactivate, verify/unverify, search, and delete facility records. Deletion requires confirmation. The image field accepts a URL; Firebase Storage upload is not configured. The operating-hours field accepts a JSON map; enter only confirmed schedule data. The dashboard shows counts across all facility records.

### Bulk importing OpenStreetMap facilities

From the admin dashboard choose **Import facilities** and upload a CSV or JSON file. The importer previews and validates each record, checks deterministic IDs against the existing facilities collection, and writes new records in Firestore batches of at most 400. Repeated identifiers are excluded, existing documents are never overwritten, possible nearby duplicates are only warnings, and failed batches are reported independently. Review unknown source categories in the preview and choose a normalized category; the original category remains in `sourceData`.

The supplied MIMAROPA candidate dataset was filtered using approximate province-area windows, not an authoritative boundary. Before importing, compare every selected point with an authoritative MIMAROPA administrative boundary, set a geographic review status for each selected row, and confirm the boundary check. Records still uncertain are imported with `geographicReview: "uncertain"`; records marked outside or unreviewed cannot be imported. Original coordinates are preserved separately from administrator-editable coordinates. This app does not bundle an authoritative boundary file and does not claim that the source extract itself confirms regional membership.

The import screen requires Firestore access under the existing administrator custom claim. Deploy the updated `firestore.rules` before production use. Guest browsing, the existing sign-in-gated favorites, and live Overpass discovery remain available; the map omits live results whose OSM type and ID already match an active imported facility.

## Sample records

The app falls back to four non-verified demo entries while Firebase client settings are blank. Their IDs, coordinates, names, and contact values are illustrative. They are not included in a live Firestore collection unless an administrator deliberately creates them. Replace them with validated facility information and actual coordinates before deployment.

## Build, browser, Android, and deployment

```powershell
npm run build
npx ionic cap add android
npx ionic cap sync android
npx ionic cap open android
```

The Android steps require Android Studio and its SDK. For a browser preview, use `npm start` and test with location permission both allowed and denied. A production web deployment builds to `www`; after configuring the Firebase CLI project, deploy Firestore rules and Firebase Hosting:

```powershell
npm run build
npx firebase-tools deploy --only firestore:rules,hosting
```

The hosting configuration in `firebase.json` includes the Angular single-page-app rewrite. Add the deployed host to Firebase Authentication's authorized domains. Configure appropriate Firebase API key restrictions and quotas. Android/iOS projects are generated locally by Capacitor and should be reviewed for platform-specific permissions and signing before release.

## Validation notes

`npm run build` and `npm test -- --watch=false --isolate=false` validate compilation and unit-level utility behavior. Full authentication, Firestore authorization, favorites synchronization, and admin workflows require a configured Firebase project; test security rules against the Firebase Emulator Suite before production. No successful live Firebase requests are claimed until the app is configured and exercised against that project.
#   c a r e f i n d e r  
 