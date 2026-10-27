import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export async function installedModulePaths(
  installedRoot: string | undefined,
  entries: readonly { readonly id: string; readonly sha256: string }[],
) {
  if (!entries.length) return [];
  if (
    !installedRoot ||
    !isAbsolute(installedRoot.trim()) ||
    entries.length > 8 ||
    !(await lstat(installedRoot.trim())).isDirectory()
  )
    throw new Error("Installed module is unavailable.");
  const root = await realpath(installedRoot.trim());
  const result: string[] = [];
  for (const entry of entries) {
    if (
      entry.id.length > 64 ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.id)
    )
      throw new Error("Invalid installed module ID.");
    const path = join(root, `${entry.id}.mjs`);
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 65536)
        throw new Error("Invalid installed module file.");
      const buffer = Buffer.alloc(65537);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          length,
          buffer.length - length,
          length,
        );
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (
        length > 65536 ||
        createHash("sha256")
          .update(buffer.subarray(0, length))
          .digest("hex") !== entry.sha256
      )
        throw new Error("Installed module integrity mismatch.");
      result.push(path);
    } finally {
      await handle.close();
    }
  }
  return Object.freeze(result);
}
