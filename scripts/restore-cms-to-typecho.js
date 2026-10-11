#!/usr/bin/env node
import { exitCode, runRestore } from './lib/cms-migration-cli.js';

try {
  const result = await runRestore(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(exitCode(error));
}
