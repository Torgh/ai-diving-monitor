// Builds the Android app with the Gradle wrapper, on Windows too (Capacitor's `cap run` doesn't find
// gradlew there when the project sits in mobile/android). Run through package.json:
//   bun run android            debug build, installed and started on the emulator or phone (adb)
//   bun run android:release    signed release APK and App Bundle, with the key's SHA-1
//   bun run android:keystore   creates the release key once, outside the repository
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ANDROID = fileURLToPath(new URL("../android/", import.meta.url));
const APP_ID = "io.github.torgh.divedeck";
const WINDOWS = process.platform === "win32";

/** Where the release key and its passwords live: never in the repository. Gradle reads the same file. */
const SIGNING = process.env.DIVEDECK_SIGNING ?? path.join(homedir(), ".android", "divedeck-release.properties");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) fail(`${path.basename(command)} ${args.join(" ")} failed.`);
}

/** The Android SDK: ANDROID_HOME, else where Android Studio puts it. Gradle gets it too. */
const SDK = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk"),
  path.join(homedir(), "Library", "Android", "sdk"),
  path.join(homedir(), "Android", "Sdk"),
].find((dir) => dir && existsSync(dir));
const env = SDK ? { ...process.env, ANDROID_HOME: SDK } : process.env;

// A .bat file runs through cmd.exe on Windows (Node no longer starts one directly), by its full path:
// with NoDefaultCurrentDirectoryInExePath set, cmd doesn't look in the current folder (nor does `cap run`).
const gradle = (...tasks) =>
  WINDOWS
    ? run("cmd.exe", ["/d", "/s", "/c", `""${path.join(ANDROID, "gradlew.bat")}" -q ${tasks.join(" ")}"`], { cwd: ANDROID, env, windowsVerbatimArguments: true })
    : run("./gradlew", ["-q", ...tasks], { cwd: ANDROID, env });

function sdkTool(dir, name) {
  const tool = SDK && path.join(SDK, dir, WINDOWS ? `${name}.exe` : name);
  return tool && existsSync(tool) ? tool : name;
}

function javaTool(name) {
  const tool = process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, "bin", WINDOWS ? `${name}.exe` : name);
  return tool && existsSync(tool) ? tool : name;
}

function readSigning() {
  if (!existsSync(SIGNING)) return null;
  const entries = readFileSync(SIGNING, "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([\w.]+)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]);
  return Object.fromEntries(entries);
}

// Passwords go to keytool through the environment, not its command line (where `ps` or a warning could show them).
const KEY_ENV = "DIVEDECK_KEY_PASSWORD";

function sha1(signing) {
  const out = execFileSync(javaTool("keytool"), ["-list", "-v", "-keystore", signing.storeFile, "-alias", signing.keyAlias, "-storepass:env", KEY_ENV], {
    encoding: "utf8",
    env: { ...process.env, [KEY_ENV]: signing.storePassword },
  });
  return out.match(/SHA1:\s*([0-9A-F:]+)/)?.[1] ?? "(not found)";
}

function keystore() {
  if (existsSync(SIGNING)) return console.log(`The release key is already set up: ${SIGNING}`);
  const storeFile = SIGNING.replace(/\.properties$/, ".jks");
  if (existsSync(storeFile)) fail(`${storeFile} exists but ${SIGNING} doesn't: write its storeFile, storePassword, keyAlias and keyPassword there.`);
  mkdirSync(path.dirname(SIGNING), { recursive: true });
  // PKCS12 keeps one password for the store and the key. Hex, so it can't look like an option or need quoting.
  const password = randomBytes(24).toString("hex");
  run(javaTool("keytool"), [
    "-genkeypair",
    "-keystore", storeFile,
    "-storetype", "PKCS12",
    "-alias", "divedeck",
    "-keyalg", "RSA",
    "-keysize", "4096",
    "-validity", "10000",
    "-dname", "CN=DiveDeck, O=Torgh",
    "-storepass:env", KEY_ENV,
    "-keypass:env", KEY_ENV,
  ], { env: { ...process.env, [KEY_ENV]: password } });
  const props = [
    "# DiveDeck's Android release key. Keep a copy of this file and the .jks somewhere safe:",
    "# an installed app only takes updates signed with the same key.",
    `storeFile=${storeFile.replace(/\\/g, "/")}`,
    `storePassword=${password}`,
    "keyAlias=divedeck",
    `keyPassword=${password}`,
    "",
  ].join("\n");
  writeFileSync(SIGNING, props, { mode: 0o600 });
  console.log(`Created the release key:\n  ${storeFile}\n  ${SIGNING} (its passwords)\nBack both up: without them the app can't be updated on a phone.`);
  console.log(`SHA-1 (for a Google OAuth client of type Android): ${sha1(readSigning())}`);
}

function release() {
  const signing = readSigning();
  if (!signing) fail(`No release key yet. Create it once with: bun run android:keystore`);
  gradle("assembleRelease", "bundleRelease");
  const outputs = path.join(ANDROID, "app", "build", "outputs");
  console.log(`Signed release:\n  ${path.join(outputs, "apk", "release", "app-release.apk")}\n  ${path.join(outputs, "bundle", "release", "app-release.aab")}`);
  console.log(`Signed with the key whose SHA-1 is ${sha1(signing)}`);
}

function debug() {
  gradle("assembleDebug");
  const adb = sdkTool("platform-tools", "adb");
  // With several devices attached, ANDROID_SERIAL picks one (adb reads it).
  run(adb, ["install", "-r", path.join(ANDROID, "app", "build", "outputs", "apk", "debug", "app-debug.apk")]);
  run(adb, ["shell", "am", "start", "-n", `${APP_ID}/.MainActivity`]);
}

const command = process.argv[2];
if (command === "keystore") keystore();
else if (command === "release") release();
else if (command === "run") debug();
else fail("Usage: node mobile/scripts/android.mjs run | release | keystore");
