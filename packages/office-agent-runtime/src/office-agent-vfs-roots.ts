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
    description: "Usa esta carpeta cuando el usuario pregunte algo sobre 'documentación ISO de Castrosua', 'documentación ISO', 'Sistema de Gestión de la Calidad', 'Gestión Ambiental', 'Gestión de la Seguridad y Salud en el Trabajo (SST)', 'Gestión de la Ciberseguridad (CSMS)', o en general cuando parezcan preguntar sobre documentación interna de la empresa Castrosua.",
    readOnly: true,
  },
] as const satisfies readonly OfficeAgentVfsRootDefinition[];
