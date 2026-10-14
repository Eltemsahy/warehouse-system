import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Express } from "express";

const servers: { close: () => Promise<void> }[] = [];

/** Starts an Express app on a random local port and returns its base URL. */
export async function serve(app: Express): Promise<string> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push({
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Call from afterAll to stop every server started by `serve`. */
export async function closeServers(): Promise<void> {
  await Promise.all(servers.splice(0).map((s) => s.close()));
}