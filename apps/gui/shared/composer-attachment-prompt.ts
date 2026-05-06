import type { ComposerAttachment } from "./desktop-data-contracts";

export { parseComposerAttachmentBlock } from "./composer-attachment-block";

function isExternalReference(path: string) {
  return /^https?:\/\//i.test(path);
}

function formatAttachmentPath(path: string) {
  return `- \`${path}\``;
}

export function buildComposerAttachmentPrompt(attachments: ComposerAttachment[]): string {
  const normalizedAttachments = attachments
    .map((attachment) => ({ ...attachment, path: attachment.path.trim() }))
    .filter((attachment) => attachment.path.length > 0);

  if (normalizedAttachments.length === 0) {
    return "";
  }

  const localFiles = normalizedAttachments.filter((attachment) => !isExternalReference(attachment.path));
  const externalReferences = normalizedAttachments.filter((attachment) => isExternalReference(attachment.path));
  const sections: string[] = [];

  if (localFiles.length > 0) {
    sections.push(
      `User attached the following files. They have been copied into the writable project folder:\n\n${localFiles
        .map((attachment) => formatAttachmentPath(attachment.path))
        .join("\n")}`,
    );
  }

  if (externalReferences.length > 0) {
    sections.push(
      `User attached the following references:\n\n${externalReferences
        .map((attachment) => formatAttachmentPath(attachment.path))
        .join("\n")}`,
    );
  }

  return `---\n${sections.join("\n\n")}\n---`;
}
