import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "@shared/schema";

export const client = new PGlite();
export const db = drizzle(client, { schema });
