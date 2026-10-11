import crypto from 'node:crypto';
import sharp from 'sharp';
import { appendAudit } from './audit-log.js';
import { shadowWriteRefusal } from './shadow-guard.js';

const MAX_BYTES = 5 * 1024 * 1024;

export const MOCK_IMAGE_MAX_BYTES = MAX_BYTES;
export const MOCK_IMAGE_MAX_EDGE = 8000;
export const MOCK_IMAGE_MAX_PIXELS = 16_000_000;
export const MOCK_IMAGE_TIMEOUT_SECONDS = 5;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sniffStillImage(bytes) {
  const head = bytes.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml') || head.includes('<svg')) {
    return { ok: false, error: 'svg is rejected' };
  }
  if (bytes.subarray(0, 4).toString('ascii') === 'GIF8') {
    return { ok: false, error: 'animated gif is rejected until the image provider is verified' };
  }
  const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (png) {
    if (bytes.includes(Buffer.from('acTL'))) return { ok: false, error: 'animated png is rejected until the image provider is verified' };
    return { ok: true, mime: 'image/png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ok: true, mime: 'image/jpeg' };
  }
  return { ok: false, error: 'only still jpeg and png are accepted by the unverified mock' };
}

function decodeFailure(error) {
  const message = error instanceof Error ? error.message : '';
  if (message.toLowerCase().includes('timeout')) {
    return { ok: false, status: 400, error: 'image processing timed out' };
  }
  if (message.toLowerCase().includes('pixel')) {
    return { ok: false, status: 400, error: 'image pixel size is outside the mock limit' };
  }
  return { ok: false, status: 400, error: 'image could not be decoded' };
}

async function reencodeStill(bytes, mime) {
  try {
    const input = sharp(bytes, {
      failOn: 'error',
      limitInputPixels: MOCK_IMAGE_MAX_PIXELS,
      animated: false,
      pages: 1,
    }).timeout({ seconds: MOCK_IMAGE_TIMEOUT_SECONDS });
    const meta = await input.metadata();
    const pages = meta.pages || 1;
    if (pages > 1) {
      return { ok: false, status: 400, error: 'animated image is rejected until the image provider is verified' };
    }
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (
      width < 1 || height < 1
      || width > MOCK_IMAGE_MAX_EDGE
      || height > MOCK_IMAGE_MAX_EDGE
      || width * height > MOCK_IMAGE_MAX_PIXELS
    ) {
      return { ok: false, status: 400, error: 'image pixel size is outside the mock limit' };
    }
    const encoded = mime === 'image/jpeg'
      ? await sharp(bytes, { failOn: 'error', limitInputPixels: MOCK_IMAGE_MAX_PIXELS })
        .timeout({ seconds: MOCK_IMAGE_TIMEOUT_SECONDS })
        .jpeg({ quality: 85 })
        .toBuffer()
      : await sharp(bytes, { failOn: 'error', limitInputPixels: MOCK_IMAGE_MAX_PIXELS })
        .timeout({ seconds: MOCK_IMAGE_TIMEOUT_SECONDS })
        .png()
        .toBuffer();
    const out = await sharp(encoded).metadata();
    return {
      ok: true,
      bytes: encoded,
      mime,
      width: out.width,
      height: out.height,
    };
  } catch (error) {
    return decodeFailure(error);
  }
}

export async function storeMockImage(db, bytes) {
  const refused = await shadowWriteRefusal(db);
  if (refused) return refused;
  if (!Buffer.isBuffer(bytes)) return { ok: false, status: 400, error: 'image bytes are required' };
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return { ok: false, status: 400, error: 'image size is outside the mock limit' };
  }
  const kind = sniffStillImage(bytes);
  if (!kind.ok) return { ok: false, status: 400, error: kind.error };
  const encoded = await reencodeStill(bytes, kind.mime);
  if (!encoded.ok) return encoded;
  const hash = sha256(encoded.bytes);
  const [existing] = await db.query(
    'SELECT media_id, url, mime, width, height FROM cms_media WHERE sha256 = ?',
    [hash],
  );
  if (existing.length) {
    return {
      ok: true,
      provider: 'unverified',
      mediaId: Number(existing[0].media_id),
      url: existing[0].url,
      sha256: hash,
      mime: existing[0].mime,
      width: existing[0].width == null ? null : Number(existing[0].width),
      height: existing[0].height == null ? null : Number(existing[0].height),
      deduped: true,
    };
  }
  const url = `mock://unverified/${hash}`;
  const now = Math.floor(Date.now() / 1000);
  const [inserted] = await db.query(
    `INSERT INTO cms_media (url, sha256, mime, width, height, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [url, hash, encoded.mime, encoded.width, encoded.height, now],
  );
  await appendAudit(db, {
    action: 'media.store',
    detail: { mediaId: Number(inserted.insertId), sha256: hash, provider: 'unverified' },
    now,
  });
  return {
    ok: true,
    provider: 'unverified',
    mediaId: Number(inserted.insertId),
    url,
    sha256: hash,
    mime: encoded.mime,
    width: encoded.width,
    height: encoded.height,
    deduped: false,
  };
}

