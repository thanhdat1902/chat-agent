/**
 * Drops the local SQLite file and lets the next request re-seed from scratch.
 * Useful after a demo run: `npm run seed`.
 */
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(process.cwd(), "data/memory.db");
for (const suffix of ["", "-wal", "-shm"]) {
  try {
    rmSync(`${file}${suffix}`);
    console.log(`removed ${file}${suffix}`);
  } catch {
    /* not present */
  }
}
console.log("Seed will be rebuilt on the next request.");
