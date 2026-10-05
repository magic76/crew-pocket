#!/usr/bin/env node
const fs = require('node:fs');

const binaryPath = process.argv[2];
if (!binaryPath) throw new Error('Usage: patch-codex-helper-name.js <codex ELF>');
const binary = fs.readFileSync(binaryPath);
if (!binary.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
  throw new Error('Codex payload is not an ELF executable');
}

// Codex 0.160 resolves this fixed sibling filename and has no host-path env
// override. Android only extracts lib*.so entries into nativeLibraryDir.
// An equal-length substitution preserves every ELF offset and Rust string
// length while making the executable lookup match the installer-owned file.
const upstreamName = Buffer.from('codex-code-mode-host');
const androidName = Buffer.from('libcode_mode_host.so');
if (upstreamName.length !== androidName.length) throw new Error('Helper name length mismatch');
let count = 0;
for (let offset = binary.indexOf(upstreamName); offset !== -1;
  offset = binary.indexOf(upstreamName, offset + androidName.length)) {
  androidName.copy(binary, offset);
  count++;
}
if (!count && !binary.includes(androidName)) {
  throw new Error('Codex payload has no recognized code-mode helper name; inspect its layout');
}
if (count) fs.writeFileSync(binaryPath, binary);
console.log(`Android Codex helper filename adapted (${count} substitutions)`);
