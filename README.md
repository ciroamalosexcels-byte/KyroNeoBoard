# Kyro Neo Board

Mesa para armar fotos en tamaños A3 a A7 con marco blanco, acomodarlas en lienzos y exportarlas en hojas A3 o A4 (JPG 300 dpi + PDF + mapa de armado) para imprimir y recortar.

## Instalar

**Descargas:** carpeta [instalaciones](instalaciones/) o la [página de descargas](https://github.com/ciroamalosexcels-byte/KyroNeoBoard/releases/latest).

Ejecutá `Kyro-Neo-Board-Setup-1.3.0.exe`. Si Windows muestra **"Windows protegió su PC"**, tocá *Más información → Ejecutar de todas formas*. Aparece porque el programa no tiene firma digital paga; no es un virus.

- Windows 10 y 11: `Kyro-Neo-Board-Setup-1.3.0.exe`
- Windows 7 / 8.1: `Kyro-Neo-Board-Setup-1.3.0-Windows7.exe`. Usa un motor más viejo, sin actualizaciones de seguridad.
- Windows XP: no se puede, ningún motor actual corre ahí.

## Usar

1. **Proyecto nuevo**: elegí una carpeta y el programa crea la carpeta del proyecto.
2. Arrastrá fotos a la mesa, o pegalas con Ctrl+V. Sirven JPG, PNG, WebP, TIFF, HEIC (iPhone) y RAW de cámara (NEF, CR2, CR3, ARW, DNG, RAF, ORF, RW2, PEF…). Del RAW se usa la foto de tamaño completo que la cámara guarda adentro.
3. Para ver todos los atajos, tocá **?**.
4. **Ctrl+S** guarda el proyecto como `.neo`. Si después hacés doble clic en un `.neo`, se abre en el programa.

En la mesa se ve una vista previa liviana; al exportar se usa la foto completa (hasta 20 o 40 MP, según la Configuración ⚙).

**Trackpad**: con dos dedos se mueve la vista y pellizcando se hace zoom. Con el mouse, la ruedita hace zoom. En Configuración ⚙ se puede elegir mouse, trackpad o automático, y si Ctrl+Z guarda 20 o 40 pasos.

**En equipo** (botón de personas): abrí una sala y los que estén en tu misma red (wifi o cable) entran a tu mesa desde su compu, celu o tablet, con un enlace o un QR. Trabajan todos al mismo tiempo, ven los cursores de los demás y pueden mandarse mensajes. La primera vez, Windows pregunta si el programa puede usar la red: aceptá en **redes privadas**.

La mesa se guarda sola, con el historial de Ctrl+Z, dentro de la carpeta del proyecto.

## Desarrollo

```
npm install
npm start            # abrir el programa
npm run selftest     # carga la mesa sin mostrarla y avisa si hay errores
npm run dist         # instalador Windows 10/11 → dist/
npm run dist:win7    # instalador Windows 7 → dist-win7/
```

Si `npm run dist` falla con *Cannot create symbolic link*, activá el **Modo desarrollador** de Windows, o copiá la carpeta descomprimida de `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\<número>` como `winCodeSign-2.6.0`.

Tipografía Archivo (SIL Open Font License), incluida en `web/_app/fonts`.
