// The iPhone app's own Cordova files (the only files of the .ipa that are not the game's www byte for byte):
//   cordova.js                                   cordova-ios's (the APK's is Android's: it cannot run on iOS)
//   cordova_plugins.js                           the plugin list: cordova-plugin-file only (the game engine reads its files through it on iOS)
//   plugins/cordova-plugin-file/www/**.js        that plugin's modules, wrapped as Cordova wraps them (cordova-ios lib/plugman/pluginHandlers.js)
// The game's servers accept exactly these files by their hashes (MDZNet anti-cheat AC_PLATFORM, round 54c), so they are made here once,
// committed (ios/platform_www), and the workflow copies them over what "cordova prepare" made after checking that both are the same code.
//   node platform-www.cjs <cordova-ios package dir> <cordova-plugin-file package dir> <out dir>
"use strict";
const fs = require("fs"), path = require("path");
const [IOS, FILE, OUT] = process.argv.slice(2).map(p => p && path.resolve(p));
if (!IOS || !FILE || !OUT) { console.error("usage: platform-www.cjs <cordova-ios dir> <cordova-plugin-file dir> <out dir>"); process.exit(1); }
const pkg = JSON.parse(fs.readFileSync(path.join(FILE, "package.json"), "utf8"));
const xml = fs.readFileSync(path.join(FILE, "plugin.xml"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const PID = /<plugin[^>]*\bid="([^"]+)"/.exec(xml)[1];
// the common modules (outside any <platform>), then the ios platform's (cordova-common PluginInfo._getTags order)
const common = xml.replace(/<platform\b[\s\S]*?<\/platform>/g, "");
const iosPart = (/<platform name="ios">([\s\S]*?)<\/platform>/.exec(xml) || [])[1] || "";
const modules = [];
const scan = part => { const re = /<js-module\b([^>]*?)(\/>|>([\s\S]*?)<\/js-module>)/g; let m;
    while ((m = re.exec(part))) { const at = n => (new RegExp("\\b" + n + "=\"([^\"]*)\"").exec(m[1]) || [])[1], body = m[3] || "";
        const tg = t => [...body.matchAll(new RegExp("<" + t + "\\b[^>]*target=\"([^\"]+)\"", "g"))].map(x => x[1]);
        modules.push({ src: at("src"), name: at("name"), clobbers: tg("clobbers"), merges: tg("merges"), runs: /<runs\b/.test(body) }); } };
scan(common); scan(iosPart);
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(path.join(IOS, "templates/project/www/cordova.js"), path.join(OUT, "cordova.js"));
const list = [], seen = new Set();
for (const m of modules) {
    const file = ["plugins", PID, m.src].join("/"); if (seen.has(file)) continue; seen.add(file);
    const name = PID + "." + (m.name || path.basename(m.src, path.extname(m.src)));
    let text = fs.readFileSync(path.join(FILE, m.src), "utf8").replace(/^\ufeff/, "");
    if (/\.json$/.test(m.src)) text = "module.exports = " + text;
    const dst = path.join(OUT, file); fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, `cordova.define("${name}", function(require, exports, module) {\n${text}\n});\n`, "utf8");
    const e = { id: PID + "." + (m.name || /([^/]+)\.js/.exec(m.src)[1]), file, pluginId: PID };
    if (m.clobbers.length) e.clobbers = m.clobbers; if (m.merges.length) e.merges = m.merges; if (m.runs) e.runs = true;
    list.push(e);
}
const ind = s => s.split("\n").join("\n  ");
fs.writeFileSync(path.join(OUT, "cordova_plugins.js"), "cordova.define('cordova/plugin_list', function(require, exports, module) {\n  module.exports = " +
    ind(JSON.stringify(list, null, 2)) + ";\n  module.exports.metadata = " + ind(JSON.stringify({ [PID]: pkg.version }, null, 2)) + ";\n});", "utf8");
console.log("platform www: cordova.js (cordova-ios " + JSON.parse(fs.readFileSync(path.join(IOS, "package.json"), "utf8")).version + "), " + list.length + " modules of " + PID + " " + pkg.version);
