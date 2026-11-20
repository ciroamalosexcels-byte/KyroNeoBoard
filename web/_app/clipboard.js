// Las acciones se disparan con un clic: Inicio corre en localhost.
export async function copyText(text) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; } } catch {}
  const previous = document.activeElement, field = document.createElement('textarea');
  field.value = text; field.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.append(field); field.select();
  try { if (!document.execCommand('copy')) throw new Error('No se pudo copiar. Seleccioná el código y usá Ctrl+C.'); }
  finally { field.remove(); previous?.focus(); }
}

export async function pasteText() {
  if (!navigator.clipboard?.readText) throw new Error('Pegá el código en el campo con Ctrl+V o con el menú Pegar.');
  try { return await navigator.clipboard.readText(); }
  catch { throw new Error('No se pudo leer el portapapeles. Pegá el código en el campo con Ctrl+V.'); }
}
