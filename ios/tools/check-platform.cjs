// After "cordova prepare ios": the app's www (platforms/ios/www) must be the game's www byte for byte plus the iOS Cordova files the
// servers accept (ios/platform_www, their anti-cheat hashes in ios/ac-platform.json). Steps:
//   1. what Cordova made is the same code as the committed platform files (cordova.js and every plugin module byte for byte; the plugin
//      list the same modules) - else the pinned versions did not give what the servers were built for: stop
//   2. the committed platform files copied over (their bytes are the ones the servers know)
//   3. every game file in the app = www/ (except the platform files), every platform file's anti-cheat hash = ac-platform.json
//   node check-platform.cjs <platforms/ios/www> <ios/platform_www> <www> <ios/ac-platform.json>
"use strict";
const fs = require("fs"), path = require("path");
const { fileHash } = require("./ac-hash.cjs");
const [APP, PLAT, WWW, ACJ] = process.argv.slice(2).map(p => p && path.resolve(p));
if (!APP || !PLAT || !WWW || !ACJ) { console.error("usage: check-platform.cjs <app www> <platform_www> <www> <ac-platform.json>"); process.exit(1); }
const list = d => { const out = []; const walk = (p, rel) => fs.readdirSync(p, { withFileTypes: true }).forEach(e => {
    const r = rel ? rel + "/" + e.name : e.name; if (e.isDirectory()) walk(path.join(p, e.name), r); else out.push(r); }); walk(d, ""); return out.sort(); };
const same = (a, b) => fs.existsSync(a) && fs.existsSync(b) && Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0;
const pluginList = f => { let mods = null, meta = null; const cordova = { define: (n, fn) => { const module = { exports: {} }; fn(null, module.exports, module); mods = module.exports; meta = module.exports.metadata; } };
    new Function("cordova", fs.readFileSync(f, "utf8"))(cordova); return { mods: mods.map(m => JSON.stringify(m)).sort(), meta: JSON.stringify(meta) }; };
const fail = m => { console.log("FAIL " + m); process.exit(1); };
const platFiles = list(PLAT);
// 1.
for (const r of platFiles) {
    const made = path.join(APP, r), ours = path.join(PLAT, r);
    if (!fs.existsSync(made)) fail("cordova did not make " + r);
    if (r === "cordova_plugins.js") { const a = pluginList(made), b = pluginList(ours);
        if (JSON.stringify(a.mods) !== JSON.stringify(b.mods) || a.meta !== b.meta) fail("the plugin list differs from ios/platform_www/cordova_plugins.js:\n" + fs.readFileSync(made, "utf8").slice(0, 3000)); }
    else if (!same(made, ours)) fail(r + " differs from ios/platform_www (cordova-ios / cordova-plugin-file not the pinned versions?)");
}
list(path.join(APP, "plugins")).forEach(r => { r = "plugins/" + r; if (!fs.existsSync(path.join(PLAT, r)) && !fs.existsSync(path.join(WWW, r))) fail("cordova made an unexpected plugin file " + r); });
console.log("1. cordova's iOS files = ios/platform_www (" + platFiles.length + " files)");
// 2.
for (const r of platFiles) fs.copyFileSync(path.join(PLAT, r), path.join(APP, r));
console.log("2. ios/platform_www copied into the app");
// 3.
const AC = JSON.parse(fs.readFileSync(ACJ, "utf8")), plat = new Set(platFiles);
let n = 0;
for (const r of list(WWW)) { if (plat.has(r)) continue; if (!same(path.join(WWW, r), path.join(APP, r))) fail("game file " + r + " is not the game's in the app"); n++; }
for (const r of platFiles) { const h = fileHash(path.join(APP, r)); if (AC[r] !== h) fail(r + ": anti-cheat hash " + h + ", the servers accept " + AC[r]); }
const extra = list(APP).filter(r => !plat.has(r) && !fs.existsSync(path.join(WWW, r)));
console.log("3. the app's www: " + n + " game files unchanged, " + platFiles.length + " iOS Cordova files with the servers' hashes" + (extra.length ? ", also " + extra.join(", ") : ""));
