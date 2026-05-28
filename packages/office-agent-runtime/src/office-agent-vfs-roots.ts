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
  {
    scheme: OFFICE_AGENT_VIRTUAL_FS_SCHEME,
    authority: "instrucciones_tecnicas",
    uriPrefix: "virtual://instrucciones_tecnicas",
    rootId: "instrucciones_tecnicas",
    folderName: "instrucciones_tecnicas",
    displayName: "Instrucciones Técnicas Castrosua docs",
    description: "Esto es una base documental de la empresa Castrosua con instrucciones de montaje y fabricación de carrocerías. Los documentos pueden incluir referencias a artículos identificados por códigos numéricos, denominados indistintamente \"código Logic\", \"código artículo\" o simplemente \"Logic\", que corresponden a piezas, materiales o conjuntos del sistema ERP Logic. La subcarpeta 05_NORMALIZACIONES INTERNAS contiene correos electrónicos que actúan como excepciones, modificaciones o cambios puntuales sobre instrucciones o normas existentes. Ante cualquier contradicción entre un documento de instrucción estándar y un email de esta carpeta, prevalece el email, ya que representa la decisión más reciente sobre esa norma concreta. Cuando respondas consultas, indica siempre el documento fuente y, si aplica, si la respuesta está condicionada por alguna normalización interna.",
    readOnly: true,
  },
] as const satisfies readonly OfficeAgentVfsRootDefinition[];
