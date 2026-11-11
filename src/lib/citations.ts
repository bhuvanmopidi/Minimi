// "[2]" in an answer → a markdown link to "#cite-2", which the renderer turns into a citation chip.
// Real links ("[text](url)") are left alone because of the (?!\() lookahead.
export function linkCitations(markdown: string): string {
  return markdown.replace(/\[(\d{1,3})\](?!\()/g, "[$1](#cite-$1)");
}

export function citationNumber(href: string | undefined): number | null {
  const m = href ? /^#cite-(\d{1,3})$/.exec(href) : null;
  return m ? Number(m[1]) : null;
}
