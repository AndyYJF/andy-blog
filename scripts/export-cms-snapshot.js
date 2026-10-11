#!/usr/bin/env node
process.env.CONTENT_SOURCE = 'cms';
await import('./export-content-snapshot.js');
