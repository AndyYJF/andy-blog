#!/usr/bin/env node
import { exitCode, runImport } from './lib/cms-migration-cli.js';

try {
  const result = await runImport(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(exitCode(error));
}
