// Creates the first administrator account. Run `npm run migrate` first.
//            npm run create-admin -- --username admin --display-name "Site Administrator" [--email a@b.test]
//      The password is asked for twice without echoing it. For scripts, set WMS_ADMIN_PASSWORD instead
// (never put a password on the command line: it ends up in the shell history).
// Refuses to touch an existing username. Allowed in production: that is where it is needed.
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import {
  createIdentityModule,
  PgIdentityRepository,
  ScryptPasswordHasher,
} from "../modules/identity/index.js";

/** Reads one line from the terminal without showing what is typed. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error("no terminal to ask on: set WMS_ADMIN_PASSWORD instead"));
      return;
    }
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const finish = (done: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      done();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish(() => resolve(value));
        if (ch === "\u0003") return finish(() => reject(new Error("cancelled")));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const { values } = parseArgs({
  options: {
    username: { type: "string" },
    "display-name": { type: "string" },
    email: { type: "string" },
  },
});

if (!values.username) {
  console.error(
    'usage: npm run create-admin -- --username <name> [--display-name "<name>"] [--email <address>]',
  );
  process.exit(2);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://wms:wms@localhost:5432/wms",
});

try {
  let password = process.env.WMS_ADMIN_PASSWORD;
  if (password === undefined) {
    password = await promptHidden("Password: ");
    if (password !== (await promptHidden("Repeat the password: "))) {
      throw new Error("the two passwords differ");
    }
  }

  const identity = createIdentityModule({
    repository: new PgIdentityRepository(pool),
    hasher: new ScryptPasswordHasher(),
  });
  const created = await identity.users.create({
    username: values.username,
    displayName: values["display-name"] ?? values.username,
    email: values.email ?? null,
    password,
  });
  if (!created.ok) throw created.error;
  console.log(`created the administrator "${created.value.username}" (${created.value.id})`);
} catch (e) {
  console.error("could not create the administrator:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
