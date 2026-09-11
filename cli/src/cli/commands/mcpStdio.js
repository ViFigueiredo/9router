/**
 * `9router mcp-stdio` — stdio ↔ HTTP bridge for the 9Router MCP server.
 *
 * Agent clients that only speak stdio (Claude Desktop, Claude Code, …) spawn this
 * command; it forwards newline-delimited JSON-RPC from stdin to the gateway's
 * /api/mcp-server/message endpoint and writes the responses back to stdout.
 *
 * The API key is read from --api-key or NINE_ROUTER_API_KEY and is never logged.
 */

const http = require("http");
const https = require("https");

const DEFAULT_URL = "http://127.0.0.1:20128";
const REQUEST_TIMEOUT_MS = 120000;

const HELP = `
Usage: 9router mcp-stdio [options]

Bridge MCP stdio (stdin/stdout JSON-RPC) to a 9Router gateway.

Options:
  --url <base>       Gateway base URL (default ${DEFAULT_URL})
  --api-key <key>    9Router API key (default: env NINE_ROUTER_API_KEY)
  --help             Show this help

Client config (Claude Desktop / Claude Code):
  {
    "mcpServers": {
      "9router": {
        "command": "npx",
        "args": ["-y", "9router", "mcp-stdio", "--url", "https://your-host", "--api-key", "<KEY>"]
      }
    }
  }
`;

function parseArgs(argv) {
  const options = { url: DEFAULT_URL, apiKey: process.env.NINE_ROUTER_API_KEY || "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--url" && argv[i + 1]) { options.url = argv[i + 1]; i += 1; continue; }
    if (arg === "--api-key" && argv[i + 1]) { options.apiKey = argv[i + 1]; i += 1; continue; }
  }
  return options;
}

function postJson(urlString, apiKey, payload) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL("/api/mcp-server/message", urlString);
    } catch {
      reject(new Error(`Invalid --url: ${urlString}`));
      return;
    }

    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const client = target.protocol === "https:" ? https : http;
    const req = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: target.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": body.length,
        "x-api-key": apiKey,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Gateway returned HTTP ${res.statusCode}${raw ? `: ${raw.slice(0, 200)}` : ""}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error(`Gateway returned invalid JSON: ${raw.slice(0, 200)}`));
        }
      });
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function run(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!options.apiKey) {
    process.stderr.write("Missing API key: pass --api-key or set NINE_ROUTER_API_KEY\n");
    return 2;
  }

  let buffer = "";
  let queue = Promise.resolve();

  const handleLine = async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }

    // Notifications expect no reply; forward them without blocking the stream.
    const isNotification = message.id === undefined || message.id === null;

    try {
      const response = await postJson(options.url, options.apiKey, message);
      if (!isNotification && response) writeMessage(response);
    } catch (error) {
      if (!isNotification) {
        writeMessage({
          jsonrpc: "2.0",
          id: message.id ?? null,
          error: { code: -32000, message: String(error?.message || error) },
        });
      } else {
        process.stderr.write(`mcp-stdio: ${error?.message || error}\n`);
      }
    }
  };

  return await new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        // Serialize requests so responses keep their order.
        queue = queue.then(() => handleLine(line));
        index = buffer.indexOf("\n");
      }
    });
    process.stdin.on("end", () => {
      if (buffer.trim()) queue = queue.then(() => handleLine(buffer));
      queue.then(() => resolve(0));
    });
    process.stdin.on("error", () => resolve(1));
  });
}

module.exports = { run };
