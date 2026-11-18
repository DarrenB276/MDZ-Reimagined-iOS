// The servers' anti-cheat on Apple's browser engine (WebKit = Safari and every iPhone browser / app), run by the workflow on a Mac.
// The game is loaded in Chromium (a server's own page: its baseline) and in WebKit twice - with the game's files (Safari) and with the
// iPhone app's Cordova files (ios/platform_www, as the .ipa has them). Each WebKit report is judged by the server's rules (MDZNet
// acReport / acReportV2): anything they would call a cheat fails the run.
//   node webkit-ac.cjs <www dir>
"use strict";
const fs = require("fs"), path = require("path"), http = require("http");
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
// (a local smoke run without WebKit: SECOND_ENGINE=chromium, CHROMIUM_PATH=<chrome.exe>)
const SECOND = process.env.SECOND_ENGINE === "chromium" ? chromium : webkit, LAUNCH = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const WWW = path.resolve(process.argv[2] || "www"), PLAT = path.join(__dirname, "..", "platform_www");
const AC = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "ac-platform.json"), "utf8"));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".ogg": "audio/ogg",
    ".m4a": "audio/mp4", ".xml": "text/xml", ".css": "text/css", ".webp": "image/webp", ".txt": "text/plain", ".csv": "text/csv" };
