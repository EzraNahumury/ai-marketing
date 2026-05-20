/* eslint-disable @typescript-eslint/no-require-imports */
// Custom entry point used by Hostinger Cloud Startup (Phusion Passenger)
// and any other shared host that boots a Node.js app by running a single file.
//
// `next start` already respects `process.env.PORT`, so this file is only
// needed where the host's "startup file" field cannot pass CLI args.
// Locally you can still use `npm run dev` / `npm run start` as usual.

const next = require("next");
const http = require("node:http");

const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";

const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    http
      .createServer((req, res) => handle(req, res))
      .listen(port, hostname, () => {
        console.log(`> Ready on http://${hostname}:${port}`);
      });
  })
  .catch((err) => {
    console.error("Failed to start Next.js server:", err);
    process.exit(1);
  });
