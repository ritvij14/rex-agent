// Migration dry-run: counts only. Reads file metadata of an operator-supplied
// root (typically previous private work) without reading contents, emitting no
// names and no writes. Mapping/copy is a separate explicitly approved step.
import { lstatSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const root = process.argv[2];
if (!root || process.argv.length > 3)
  throw new Error(
    "Usage: node --import tsx scripts/migration-dry-run.ts <root>",
  );
if (typeof root !== "string" || !root.trim() || !isAbsolute(root))
  throw new Error("Provide an absolute, plain path.");

let files = 0;
let bytes = 0;
const directories: string[] = [];

function walk(directory: string) {
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      files += 1;
      try {
        bytes += lstatSync(join(directory, entry.name)).size;
      } catch {
        // Unreadable metadata is counted as unknown rather than read.
      }
    } else if (entry.isDirectory()) {
      directories.push(entry.name);
      walk(join(directory, entry.name));
    }
  }
}

try {
  if (!lstatSync(root).isDirectory()) throw new Error("Not a directory.");
} catch {
  throw new Error("Unreadable root; nothing was read.");
}

walk(root);
console.log(
  JSON.stringify({
    root,
    files,
    approximateBytes: bytes,
    topLevelDirectories: directories.length,
  }),
);
