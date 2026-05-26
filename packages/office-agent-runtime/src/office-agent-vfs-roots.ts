export const OFFICE_AGENT_VIRTUAL_FS_SCHEME = "virtual";

export interface OfficeAgentVfsRootDefinition {
  readonly scheme: typeof OFFICE_AGENT_VIRTUAL_FS_SCHEME;
  readonly authority: string;
  readonly uriPrefix: string;
  readonly rootId: string;
  readonly folderName: string;
  readonly displayName: string;
  readonly description: string;
  readonly readOnly: boolean;
}

export const OFFICE_AGENT_VFS_ROOTS = [
  {
    scheme: OFFICE_AGENT_VIRTUAL_FS_SCHEME,
    authority: "castrosua_iso",
    uriPrefix: "virtual://castrosua_iso",
    rootId: "castrosua_iso",
    folderName: "castrosua_iso",
    displayName: "Castrosua ISO docs",
    description: "Use this virtual folder when the user asks about Castrosua ISO documentation, quality procedures, audits, compliance, manuals, revisions, processes, or related internal documentation.",
    readOnly: true,
  },
] as const satisfies readonly OfficeAgentVfsRootDefinition[];
