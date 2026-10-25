import { writeFileSync } from "node:fs";

const APIS = new Set([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
]);

export function modelConfiguration(model: string, api: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model) || !APIS.has(api)) {
    throw new Error("Expected a literal model ID and supported API");
  }
  return {
    providers: {
      "cli-proxy": {
        baseUrl: `http://127.0.0.1:8317${api === "anthropic-messages" ? "" : "/v1"}`,
        api,
        apiKey: "sandbox-placeholder",
        models: [{ id: model }],
      },
    },
  };
}

export function configure(model: string, api: string) {
  const config = modelConfiguration(model, api);
  writeFileSync("/state/pi/models.json", JSON.stringify(config), {
    mode: 0o600,
  });
  writeFileSync(
    "/state/pi/settings.json",
    JSON.stringify({
      defaultProvider: "cli-proxy",
      defaultModel: model,
      cacheWarming: "off",
      transport: "sse",
      enableInstallTelemetry: false,
      enableAnalytics: false,
      retry: { enabled: false },
    }),
    { mode: 0o600 },
  );
}
