# Kyro Neo Board

Mesa para armar fotos en tamaños A3 a A7 con marco blanco, acomodarlas en lienzos y exportarlas en hojas A3 o A4 (JPG 300 dpi + PDF + mapa de armado) para imprimir y recortar.

## Instalar

**Descargas:** carpeta [instalaciones](instalaciones/) o la [página de descargas](https://github.com/ciroamalosexcels-byte/KyroNeoBoard/releases/latest).

Ejecutá `Kyro-Neo-Board-Setup-1.4.0.exe`. Si Windows muestra **"Windows protegió su PC"**, tocá *Más información → Ejecutar de todas formas*. Aparece porque el programa no tiene firma digital paga; no es un virus.

- Windows 10 y 11: `Kyro-Neo-Board-Setup-1.4.0.exe`
- Windows 7 / 8.1: `Kyro-Neo-Board-Setup-1.4.0-Windows7.exe`. Usa un motor más viejo, sin actualizaciones de seguridad.
- Windows XP: no se puede, ningún motor actual corre ahí.

## Usar

1. **Proyecto nuevo**: elegí una carpeta y el programa crea la carpeta del proyecto.
2. Arrastrá fotos a la mesa, o pegalas con Ctrl+V. Sirven JPG, PNG, WebP, TIFF, HEIC (iPhone) y RAW de cámara (NEF, CR2, CR3, ARW, DNG, RAF, ORF, RW2, PEF…). Del RAW se usa la foto de tamaño completo que la cámara guarda adentro.
3. Para ver todos los atajos, tocá **?**.
4. **Ctrl+S** guarda el proyecto como `.neo`. Si después hacés doble clic en un `.neo`, se abre en el programa.

En la mesa se ve una vista previa liviana; al exportar se usa la foto completa (hasta 20 o 40 MP, según la Configuración ⚙).

**Trackpad**: con dos dedos se mueve la vista y pellizcando se hace zoom. Con el mouse, la ruedita hace zoom. En Configuración ⚙ se puede elegir mouse, trackpad o automático, y si Ctrl+Z guarda 20 o 40 pasos.

**En equipo** (botón de personas): abrí una sala y los que estén en tu misma red (wifi o cable) entran a tu mesa desde su compu, celu o tablet, con un enlace o un QR. Trabajan todos al mismo tiempo, ven los cursores de los demás y pueden mandarse mensajes. La primera vez, Windows pregunta si el programa puede usar la red: aceptá en **redes privadas**.

En la versión **1.4.2**, Inicio ofrece **Conectarse a una sala**: el anfitrión toca el ícono de copiar en el lado derecho del ticket y comparte su código. En la otra compu, tocá **Pegar código → Entrar**, o elegí una sala de la lista. El programa busca la dirección por dentro: no hace falta escribir ni compartir una IP o un enlace. Tienen que estar en la misma red; si no encuentra la sala, revisá que siga abierta y que la red permita que las computadoras se vean. Para el celu y la tablet sigue estando el QR. Una corona amarilla sobre el avatar identifica al anfitrión.

Al abrir una sala podés elegir **Pedir aprobación** o **Entrada directa**, y agregar una **contraseña opcional**, distinta del código de sala. La opción predeterminada es pedir aprobación; se cambia en Configuración → Ingreso a mis salas y se aplica a la próxima sala. Las solicitudes aparecen en el panel del anfitrión con **Aceptar** y **Rechazar**. Hasta que se autoriza el ingreso, el invitado no tiene acceso a las fotos ni a la edición. Para salir desde el programa, **Salir de la sala** vuelve al inicio.

En **1.4.3**, el ingreso muestra un ticket con seis casilleros vacíos para el código. El QR está dentro del ticket de la sala, abajo a la izquierda. **En equipo → Solo chat** oculta el panel lateral y muestra una barra translúcida abajo, centrada, con los últimos dos mensajes flotando encima. El botón de personas de esa barra vuelve al panel completo y la X oculta el chat sin salir de la sala. El borrador se conserva al cambiar de vista.

La mesa se guarda sola en un único archivo **.neo** dentro de la carpeta del proyecto, junto con el historial de Ctrl+Z. **Ctrl+S** guarda en ese mismo archivo; **Guardar como…** permite elegir otro nombre o ubicación y continúa el autoguardado allí. Las fotos siguen en su carpeta.

Los proyectos anteriores con `mesa.json` y `mesa.historial.json` se convierten al abrirlos desde Recientes. El programa verifica que el nuevo `.neo` contenga todo el armado y el historial antes de retirar esos dos archivos. Si ya hay otro `.neo` distinto, lo conserva y crea un nombre disponible para el proyecto recuperado. Este cambio está en el código de desarrollo, pendiente de compilar el instalador.

**Ilusión 3D · Pirámide**: seleccioná una foto y tocá el botón de la pirámide, junto a Mosaico, o usá clic derecho → Ilusión 3D. Mové la punta hasta el punto de fuga de la imagen y elegí ancho, alto y profundidad. La vista 3D usa el mismo motor de canvas, mat, órbita y zoom de Zine Generator: arrastrar gira, la rueda acerca, doble clic restablece y «Mirar de frente» recupera el punto de observación usado para proyectar la imagen. «Recorrer» muestra un desplazamiento suave; «Ver la forma» descubre las cuatro caras sin textura. La opción Hojas permite acercar y desplazar la plantilla.

«Crear ilusión» agrega una pieza independiente y conserva la foto original. Su geometría, recorte, orientación y punto de fuga quedan dentro del `.neo`, con deshacer/rehacer y colaboración LAN. Doble clic sobre una ilusión vuelve a abrirla. Las ilusiones se imprimen por su plantilla propia, accesible también desde la vista de exportación general.

La plantilla incluye cuatro caras triangulares con pestañas, base opcional y guía de armado con una regla de 10 cm. Exporta PDF A4/A3 a tamaño real; las caras grandes se reparten en hojas con 8 mm de superposición. En escritorio se guardan PDF y hojas JPG de 300 dpi; desde Chrome se descarga el PDF y se puede descargar un JPG por hoja. Imprimí al 100%, sin ajustar al papel. La previsualización comprueba la geometría y la proyección; el efecto perceptual final depende también de la foto, del montaje y de la observación. Esta herramienta también está pendiente de compilar en el instalador.

La proyección sigue la construcción de [perspectiva invertida de Cornell](https://www.cs.cornell.edu/courses/cs4670/2015sp/projects/pa4/reverse.htm) y el efecto descrito por [Rogers y Hughes (2023)](https://doi.org/10.1177/20416695231165623). Dentro del visor, Ctrl+S guarda la ilusión y Ctrl+P exporta su plantilla.

## Desarrollo

```
npm install
npm start            # abrir el programa
npm run selftest     # carga la mesa sin mostrarla y avisa si hay errores
npm test             # pruebas de enlaces, ingreso y permisos de las salas LAN
npm run dist         # instalador Windows 10/11 → dist/
npm run dist:win7    # instalador Windows 7 → dist-win7/
```

Si `npm run dist` falla con *Cannot create symbolic link*, activá el **Modo desarrollador** de Windows, o copiá la carpeta descomprimida de `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\<número>` como `winCodeSign-2.6.0`.

Tipografía Archivo (SIL Open Font License), incluida en `web/_app/fonts`.

En **1.4.4**, B abre Dibujo (diez pinceles del motor de Zine, c?rculo crom?tico, grosor y opacidad) y T abre Texto (fuente, tama?o y alineaci?n). Toc? la mesa para ubicar texto; doble clic para editarlo. El arte se guarda con el proyecto, se comparte en LAN y se renderiza en la exportaci?n. Solo chat usa vidrio seg?n el tema, nombres con el color e ?cono del perfil y mensajes que se desvanecen a los 15 segundos; el tiempo se cambia en Configuraci?n.
