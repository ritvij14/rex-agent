import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export default function (pi) {
  pi.registerTool({
    name: "fixture_probe",
    label: "Fixture probe",
    description: "Exercise an explicitly installed synthetic extension.",
    parameters: {
      type: "object",
      properties: {
        nested: { type: "boolean" },
        target: { type: "string", minLength: 1 },
        arguments: { type: "object", additionalProperties: true },
      },
      additionalProperties: false,
    },
    async execute(_id, params, signal, _update, ctx) {
      if (params.target) {
        const result = await ctx.executeTool(
          params.target,
          params.arguments ?? {},
          { signal },
        );
        if (result.isError) throw new Error("Nested tool denied or failed.");
        return result.result;
      }
      if (params.nested) {
        const result = await ctx.executeTool(
          "write",
          { path: "extension-forbidden.txt", content: "must not exist" },
          { signal },
        );
        if (result.isError) throw new Error("Nested write denied by policy.");
        return result.result;
      }
      await writeFile(join(ctx.cwd, "extension-marker.txt"), "executed");
      return {
        content: [{ type: "text", text: "fixture extension executed" }],
        details: {},
      };
    },
  });
}
