import type { Editor } from '@tiptap/core';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { useEffect } from 'react';

const extensions = [StarterKit, TableKit, Markdown];

/**
 * Its own chunk (Tiptap is heavy): a document edited like in Word, stored as Markdown, the format the model writes.
 * A new `markdown` from outside (the model's version, an old version) replaces the content without counting as an edit.
 */
export default function DocumentEditor({
  markdown,
  editable,
  onChange,
  onReady,
}: {
  markdown: string;
  editable: boolean;
  onChange: (markdown: string) => void;
  /** The editor, for the exports. */
  onReady: (editor: Editor | null) => void;
}) {
  const editor = useEditor({
    extensions,
    content: markdown,
    contentType: 'markdown',
    editable,
    editorProps: { attributes: { class: 'canvas-document min-h-full px-6 py-6 md:px-10' } },
    onUpdate: ({ editor: changed }) => onChange(changed.getMarkdown()),
  });

  useEffect(() => {
    onReady(editor);
    return () => onReady(null);
  }, [editor, onReady]);

  // React's development double mount runs these on an instance Tiptap already destroyed.
  useEffect(() => {
    if (editor.isDestroyed || editor.getMarkdown() === markdown) return;
    editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
  }, [editor, markdown]);

  useEffect(() => {
    if (!editor.isDestroyed) editor.setEditable(editable, false);
  }, [editor, editable]);

  return <EditorContent editor={editor} className='min-h-full' />;
}
