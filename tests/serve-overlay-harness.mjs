import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulePrefix = "/modules/character-show/";

export const HARNESS_PATH = `${modulePrefix}tests/overlay-harness.html`;

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

/** Serve the repository under /modules/character-show/ on 127.0.0.1. Port 0 picks a free port. */
export function startHarnessServer(port = 0) {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const relativePath = url.pathname.startsWith(modulePrefix) ? normalize(url.pathname.slice(modulePrefix.length)) : null;
    const filePath = relativePath === null ? null : resolve(join(root, relativePath));
    if (!filePath || !filePath.startsWith(root + sep) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "content-type": contentTypes.get(extname(filePath)) || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  });

  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolveServer(server));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startHarnessServer(Number(process.env.PORT || 0));
  console.log(`Character Show harness: http://127.0.0.1:${server.address().port}${HARNESS_PATH}`);
}
