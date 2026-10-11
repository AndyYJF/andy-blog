import { EditorState } from '@codemirror/state';
import { history, redo, undo } from '@codemirror/commands';
import { prepareEditorDocument, textForSave } from './text-fidelity.js';

function dispatch(state, spec) {
  return spec instanceof EditorState ? spec : state.update(spec).state;
}

export function createEditorSession(text) {
  const prepared = prepareEditorDocument(text);
  let state = EditorState.create({
    doc: prepared.doc,
    extensions: [history(), EditorState.lineSeparator.of(prepared.lineSeparator)],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction) {
      state = dispatch(state, transaction);
    },
  };
  return {
    prepared,
    get state() {
      return state;
    },
    insert(value) {
      const next = state.update({
        changes: { from: state.doc.length, insert: value },
      });
      state = next.state;
    },
    replace(from, to, value) {
      state = state.update({ changes: { from, to, insert: value } }).state;
    },
    undo() {
      return undo(view);
    },
    redo() {
      return redo(view);
    },
    doc() {
      return state.sliceDoc();
    },
    save() {
      return textForSave(prepared, state.sliceDoc());
    },
  };
}
