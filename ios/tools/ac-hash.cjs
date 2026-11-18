// The game's anti-cheat hash of each file (net/mdz-anticheat.js hashFile: the text as the page's XMLHttpRequest reads it - UTF-8, a BOM
// dropped - in slices of 500 000 characters, cyrb53 each, then cyrb53 of the slices' hashes + "|" + the length).
//   node ac-hash.cjs <dir> [file ...]      prints {"relative/path": "hash", ...} (every .js file under <dir> when no files are named)
"use strict";
const fs = require("fs"), path = require("path");
const hash = s => { let h1 = 0xdeadbeef, h2 = 0x41c6ce57, i, c; s = String(s);
    for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36); };
const fileHash = f => { const txt = new TextDecoder("utf-8").decode(fs.readFileSync(f)); if (!txt) return ""; const parts = [];
    for (let at = 0; at < txt.length; at += 500000) parts.push(hash(txt.slice(at, at + 500000))); return hash(parts.join(".") + "|" + txt.length); };
module.exports = { hash, fileHash };
if (require.main === module) {
    const dir = path.resolve(process.argv[2]); let files = process.argv.slice(3);
    if (!files.length) { const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name)) files.push(path.relative(dir, p).split(path.sep).join("/")); }); walk(dir); files.sort(); }
    const out = {}; files.forEach(f => { out[f] = fileHash(path.join(dir, f)); }); console.log(JSON.stringify(out, null, 1));
}
