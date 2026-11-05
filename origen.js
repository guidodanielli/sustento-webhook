/*
 * De dónde vino la visita, recordado durante toda la visita.
 *
 * Hasta el 05/11/2026 cada página leía el origen de su propia URL o del
 * referidor. Si alguien entraba por un link etiquetado, pasaba por el blog y
 * volvía a la home, la home veía como referidor nuestro propio dominio y
 * anotaba "haceloconsustento.com": la etiqueta se perdía. Le pasó a una de las
 * primeras cuatro reservas de la agenda propia (17/10) y a un alta (01/09).
 *
 * Regla: gana la PRIMERA página de la visita (la pestaña). Se guarda en
 * sessionStorage, que dura lo que dura la pestaña. Los links internos que traen
 * su propio utm (el menú del blog manda utm_source=blog) no pisan el origen
 * real; solo cuentan si la visita empezó sin ningún dato.
 *
 * Lo cargan todas las páginas públicas en el <head>, antes que sus scripts.
 * Expone window.origenSustento:
 *   source  → el utm_source, o el dominio que la trajo, o "directo"
 *   content → el utm_content del link de entrada (o "")
 *   texto   → el formato de la columna subscribers.origen:
 *             "utm_source / utm_medium / utm_campaign / utm_content"
 */
(function () {
  var CLAVE = 'sustento_origen';
  // Referidores que son la propia web (y las copias locales de prueba).
  var PROPIOS = /(^|\.)haceloconsustento\.com$|\.vercel\.app$|^localhost$|^127\.0\.0\.1$/;

  function leer() {
    try { return JSON.parse(sessionStorage.getItem(CLAVE) || 'null'); } catch (e) { return null; }
  }
  function guardar(o) {
    try { sessionStorage.setItem(CLAVE, JSON.stringify(o)); } catch (e) {}
  }

  function deEstaPagina() {
    var p;
    try { p = new URLSearchParams(location.search); } catch (e) { p = null; }
    var utm = {};
    if (p) {
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(function (k) {
        var v = p.get(k);
        if (v) utm[k] = String(v).slice(0, 60);
      });
    }
    if (utm.utm_source) return { utm: utm };

    var host = '';
    try {
      if (document.referrer) host = new URL(document.referrer).hostname.replace(/^www\./, '');
    } catch (e) {}
    if (host && !PROPIOS.test(host)) return { ref: host.slice(0, 120) };
    return { directo: true };
  }

  var actual = deEstaPagina();
  var origen = leer();
  // Una visita que arrancó "directo" y después llega por un link interno con
  // utm (el CTA del blog) se queda con ese utm: es mejor dato que "directo".
  if (!origen || (origen.directo && actual.utm)) {
    origen = actual;
    guardar(origen);
  }

  var utm = origen.utm || {};
  var texto = origen.utm
    ? ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']
        .map(function (k) { return utm[k]; }).filter(Boolean).join(' / ')
    : (origen.ref || 'directo');

  window.origenSustento = {
    source: utm.utm_source || origen.ref || 'directo',
    content: utm.utm_content || '',
    texto: texto.slice(0, 120)
  };
})();
