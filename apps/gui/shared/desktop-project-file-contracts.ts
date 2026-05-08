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
