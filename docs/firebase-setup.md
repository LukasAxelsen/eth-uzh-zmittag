# Google sign-in and preference sync

The menu site stays on GitHub Pages. Firebase Authentication handles Google
sign-in; Cloud Firestore holds one private preferences document per user.
No service-account key, Google client secret, Cloud Function or paid billing
is needed by the website. No Analytics SDK is loaded.

Configured on 2026-10-16: project `zmittag-eth-uzh-20261016`, Web App
`Zmittag Web`, Google sign-in enabled, default database in Zurich
(`europe-west6`), Spark plan. The public app config and deployed access
rules are tracked here; the owner's Firebase CLI credentials stay outside
the repository.

## Project setup

1. Open the Firebase console with the project's owner account. Create or
   select the Zmittag project. A new owner must accept the Firebase terms.
2. Register a Web App named Zmittag Web. Copy only the public Firebase config
   object into `template/firebase-config.js` as `window.ZMITTAG_FIREBASE_CONFIG`.
   This public config identifies the app; Firestore rules enforce access.
3. Enable Authentication → Sign-in method → Google. Set the public app name
   to Zmittag and the support email to the project owner's email.
4. In Authentication → Settings → Authorized domains, keep Firebase's own
   domains and add `lukasaxelsen.github.io`, `localhost`, and `127.0.0.1`.
5. Create the default Firestore database, Standard edition, in
   `europe-west6` (Zurich). Leave paid billing, PITR and backups disabled.
6. Deploy the repository's private-by-default rules:

   ```sh
   npx firebase-tools deploy --only firestore:rules --project zmittag-eth-uzh-20261016
   ```

7. Regenerate the site with `python3 menu.py` so the two account assets are
   included in `output/`. Confirm the local UI before committing/deploying.

## Login and data behavior

- Clicking the small avatar or blue Login text opens Google's official popup.
  The signed-in account shows its Google photo/name and a Logout text control.
  This avoids cross-origin redirect-storage problems on GitHub Pages/Safari.
  Popups must be allowed for the site; a blocked popup gets the shared alert.
- New account: upload local preferences. Existing account: the shared alert
  offers cloud, this device or Not now. Not now does not overwrite either
  copy and leaves Choose preferences available in My Data.
- Trusted session restores automatically, merging pending local fields with
  the newest remote fields. Offline changes survive a browser reload.
- Changes to the same field are resolved by server write order. Groups are
  one field, so simultaneous group edits are resolved as a whole collection.
- Dates are never persisted or synchronized. Sign-out keeps local preferences.
- Names/avatars come from Firebase Auth; Firestore stores only preference
  fields and a server timestamp. Other users cannot read/list these documents.
- Deleted default groups are saved in the optional `hiddenGroups` list. Old
  documents default to an empty list. Deploy the updated `firestore.rules`
  together with this frontend so writes containing the new field are accepted.

## Verification

```sh
node scripts/test-account-sync.mjs
npm run test:browser
python3 scripts/verify-anim-contract.py
```

The browser fixtures explicitly disable production Firebase. The state-machine
tests cover initial upload, both conflict choices, offline reloads, independent
field merges, rapid write reversals and account isolation. Validate real Google
login and cross-device delivery separately after project configuration.

Primary references: [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin),
[redirect storage and popup alternative](https://firebase.google.com/docs/auth/web/redirect-best-practices),
[Firestore access rules](https://firebase.google.com/docs/firestore/security/rules-conditions),
[database locations](https://firebase.google.com/docs/firestore/locations).
