const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const MIN = BigInt(Number.MIN_SAFE_INTEGER);

export function jsonSafeInteger(value) {
  if (typeof value !== 'bigint') return value;
  if (value > MAX || value < MIN) {
    throw new Error(`integer ${value} exceeds the safe integer range`);
  }
  return Number(value);
}

export function safeIntegerTypeCast(field, next) {
  if (field.type !== 'LONGLONG') return next();
  const raw = field.string();
  if (raw == null) return null;
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`integer column ${field.name} value ${raw} is not a decimal integer`);
  }
  const big = BigInt(raw);
  if (big > MAX || big < MIN) {
    throw new Error(`integer column ${field.name} value ${raw} exceeds the safe integer range`);
  }
  return Number(big);
}
