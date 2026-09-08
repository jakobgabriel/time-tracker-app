#!/usr/bin/env node
/**
 * Teaches the generated Gradle project how to sign a release APK.
 *
 * `tauri android init` regenerates `src-tauri/gen/android` from a template that
 * has no signing config, so the edit that the Tauri docs ask you to make by
 * hand is applied here instead — that keeps the generated project out of git
 * while still producing an installable release build.
 *
 * Reads `keystore.properties` from the Gradle root at build time; does nothing
 * (successfully) if the project has already been patched.
 */
import { readFileSync, writeFileSync } from "node:fs";

const GRADLE = "src-tauri/gen/android/app/build.gradle.kts";

const PROPERTIES = `val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}

`;

const SIGNING_CONFIG = `
    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties.getProperty("keyAlias")
            keyPassword = keystoreProperties.getProperty("keyPassword")
            storeFile = keystoreProperties.getProperty("storeFile")?.let { file(it) }
            storePassword = keystoreProperties.getProperty("storePassword")
        }
    }
`;

let gradle = readFileSync(GRADLE, "utf8");

if (gradle.includes("signingConfigs")) {
  console.log("build.gradle.kts already carries a signing config — nothing to do");
  process.exit(0);
}

const anchor = "android {";
if (!gradle.includes(anchor) || !gradle.includes('getByName("release") {')) {
  console.error(`${GRADLE} does not look like the Tauri template; refusing to patch it blindly`);
  process.exit(1);
}

gradle = gradle.replace(anchor, `${PROPERTIES}${anchor}${SIGNING_CONFIG}`);
gradle = gradle.replace(
  'getByName("release") {',
  'getByName("release") {\n            signingConfig = signingConfigs.getByName("release")',
);

writeFileSync(GRADLE, gradle);
console.log("patched build.gradle.kts with a release signing config");
