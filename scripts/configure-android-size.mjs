#!/usr/bin/env node
/**
 * Trims the generated Android project down to a phone-sized APK.
 *
 * `tauri android init` regenerates `src-tauri/gen/android` from a template
 * tuned for developing against a device, not for shipping. Three things in it
 * cost a lot of megabytes:
 *
 *  - the debug build type asks Gradle to keep the native debug symbols, and an
 *    unoptimized Rust cdylib carrying them is ~225 MB per architecture;
 *  - the release build type minifies code but not resources;
 *  - AppCompat and Material bring translations for every locale Android knows,
 *    and this app speaks two.
 *
 * Run after `tauri android init` and before a build. It is idempotent, and it
 * verifies every edit landed rather than trusting the replace — the template
 * is upstream's to change.
 */
import { readFileSync, writeFileSync } from "node:fs";

const GRADLE = "src-tauri/gen/android/app/build.gradle.kts";

// The locales the interface actually has. Anything else in AppCompat and
// Material is dead weight the resource shrinker will not touch on its own.
const LOCALES = ["en", "de"];

const KEEP_SYMBOLS =
  /\s*packaging \{\s*jniLibs\.keepDebugSymbols\.add\("\*\/arm64-v8a\/\*\.so"\)\n(?:\s*jniLibs\.keepDebugSymbols\.add\("[^"]+"\)\n)*\s*\}/;

const PACKAGING = `
    packaging {
        // Kotlin and Gradle metadata that nothing reads at runtime.
        resources.excludes += setOf(
            "/META-INF/*.version",
            "/META-INF/*.kotlin_module",
            "/META-INF/com/android/build/gradle/app-metadata.properties",
            "/kotlin/**",
            "DebugProbesKt.bin",
        )
    }

    // The signed list of dependencies Play uses; an APK built here has no use
    // for it.
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }
`;

let gradle = readFileSync(GRADLE, "utf8");
const before = gradle;

if (!gradle.includes("android {") || !gradle.includes('getByName("release") {')) {
  console.error(`${GRADLE} does not look like the Tauri template; refusing to patch it blindly`);
  process.exit(1);
}

// 1. Stop the debug build type from keeping ~225 MB of native symbols per ABI.
gradle = gradle.replace(KEEP_SYMBOLS, "");

// 2. Shrink resources alongside the code, which the template already minifies.
if (!gradle.includes("isShrinkResources")) {
  gradle = gradle.replace(
    'getByName("release") {\n            isMinifyEnabled = true',
    'getByName("release") {\n            isMinifyEnabled = true\n            isShrinkResources = true',
  );
}

// 3. Drop every locale the app does not speak.
if (!gradle.includes("localeFilters")) {
  const locales = LOCALES.map((l) => `"${l}"`).join(", ");
  gradle = gradle.replace(
    "    buildTypes {",
    `    androidResources {\n        localeFilters += listOf(${locales})\n    }\n\n    buildTypes {`,
  );
}

// 4. Leave out packaging that only a store listing needs.
if (!gradle.includes("dependenciesInfo")) {
  gradle = gradle.replace("    buildTypes {", `${PACKAGING}\n    buildTypes {`);
}

if (gradle !== before) writeFileSync(GRADLE, gradle);

// Verify, rather than assume. A silently missed replace here is a 600 MB APK.
const expected = [
  ["isShrinkResources = true", "resource shrinking"],
  ["localeFilters += listOf(", "locale filtering"],
  ["dependenciesInfo {", "dependency-info removal"],
];
let failed = false;
for (const [needle, what] of expected) {
  if (!gradle.includes(needle)) {
    console.error(`could not apply ${what} — the template has moved`);
    failed = true;
  }
}
if (gradle.includes("keepDebugSymbols")) {
  console.error("the debug build type still keeps native debug symbols — the template has moved");
  failed = true;
}
process.exit(failed ? 1 : 0);
