# MN1 — interfaz web y canal de actualizaciones

Este repositorio contiene la interfaz web, sus pruebas y las APK compiladas aprobadas para distribución. Incluye únicamente las dos bases iniciales sin hora autorizadas: Indestructibles y Super Guerreros. No contiene código fuente Android ni imágenes o datos guardados por usuarios en sus teléfonos.

Los cambios aprobados de main se verifican y publican con GitHub Actions / Pages. Los pull requests sólo ejecutan pruebas. El frontend se actualiza sin reinstalar la APK.

## Instalar MN1

Versión base con actualizador: [descargar APK](https://jatlopz.github.io/mn1-web/downloads/mn1-7-9cbcf02e30aceb4b.apk).

Instalar encima de MN1 sin desinstalar ni borrar datos. Esta base añade Actualizaciones dentro de la app. Las futuras actualizaciones nativas se descargan desde ahí y Android pide confirmación para instalar. Los cambios web continúan llegando sin reinstalar. La APK es pública; el código fuente Android se mantiene privado.

## Publicar una versión nativa aprobada

Incluir sólo el binario firmado aprobado en releases/downloads/ y actualizar releases/android-update.json con versión creciente, URL fija, tamaño exacto y SHA256. Conservar la firma original. El empaquetador verifica integridad y únicamente copia ese APK y el manifiesto al sitio; no incluye fuentes Android. La app también verifica paquete, versión y firma antes de abrir el instalador.

Pruebas: npm --prefix web test

Paquete web: node web/tools/build-site.mjs

Canal Android: node web/tools/include-android-release.mjs

El envío de WhatsApp requiere confirmación del usuario. No se promete envío automático a grupos.
