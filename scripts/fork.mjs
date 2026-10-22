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
["\"$scramjet\",1", "\"$speedster\",1"]
];
for (const [a, b] of patches) {
if (!s.includes(a)) throw new Error("fork patch failed: " + a);
s = s.split(a).join(b);
}
s = s.replace(/\/\/# sourceMappingURL=.*$/m, "");
writeFileSync(file, s);
}
