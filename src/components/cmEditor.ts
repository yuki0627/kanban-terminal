// Thin CodeMirror 6 wrapper for the Files view's editor: build/destroy an EditorView,
// swap the document + language when a different file is opened, and read it back on
// save. Kept out of the .vue file so the language-by-extension logic is unit-testable
// without a DOM.
import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";

export type LangKind = "markdown" | "javascript" | "json" | "text";

// Pick a syntax mode from a filename's extension. Only the modes we bundle are
// recognised; everything else edits as plain text.
export function langKindForFilename(name: string): LangKind {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "text"; // no extension (Makefile, LICENSE, …)
  const ext = name.slice(dot + 1).toLowerCase();
  if (["md", "markdown", "mdx"].includes(ext)) return "markdown";
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(ext)) return "javascript";
  if (ext === "json") return "json";
  return "text";
}

function langExtension(kind: LangKind): Extension {
  if (kind === "markdown") return markdown();
  if (kind === "javascript") return javascript({ typescript: true });
  if (kind === "json") return json();
  return [];
}

export interface CmEditor {
  setDoc(text: string, filename: string): void;
  getDoc(): string;
  destroy(): void;
}

// `onChange` fires only on USER edits — loading a file (setDoc) is programmatic and
// must not mark the buffer dirty, so it's suppressed with a flag.
export function createEditor(parent: HTMLElement, onChange: () => void): CmEditor {
  const lang = new Compartment();
  let loading = false;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "",
      extensions: [
        basicSetup,
        oneDark,
        lang.of([]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !loading) onChange();
        }),
      ],
    }),
  });
  return {
    setDoc(text, filename) {
      loading = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        effects: lang.reconfigure(langExtension(langKindForFilename(filename))),
      });
      loading = false;
    },
    getDoc: () => view.state.doc.toString(),
    destroy: () => view.destroy(),
  };
}
