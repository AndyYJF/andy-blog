/**
 * @type {LHCI.LighthouseCiConfig}
 * Stage 9 budgets: Perf ≥95, SEO 100, A11y ≥95 (plan §2.6 / Stage 9).
 * Collect against local static dist (started by lighthouse-gate.js).
 */
module.exports = {
  ci: {
    collect: {
      url: [
        'http://127.0.0.1:4321/',
        'http://127.0.0.1:4321/posts/maibot-astrbot-napcat/',
      ],
      numberOfRuns: 1,
      settings: {
        preset: 'desktop',
        chromeFlags: '--headless=new --no-sandbox --disable-gpu',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.95 }],
        'categories:seo': ['error', { minScore: 1 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: './docs/baselines/reports/lighthouse',
    },
  },
};
