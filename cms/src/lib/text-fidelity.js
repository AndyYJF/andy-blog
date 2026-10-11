export function classifyNewlines(text) {
  const source = String(text);
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\r') {
      if (source[i + 1] === '\n') {
        crlf += 1;
        i += 1;
      } else {
        cr += 1;
      }
    } else if (char === '\n') {
      lf += 1;
    }
  }
  const kinds = [
    crlf ? 'CRLF' : '',
    lf ? 'LF' : '',
    cr ? 'CR' : '',
  ].filter(Boolean);
  return {
    crlf,
    lf,
    cr,
    uniform: kinds.length <= 1 ? (kinds[0] || 'LF') : null,
  };
}

export function lineSeparatorFor(uniform) {
  if (uniform === 'CRLF') return '\r\n';
  if (uniform === 'CR') return '\r';
  return '\n';
}

/** Display copy used only when the stored text mixes newline styles. */
export function normalizeMixedToLf(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function prepareEditorDocument(text) {
  const source = String(text);
  const newlines = classifyNewlines(source);
  if (newlines.uniform) {
    return {
      original: source,
      doc: source,
      lineSeparator: lineSeparatorFor(newlines.uniform),
      mixed: false,
      newlines,
    };
  }
  return {
    original: source,
    doc: normalizeMixedToLf(source),
    lineSeparator: '\n',
    mixed: true,
    newlines,
  };
}

/**
 * Unchanged mixed documents keep the original bytes. An actual edit must
 * carry an explicit LF normalization record; this function does not apply it.
 */
export function textForSave(prepared, editorDoc) {
  const doc = String(editorDoc);
  if (!prepared.mixed) {
    return { text: doc, normalized: false, newlineNormalization: null };
  }
  if (doc === prepared.doc) {
    return { text: prepared.original, normalized: false, newlineNormalization: null };
  }
  return {
    text: doc,
    normalized: true,
    newlineNormalization: {
      from: 'mixed',
      to: 'LF',
      before: prepared.newlines,
      after: classifyNewlines(doc),
    },
  };
}

export function acceptStoredText(stored, incoming, newlineNormalization) {
  if (incoming === stored) return { ok: true, text: incoming, newlineNormalization: null };
  const prepared = prepareEditorDocument(stored);
  if (!prepared.mixed) return { ok: true, text: incoming, newlineNormalization: null };
  if (!newlineNormalization || newlineNormalization.from !== 'mixed' || newlineNormalization.to !== 'LF') {
    return { ok: false, error: 'mixed newline edit requires explicit normalization' };
  }
  if (classifyNewlines(incoming).crlf || classifyNewlines(incoming).cr) {
    return { ok: false, error: 'explicit normalization must produce LF text' };
  }
  return { ok: true, text: incoming, newlineNormalization };
}

const JOE_PATTERN = /\{(?:netease|cloud|bilibili|message|alert|collapse)\b[^}]*\}|:::[\w-]+/;

export function joeMarkerRanges(text) {
  const ranges = [];
  const pattern = new RegExp(JOE_PATTERN.source, 'g');
  for (const match of String(text).matchAll(pattern)) {
    ranges.push({ from: match.index, to: match.index + match[0].length, text: match[0] });
  }
  return ranges;
}
