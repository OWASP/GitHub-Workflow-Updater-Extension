// Patch package.json fields while preserving key order
// Usage: node scripts/patch-package-json.js key1=value1 key2=value2 "key3=value with spaces"
//   e.g. node scripts/patch-package-json.js publisher=OWASP "displayName=OWASP GitHub Workflow Updater"

const fs = require('fs');

const patches = {};
for (const arg of process.argv.slice(2)) {
    const eqIndex = arg.indexOf('=');
    if (eqIndex === -1) {
        console.error(`Skipping invalid argument (missing =): ${arg}`);
        continue;
    }
    const key = arg.substring(0, eqIndex);
    const value = arg.substring(eqIndex + 1);
    patches[key] = value;
}

const data = fs.readFileSync('package.json', 'utf8');
const p = JSON.parse(data);

// Apply patches
for (const [key, value] of Object.entries(patches)) {
    p[key] = value;
}

// Preserve original key order, adding new keys at the end
const originalOrder = Object.keys(JSON.parse(data));
const seen = new Set();
const ordered = {};

for (const key of originalOrder) {
    ordered[key] = p[key];
    seen.add(key);
}
for (const key of Object.keys(p)) {
    if (!seen.has(key)) {
        ordered[key] = p[key];
    }
}

fs.writeFileSync('package.json', JSON.stringify(ordered, null, 2) + '\n');
console.log(`Patched package.json: ${JSON.stringify(patches)}`);
