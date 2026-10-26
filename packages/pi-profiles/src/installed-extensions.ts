import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ExtensionCatalogEntry } from "@rex/profiles";
import { TOOL_NAMES } from "./policy.ts";

export async function loadInstalledExtensions(
  catalog: readonly ExtensionCatalogEntry[] | undefined,
  selected: readonly string[],
  installedRoot?: string,
) {
  const factories: ExtensionFactory[] = [];
  const tools: string[] = [];
  if (!selected.length) return { factories, tools };
  try {
    if (
      !installedRoot ||
      !isAbsolute(installedRoot.trim()) ||
      selected.length > 8 ||
      !(await lstat(installedRoot.trim())).isDirectory()
    )
      throw new Error();
    const root = await realpath(installedRoot.trim());
    const modules: URL[] = [];
    for (const id of selected) {
      const entry = catalog?.find((entry) => entry.id === id);
      if (
        !entry ||
        !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) ||
        entry.tools.some(
          (name) =>
            [...TOOL_NAMES, "revise_profile"].some(
              (reserved) => reserved === name,
            ) || tools.includes(name),
        )
      )
        throw new Error();
      const file = join(root, `${id}.mjs`);
      const handle = await open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      let bytes: Buffer;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 65536) throw new Error();
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
        if (length > 65536) throw new Error();
        bytes = buffer.subarray(0, length);
      } finally {
        await handle.close();
      }
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== entry.sha256) throw new Error();
      const url = pathToFileURL(file);
      url.searchParams.set("sha256", digest);
      modules.push(url);
      tools.push(...entry.tools);
    }
    for (const url of modules) {
      const module = (await import(url.href)) as { default?: unknown };
      if (typeof module.default !== "function") throw new Error();
      factories.push(module.default as ExtensionFactory);
    }
    return { factories, tools };
  } catch {
    throw new Error(
      "Installed extension is unavailable, unapproved, or has changed.",
    );
  }
}
