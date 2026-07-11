/**
 * @tripwire/db — persistence + the service layer.
 *
 * Drizzle schema + services. All three heads (web, api, worker) call these
 * services — logic lives here, never in route handlers or server functions.
 * Every jsonb column has a contracts schema validated ON WRITE (services).
 */

export type { Db } from "./client.ts";
export { createDb, schema } from "./client.ts";
export * from "./schema/index.ts";
