import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALLOWED_METHODS,
  absoluteUrl,
  evaluateRedirect,
  extractCanonical,
  mergeObservationParts,
  normalizeBodyForHash,
  requestPathForEntry,
  requestVantage,
  sameUrl,
} from './stage10-observation.js';

test('legacy path and query keys become exact read-only request paths', () => {
  assert.equal(requestPathForEntry({oldPath:'/archives/47/',queryKey:null}), '/archives/47/');
  assert.equal(requestPathForEntry({oldPath:null,queryKey:'/:47'}), '/?p=47');
  assert.equal(requestPathForEntry({oldPath:null,queryKey:'/index.php:47'}), '/index.php?p=47');
  assert.throws(() => requestPathForEntry({oldPath:null,queryKey:'bad'}), /invalid queryKey/);
});

test('redirect evaluation requires status, semantic Location, and server identity', () => {
  const expected = absoluteUrl('/posts/typecho-joe-mermaid/');
  assert.deepEqual(evaluateRedirect({status:302,headers:{location:expected},serverIdentityOk:true},302,expected), {pass:true,reasons:[]});
  const failed = evaluateRedirect({status:200,headers:{},serverIdentityOk:false},302,expected);
  assert.equal(failed.pass,false);
  assert.deepEqual(failed.reasons,['status:200!=302',`location:missing!=${expected}`,'server-identity-mismatch']);
  assert.deepEqual(evaluateRedirect({status:301,headers:{location:expected},serverIdentityOk:true},301,expected), {pass:true,reasons:[]});
  const failed301 = evaluateRedirect({status:302,headers:{location:expected},serverIdentityOk:true},301,expected);
  assert.equal(failed301.pass,false);
  assert.equal(failed301.reasons.includes('status:302!=301'), true);
});

test('canonical extraction is order-independent and URL comparison is semantic', () => {
  assert.equal(extractCanonical('<link href="https://www.andy-y.cn/about/" rel="canonical">'),'https://www.andy-y.cn/about/');
  assert.equal(extractCanonical("<link rel='alternate'><link rel='canonical noop' href='/about/'>"),'/about/');
  assert.equal(sameUrl('/about/','https://www.andy-y.cn/about/'),true);
  assert.equal(sameUrl('/about','https://www.andy-y.cn/about/'),false);
});

test('hash normalization removes only the identified Cloudflare tail injection', () => {
  const origin = '<html><body>content</body></html>';
  const injected = `<html><body>content<script>(function(){var a='/cdn-cgi/challenge-platform/scripts/jsd/main.js';})();</script></body></html>`;
  assert.equal(normalizeBodyForHash(injected,'text/html').toString('utf8'),origin);
  const injectedPrefixed = `<html><body>content<script>(function(){var a='/cdn-cgi/challenge-platform/h/g/scripts/jsd/main.js';})();</script></body></html>`;
  assert.equal(normalizeBodyForHash(injectedPrefixed,'text/html').toString('utf8'),origin);
  assert.equal(normalizeBodyForHash('<html><body>content<script>safe()</script></body></html>','text/html').toString('utf8'),'<html><body>content<script>safe()</script></body></html>');
});

test('hash normalization reverses Cloudflare email protection without touching ordinary HTML', () => {
  const encoded = '23131413121114424d475a63444e424a4f0d404c4e';
  const linked = `<a href="/cdn-cgi/l/email-protection#b2828582838085d3dcd6cbf2d5dfd3dbde9cd1dddf"><span class="__cf_email__" data-cfemail="${encoded}">hidden</span></a>`;
  const plain = `<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${encoded}">hidden</a>`;
  const hrefOnly = `<a href="/cdn-cgi/l/email-protection#${encoded}"><span>联系我</span><small>Email</small></a>`;
  const classFirst = `<a class="s-wide" href="/cdn-cgi/l/email-protection#${encoded}"><svg></svg></a>`;
  const nested = `<span class="s-handle"><span class="__cf_email__" data-cfemail="${encoded}">hidden</span></span>`;
  const script = '<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>';
  assert.equal(normalizeBodyForHash(linked,'text/html').toString('utf8'),'<a href="mailto:070127andy@gmail.com">070127andy@gmail.com</a>');
  assert.equal(normalizeBodyForHash(plain,'text/html').toString('utf8'),'070127andy@gmail.com');
  assert.equal(normalizeBodyForHash(hrefOnly,'text/html').toString('utf8'),'<a href="mailto:070127andy@gmail.com"><span>联系我</span><small>Email</small></a>');
  assert.equal(normalizeBodyForHash(classFirst,'text/html').toString('utf8'),'<a class="s-wide" href="mailto:070127andy@gmail.com"><svg></svg></a>');
  assert.equal(normalizeBodyForHash(nested,'text/html').toString('utf8'),'<span class="s-handle">070127andy@gmail.com</span>');
  assert.equal(normalizeBodyForHash(`a${script}b`,'text/html').toString('utf8'),'ab');
});

test('network layer rejects every non-read-only method before connecting', async () => {
  assert.deepEqual([...ALLOWED_METHODS].sort(),['GET','HEAD']);
  await assert.rejects(
    requestVantage({name:'fixture',ip:'127.0.0.1',expectedServer:'fixture'},{requestPath:'/',method:'POST',timeoutMs:1,maxBytes:1}),
    /read-only collector rejects method POST/,
  );
  await assert.rejects(
    requestVantage({
      name:'cloudflare',
      ip:'104.21.4.96',
      expectedServer:'cloudflare',
      proxyUrl:'http://127.0.0.1:7890',
      connectHost:'cname.517963.xyz',
    }, {requestPath:'/',method:'POST',timeoutMs:1,maxBytes:1}),
    /read-only collector rejects method POST/,
  );
});

test('merge requires three unique origin/aliyun/cloudflare vantages before pass', () => {
  const row = (name, ip) => ({
    capturedAt: '2026-08-20T00:00:00.000Z',
    vantages: [{
      name,
      ip,
      expectedServer: name,
      release: {pass: true},
      terminals: [{targetPath:'/about/', pass:true, observed:{normalizedBodySha256:'abc'}, reasons:[]}],
      legacy: [{pass:true}],
      probes: [{pass:true}],
    }],
  });
  const merged = mergeObservationParts(
    [row('origin','127.0.0.1'), row('aliyun','117.68.127.5'), row('cloudflare','104.21.4.96')],
    {observationDate:'2026-08-20', expectedRelease:'20260819T083006Z-96a161e2', expectedRedirect:302, legacyEntries:1, uniqueTargets:1},
  );
  assert.equal(merged.summary.ok, true);
  assert.equal(merged.decision, 'OBSERVATION_PASS_DOES_NOT_AUTHORIZE_301');
  assert.throws(
    () => mergeObservationParts([row('origin','127.0.0.1')], {observationDate:'2026-08-20', expectedRelease:'20260819T083006Z-96a161e2', expectedRedirect:302, legacyEntries:1, uniqueTargets:1}),
    /missing vantage aliyun/,
  );
});
