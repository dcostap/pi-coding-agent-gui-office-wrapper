export type ProjectFileEntryKind = "file" | "directory";

export type ProjectFileEntry = {
  path: string;
  name: string;
  kind: ProjectFileEntryKind;
  modifiedMs: number;
  size: number | null;
};

export type ProjectFileEntriesResult = {
  rootPath: string;
  directoryPath: string;
  entries: ProjectFileEntry[];
};

export type ProjectFilePreviewResult =
  | {
      kind: "text";
      filePath: string;
      name: string;
      size: number;
      modifiedMs: number;
      text: string;
      truncated: boolean;
    }
  | {
      kind: "image";
      filePath: string;
      name: string;
      size: number;
      modifiedMs: number;
      mimeType: string;
      dataUrl: string;
    }
  | {
      kind: "unsupported";
      filePath: string;
      name: string;
      size: number;
      modifiedMs: number;
      reason?: string;
    };
