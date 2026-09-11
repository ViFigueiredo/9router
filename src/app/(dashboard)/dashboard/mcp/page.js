"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Badge, Toggle } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const TOOL_GROUPS = [
  {
    label: "Read",
    tools: [
      ["list_providers", "Configured provider connections with status"],
      ["list_models", "Models of one provider with kind + health tag"],
      ["get_model_health", "Latency, tok/s, events and last error per model"],
      ["get_ranking", "Global ranking from accumulated validate counters"],
      ["list_combos", "Combos with models, locks and auto-reorder flag"],
      ["get_usage_stats", "Token/request usage for a period"],
    ],
  },
  {
    label: "Actions",
    tools: [
      ["test_model", "Ping a model through the gateway (records health)"],
      ["reorder_combo", "Reclassify a combo by the ranking, respecting locks"],
    ],
  },
  {
    label: "Admin (opt-in)",
    tools: [
      ["set_models_enabled", "Enable/disable models of a provider"],
      ["set_connection_active", "Activate/deactivate a connection"],
      ["add_connection", "Add an API-key connection"],
      ["delete_combo", "Delete a combo"],
    ],
  },
];

function CopyButton({ value, label = "Copy" }) {
  const { copied, copy } = useCopyToClipboard(2000);
  return (
    <button
      onClick={() => copy(value)}
      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-primary/90"
      title={value}
    >
      <span className="material-symbols-outlined text-[12px]">{copied ? "check" : "content_copy"}</span>
      {copied ? "Copied!" : label}
    </button>
  );
}

function Snippet({ title, where, code }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-main">{title}</p>
          <p className="truncate text-[11px] text-text-muted">{where}</p>
        </div>
        <CopyButton value={code} />
      </div>
      <pre className="max-h-56 overflow-auto rounded-md bg-sidebar p-2 font-mono text-[11px] leading-relaxed text-text-muted">
        {code}
      </pre>
    </div>
  );
}

export default function McpPage() {
  const [settings, setSettings] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [settingsRes, keysRes] = await Promise.all([
          fetch("/api/settings", { cache: "no-store" }),
          fetch("/api/keys", { cache: "no-store" }),
        ]);
        const settingsData = settingsRes.ok ? await settingsRes.json() : {};
        const keysData = keysRes.ok ? await keysRes.json() : {};
        if (cancelled) return;
        setSettings(settingsData);
        const firstKey = (keysData.keys || []).find((k) => k.isActive !== false) || (keysData.keys || [])[0];
        setApiKey(firstKey?.key || "");
      } catch {
        // Leave placeholders visible; the snippets still document the shape.
      }
      setOrigin(window.location.origin);
    })();
    return () => { cancelled = true; };
  }, []);

  const allowAdmin = settings?.mcpAllowAdmin === true;

  const toggleAdmin = async () => {
    const next = !allowAdmin;
    setSettings((prev) => ({ ...prev, mcpAllowAdmin: next }));
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpAllowAdmin: next }),
      });
    } catch {
      setSettings((prev) => ({ ...prev, mcpAllowAdmin: !next }));
    }
  };

  const base = origin || "https://your-9router-host";
  const key = apiKey || "<YOUR_API_KEY>";

  const snippets = useMemo(() => ({
    sse: `${base}/api/mcp-server/sse`,
    httpJson: `curl -s ${base}/api/mcp-server/message \\
  -H "x-api-key: ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    cursor: JSON.stringify({
      mcpServers: { "9router": { url: `${base}/api/mcp-server/sse`, headers: { "x-api-key": key } } },
    }, null, 2),
    vscode: JSON.stringify({
      servers: { "9router": { type: "sse", url: `${base}/api/mcp-server/sse`, headers: { "x-api-key": key } } },
    }, null, 2),
    claudeDesktop: JSON.stringify({
      mcpServers: {
        "9router": {
          command: "npx",
          args: ["-y", "9router", "mcp-stdio", "--url", base, "--api-key", key],
        },
      },
    }, null, 2),
    cLine: JSON.stringify({
      mcpServers: { "9router": { url: `${base}/api/mcp-server/sse`, headers: { "x-api-key": key }, disabled: false } },
    }, null, 2),
  }), [base, key]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[20px]">smart_toy</span>
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold sm:text-xl">MCP Server</h2>
            <p className="text-sm text-text-muted">
              Expose providers, models, ranking, combos and usage to MCP agents over HTTP or stdio.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border-subtle bg-surface p-3">
            <p className="text-xs font-medium text-text-main">Endpoint (SSE handshake)</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-muted">{snippets.sse}</code>
              <CopyButton value={snippets.sse} />
            </div>
            <p className="mt-2 text-xs font-medium text-text-main">Authentication</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-muted">{key}</code>
              <CopyButton value={key} />
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              Send the key as <code>x-api-key</code> or <code>Authorization: Bearer</code>. Messages are
              JSON-RPC 2.0 POSTed to <code>/api/mcp-server/message</code> and returned in the response body.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-main">Allow MCP admin tools</p>
              <p className="text-[11px] text-text-muted">
                Adds tools that create/delete connections and combos and toggle models. Off by default —
                an API key alone must not grant administrative control.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={allowAdmin ? "primary" : "default"} size="sm">{allowAdmin ? "enabled" : "read + actions"}</Badge>
              <Toggle checked={allowAdmin} onChange={toggleAdmin} />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-text-main">Client setup</h3>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Snippet title="Cursor" where="~/.cursor/mcp.json (or .cursor/mcp.json in the project)" code={snippets.cursor} />
          <Snippet title="VS Code (Copilot)" where=".vscode/mcp.json" code={snippets.vscode} />
          <Snippet title="Cline / Roo Code" where="MCP settings JSON" code={snippets.cLine} />
          <Snippet title="Claude Desktop / Claude Code" where="claude_desktop_config.json — uses the stdio shim" code={snippets.claudeDesktop} />
          <Snippet title="Any HTTP client (raw check)" where="terminal" code={snippets.httpJson} />
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-text-main">Tools</h3>
        <div className="flex flex-col gap-4">
          {TOOL_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">{group.label}</p>
              <div className="overflow-hidden rounded-lg border border-border-subtle">
                {group.tools.map(([name, description], index) => (
                  <div
                    key={name}
                    className={`flex flex-col gap-0.5 p-2.5 sm:flex-row sm:items-center sm:justify-between ${index % 2 ? "bg-black/[0.02] dark:bg-white/[0.02]" : ""}`}
                  >
                    <code className="font-mono text-xs text-text-main">{name}</code>
                    <span className="text-[11px] text-text-muted sm:max-w-[60%] sm:text-right">{description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
