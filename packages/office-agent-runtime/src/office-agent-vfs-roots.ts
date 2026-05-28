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
    description: `
Esto es una base documental de la empresa Castrosua con instrucciones de montaje y fabricación de carrocerías. Los documentos pueden incluir referencias a artículos identificados generalmente por códigos numéricos, denominados indistintamente "código Logic", "código artículo" o simplemente "Logic", que corresponden a piezas, materiales o conjuntos del sistema ERP Logic.

Interpretación de códigos de artículo en documentos técnicos:
- Cuando en una instrucción aparezcan listados de materiales, tablas, notas o textos con códigos numéricos de 6 dígitos junto a una descripción, debe interpretarse por defecto que ese valor es un código de artículo del ERP Logic (CodigoArticulo), salvo que el propio documento indique claramente otra cosa.
- Expresiones como "código Logic", "código artículo", "artículo", "Logic" o un número de 6 dígitos en una lista de materiales suelen referirse al mismo concepto: el identificador de artículo en Logic.
- Ejemplos típicos: 012496, 209981, 012919, 222885, 014568, 220028, 201373, 220740, 207727, 010378K, 217078D, C000726-01, JL-2013/016-16284, LP-2017/106.
- En consultas a base de datos sobre estos códigos, la IA debe asumir que se trata de búsquedas en el ERP Logic, normalmente contra la tabla Articulos, relacionando por CodigoArticulo.
- Regla importante: para consultar artículos en Logic, usar siempre Articulos.CodigoEmpresa = 1, ya que los artículos de la empresa 1 aplican a todas las empresas. No mostrar este dato al usuario.
- Si el usuario pide información sobre uno de estos códigos en el contexto de documentación técnica, materiales, montaje o fabricación, la IA debe interpretarlo primero como un artículo de Logic antes de considerar otros significados posibles.
La subcarpeta 05_NORMALIZACIONES INTERNAS contiene correos electrónicos que actúan como excepciones, modificaciones o cambios puntuales sobre instrucciones o normas existentes. Ante cualquier contradicción entre un documento de instrucción estándar y un email de esta carpeta, prevalece el email, ya que representa la decisión más reciente sobre esa norma concreta.
Cuando respondas consultas, indica siempre el documento fuente junto a cada respuesta y, si aplica, si la respuesta está condicionada por alguna normalización interna.
    `.trim(),
    readOnly: true,
  },
] as const satisfies readonly OfficeAgentVfsRootDefinition[];
