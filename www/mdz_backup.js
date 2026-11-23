// ==== MDZBackup: the whole game's data in one .zip, and back (round 55 SAVE) =====================================
// The user: "Improve and fix the save system: export / import the IndexedDB (progress, profile, world, achievements) as a .zip with a
// progress dialog, PC and mobile" (asked: Export / Import added, the autosave stays).
//
// Main menu > Saves > "Back up all" / "Restore all" (patch 97zzb SV: the plates call MDZBackup.exportAll() / importAll()).
//   Back up    every IndexedDB database of the game's page (indexedDB.databases(); else the game's known ones) - each object store's
//              records (keys and values; Blobs, ArrayBuffers, typed arrays and Dates kept by a tagged form) - and localStorage, into
//              mdz-backup-<date>.zip: backup.json (what is in it), idb/<n>/<m>.json (a store each), localStorage.json, README.txt.
//              Deflated by the browser's CompressionStream where there is one (else stored). A browser downloads it; the APK
//              (Cordova File) writes it to the phone's Download folder (else Android/data/..., else app storage), as MDZSaves does.
//   Restore    the file chooser -> the .zip read and checked (its format, every file's CRC) -> "Restore this backup?" -> each database:
//              made at the file's version with its stores if this device has none (a new phone), else each of its stores emptied and
//              filled with the file's records (a store this device's database lacks is made by an upgrade to the file's version when
//              the file's is newer; else left out and named); localStorage replaced by the file's -> the game starts again (reload).
//              Only from the main menu (no world running: nothing saves in between).
// A dialog shows each step and a bar (records / files done). Strings through MDZNet's translations (net/mdz-lang.js).
// The device's player id (localStorage + IndexedDB) travels with the backup: restoring it on a new phone keeps the survivors a
// server holds for that id; two devices restored from one backup share it (the host names the second "(2)").
(function () {
    "use strict";
    if (window.MDZBackup) return;
    var FORMAT = "mdz-full-backup", VERSION = 1, SKIP_DB = { "mdz_backup_scratch": 1 };
    var KNOWN_DB = ["_C2SaveStates", "localforage", "mdz_native_survivors", "mdz_native_islands", "mdz_world_slots"];
    function tr(s) { try { var n = window.MDZNet && window.MDZNet.inst; return n && n.tr ? n.tr(s) : s; } catch (e) { return s; } }
    function trf(s, a) { return tr(s).replace("{0}", a); }
    function stamp(d) { function p(x) { return (x < 10 ? "0" : "") + x; } return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "-" + p(d.getHours()) + "-" + p(d.getMinutes()); }
    function gameVersion() { try { return String(window.MDZNet && window.MDZNet.gameVersion || ""); } catch (e) { return ""; } }

    // ---- the dialog --------------------------------------------------------------------------------------------------
    var UI = null;
    function ui() {
        if (UI && document.body.contains(UI.root)) return UI;
        var root = document.createElement("div"); root.id = "mdz_backup";
        root.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;background:rgba(0,0,0,0.62);display:flex;align-items:center;justify-content:center;font-family:Arial,Helvetica,sans-serif;touch-action:none";
        var box = document.createElement("div");
        box.style.cssText = "width:min(520px,92vw);background:#1d211c;border:2px solid #6f7a5f;border-radius:8px;padding:18px 20px;color:#e8e4d4;box-shadow:0 8px 30px rgba(0,0,0,0.6)";
        var title = document.createElement("div"); title.style.cssText = "font-size:20px;font-weight:bold;margin-bottom:10px";
        var line = document.createElement("div"); line.style.cssText = "font-size:15px;line-height:1.4;min-height:42px;white-space:pre-wrap;word-break:break-word";
        var barO = document.createElement("div"); barO.style.cssText = "height:14px;background:#0d0f0c;border:1px solid #535b47;border-radius:4px;margin:12px 0;overflow:hidden";
        var bar = document.createElement("div"); bar.style.cssText = "height:100%;width:0%;background:#9cb36a;transition:width 0.15s"; barO.appendChild(bar);
        var btns = document.createElement("div"); btns.style.cssText = "display:flex;gap:10px;justify-content:flex-end;margin-top:6px";
        box.appendChild(title); box.appendChild(line); box.appendChild(barO); box.appendChild(btns); root.appendChild(box);
        // the game below must not take these taps
        ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "mouseup", "click", "keydown"].forEach(function (k) { root.addEventListener(k, function (e) { e.stopPropagation(); }, false); });
        document.body.appendChild(root);
        UI = { root: root, title: title, line: line, bar: bar, barO: barO, btns: btns };
        return UI;
    }
    function show(title, text, frac, buttons) {
        var u = ui(); u.title.textContent = title; u.line.textContent = text || "";
        u.barO.style.display = frac === null || frac === undefined ? "none" : "block"; if (frac !== null && frac !== undefined) u.bar.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + "%";
        u.btns.innerHTML = "";
        (buttons || []).forEach(function (b) { var e = document.createElement("button"); e.textContent = b.text;
            e.style.cssText = "font-size:16px;padding:10px 18px;min-width:110px;border-radius:6px;border:1px solid #6f7a5f;color:#fff;cursor:pointer;background:" + (b.main ? "#4f6b2c" : "#3a3f35");
            e.addEventListener("click", function (ev) { ev.stopPropagation(); b.fn(); }); u.btns.appendChild(e); });
    }
    function hide() { if (UI && UI.root.parentNode) UI.root.parentNode.removeChild(UI.root); UI = null; }
    var busy = false;

    // ---- values: what JSON cannot hold, tagged -------------------------------------------------------------------------
    var TAG = "\u0000mdzbk";
    function b64(u8) { var s = "", CH = 0x8000; for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
    function unb64(s) { var t = atob(s), u = new Uint8Array(t.length); for (var i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; }
    var TYPED = ["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array"];
    // Blobs read first (async), then a plain tree
    function pack(v) {
        if (v === null || typeof v !== "object") return Promise.resolve(v);
        if (typeof Blob !== "undefined" && v instanceof Blob) return new Response(v).arrayBuffer().then(function (b) { var o = {}; o[TAG] = "blob"; o.type = v.type || ""; o.d = b64(new Uint8Array(b)); return o; });
        if (v instanceof Date) { var od = {}; od[TAG] = "date"; od.d = v.getTime(); return Promise.resolve(od); }
        if (v instanceof ArrayBuffer) { var oa = {}; oa[TAG] = "ab"; oa.d = b64(new Uint8Array(v)); return Promise.resolve(oa); }
        if (ArrayBuffer.isView(v)) { var ot = {}; ot[TAG] = "typed"; ot.k = v.constructor && v.constructor.name || "Uint8Array"; ot.d = b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); return Promise.resolve(ot); }
        if (Array.isArray(v)) return Promise.all(v.map(pack));
        var ks = Object.keys(v); return Promise.all(ks.map(function (k) { return pack(v[k]); })).then(function (vals) { var o = {}; ks.forEach(function (k, i) { o[k] = vals[i]; }); return o; });
    }
    function unpack(v) {
        if (v === null || typeof v !== "object") return v;
        if (Array.isArray(v)) return v.map(unpack);
        var t = v[TAG];
        if (t === "blob") return new Blob([unb64(v.d)], { type: v.type || "" });
        if (t === "date") return new Date(v.d);
        if (t === "ab") return unb64(v.d).buffer;
        if (t === "typed") { var u = unb64(v.d), K = TYPED.indexOf(v.k) >= 0 ? window[v.k] : Uint8Array; return new K(u.buffer, 0, u.byteLength / (K.BYTES_PER_ELEMENT || 1)); }
        var o = {}; for (var k in v) o[k] = unpack(v[k]); return o;
    }

    // ---- IndexedDB ------------------------------------------------------------------------------------------------------
    function req(r) { return new Promise(function (ok, no) { r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error || new Error("IndexedDB")); }; }); }
    function dbNames() {
        if (indexedDB.databases) return indexedDB.databases().then(function (l) { return (l || []).filter(function (d) { return d && d.name && !SKIP_DB[d.name]; }).map(function (d) { return d.name; }); }).catch(function () { return probeKnown(); });
        return probeKnown();
    }
    // (no databases(): the game's known names, opened only if they exist - an open of a missing one would make it)
    function probeKnown() {
        return KNOWN_DB.reduce(function (p, name) { return p.then(function (out) { return new Promise(function (ok) {
            var made = false, r = indexedDB.open(name);
            r.onupgradeneeded = function () { made = true; try { r.transaction.abort(); } catch (e) { } };
            r.onsuccess = function () { r.result.close(); if (!made) out.push(name); ok(out); };
            r.onerror = function () { ok(out); }; }); }); }, Promise.resolve([]));
    }
    function openDb(name) { return req(indexedDB.open(name)); }
    function readStore(db, sn, onRec) {
        return new Promise(function (ok, no) {
            var out = [], tx; try { tx = db.transaction(sn, "readonly"); } catch (e) { no(e); return; }
            var c = tx.objectStore(sn).openCursor();
            c.onsuccess = function () { var cur = c.result; if (cur) { out.push([cur.primaryKey, cur.value]); if (onRec) onRec(); cur.continue(); } };
            c.onerror = function () { no(c.error); };
            tx.oncomplete = function () { ok(out); }; tx.onabort = function () { no(tx.error || new Error("read aborted")); };
        });
    }

    // ---- zip (as MDZSaves' round 48 writer, several files; and a reader of all its entries) --------------------------------------
    var CRC = null;
    function crc32(u8) { if (!CRC) { CRC = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
        var x = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) x = CRC[(x ^ u8[i]) & 255] ^ (x >>> 8); return (x ^ 0xFFFFFFFF) >>> 0; }
    function streamBytes(u8, Kind, fmt) { return new Response(new Blob([u8]).stream().pipeThrough(new Kind(fmt))).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
    function deflate(u8) { if (typeof CompressionStream !== "function") return Promise.resolve(null); return streamBytes(u8, CompressionStream, "deflate-raw").catch(function () { return null; }); }
    function makeZip(files, onFile) {
        var enc = new TextEncoder(), parts = [], dir = [], off = 0, d = new Date(), done = 0;
        var dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
        return files.reduce(function (p, f) { return p.then(function () {
            var name = enc.encode(f.name), raw = typeof f.text === "string" ? enc.encode(f.text) : f.text, crc = crc32(raw);
            return deflate(raw).then(function (z) {
                var method = z && z.length < raw.length ? 8 : 0, data = method ? z : raw;
                var h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
                h.setUint16(10, dosT, true); h.setUint16(12, dosD, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, raw.length, true); h.setUint16(26, name.length, true);
                var c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
                c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
                parts.push(new Uint8Array(h.buffer), name, data); dir.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length;
                done++; if (onFile) onFile(done, files.length);
            }); }); }, Promise.resolve()).then(function () {
            var dl = dir.reduce(function (s, x) { return s + x.length; }, 0), e = new DataView(new ArrayBuffer(22));
            e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, dl, true); e.setUint32(16, off, true);
            var all = parts.concat(dir, [new Uint8Array(e.buffer)]), n = all.reduce(function (s, x) { return s + x.length; }, 0), out = new Uint8Array(n), at = 0;
            all.forEach(function (x) { out.set(x, at); at += x.length; }); return out; });
    }
    function readZip(u8, onFile) {          // -> Promise<{name: text}>, every entry's CRC checked
        var v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), e = -1;
        if (!(u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b)) return Promise.reject(new Error(tr("that file is not a .zip")));
        for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
        if (e < 0) return Promise.reject(new Error(tr("that .zip is damaged")));
        var count = v.getUint16(e + 10, true), p = v.getUint32(e + 16, true), dec = new TextDecoder(), ents = [];
        for (var k = 0; k < count; k++) {
            if (v.getUint32(p, true) !== 0x02014b50) return Promise.reject(new Error(tr("that .zip is damaged")));
            var method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true), nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), loc = v.getUint32(p + 42, true);
            ents.push({ name: dec.decode(u8.subarray(p + 46, p + 46 + nlen)), method: method, crc: crc, csize: csize, loc: loc });
            p += 46 + nlen + xlen + clen;
        }
        var out = {}, done = 0;
        return ents.reduce(function (pr, en) { return pr.then(function () {
            var start = en.loc + 30 + v.getUint16(en.loc + 26, true) + v.getUint16(en.loc + 28, true), data = u8.subarray(start, start + en.csize);
            var got = en.method === 0 ? Promise.resolve(data) : en.method === 8 && typeof DecompressionStream === "function" ? streamBytes(data, DecompressionStream, "deflate-raw") : Promise.reject(new Error(tr("this device cannot open that .zip")));
            return got.then(function (raw) { if (crc32(raw) !== en.crc) throw new Error(trf("that .zip is damaged ({0})", en.name)); out[en.name] = dec.decode(raw); done++; if (onFile) onFile(done, ents.length); });
        }); }, Promise.resolve()).then(function () { return out; });
    }

    // ---- files (as MDZSaves: the APK's Download folder, else a browser download; the chooser) -------------------------------------
    function nativeFiles() { return !!(window.cordova && window.cordova.file && typeof window.resolveLocalFileSystemURL === "function"); }
    function writeNative(dirUrl, name, u8) {
        return new Promise(function (resolve, reject) {
            window.resolveLocalFileSystemURL(dirUrl, function (dir) {
                dir.getFile(name, { create: true, exclusive: false }, function (fe) {
                    var blob = new Blob([u8], { type: "application/zip" });
                    fe.createWriter(function (w) { var emptied = false;
                        w.onerror = function (e) { reject(e && e.target && e.target.error || new Error("write failed")); };
                        w.onwriteend = function () { if (!emptied) { emptied = true; w.write(blob); return; }
                            fe.file(function (f) { if (f.size !== blob.size) reject(new Error(tr("the file was written short"))); else resolve(); }, function () { resolve(); }); };
                        w.truncate(0); }, reject);
                }, reject);
            }, reject);
        });
    }
    function saveFile(u8, name) {
        if (nativeFiles()) {
            var f = window.cordova.file, dirs = [];
            if (f.externalRootDirectory) dirs.push({ url: f.externalRootDirectory + "Download/", label: "Download" });
            if (f.externalDataDirectory) dirs.push({ url: f.externalDataDirectory, label: "Android/data/" + (f.externalDataDirectory.split("/Android/data/")[1] || "").replace(/\/+$/, "") });
            if (f.dataDirectory) dirs.push({ url: f.dataDirectory, label: "app storage" });
            var i = 0, next = function () { if (i >= dirs.length) return Promise.reject(new Error(tr("the phone did not let the game write the file"))); var d = dirs[i++];
                return writeNative(d.url, name, u8).then(function () { return d.label + "/" + name; }, next); };
            return next();
        }
        if (location.protocol === "file:" && /Android/i.test(navigator.userAgent)) return Promise.reject(new Error(tr("files cannot be written here")));
        var url = URL.createObjectURL(new Blob([u8], { type: "application/zip" })), a = document.createElement("a");
        a.href = url; a.download = name; a.style.display = "none"; document.body.appendChild(a); a.click();
        setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) { } }, 4000);
        MDZBackup.lastFile = { name: name, bytes: u8.length, u8: MDZBackup.keepLast ? u8 : null };
        return Promise.resolve("Downloads/" + name);
    }
    function chooseFile(cb) {
        var inp = document.getElementById("mdz_backup_file");
        if (!inp) { inp = document.createElement("input"); inp.type = "file"; inp.id = "mdz_backup_file"; inp.accept = ".zip,application/zip";
            inp.style.cssText = "position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0"; document.body.appendChild(inp); }
        inp.value = ""; inp.onchange = function () { var f = inp.files && inp.files[0]; if (f) cb(f); }; inp.click();
    }

    // ---- back up ----------------------------------------------------------------------------------------------------------------
    // -> Promise<{files, manifest}> (tests: MDZBackup.collect())
    function collect(progress) {
        var manifest = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), game: gameVersion(), dbs: [], localStorage: "localStorage.json" }, files = [];
        return dbNames().then(function (names) {
            var total = 0, done = 0, tick = function () { done++; if (progress && done % 25 === 0) progress(done, total); };
            return names.reduce(function (p, name, di) { return p.then(function () {
                return openDb(name).then(function (db) {
                    var stores = Array.prototype.slice.call(db.objectStoreNames), info = { name: name, version: db.version, stores: [] };
                    return stores.reduce(function (p2, sn, si) { return p2.then(function () {
                        var t = db.transaction(sn, "readonly"), os = t.objectStore(sn), meta = { name: sn, keyPath: os.keyPath, autoIncrement: os.autoIncrement, indexes: [] };
                        Array.prototype.slice.call(os.indexNames).forEach(function (ix) { var I = os.index(ix); meta.indexes.push({ name: ix, keyPath: I.keyPath, unique: I.unique, multiEntry: I.multiEntry }); });
                        return req(os.count()).then(function (n) { total += n; return readStore(db, sn, tick); }).then(function (recs) {
                            return Promise.all(recs.map(function (r) { return Promise.all([pack(r[0]), pack(r[1])]); })).then(function (packed) {
                                meta.file = "idb/" + di + "/" + si + ".json"; meta.count = packed.length;
                                files.push({ name: meta.file, text: JSON.stringify(packed) }); info.stores.push(meta);
                            });
                        });
                    }); }, Promise.resolve()).then(function () { db.close(); manifest.dbs.push(info); });
                }, function (e) { manifest.dbs.push({ name: name, error: String(e && e.message || e) }); });
            }); }, Promise.resolve());
        }).then(function () {
            var ls = {}; try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); ls[k] = localStorage.getItem(k); } } catch (e) { }
            manifest.localStorageKeys = Object.keys(ls).length;
            files.push({ name: "localStorage.json", text: JSON.stringify(ls) });
            files.unshift({ name: "backup.json", text: JSON.stringify(manifest, null, 1) });
            files.push({ name: "README.txt", text: "MiniDayZ+ Reimagined - a backup of everything the game keeps on this device (" + manifest.exportedAt + ", game " + manifest.game + ").\r\n\r\n" +
                "Saves, worlds, survivors, progress, unlocks and settings: " + manifest.dbs.length + " databases and " + manifest.localStorageKeys + " settings.\r\n" +
                "To restore: Main menu > Saves > Restore all, and choose this .zip. It replaces what that device has; the game then starts again.\r\n" +
                "Your player id is in it too: restored on a new phone, servers know you. Do not restore one backup on two devices that play at the same time.\r\n" });
            return { files: files, manifest: manifest };
        });
    }
    function exportAll() {
        if (busy) return; busy = true;
        var T = tr("Back up all");
        show(T, tr("Reading the game's data..."), 0, []);
        collect(function (d, n) { show(T, trf("Reading the game's data... {0}", d + " / " + n), n ? 0.6 * d / n : 0, []); }).then(function (c) {
            show(T, tr("Packing the .zip..."), 0.6, []);
            return makeZip(c.files, function (d, n) { show(T, tr("Packing the .zip...") + " " + d + " / " + n, 0.6 + 0.35 * d / n, []); }).then(function (u8) {
                show(T, tr("Saving the file..."), 0.97, []);
                return saveFile(u8, "mdz-backup-" + stamp(new Date()) + ".zip").then(function (where) {
                    MDZBackup.lastExport = { where: where, bytes: u8.length, dbs: c.manifest.dbs.length, records: c.manifest.dbs.reduce(function (s, d) { return s + (d.stores || []).reduce(function (t, x) { return t + x.count; }, 0); }, 0) };
                    busy = false;
                    show(T, trf("Saved: {0}", where) + "\n" + (Math.round(u8.length / 1024) + " KB, " + c.manifest.dbs.length + " " + tr("databases")), 1, [{ text: tr("Close"), main: true, fn: hide }]);
                });
            });
        }).catch(function (e) { busy = false; show(T, trf("Could not back up: {0}", e && e.message || e), null, [{ text: tr("Close"), fn: hide }]); });
    }

    // ---- restore ----------------------------------------------------------------------------------------------------------------
    function parseBackup(u8, progress) {
        return readZip(u8, progress).then(function (all) {
            var m; try { m = JSON.parse(all["backup.json"] || "null"); } catch (e) { m = null; }
            if (!m || m.format !== FORMAT) throw new Error(tr("that .zip is not a backup of the game (Back up all makes one)"));
            if (!(m.version <= VERSION)) throw new Error(tr("that backup is from a newer game - update the game first"));
            (m.dbs || []).forEach(function (d) { (d.stores || []).forEach(function (s) { if (all[s.file] === undefined) throw new Error(trf("that .zip is damaged ({0})", s.file)); }); });
            return { m: m, all: all };
        });
    }
    function makeStores(db, info, onlyMissing) {
        (info.stores || []).forEach(function (s) {
            if (onlyMissing && db.objectStoreNames.contains(s.name)) return;
            var o = { autoIncrement: !!s.autoIncrement }; if (s.keyPath !== null && s.keyPath !== undefined) o.keyPath = s.keyPath;
            var os = db.createObjectStore(s.name, o); (s.indexes || []).forEach(function (ix) { try { os.createIndex(ix.name, ix.keyPath, { unique: !!ix.unique, multiEntry: !!ix.multiEntry }); } catch (e) { } });
        });
    }
    // open a database for the restore. Not on this device: made at the FILE's version with its stores (the game opens its own at
    // fixed versions - a higher one would make its open fail). On it: as it is; a store it lacks is made by an upgrade to the file's
    // version only when that is newer - and given up after 4 s if the game's open connection blocks the upgrade (left out, named)
    function openFor(info, exists) {
        return new Promise(function (ok, no) {
            var names = function (l) { return l.map(function (s) { return s.name; }); };
            if (!exists) {
                var c = indexedDB.open(info.name, Math.max(1, Number(info.version) || 1));
                c.onupgradeneeded = function () { makeStores(c.result, info, true); };
                c.onsuccess = function () { ok({ db: c.result, left: [] }); }; c.onerror = function () { no(c.error); };
                return;
            }
            var r = indexedDB.open(info.name);
            r.onerror = function () { no(r.error); };
            r.onsuccess = function () { var db = r.result;
                var missing = (info.stores || []).filter(function (s) { return !db.objectStoreNames.contains(s.name); });
                if (!missing.length || !(info.version > db.version)) { ok({ db: db, left: names(missing) }); return; }
                db.close(); var u = indexedDB.open(info.name, info.version), gave = false;
                u.onupgradeneeded = function () { makeStores(u.result, info, true); };
                u.onblocked = function () { setTimeout(function () { if (gave) return; gave = true; var q = indexedDB.open(info.name);
                    q.onsuccess = function () { ok({ db: q.result, left: names(missing) }); }; q.onerror = function () { no(q.error); }; }, 4000); };
                u.onsuccess = function () { if (gave) { u.result.close(); return; } gave = true; ok({ db: u.result, left: [] }); };
                u.onerror = function () { if (!gave) { gave = true; no(u.error); } };
            };
        });
    }
    function writeStore(db, s, recs, tick) {
        return new Promise(function (ok, no) {
            var tx = db.transaction(s.name, "readwrite"), os = tx.objectStore(s.name);
            os.clear();
            recs.forEach(function (r) { var k = unpack(r[0]), v = unpack(r[1]); if (os.keyPath !== null && os.keyPath !== undefined) os.put(v); else os.put(v, k); tick(); });
            tx.oncomplete = function () { ok(); }; tx.onerror = function () { no(tx.error); }; tx.onabort = function () { no(tx.error || new Error("write aborted")); };
        });
    }
    function applyBackup(b, progress) {
        var m = b.m, total = 0, done = 0, left = [];
        (m.dbs || []).forEach(function (d) { (d.stores || []).forEach(function (s) { total += s.count || 0; }); });
        var tick = function () { done++; if (progress && done % 25 === 0) progress(done, total); }, have = {};
        return dbNames().then(function (l) { l.forEach(function (n) { have[n] = 1; }); }).then(function () { return (m.dbs || []).reduce(function (p, info) { return p.then(function () {
            if (info.error || !info.stores) return;
            return openFor(info, !!have[info.name]).then(function (o) {
                left = left.concat(o.left.map(function (n) { return info.name + "/" + n; }));
                return info.stores.reduce(function (p2, s) { return p2.then(function () { if (!o.db.objectStoreNames.contains(s.name)) return;
                    return writeStore(o.db, s, JSON.parse(b.all[s.file]), tick); }); }, Promise.resolve()).then(function () { o.db.close(); });
            });
        }); }, Promise.resolve()); }).then(function () {
            var ls = JSON.parse(b.all["localStorage.json"] || "{}");
            try { localStorage.clear(); for (var k in ls) localStorage.setItem(k, ls[k]); } catch (e) { throw new Error(trf("the settings could not be written: {0}", e && e.message || e)); }
            return { records: done, left: left };
        });
    }
    function inWorld() { try { var r = window.cr_getC2Runtime && cr_getC2Runtime(); return !!(r && r.wa && r.wa.name === "Map"); } catch (e) { return false; } }
    function importAll() {
        if (busy) return;
        var T = tr("Restore all");
        if (inWorld()) { show(T, tr("Restore a backup from the main menu (leave the world first)."), null, [{ text: tr("Close"), fn: hide }]); return; }
        chooseFile(function (file) { importFile(file); });
    }
    function importFile(file) {
        var T = tr("Restore all"); busy = true;
        show(T, tr("Reading the file..."), 0, []);
        new Response(file).arrayBuffer().then(function (buf) {
            return parseBackup(new Uint8Array(buf), function (d, n) { show(T, tr("Checking the backup...") + " " + d + " / " + n, 0.3 * d / n, []); });
        }).then(function (b) {
            busy = false;
            var when = String(b.m.exportedAt || "").replace("T", " ").slice(0, 16), recs = (b.m.dbs || []).reduce(function (s, d) { return s + (d.stores || []).reduce(function (t, x) { return t + (x.count || 0); }, 0); }, 0);
            show(T, trf("Restore the backup made {0}?", when) + (b.m.game ? " (" + b.m.game + ")" : "") + "\n" + tr("It replaces this device's saves, worlds, survivors, progress and settings. The game starts again after.") + "\n" + recs + " " + tr("records"), null, [
                { text: tr("Cancel"), fn: hide },
                { text: tr("Restore"), main: true, fn: function () { restoreNow(b); } }]);
        }).catch(function (e) { busy = false; show(T, trf("Could not restore: {0}", e && e.message || e), null, [{ text: tr("Close"), fn: hide }]); });
    }
    function restoreNow(b) {
        var T = tr("Restore all"); busy = true;
        MDZBackup.restoring = true;   // (only from the main menu - no world runs, nothing autosaves in between; tests read this)
        show(T, tr("Writing..."), 0.3, []);
        applyBackup(b, function (d, n) { show(T, tr("Writing...") + " " + d + " / " + n, 0.3 + 0.65 * d / n, []); }).then(function (r) {
            MDZBackup.lastImport = r;
            show(T, tr("Restored. The game starts again...") + (r.left.length ? "\n" + trf("Left out: {0}", r.left.join(", ")) : ""), 1, []);
            if (!MDZBackup.noReload) setTimeout(function () { location.reload(); }, r.left.length ? 2500 : 900);
            else busy = false;
        }).catch(function (e) { busy = false; MDZBackup.restoring = false; show(T, trf("Could not restore: {0}", e && e.message || e), null, [{ text: tr("Close"), fn: hide }]); });
    }

    window.MDZBackup = { exportAll: exportAll, importAll: importAll, importFile: importFile, collect: collect, makeZip: makeZip, readZip: readZip, parseBackup: parseBackup, applyBackup: applyBackup,
        isBusy: function () { return busy; }, hide: hide, lastFile: null, lastExport: null, lastImport: null, keepLast: false, noReload: false, restoring: false };
})();
