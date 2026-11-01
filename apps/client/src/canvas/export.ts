import type { JSONContent } from '@tiptap/core';
import type { Paragraph, ParagraphChild, Table } from 'docx';

/** What a Word section, a table cell or a list holds. */
type Block = Paragraph | Table;

/** "Lettre de résiliation" → "Lettre de résiliation.docx": what the browser saves. */
function fileName(title: string, extension: string): string {
  return `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'document'}.${extension}`;
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadHtml(html: string, title: string): void {
  download(new Blob([html], { type: 'text/html' }), fileName(title, 'html'));
}

/**
 * The browser's print dialog, where "Save as PDF" is one click: the document alone, in light colors, the title as the
 * file name. From the page itself: printing an iframe fails in some browsers (Safari on iPhone).
 */
export function printDocument(html: string, title: string): void {
  const root = document.documentElement;
  const page = Object.assign(document.createElement('div'), { id: 'print-root', className: 'canvas-document' });
  // Tiptap's own HTML of the document: only the nodes of its schema.
  page.innerHTML = html;
  document.body.append(page);
  const dark = root.classList.contains('dark');
  const appTitle = document.title;
  root.classList.remove('dark');
  root.classList.add('printing');
  document.title = title;
  window.addEventListener(
    'afterprint',
    () => {
      page.remove();
      root.classList.remove('printing');
      if (dark) root.classList.add('dark');
      document.title = appTitle;
    },
    { once: true },
  );
  window.print();
}

/** A Word file of the editor's content: headings, bold and italics, lists, links, tables. Loads `docx` only now. */
export async function downloadWord(content: JSONContent, title: string): Promise<void> {
  // Loaded on the first export, not with the app: `docx` is large and most people never export.
  const docx = await import('docx');
  let orderedLists = 0;

  const runs = (nodes: JSONContent[] = []): ParagraphChild[] =>
    nodes.flatMap((node): ParagraphChild[] => {
      if (node.type === 'hardBreak') return [new docx.TextRun({ text: '', break: 1 })];
      if (node.type !== 'text') return [];
      const marks = new Set(node.marks?.map((mark) => mark.type));
      const style = {
        bold: marks.has('bold'),
        italics: marks.has('italic'),
        strike: marks.has('strike'),
        ...(marks.has('underline') ? { underline: {} } : {}),
        ...(marks.has('code') ? { font: 'Courier New' } : {}),
        ...(marks.has('link') ? { style: 'Hyperlink' } : {}),
      };
      // A line break inside a paragraph (an address) is a new line in the text, as the editor shows it.
      const lines = (node.text ?? '').split('\n');
      const run = lines.map(
        (line, index) => new docx.TextRun({ text: line, break: index > 0 ? 1 : undefined, ...style }),
      );
      const link = node.marks?.find((mark) => mark.type === 'link');
      return link ? [new docx.ExternalHyperlink({ link: String(link.attrs?.href), children: run })] : run;
    });

  const list = (node: JSONContent, level: number, ordered: number | null): Block[] =>
    (node.content ?? []).flatMap((item) =>
      (item.content ?? []).flatMap((child, index): Block[] => {
        if (child.type === 'bulletList') return list(child, level + 1, null);
        if (child.type === 'orderedList') return list(child, level + 1, ++orderedLists);
        if (index > 0) return blocks([child]);
        return [
          new docx.Paragraph({
            children: runs(child.content),
            ...(ordered === null
              ? { bullet: { level } }
              : { numbering: { reference: 'ordered', level, instance: ordered } }),
          }),
        ];
      }),
    );

  const blocks = (nodes: JSONContent[] = []): Block[] =>
    nodes.flatMap((node): Block[] => {
      switch (node.type) {
        case 'heading': {
          const level = Math.min(Number(node.attrs?.level ?? 1), 4) as 1 | 2 | 3 | 4;
          return [new docx.Paragraph({ heading: docx.HeadingLevel[`HEADING_${level}`], children: runs(node.content) })];
        }
        case 'bulletList':
          return list(node, 0, null);
        case 'orderedList':
          return list(node, 0, ++orderedLists);
        case 'blockquote':
          return blocks(node.content);
        case 'codeBlock':
          return (node.content?.[0]?.text ?? '')
            .split('\n')
            .map((line) => new docx.Paragraph({ children: [new docx.TextRun({ text: line, font: 'Courier New' })] }));
        case 'horizontalRule':
          return [
            new docx.Paragraph({
              border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: 'AAAAAA', space: 1 } },
            }),
          ];
        case 'table':
          return [
            new docx.Table({
              width: { size: 100, type: docx.WidthType.PERCENTAGE },
              rows: (node.content ?? []).map(
                (row) =>
                  new docx.TableRow({
                    children: (row.content ?? []).map((cell) => {
                      const children = blocks(cell.content);
                      return new docx.TableCell({
                        children: children.length > 0 ? children : [new docx.Paragraph('')],
                      });
                    }),
                  }),
              ),
            }),
          ];
        default:
          return [new docx.Paragraph({ children: runs(node.content) })];
      }
    });

  const file = new docx.Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: [
        {
          reference: 'ordered',
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: docx.LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: docx.AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: blocks(content.content) }],
  });
  download(await docx.Packer.toBlob(file), fileName(title, 'docx'));
}
