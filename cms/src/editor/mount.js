import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, keymap } from '@codemirror/view';
import { history, redo, undo } from '@codemirror/commands';
import { joeMarkerRanges, prepareEditorDocument, textForSave } from '../lib/text-fidelity.js';
import { acceptPreviewMessage, PREVIEW_LIMITS } from '../lib/preview-channel.js';
import { editorWriteHeaders, readStoredCsrf } from '../lib/editor-auth.js';

const toggleSource = StateEffect.define();
const sourceMode = StateField.define({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(toggleSource)) return effect.value;
    }
    return value;
  },
});

function joeDecorations(state) {
  if (state.field(sourceMode)) return Decoration.none;
  const ranges = joeMarkerRanges(state.doc.toString())
    .map((range) => Decoration.mark({ class: 'cm-joe' }).range(range.from, range.to));
  return Decoration.set(ranges, true);
}

const joeField = StateField.define({
  create(state) {
    return joeDecorations(state);
  },
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.effects.some((effect) => effect.is(toggleSource))) {
      return value.map(transaction.changes);
    }
    return joeDecorations(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function extensionsFor(separator, schedulePreview, nonce) {
  return [
    ...(nonce ? [EditorView.cspNonce.of(nonce)] : []),
    history(),
    sourceMode,
    joeField,
    EditorState.lineSeparator.of(separator),
    keymap.of([
      { key: 'Mod-z', run: undo },
      { key: 'Mod-y', run: redo },
      { key: 'Mod-Shift-z', run: redo },
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) schedulePreview();
    }),
  ];
}

export function mountEditor({ cid, win = window, nonce = '' }) {
  const status = win.document.getElementById('status');
  const title = win.document.getElementById('title');
  const editorHost = win.document.getElementById('editor');
  const preview = win.document.getElementById('preview');
  const newline = win.document.getElementById('newline');
  const normalizeLabel = win.document.getElementById('normalize-label');
  const normalize = win.document.getElementById('normalize');
  const flowId = crypto.randomUUID();
  let revision = 0;
  let isNew = false;
  let prepared = prepareEditorDocument('');
  let view = null;
  let previewTimer = 0;
  let previewController = null;

  preview.src = `/preview-frame/?flow=${encodeURIComponent(flowId)}&parent=${encodeURIComponent(win.location.origin)}`;

  function schedulePreview() {
    win.clearTimeout(previewTimer);
    previewTimer = win.setTimeout(pushPreview, PREVIEW_LIMITS.debounceMs);
  }

  async function pushPreview() {
    if (!view) return;
    previewController?.abort();
    previewController = new AbortController();
    try {
      const response = await win.fetch('/api/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cid, text: view.state.sliceDoc() }),
        signal: previewController.signal,
      });
      const payload = await response.json();
      if (!payload.ok) {
        status.textContent = payload.error || '预览失败';
        return;
      }
      // 沙箱 iframe 是不透明源，指定父源发不进去。帧里仍核对父源、来源窗口和 flowId。
      preview.contentWindow?.postMessage(
        { type: 'cms-preview-html', flowId, html: payload.html },
        '*',
      );
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      status.textContent = '预览没有完成';
    }
  }

  win.addEventListener('message', (event) => {
    if (!acceptPreviewMessage(event, { iframeWindow: preview.contentWindow, flowId })) return;
    if (event.data.type === 'cms-preview-ready') schedulePreview();
  });

  function currentSave() {
    const decision = textForSave(prepared, view.state.sliceDoc());
    if (decision.normalized && !normalize.checked) return { blocked: true, decision };
    return { blocked: false, decision };
  }

  win.document.getElementById('source').addEventListener('click', () => {
    if (!view) return;
    view.dispatch({ effects: toggleSource.of(!view.state.field(sourceMode)) });
  });

  win.document.getElementById('save').addEventListener('click', async () => {
    if (!view) return;
    const pending = currentSave();
    if (pending.blocked) {
      status.textContent = '混合换行有改动。勾选规范化后再保存。';
      return;
    }
    const response = await win.fetch(`/api/contents/${cid}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: editorWriteHeaders(readStoredCsrf(win.sessionStorage)),
      body: JSON.stringify({
        title: title.value,
        text: pending.decision.text,
        baseRevision: revision,
        newlineNormalization: pending.decision.newlineNormalization,
        ...(isNew ? { type: 'post_draft' } : {}),
      }),
    });
    if (response.status === 401) {
      status.textContent = '需要登录。这次保存没有写入。手感仍待试用。';
      return;
    }
    if (response.status === 403) {
      status.textContent = '登录状态不对。这次保存没有写入。手感仍待试用。';
      return;
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      status.textContent = '保存失败';
      return;
    }
    if (response.status === 409) {
      status.textContent = `修订冲突，服务器现在是第 ${payload.current?.revision ?? '?'} 版，没有覆盖它。`;
      return;
    }
    if (!response.ok) {
      status.textContent = payload.error || '保存失败';
      return;
    }
    revision = payload.revision;
    isNew = false;
    prepared = prepareEditorDocument(payload.content.text);
    const queue = payload.publish
      ? `重建请求已入队，状态是 ${payload.publish.state}。这里没有发布清单。`
      : '这次保存没有进入发布队列。';
    status.textContent = `已保存，修订 ${revision}。${queue}手感仍待试用。`;
  });

  function openEditor(text) {
    prepared = prepareEditorDocument(text);
    newline.hidden = !prepared.mixed;
    normalizeLabel.hidden = !prepared.mixed;
    view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: prepared.doc,
        extensions: extensionsFor(prepared.lineSeparator, schedulePreview, nonce),
      }),
    });
    schedulePreview();
  }

  win.fetch(`/api/contents/${cid}`, {
    credentials: 'same-origin',
    headers: editorWriteHeaders(readStoredCsrf(win.sessionStorage)),
  }).then(async (response) => {
    let text = '';
    if (response.status === 401) {
      revision = 0;
      status.textContent = '需要登录。这篇正文没有读出。手感仍待试用。';
      return;
    }
    if (response.status === 403) {
      revision = 0;
      status.textContent = '登录状态不对。这篇正文没有读出。手感仍待试用。';
      return;
    }
    if (response.status === 404) {
      revision = 0;
      isNew = true;
      status.textContent = '新文稿。手感仍待试用。';
    } else if (!response.ok) {
      revision = 0;
      status.textContent = '本地库没有连上。可以试写和预览，保存会失败。手感仍待试用。';
    } else {
      const payload = await response.json();
      revision = payload.revision;
      title.value = payload.title || '';
      text = payload.text || '';
      const publishState = payload.publishState;
      const queue = publishState?.requestAccepted
        ? '重建请求已接收。这里没有发布清单。'
        : publishState?.queue
          ? `重建请求状态是 ${publishState.queue}。这里没有发布清单。`
          : '';
      status.textContent = queue
        ? `修订 ${revision}。${queue}手感仍待试用。`
        : `修订 ${revision}。手感仍待试用。`;
    }
    openEditor(text);
  }).catch(() => {
    revision = 0;
    status.textContent = '读取失败。可以试写和预览，保存会失败。手感仍待试用。';
    openEditor('');
  });
}
