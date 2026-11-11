// Evita bloquear la pantalla si falla la carga de la aplicación.
setTimeout(() => { delete document.documentElement.dataset.themePending; }, 12000);
