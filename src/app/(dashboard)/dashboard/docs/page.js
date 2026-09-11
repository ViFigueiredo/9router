"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Card, Badge, SegmentedControl } from "@/shared/components";
import "swagger-ui-react/swagger-ui.css";
import "./swagger-theme.css";

// Swagger UI touches window/document, so it must not be server-rendered.
const SwaggerUI = dynamic(() => import("swagger-ui-react"), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-text-muted">Loading API reference…</div>,
});

const TABS = [
  { value: "api", label: "API" },
  { value: "mcp", label: "MCP" },
];

function ToolDetails({ tool }) {
  const schema = tool.inputSchema || {};
  const properties = Object.entries(schema.properties || {});
  return (
    <details className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium text-text-main">
        <code className="font-mono text-xs">{tool.name}</code>
        <span className="ml-2 text-[11px] font-normal text-text-muted">{tool.description}</span>
      </summary>
      <div className="mt-2 flex flex-col gap-1.5">
        {properties.length === 0 ? (
          <p className="text-[11px] text-text-muted">No parameters.</p>
        ) : (
          properties.map(([name, spec]) => (
            <div key={name} className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
              <code className="font-mono text-text-main">{name}</code>
              <Badge variant="default" size="sm">{spec.type || "any"}</Badge>
              {Array.isArray(schema.required) && schema.required.includes(name) && (
                <Badge variant="primary" size="sm">required</Badge>
              )}
              {spec.description && <span className="text-text-muted">{spec.description}</span>}
            </div>
          ))
        )}
      </div>
    </details>
  );
}

export default function DocsPage() {
  const [tab, setTab] = useState("api");
  const [tools, setTools] = useState(null);
  const [toolsError, setToolsError] = useState("");

  useEffect(() => {
    if (tab !== "mcp" || tools || toolsError) return;
    let cancelled = false;
    (async () => {
      try {
        const keysRes = await fetch("/api/keys", { cache: "no-store" });
        const keysData = keysRes.ok ? await keysRes.json() : {};
        const key = (keysData.keys || []).find((k) => k.isActive !== false)?.key || (keysData.keys || [])[0]?.key;
        if (!key) throw new Error("No API key available — create one in Endpoint & Key");
        const res = await fetch("/api/mcp-server/message", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": key },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
        const body = await res.json();
        if (!res.ok || body.error) throw new Error(body.error?.message || `HTTP ${res.status}`);
        if (!cancelled) setTools(body.result.tools || []);
      } catch (error) {
        if (!cancelled) setToolsError(error.message || "Failed to load MCP tools");
      }
    })();
    return () => { cancelled = true; };
  }, [tab, tools, toolsError]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl options={TABS} value={tab} onChange={setTab} className="w-full sm:w-auto" />
        {tab === "api" && (
          <a
            href="/openapi.json"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-text-muted hover:text-primary"
          >
            openapi.json ↗
          </a>
        )}
      </div>

      {tab === "api" && (
        <Card padding="sm">
          <p className="mb-3 text-sm text-text-muted">
            OpenAI-compatible gateway on <code className="font-mono">/v1</code> (and <code className="font-mono">/codex</code>) with an
            API key, plus the administrative API on <code className="font-mono">/api</code> behind the dashboard session.
            Use <strong>Authorize</strong> to paste a key and try requests from here.
          </p>
          <div className="docs-swagger">
            <SwaggerUI
              url="/openapi.json"
              docExpansion="list"
              defaultModelsExpandDepth={1}
              defaultModelExpandDepth={1}
              displayRequestDuration
              filter
              tryItOutEnabled={false}
            />
          </div>
        </Card>
      )}

      {tab === "mcp" && (
        <div className="flex flex-col gap-4">
          <Card>
            <h3 className="mb-2 text-sm font-semibold text-text-main">Connect an agent</h3>
            <p className="text-sm text-text-muted">
              The MCP server exposes the same capabilities as this dashboard. Setup snippets for known
              clients (Cursor, VS Code, Cline, Claude Desktop via the stdio shim) live in{" "}
              <a href="/dashboard/mcp" className="text-primary hover:underline">Dashboard → MCP Server</a>.
            </p>
            <div className="mt-2 flex flex-col gap-1 text-xs text-text-muted">
              <span>SSE endpoint: <code className="font-mono">/api/mcp-server/sse</code></span>
              <span>JSON-RPC: <code className="font-mono">POST /api/mcp-server/message</code></span>
              <span>Auth: <code className="font-mono">x-api-key</code> (or <code className="font-mono">Authorization: Bearer</code>)</span>
              <span>Admin tools: off unless enabled in Settings → MCP</span>
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-text-main">
              Tools {tools ? `(${tools.length})` : ""}
            </h3>
            {toolsError && <p className="text-sm text-red-500">{toolsError}</p>}
            {!tools && !toolsError && <p className="text-sm text-text-muted">Loading tools…</p>}
            {tools && (
              <div className="flex flex-col gap-2">
                {tools.map((tool) => <ToolDetails key={tool.name} tool={tool} />)}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
