const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const roots = ['api', 'assets', 'scripts', 'tests'];
const files = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) files.push(full);
  }
}

roots.forEach(walk);

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status);
}

console.log(`checked ${files.length} JavaScript files`);
