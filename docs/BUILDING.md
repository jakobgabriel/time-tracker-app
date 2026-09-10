# Building the APK

Four ways, cheapest first. The repository is public, so the GitHub Actions route costs nothing.

## 1. GitHub Actions (nothing to install)

Push to `main` or any `claude/**` branch, or run the **Android APK** workflow by hand, and download
the `tempo-apk` artifact from the run. Tagging `v0.1.0` also attaches the APK to a release.

Without signing secrets the artifact is a **debug-signed** APK — installable on your own phone once
you allow "install unknown apps" for the browser or file manager you open it with. For a release
build, add the four secrets listed in the README and the workflow signs it.

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
npm run android:build                                 # --apk
```

The APK lands in `src-tauri/gen/android/app/build/outputs/apk/`. Add `-- --debug` for a
debug-signed one you can install without a keystore.

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

## Installing it on the phone

Send the APK to yourself (or `adb install path/to/app.apk` over USB). Android will ask you to allow
installs from whichever app opened it. A debug-signed and a release-signed APK cannot replace one
another — uninstall first when switching between them.