const serve = port => new Promise(res => { const s = http.createServer((q, r) => {
    let rel = decodeURIComponent(q.url.split("?")[0]).replace(/^\/+/, "") || "index.html"; const ios = rel.startsWith("__ios/"); if (ios) rel = rel.slice(6);
    let f = path.join(ios && fs.existsSync(path.join(PLAT, rel)) ? PLAT : WWW, rel);
    if (!f.startsWith(WWW) && !f.startsWith(PLAT)) { r.writeHead(403); r.end(); return; }
    fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); r.end(b); });
}); s.listen(port, "127.0.0.1", () => res(s)); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function report(browserType, name, iosFiles) {
    const b = await browserType.launch(browserType === chromium ? LAUNCH : {}), ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }), page = await ctx.newPage();
    const errors = []; page.on("pageerror", e => errors.push(String(e.message || e).slice(0, 160)));
    if (iosFiles) {
        // the app's files: cordova.js, the plugin list, the file plugin's modules from ios/platform_www (the rest is the game's www); the
        // native side of Cordova is not here - its message channel is a no-op
        await page.addInitScript(() => { window.webkit = window.webkit || {}; window.webkit.messageHandlers = { cordova: { postMessage: function () { } } }; });
        await page.route("**/*", route => { const u = new URL(route.request().url()); const rel = u.pathname.replace(/^\/+/, "");
            if (rel === "cordova.js" || rel === "cordova_plugins.js" || rel.startsWith("plugins/cordova-plugin-file/")) return route.continue({ url: u.origin + "/__ios/" + rel });
            return route.continue(); });
    }
    await page.goto("http://127.0.0.1:8099/index.html");
    const t0 = Date.now(); let up = false;
    while (Date.now() - t0 < 180000) { up = await page.evaluate(() => { try { const r = window.cr_getC2Runtime && window.cr_getC2Runtime(); return !!(r && r.wa && window.__mdzG); } catch (e) { return false; } }).catch(() => false);
        if (up) break; await sleep(1000); }
    if (!up) { await page.screenshot({ path: name + ".png" }); await b.close(); throw new Error(name + ": the game did not start in 180 s " + JSON.stringify(errors.slice(0, 5))); }
    await sleep(8000);
    // what the game's own plugins do all the time (and a script reading the handles: Chromium calls it "automation", the tests' tool)
    await page.evaluate(() => { void window.MDZNet; void window.c2_callFunction; void window.cr_getC2Runtime; }).catch(() => { });
    await sleep(1500);
    const r = await page.evaluate(nonce => new Promise(res => window.__mdzG(nonce, res)), "t-" + name);
    await page.screenshot({ path: name + ".png" }); await b.close();
    console.log("== " + name + ": " + navigatorName(r) + " files " + Object.keys(r.f || {}).length + ", handle reads " + r.c + (r.ns ? ", stack: text (no call sites)" : "") + (errors.length ? ", page errors " + JSON.stringify(errors.slice(0, 3)) : ""));
    return r;
}
const navigatorName = r => r && r.v ? "report v" + r.v + "," : "NO REPORT,";
// the server's rules (MDZNet acReport + acReportV2, the parts a player's browser decides)
function judge(B, r) {
    const sure = [], sus = [], notIn = l => x => (l || []).indexOf(x) < 0;
    if (r.none) sure.push("the anti-cheat file is missing");
    const mk = (r.m || []); if (mk.length) sure.push("cheat tool (" + mk.join(", ") + ")");
    const ok = {}; (B.s || []).forEach(x => { ok[x] = 1; });
    const extra = (r.s || []).filter(x => !ok[x] && x !== "src:cordova.js" && x !== "src:cordova_plugins.js" && x.indexOf("src:plugins/") !== 0);
    if (extra.length) sure.push("scripts that are not the game's (" + extra.join(", ") + ")");
    const changed = Object.keys(r.f || {}).filter(k => B.f[k] && r.f[k] && B.f[k] !== r.f[k] && AC[k] !== r.f[k]);
    if (changed.length) sure.push("changed game files (" + changed.join(", ") + ")");
    const wr = (r.w || []).filter(notIn(B.w)).concat((r.w0 || []).filter(notIn(B.w0)));
    const wSure = wr.filter(x => /^[tj]:/.test(x)), wSus = wr.filter(x => !/^[tj]:/.test(x));
    if (wSure.length) sure.push("browser functions replaced (" + wSure.join(", ") + ")"); if (wSus.length) sus.push("replaced browser functions (" + wSus.join(", ") + ")");
    (r.x || []).filter(h => h[0] !== "automation").forEach(h => sure.push("game code run from outside the game: " + h[0] + " read " + h[1] + " at " + h[2]));
    const px = (r.p || []).filter(notIn(B.p)), CORE = /^(Object|Array|Function|String|Number|Promise|Error|JSON|Math|Reflect|WeakMap)[.]/;
    if (px.some(k => CORE.test(k))) sure.push("traps on the game's objects (" + px.join(", ") + ")"); else if (px.length) sus.push("page objects changed (" + px.join(", ") + ")");
    const gx = (r.g || []).filter(notIn(B.g)); if (gx.length) sure.push("cheat code in the page (" + gx.join(", ") + ")");
    const prex = (r.pre || []).filter(notIn(B.pre)); if (prex.length) sure.push("the game's handles were taken before the game started (" + prex.join(", ") + ")");
    const ox = (r.o || []).filter(notIn(B.o)); if (ox.length) sus.push("cheat menu text (" + ox.join(", ") + ")");
    return { sure, sus };
}
(async () => {
    const srv = await serve(8099); let fail = 0;
    try {
        const base = await report(chromium, "chromium-server", false);
        for (const [name, ios] of [["webkit-safari", false], ["webkit-ios-app", true]]) {
            const r = await report(SECOND, name, ios), j = judge(base, r);
            if (ios) { const plat = Object.keys(r.f || {}).filter(k => AC[k]); const bad = plat.filter(k => AC[k] !== r.f[k]);
                console.log("   iOS Cordova files hashed: " + plat.length + (bad.length ? ", NOT the servers' hashes: " + bad.join(", ") : " (all the servers' hashes)")); if (bad.length) fail++; }
            j.sure.forEach(x => console.log("   CHEAT (the server would " + "ban/kick): " + x)); j.sus.forEach(x => console.log("   suspicious (admins notified): " + x));
            if (j.sure.length) fail++; else console.log("   PASS: the server sees nothing to punish");
        }
    } catch (e) { console.log("FAIL " + e.message); fail++; }
    srv.close(); console.log(fail ? "WEBKIT ANTI-CHEAT CHECK FAILED" : "WEBKIT ANTI-CHEAT CHECK PASSED"); process.exit(fail ? 1 : 0);
})();
