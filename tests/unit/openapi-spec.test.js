import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Guards the API reference against drift: every documented path must exist as a
// real Next.js route file, so the docs can never describe an endpoint the app
// does not serve.
const spec = JSON.parse(readFileSync(new URL("../../public/openapi.json", import.meta.url), "utf8"));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function appSegments(apiPath) {
  // `/v1/*` and `/codex` are rewritten to `/api/v1/*` (next.config.mjs), so the
  // doc path maps to the route file under src/app/api.
  const appPath = apiPath.startsWith("/api/") ? apiPath : `/api${apiPath}`;
  return appPath.replace(/^\//, "").split("/");
}

function candidateRouteFiles(apiPath) {
  const segments = appSegments(apiPath);
  const bracketed = segments.map((segment) => (/^\{.+\}$/.test(segment) ? `[${segment.slice(1, -1)}]` : segment));
  const candidates = [`${repoRoot}src/app/${bracketed.join("/")}/route.js`];

  // A route may be served by a catch-all instead of a single dynamic segment
  // (e.g. /v1/models/{model} → models/[...model]).
  const firstParam = segments.findIndex((segment) => /^\{.+\}$/.test(segment));
  if (firstParam > 0) {
    const prefix = segments.slice(0, firstParam).join("/");
    const paramName = segments[firstParam].slice(1, -1);
    candidates.push(`${repoRoot}src/app/${prefix}/[...${paramName}]/route.js`);
    candidates.push(`${repoRoot}src/app/${prefix}/[[...${paramName}]]/route.js`);
  }
  return candidates;
}

function hasRoute(apiPath) {
  return candidateRouteFiles(apiPath).some((file) => existsSync(file));
}

describe("openapi.json", () => {
  it("is a valid 3.x document with info and paths", () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBeTruthy();
    expect(spec.info.version).toBeTruthy();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(10);
  });

  it("documents the core public endpoints with responses", () => {
    for (const path of ["/v1/chat/completions", "/v1/models", "/v1/embeddings", "/v1/images/generations", "/v1/audio/speech"]) {
      expect(spec.paths[path], `missing ${path}`).toBeTruthy();
      const operation = spec.paths[path].get || spec.paths[path].post;
      expect(operation.responses, `${path} has no responses`).toBeTruthy();
      expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
    }
  });

  it("declares API-key auth for the LLM surface", () => {
    expect(spec.components.securitySchemes.ApiKeyAuth).toBeTruthy();
    expect(spec.paths["/v1/chat/completions"].post.responses["401"]).toBeTruthy();
  });

  it("keeps /api/health public", () => {
    expect(spec.paths["/api/health"].get.security).toEqual([]);
  });

  it("every documented path maps to a real route file", () => {
    const missing = Object.keys(spec.paths).filter((path) => !hasRoute(path));
    expect(missing).toEqual([]);
  });

  it("every $ref resolves to a declared component", () => {
    const raw = JSON.stringify(spec);
    const refs = [...raw.matchAll(/"\$ref":"#\/components\/([a-zA-Z]+)\/([A-Za-z0-9_]+)"/g)];
    expect(refs.length).toBeGreaterThan(0);
    const unresolved = refs
      .map(([, group, name]) => [group, name])
      .filter(([group, name]) => !spec.components?.[group]?.[name]);
    expect(unresolved).toEqual([]);
  });
});
