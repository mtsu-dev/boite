# Native Android app

`apps/mobile` is the native Android package, meant for Google Play and for
phones without Google services. It is a Tauri 2 app that embeds the same UI
bundle as the shell and the phone web app, built with
`vite build --mode mobile`. It has no core of its own: like the
[Trusted Web Activity](android.md) it is a client of the machines its phone is
added to, but it needs no Chrome and loads no page from the network. The
package is `dev.mtsu.boite`. The nightly builds and signs it, and the app
updates itself from there until it is on Play ([updates](#updates)).

## Limits

What the app does not do yet, or what nobody has checked on a phone:

| Area | State |
| --- | --- |
| Notifications | No push. They arrive only while the app is open. |
| Updates | From the nightly only: no stable release carries the APK yet. The first build with the updater is installed by hand. |
| Distribution | No Play listing. No Play bundle (AAB) was built yet, and a Play build must leave the updater out. |
| CI | A pull request builds the APK only when it changes `apps/mobile`, and no required check waits for it: a UI change that breaks the app fails that night's release. |
| QR code | The manifest asks for no camera, so pairing is by pasting the link. Scanning was never tried. |
| Networks | Tested only through `adb reverse` to a core on a PC. A core on the LAN or a tailnet is untested. |
| HTML views | Framing a core's `/view/` page is allowed by the policy, never tried on a phone. |
| Offline | No copy of a thread stays on the phone: each opens from the core. |
| Processors | arm64 only. |
| Platforms | No iOS build. `gen/apple` does not exist yet. |
| Package name | `dev.mtsu.boite` becomes permanent once published on Play. |

## What differs from the web app

- `MOBILE_BUILD` (`import.meta.env.MODE === 'mobile'`) tells the UI it is the
  Android app. `desktopShell()` is false there even though Tauri is present, so
  nothing asks for the shell's local core, its windows or its native dialogs.
  `tauriApp()` stays true, so external links go through the opener plugin
  instead of replacing the app's page. Every other build has `MOBILE_BUILD`
  false as a constant, so the bundler drops these branches.
- The page origin is `http://tauri.localhost`, the app's packaged files.
  `appPage()` is true there, as on the phone app's own address
  ([phone](phone.md#the-app-on-its-own-address)): the page is never tried as a
  core, and the first screen is the way in, scan or paste a link from another
  machine of the group. The core accepts that origin on its WebSocket
  (`SHELL_ORIGINS`), and `*.localhost` is a secure context, so the device key
  uses WebCrypto.
- Cleartext traffic is allowed, release included, and `reachableFromApp()`
  accepts plain `http:` addresses: no mixed content blocks a core on the LAN
  or a tailnet.
- The app reports itself to the core as `pwa`, the phone client, so every rule
  the core applies to the phone web app applies to it.
- The mobile build ships no service worker and no web manifest
  (`dropWorker` in `packages/ui/vite.config.ts`): the files are already in the
  APK, compressed by Tauri. Without a service worker there is no Web Push.
- The content security policy matches the phone web app's needs: plugin
  scripts run as `blob:` modules, and HTML views frame a core's `/view/`
  pages. The opener plugin may open `http` and `https` URLs only.
- `MainActivity` exposes `BoiteAndroid.ready()`. The UI calls it two frames
  after its first mount, which calls `reportFullyDrawn()`: that is the time
  `am start -W` and Play vitals report as fully drawn.

## Building

Requirements: Rust with the `aarch64-linux-android` standard library, JDK 17,
the Android SDK (platform 36, build-tools) and an NDK, with `JAVA_HOME`,
`ANDROID_HOME` and `NDK_HOME` set.

```sh
cd apps/mobile
bunx tauri android build --apk --target aarch64
```

The APK is
`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`.
`--aab` instead of `--apk` builds the Play bundle. Only arm64 is built: every
current Android phone is arm64, and each extra ABI adds a full copy of the
native library.

Release signing reads `src-tauri/gen/android/keystore.properties`, which git
ignores:

```properties
storeFile=/absolute/path/to/release.jks
storePassword=...
keyAlias=...
keyPassword=...
```

Without that file the release APK is unsigned.

The release profile favours size: `opt-level = "z"`, fat LTO, one codegen
unit, `panic = "abort"` and stripped symbols. R8 minifies the Java side and
drops unused resources. The template's Material Components dependency is gone;
the theme is AppCompat with the app's dark ground as the window background, so
the launch never flashes white.

`tauri android init` generated `src-tauri/gen/android`, and that project is
tracked with the edits above. `bunx tauri icon src-tauri/icons/icon.png`
regenerates the launcher icons from the app icon.

## Updates

The UI is inside the APK, so a new UI needs a new APK. Outside a store the app
updates itself, through the same Updates card as the desktop app
(Settings, Machines):

- `mobile.yml` builds the APK. The nightly runs it with the release's version
  and signs it with the key of the other Android apps (`ANDROID_KEYSTORE`,
  alias `boite`). The release publishes `boite-mobile_<version>_android.apk`
  beside the other files, and the release notes link it.
- The version code is the build's time, in minutes since 2020-01-01 UTC. Each
  build gets a higher code than every build before it, whatever its channel,
  so Android installs it over any of them. A build made by hand keeps the
  code 1 of `tauri.conf.json`, which every release replaces.
- `lib/app-update-android.ts` reads GitHub's release list, 8 seconds after
  launch, every 6 hours and on Check for updates, and picks the newest APK of
  the channel. Within a channel only a higher version is offered. Switching
  channel offers the other one's newest build only when it was published after
  this build: an older one has a lower code and Android would refuse it.
- `AppUpdates.kt` answers on `window.BoiteUpdater`, a message port
  (`addWebMessageListener`) that Android injects only into
  `http://tauri.localhost` and that answers only its main frame: an HTML view
  in a frame cannot reach it. A WebView without that feature gets no Updates
  card. It downloads the APK to the app's
  cache, then refuses it unless it is `dev.mtsu.boite`, has a higher version
  code and is signed by the installed app's key. It then opens a
  `PackageInstaller` session. Android asks once to let Boite install apps,
  then shows its own confirmation. Once the app installed itself, Android 12
  and later skip that confirmation (`UPDATE_PACKAGES_WITHOUT_USER_ACTION`).
  Google Play Protect, where the phone has it, still offers to scan an app it
  does not know before each install. Boite stops while it installs; on the
  OnePlus 8T it reopened on its own both times.
- The card is the desktop one: Update downloads and checks the APK, then
  Restart installs it. A failed download leaves the card in error, and the
  next Update reads the release list again.
- Android itself refuses an APK signed by another key or with a lower code,
  whatever the app checks. The release's Minisign signature, which the desktop
  updater checks, is not read here.

A test build can read another release list:
`VITE_APP_UPDATE_FEED=<url> bunx tauri android build --apk --target aarch64`.

Google Play forbids an app that updates itself (`REQUEST_INSTALL_PACKAGES` for
that purpose). The Play build must drop both install permissions,
`AppUpdates.kt` and the `BoiteUpdater` bridge; without the bridge the UI shows
no Updates card. Play App Signing must use the same key, or a phone that
installed the APK cannot take Play's updates.

## Measurements

Measured on 2026-11-15 on a OnePlus 8T (Snapdragon 865, LineageOS on
Android 17, AOSP WebView 155, no Google services), paired through
`adb reverse` to a core on a Windows PC.

| | Value |
| --- | --- |
| APK, arm64 release | 8.17 MB |
| Native library, embedded UI included | 6.34 MB |
| `classes.dex` | 1.98 MB |
| `am start -W` TotalTime, cold | 88 to 106 ms |
| Fully drawn, cold, not paired | 487 to 536 ms over 5 starts |
| Fully drawn, cold, paired | 506 to 530 ms over 5 starts |
| PSS after a cold start, not paired / paired | 126 MB / 139 MB |

The cold start loop:

```sh
for i in 1 2 3 4 5; do
  am force-stop dev.mtsu.boite; sleep 1; logcat -c
  am start -W -n dev.mtsu.boite/.MainActivity | grep TotalTime
  sleep 3; logcat -d | grep 'Fully drawn dev.mtsu.boite'
done
dumpsys meminfo dev.mtsu.boite | grep 'TOTAL PSS'
```
