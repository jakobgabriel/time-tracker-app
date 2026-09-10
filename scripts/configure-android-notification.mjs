#!/usr/bin/env node
/**
 * Installs the ongoing-notification plugin into the generated Android project.
 *
 * `tauri android init` regenerates `src-tauri/gen/android` from a template, so
 * the Kotlin lives in `src-tauri/android/notification/` and is copied in here —
 * the same arrangement as the signing config. Run it after `android init` and
 * before a build.
 *
 * Everything it installs is inert unless the app calls the plugin, which only
 * happens on Android.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const IDENTIFIER = "com.jakobgabriel.tempo";
const SOURCE = "src-tauri/android/notification";
const GEN = "src-tauri/gen/android";
const JAVA = join(GEN, "app/src/main/java", ...IDENTIFIER.split("."));
const MANIFEST = join(GEN, "app/src/main/AndroidManifest.xml");
const RULES = join(GEN, "app/proguard-tempo.pro");

if (!existsSync(GEN)) {
  console.error(`${GEN} is missing — run \`tauri android init\` first`);
  process.exit(1);
}

mkdirSync(JAVA, { recursive: true });
for (const file of readdirSync(SOURCE)) {
  copyFileSync(join(SOURCE, file), join(JAVA, file));
  console.log(`installed ${file}`);
}

// A release build runs R8, and Tauri finds a plugin by name at runtime —
// `register_android_plugin("com.jakobgabriel.tempo", "NotifyPlugin")` — so
// nothing in the bytecode references these classes and R8 would drop them.
// The template's `proguardFiles` picks up every *.pro next to it.
writeFileSync(
  RULES,
  `# Written by scripts/configure-android-notification.mjs.
# Tauri loads plugins, and parses their arguments, reflectively.
-keep @app.tauri.annotation.TauriPlugin class * { *; }
-keep @app.tauri.annotation.InvokeArg class * { *; }
-keep class com.jakobgabriel.tempo.** { *; }
`,
);
console.log("wrote proguard-tempo.pro");

let manifest = readFileSync(MANIFEST, "utf8");

const PERMISSIONS = [
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />',
];

const COMPONENTS = `
        <service
            android:name=".TimerService"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Shows the timer the user started" />
        </service>

        <service
            android:name=".TimerTile"
            android:exported="true"
            android:icon="@mipmap/ic_launcher"
            android:label="Tempo"
            android:permission="android.permission.BIND_QUICK_SETTINGS_TILE">
            <intent-filter>
                <action android:name="android.service.quicksettings.action.QS_TILE" />
            </intent-filter>
        </service>
`;

if (manifest.includes(".TimerService")) {
  console.log("AndroidManifest.xml already carries the service — nothing to do");
} else {
  for (const permission of PERMISSIONS) {
    if (!manifest.includes(permission)) {
      manifest = manifest.replace("<application", `    ${permission}\n\n    <application`);
    }
  }
  manifest = manifest.replace("</application>", `${COMPONENTS}    </application>`);
  writeFileSync(MANIFEST, manifest);
  console.log("patched AndroidManifest.xml");
}
