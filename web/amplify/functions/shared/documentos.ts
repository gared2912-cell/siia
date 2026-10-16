// Documentos del condominio guardados en Condominio.documentos (JSON). Sin dependencias: lo usan
// admin-api, portal-api y el panel /admin.

export type Documento = { slot: string; titulo: string; path: string; nombre: string; tamano: number; subido: string };

/** Lugares disponibles. Los que tienen título fijo no lo piden al subir. */
export const SLOTS_DOC: { slot: string; titulo?: string; placeholder?: string }[] = [
  // Datos generales
  { slot: 'reglamento', titulo: 'Reglamento' },
  { slot: 'doc1', placeholder: 'Ej. Acta constitutiva' },
  { slot: 'doc2', placeholder: 'Ej. Póliza de seguro' },
  // Amenidades (los ve el residente al reservar)
  { slot: 'amenidades-reglamento', titulo: 'Reglamento de amenidades' },
  { slot: 'amenidades-terminos', titulo: 'Términos y condiciones de uso' },
];

export const SLOTS_GENERALES = ['reglamento', 'doc1', 'doc2'];
export const SLOTS_AMENIDADES = ['amenidades-reglamento', 'amenidades-terminos'];

export function documentosDe(raw: unknown): Documento[] {
  let d: any = raw;
  for (let i = 0; i < 2 && typeof d === 'string'; i++) {
    try {
      d = JSON.parse(d);
    } catch {
      d = [];
    }
  }
  return Array.isArray(d) ? d.filter((x) => SLOTS_DOC.some((s) => s.slot === x?.slot)) : [];
}
