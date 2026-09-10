# Building the APK

Four ways, cheapest first. The repository is public, so the GitHub Actions route costs nothing.

## 1. GitHub Actions (nothing to install)

Push to `main` or any `claude/**` branch, or run the **Android APK** workflow by hand, and download
the `tempo-apk` artifact from the run. It holds one APK per architecture — `app-arm64-v8a-*.apk`
is the one for any phone from the last several years. Tagging `v0.1.0` also attaches them to a
release.

These are release builds: 7.9 MB for `arm64` (any phone from the last several years), 5.6 MB for
32-bit `arm`, and two x86 builds for emulators. Release APKs must be signed, so without signing
secrets the workflow generates a throwaway key — a different one every run, so Android will refuse
to install over an APK from an earlier run. Uninstall first, or add the four secrets listed in the
README to sign with a key that stays the same.

Install by allowing "install unknown apps" for the browser or file manager you open the APK with.

## 2. On your own machine

Needed once: **Node 22+**, **Rust**, **JDK 17**, and the Android **SDK platform 36**, **build-tools
36** and **NDK 27**. Android Studio's SDK Manager is the least painful way to get the last three —
the NDK lives under the *SDK Tools* tab with *Show Package Details* ticked.

```bash
export ANDROID_HOME=~/Android/Sdk                    # macOS: ~/Library/Android/sdk
export NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018"    # whichever 27.x you installed
rustup target add aarch64-linux-android armv7-linux-androideabi \
                  i686-linux-android x86_64-linux-android

npm install
npm run android:init                                  # generates src-tauri/gen/android
node scripts/configure-android-notification.mjs       # installs the notification plugin
node scripts/configure-android-size.mjs               # trims the generated project
npm run android:build                                 # --apk
```

The APK lands in `src-tauri/gen/android/app/build/outputs/apk/`. Sign it (below) — a release APK is
not installable until you do.

With a phone plugged in and USB debugging on, `npm run android:dev` installs a live-reloading
build — that is also how to iterate on the notification code, which has never run on a device.

### Signing a release build locally

```bash
keytool -genkey -v -keystore tempo.jks -keyalg RSA -keysize 2048 -validity 10000 -alias tempo
cp tempo.jks src-tauri/gen/android/keystore.jks
cat > src-tauri/gen/android/keystore.properties <<EOF
storeFile=keystore.jks
keyAlias=tempo
keyPassword=…
storePassword=…
EOF
node scripts/configure-signing.mjs
npm run android:build
```

Keep the keystore out of the repository — `.gitignore` already covers `*.jks` and
`keystore.properties`. Losing it means never being able to update an installed app in place.

## 3. Docker, if you would rather not install the SDK

Any image with the Android SDK, NDK and Rust works; the steps are the ones above. This keeps the
toolchain off your machine and makes the build reproducible, at the cost of a large image.

## 4. A self-hosted Actions runner

If the repository ever goes private again, installing GitHub's runner on a machine you leave on
lets the existing workflow build there — free, private, and no change beyond `runs-on: self-hosted`.

## Why the APK is the size it is

A phone-sized APK is 7.9 MB, measured. Almost all of that is AndroidX and Material: the Rust
library is 0.3 MB and the interface 288 KB.

Two things will make it enormous if you let them:

- **A debug build.** Cargo's dev profile is unoptimized and carries full debug info — the same
  library that is 0.3 MB in release is **225 MB** in debug — and the Tauri template's debug build
  type explicitly asks Gradle to keep those symbols in the APK. Four architectures of that is where
  a 600 MB download comes from. Debug builds are for `android:dev` against a plugged-in phone.
- **A universal APK.** It carries the native library for all four architectures. `--split-per-abi`
  gives one APK per architecture instead, and a phone needs exactly one.

`scripts/configure-android-size.mjs` handles the rest against the generated project: resource
shrinking on top of the code minification the template already does, and dropping the ~80 locales
AppCompat and Material ship that this app does not speak. CI fails the build if any APK comes out
over 50 MB, so this cannot quietly regress.

## Installing it on the phone

Send the APK to yourself (or `adb install path/to/app.apk` over USB). Android will ask you to allow
installs from whichever app opened it. A debug-signed and a release-signed APK cannot replace one
another — uninstall first when switching between them, or when the CI key changed under you.
