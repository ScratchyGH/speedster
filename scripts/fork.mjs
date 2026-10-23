import { readFileSync, writeFileSync } from "node:fs";
export function forkScramjet(file) {
let s = readFileSync(file, "utf8");
const patches = [
["<title>Scramjet</title>", "<title>Speedster</title>"],
["--deep: #080602;", "--deep: #0b0d12;"],
["--shallow: #181412;", "--shallow: #171b24;"],
["--beach: #f1e8e1;", "--beach: #eef1f7;"],
["--shore: #b1a8a1;", "--shore: #9aa3b5;"],
["--accent: #ffa938;", "--accent: #ff4d5e;"],
["<li>Updating Scramjet</li>", "<li>Updating Speedster</li>"],
["https://github.com/MercuryWorkshop/scramjet", "https://github.com/ScratchyGH/speedster"],
["<i>Scramjet v<span id=\"version\"></span>", "<i>Speedster engine v<span id=\"version\"></span>"],
["(\"$scramjet\",1,{upgrade(e){", "(\"$speedster\",2,{upgrade(e){"],
["(\"$scramjet\",1)", "(\"$speedster\",2,{upgrade:self.__spdUp})"]
];
for (const [a, b] of patches) {
if (!s.includes(a)) throw new Error("fork patch failed: " + a);
s = s.split(a).join(b);
}
if (s.includes("\"$scramjet\"")) throw new Error("fork patch failed: unpatched database name");
s = "self.__spdUp=function(e){for(const n of[\"config\",\"cookies\",\"redirectTrackers\",\"referrerPolicies\",\"publicSuffixList\"])e.objectStoreNames.contains(n)||e.createObjectStore(n)};\n" + s;
s = s.replace(/\/\/# sourceMappingURL=.*$/m, "");
writeFileSync(file, s);
}
export function poolLibcurl(file) {
let s = readFileSync(file, "utf8");
const patches = [
["const _wisp_connections = {};", "const _wisp_connections = {};\nconst _spd_pick = base => { const n = Math.max(1, globalThis.SPD_POOL || 1); let best = base + \"#0\", load = Infinity; for (let i = 0; i < n; i++) { const k = base + \"#\" + i, c = _wisp_connections[k]; if (!c) return k; const l = Object.keys(c.active_streams || {}).length; if (l < load) { load = l; best = k; } } return best; };"],
["this.real_url = url_split.join(\"/\") + \"/\";", "this.real_url = url_split.join(\"/\") + \"/\";\n      this.pool_key = _spd_pick(this.real_url);"],
["this.connections = options.connections;", "this.connections = options.connections;\n    globalThis.SPD_POOL = options.pool || 1;"]
];
for (const [a, b] of patches) {
if (s.split(a).length !== 2) throw new Error("libcurl pool patch failed: " + a);
s = s.split(a).join(b);
}
const n = s.split("_wisp_connections[this.real_url]").length - 1;
if (n !== 4) throw new Error("libcurl pool patch failed: connection map uses " + n);
s = s.split("_wisp_connections[this.real_url]").join("_wisp_connections[this.pool_key]");
writeFileSync(file, s);
}
