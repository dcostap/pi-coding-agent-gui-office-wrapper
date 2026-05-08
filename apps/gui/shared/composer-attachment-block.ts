export type ParsedComposerAttachmentBlock = {
  text: string;
  attachmentPaths: string[];
};

const attachmentBlockPattern = /^---\s*\nUser attached the following (?:files|references)[\s\S]*?\n---\s*(?:\n\s*)?/;
const attachmentPathPattern = /^-\s+`([^`]+)`\s*$/gm;

export function parseComposerAttachmentBlock(markdown: string): ParsedComposerAttachmentBlock {
  const match = markdown.match(attachmentBlockPattern);
  if (!match) {
    return { text: markdown, attachmentPaths: [] };
  }

  const block = match[0];
  const attachmentPaths = [...block.matchAll(attachmentPathPattern)]
    .map((pathMatch) => pathMatch[1]?.trim() ?? "")
    .filter((pathValue) => pathValue.length > 0);

  return {
    text: markdown.slice(block.length).trimStart(),
    attachmentPaths,
  };
}
