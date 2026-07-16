// Minimal type declarations for format libraries that don't ship their own.

declare module "html-to-docx" {
  /** Convert an HTML string to a .docx file buffer. */
  export default function htmlToDocx(
    html: string,
    headerHtml?: string | null,
    options?: Record<string, unknown>,
    footerHtml?: string | null,
  ): Promise<Buffer | ArrayBuffer>;
}
