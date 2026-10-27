import { pathToFileURL } from "node:url";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ExtensionCatalogEntry } from "@rex/profiles";
import { TOOL_NAMES } from "./policy.ts";
import { installedModulePaths } from "./installed-modules.ts";

export async function loadInstalledExtensions(
  catalog: readonly ExtensionCatalogEntry[] | undefined,
  selected: readonly string[],
  installedRoot?: string,
) {
  const factories: ExtensionFactory[] = [];
  const tools: string[] = [];
  if (!selected.length) return { factories, tools };
  try {
    const entries = selected.map((id) => {
      const entry = catalog?.find((entry) => entry.id === id);
      if (
        !entry ||
        entry.tools.some(
          (name) =>
            [...TOOL_NAMES, "revise_profile"].some(
              (reserved) => reserved === name,
            ) || tools.includes(name),
        )
      )
        throw new Error();
      tools.push(...entry.tools);
      return entry;
    });
    const paths = await installedModulePaths(installedRoot, entries);
    for (const [index, path] of paths.entries()) {
      const url = pathToFileURL(path);
      url.searchParams.set("sha256", entries[index]!.sha256);
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
