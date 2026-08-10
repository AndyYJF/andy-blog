import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALLOWED_METHODS,
  absoluteUrl,
  evaluateRedirect,
  extractCanonical,
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
  assert.equal(normalizeBodyForHash(injected,'application/xml').toString('utf8'),injected);
  assert.equal(normalizeBodyForHash('<html><body>content<script>safe()</script></body></html>','text/html').toString('utf8'),'<html><body>content<script>safe()</script></body></html>');
});

test('hash normalization reverses Cloudflare email protection without touching ordinary HTML', () => {
  const encoded = '23131413121114424d475a63444e424a4f0d404c4e';
  const linked = `<a href="/cdn-cgi/l/email-protection#b2828582838085d3dcd6cbf2d5dfd3dbde9cd1dddf"><span class="__cf_email__" data-cfemail="${encoded}">hidden</span></a>`;
  const plain = `<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${encoded}">hidden</a>`;
  const script = '<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>';
  assert.equal(normalizeBodyForHash(linked,'text/html').toString('utf8'),'<a href="mailto:070127andy@gmail.com">070127andy@gmail.com</a>');
  assert.equal(normalizeBodyForHash(plain,'text/html').toString('utf8'),'070127andy@gmail.com');
  assert.equal(normalizeBodyForHash(`a${script}b`,'text/html').toString('utf8'),'ab');
});

test('network layer rejects every non-read-only method before connecting', async () => {
  assert.deepEqual([...ALLOWED_METHODS].sort(),['GET','HEAD']);
  await assert.rejects(
    requestVantage({name:'fixture',ip:'127.0.0.1',expectedServer:'fixture'},{requestPath:'/',method:'POST',timeoutMs:1,maxBytes:1}),
    /read-only collector rejects method POST/,
  );
});
