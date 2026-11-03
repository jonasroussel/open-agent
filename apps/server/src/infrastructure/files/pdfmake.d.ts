/**
 * pdfmake 0.3's server API, as used here. `@types/pdfmake` is not used: it loads the DOM's types, whose `Response`
 * clashes with Bun's.
 */
declare module 'pdfmake' {
  /** A block or a run of text of a document definition (https://pdfmake.github.io/docs/0.3/document-definition-object/). */
  export type Content = string | { [key: string]: unknown } | Content[];

  export type DocumentDefinition = {
    content: Content[];
    [key: string]: unknown;
  };

  type Pdfmake = {
    setUrlAccessPolicy(allow: (url: string) => boolean): void;
    setLocalAccessPolicy(allow: (path: string) => boolean): void;
    addFonts(fonts: Record<string, { normal: string; bold: string; italics: string; bolditalics: string }>): void;
    createPdf(document: DocumentDefinition): { getBuffer(): Promise<Uint8Array> };
  };

  const pdfmake: Pdfmake;
  export default pdfmake;
}
