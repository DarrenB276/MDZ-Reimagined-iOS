# MDZ+ Reimagined for iPhone / iPad

The iOS app of **MDZ+ Reimagined** (2.3.9-mp27c3). It is the same game as the Android APK and the PC build, so it plays on the same multiplayer servers.

**Download:** get the `.ipa` from [Releases](../../releases). It is unsigned: your sideloading tool signs it during the install.

## Installing

Use one of these:

- **AltStore / SideStore:** free with your Apple ID. A free Apple ID's signature lasts 7 days; refresh it in the app.
- **Sideloadly** (Windows / Mac): connect the iPhone, drop in the `.ipa`, enter your Apple ID.
- **eSign / Feather / other signers:** use your own certificate.
- **TrollStore** (supported iOS versions only): installs it permanently.

Requirements:

- iOS 13 or newer.
- On iOS 16 and newer, turn on **Settings → Privacy & Security → Developer Mode** once.

## Why the game files must never be edited

Multiplayer servers run an anti-cheat that compares every player's game files with their own. If any file in `www/` is different from the release, even by one byte (an editor saving it again, line endings changed by git, a "fix"), every player of that copy is kicked or banned.

This repository guards against that in three ways:

- `www/` is the released game, byte for byte. [`ios/www-manifest.json`](ios/www-manifest.json) holds the size and SHA-256 of every file, and the build stops if any file differs.
- `.gitattributes` (`* -text`) stops git from changing line endings.
- The only files of the app that are not the game's are iOS Cordova's own:
  - `cordova.js`
  - the plugin list
  - `cordova-plugin-file`, which the game engine needs to read its files on iOS

  These are kept in [`ios/platform_www`](ios/platform_www). The servers (2.3.9-mp27c3 of 18 November 2026 and later) accept exactly these files, by the hashes in [`ios/ac-platform.json`](ios/ac-platform.json).

## How the app is built

[`.github/workflows/build-ipa.yml`](.github/workflows/build-ipa.yml) runs on GitHub's Macs in two jobs.

**First job: anti-cheat check on WebKit.**

1. Checks `www/` against the manifest.
2. Loads the game in Chromium, the way a server sees itself.
3. Loads it in WebKit (Apple's engine) twice: with the game's own files, and with the app's iOS files.
4. Judges both WebKit reports with the servers' anti-cheat rules. The build fails if a server would punish the player.

**Second job: the .ipa.**

1. `cordova create`, then `cordova platform add ios@8.1.1` and `cordova plugin add cordova-plugin-file@8.1.3`.
2. Checks the app's `www` against `www/` and `ios/platform_www`.
3. Runs `xcodebuild archive` without signing and packs `Payload/` into the `.ipa`.
4. Checks the `.ipa`'s game files once more.
5. Uploads the `.ipa` as a workflow artifact and to the release `v<ios/version.txt>`.

## Updating to a new game version

1. Replace `www/` with the new public build's `www`, unchanged.
2. Make the manifest: `node ios/tools/check-www.cjs make www ios/www-manifest.json <version>`.
3. Put the version in `ios/version.txt` and push.

Only change Cordova or plugin versions together with a game build that knows their hashes. Regenerate the files with `ios/tools/platform-www.cjs`, then put the new `ios/ac-platform.json` into the game's anti-cheat.

What the iOS app cannot do:

- **Host a LAN game.** Android's built-in server (MDZHost) is Java-only. Joining LAN games, servers and P2P games works.
- **Play some sounds, on some iPhones.** About a hundred of the game's newer sounds exist only as `.ogg`, which some iOS versions can't play; those sounds are then silent.
