# MN1 — interfaz web

Este repositorio contiene únicamente la interfaz web y sus pruebas. No incluye código Android, imágenes de equipos ni datos de usuarios.

Cambios aprobados en main se verifican y publican con GitHub Actions / Pages. Los pull requests sólo ejecutan pruebas.

Pruebas: npm --prefix web test

Paquete web: node web/tools/build-site.mjs

Configurar Settings → Pages → GitHub Actions antes del primer despliegue. La APK debe confiar en la URL HTTPS exacta; requiere una actualización Android inicial. Las acciones nativas conservan el contrato MN1Bridge v1.
