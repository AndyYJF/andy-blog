/**
 * CI gate: every direct siteUrl use under Typecho admin/action paths must be
 * on the allowlist (with a reason). New unreviewed references fail the build.
 *
 * Run against an unpacked Typecho 1.2.1 tree:
 *   node scripts/typecho-siteurl-allowlist.js .cache/typecho-src/typecho-1.2.1
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('usage: node scripts/typecho-siteurl-allowlist.js <typecho-root>');
  process.exit(64);
}

/** Path (posix) → reason. Anything else matching siteUrl is a hard fail. */
const ALLOWLIST = {
  '.phpstorm.meta.php': 'IDE stub metadata only',
  'admin/login.php': 'Intentional "back to site" link → www',
  'admin/menu.php': 'Intentional "view site" menu link → www',
  'admin/register.php': 'Closed-registration redirect / home link → www',
  'admin/welcome.php': 'Intentional "view site" welcome links → www',
  'install.php': 'Installer writes and redirects via siteUrl once',
  'var/Widget/Options.php': 'Defines siteUrl / rootUrl / adminUrl getters themselves',
  'var/Widget/Archive.php': 'Public archive permalink construction',
  'var/Widget/Comments/Archive.php': 'Public comment links',
  'var/Widget/Contents/Post/Edit.php': 'Public preview / permalink helpers in editor',
  'var/Widget/Contents/Page/Edit.php': 'Public preview / permalink helpers in editor',
  'var/Widget/Menu.php': 'Admin "view site" link intentionally points at www',
  'var/Widget/Backup.php': 'Backup filename hosts derived from public siteUrl',
  'var/Widget/Feedback.php': 'Public comment feedback URL parsing',
  'var/Widget/Options/General.php': 'Admin form that edits the public siteUrl option',
  'var/Widget/Upload.php': 'Public upload base URL (override via __TYPECHO_UPLOAD_URL__)',
  'var/Widget/User.php': 'Logout fallback when no referer — public home',
  'var/Widget/XmlRpc.php': 'XML-RPC advertises public site / homePageLink',
  'admin/common.php': 'Bootstraps options; not a redirect target',
  'admin/index.php': 'Dashboard widgets may reference public siteUrl',
  'index.php': 'Front controller',
  // Patched away from siteUrl for admin-origin — keep listed so pre-patch trees pass audit docs.
  'var/Widget/Options/Permalink.php': 'PATCHED: rewrite probe uses rootUrl (admin-origin.patch)',
  'var/Widget/Users/Profile.php': 'PATCHED: action redirect uses adminUrl (admin-origin.patch)',
  'var/Widget/Login.php': 'PATCHED: referer allowlist drops siteUrl (admin-origin.patch)',
};

const hits = [];
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'vendor' || name === 'usr') continue;
      walk(full);
      continue;
    }
    if (!name.endsWith('.php')) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (!/siteUrl/.test(text)) continue;
    const rel = path.relative(root, full).split(path.sep).join('/');
    hits.push(rel);
  }
};
walk(root);

const unexplained = hits.filter((rel) => !ALLOWLIST[rel]);
if (unexplained.length) {
  console.error('Unallowlisted siteUrl references:');
  for (const rel of unexplained) console.error(' -', rel);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      scannedWithSiteUrl: hits.length,
      allowlisted: hits.length,
    },
    null,
    2,
  ),
);
