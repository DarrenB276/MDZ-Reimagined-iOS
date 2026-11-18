// The game's files, byte for byte: www/ must be exactly the released public build (the servers' anti-cheat compares every player's
// game files with their own - one changed byte in data.js / c2runtime.js / mdzac.js and the player is kicked or banned).
//   node check-www.cjs make  <www dir> <manifest.json> <version>   writes the manifest (size + SHA-256 of every file)
//   node check-www.cjs check <www dir> <manifest.json>             exit 1 when a file differs, is missing or is extra
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const [MODE, DIR, MAN, VER] = process.argv.slice(2);
if (!/^(make|check)$/.test(MODE || "") || !DIR || !MAN) { console.error("usage: check-www.cjs make|check <www dir> <manifest.json> [version]"); process.exit(1); }
const list = d => { const out = []; const walk = (p, rel) => fs.readdirSync(p, { withFileTypes: true }).forEach(e => {
    const r = rel ? rel + "/" + e.name : e.name; if (e.isDirectory()) walk(path.join(p, e.name), r); else out.push(r); }); walk(d, ""); return out.sort(); };
const sum = f => { const b = fs.readFileSync(f); return [b.length, crypto.createHash("sha256").update(b).digest("hex")]; };
if (MODE === "make") {
    const files = {}; list(DIR).forEach(r => { files[r] = sum(path.join(DIR, r)); });
    fs.writeFileSync(MAN, JSON.stringify({ version: VER || "", files }, null, 0).replace(/\],"/g, "],\n\"") + "\n");
    console.log("manifest: " + Object.keys(files).length + " files (" + (VER || "") + ")"); process.exit(0);
}
const M = JSON.parse(fs.readFileSync(MAN, "utf8")), have = list(DIR), bad = [];
for (const r of Object.keys(M.files)) { const f = path.join(DIR, r);
    if (!fs.existsSync(f)) { bad.push("missing  " + r); continue; }
    const s = sum(f); if (s[0] !== M.files[r][0] || s[1] !== M.files[r][1]) bad.push("CHANGED  " + r); }
have.filter(r => !M.files[r]).forEach(r => bad.push("extra    " + r));
if (bad.length) { console.log(bad.slice(0, 50).join("\n")); console.log("www is NOT the released game " + M.version + ": " + bad.length + " differences"); process.exit(1); }
console.log("www = the released game " + M.version + " byte for byte (" + have.length + " files)");
