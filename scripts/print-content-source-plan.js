#!/usr/bin/env node
import { assertContentSourceGroup } from './lib/content-source-launch.js';

try {
  const plan = assertContentSourceGroup();
  process.stdout.write(
    `source=${plan.source}\nobservePrefix=${plan.observePrefix}\nuseCmsDb=${plan.useCmsDb ? '1' : '0'}\n`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : 'content source plan failed');
  process.exit(65);
}
