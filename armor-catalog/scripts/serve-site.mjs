import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDir);
const root = path.join(projectRoot, "site");
const toolsRoot = path.join(projectRoot, "tools");
const port = Number(process.argv[2] || process.env.PORT || 4173);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://localhost:${port}`);
    const requestedPath = url.pathname === "/" ? "/armor-catalog.html" : url.pathname;
    const baseRoot = requestedPath.startsWith("/tools/") ? toolsRoot : root;
    const relativePath = requestedPath.startsWith("/tools/")
      ? requestedPath.replace(/^\/tools\//, "/")
      : requestedPath;
    const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(baseRoot, safePath);
    if (!filePath.startsWith(baseRoot)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const body = await fs.readFile(filePath);
    response.writeHead(200, { "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${root} at http://127.0.0.1:${port}/`);
});
