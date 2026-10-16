/*
 * Código compartido de las páginas de la agenda: fechas en la hora de la
 * persona, selector de horarios, llamadas a la API y eventos de Analytics.
 * Sin dependencias. Lo usan agenda/index.html y agenda/gestionar/index.html.
 */
(function () {
  'use strict';

  var BA = 'America/Argentina/Buenos_Aires';
  var WA = 'https://wa.me/541171417177';

  // ---------- Analytics ----------
  // window.va lo define el stub del <head>. Un bloqueador de publicidad puede
  // frenarlo: esto nunca debe romper la página.
  function track(name, data) {
    try { if (window.va) window.va('event', data ? { name: name, data: data } : { name: name }); }
    catch (e) {}
  }

  // ---------- Fechas ----------
  function zona() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || BA; }
    catch (e) { return BA; }
  }

  function partes(iso, tz, opciones) {
    var o = { timeZone: tz };
    for (var k in opciones) o[k] = opciones[k];
    var r = {};
    new Intl.DateTimeFormat('es-AR', o).formatToParts(new Date(iso)).forEach(function (p) { r[p.type] = p.value; });
    return r;
  }
  function hora(iso, tz) {
    var p = partes(iso, tz, { hour: 'numeric', minute: '2-digit', hour12: false });
    return (Number(p.hour) % 24) + ':' + p.minute;
  }
  function claveDia(iso, tz) {
    var p = partes(iso, tz, { year: 'numeric', month: '2-digit', day: '2-digit' });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function diaCorto(iso, tz) {
    var p = partes(iso, tz, { weekday: 'short', day: 'numeric', month: 'numeric' });
    return p.weekday.replace(/\.$/, '') + ' ' + p.day + '/' + p.month;
  }
  function fechaLarga(iso, tz) {
    var p = partes(iso, tz, { weekday: 'long', day: 'numeric', month: 'long' });
    return p.weekday + ' ' + p.day + ' de ' + p.month;
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // true si la hora o el día de la persona no coinciden con los de Buenos Aires.
  function difiere(iso) {
    var tz = zona();
    return tz !== BA && (hora(iso, tz) !== hora(iso, BA) || claveDia(iso, tz) !== claveDia(iso, BA));
  }

  // "Miércoles 21 de octubre, 9:00 a 9:30" y, si la persona está en otra hora,
  // lo mismo en hora de Argentina.
  // Va en minúscula (para meter en una frase: "Tu llamada es el miércoles…");
  // con alInicio=true arranca en mayúscula (cuando la fecha abre una línea).
  // Ante una fecha inválida devuelve '' en vez de tirar.
  function describir(inicio, fin, alInicio) {
    try {
      if (isNaN(new Date(inicio).getTime()) || isNaN(new Date(fin).getTime())) return '';
      var tz = zona();
      var f = fechaLarga(inicio, tz);
      var s = (alInicio ? cap(f) : f) + ', ' + hora(inicio, tz) + ' a ' + hora(fin, tz);
      if (difiere(inicio)) {
        var dia = claveDia(inicio, tz) !== claveDia(inicio, BA) ? fechaLarga(inicio, BA) + ', ' : '';
        s += ' (en Argentina: ' + dia + hora(inicio, BA) + ' a ' + hora(fin, BA) + ')';
      }
      return s;
    } catch (e) {
      return '';
    }
  }

  // ---------- DOM ----------
  function h(tag, props, hijos) {
    var e = document.createElement(tag);
    for (var k in (props || {})) {
      if (k === 'texto') e.textContent = props[k];
      else if (k === 'class') e.className = props[k];
      else e.setAttribute(k, props[k]);
    }
    (hijos || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function vaciar(e) { while (e.firstChild) e.removeChild(e.firstChild); }
  function linkWa(texto) { return h('a', { href: WA, target: '_blank', rel: 'noopener', texto: texto || 'WhatsApp' }); }

  // ---------- API ----------
  // Devuelve { status, json, timeout }. Un fallo de red da status 0; si el
  // pedido tarda más de 35 s se aborta y vuelve status 0 con timeout=true.
  var TIMEOUT_MS = 35000;
  function api(url, opciones) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var vencio = false;
    var timer = setTimeout(function () { vencio = true; if (ctl) ctl.abort(); }, TIMEOUT_MS);
    var o = {};
    for (var k in (opciones || {})) o[k] = opciones[k];
    if (ctl) o.signal = ctl.signal;
    return fetch(url, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { clearTimeout(timer); return { status: r.status, json: j }; });
    }, function () { clearTimeout(timer); return { status: 0, json: {}, timeout: vencio }; });
  }
  function post(url, cuerpo) {
    return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  }

  // ---------- Selector de horarios ----------
  var horariosEnviado = false;
  // opciones: { root, alElegir(turno) }. Devuelve { cargar(), aviso(texto) }.
  function selector(opciones) {
    var root = opciones.root;
    var turnos = [];
    var diaActivo = null;

    var zonaNota = h('p', { class: 'ag-zona', hidden: '' });
    var aviso = h('p', { class: 'ag-aviso', role: 'status', hidden: '' });
    var msg = h('div', { class: 'ag-msg', 'aria-live': 'polite' });
    var tituloDias = h('p', { class: 'ag-sel-titulo', texto: 'Elegí un día', hidden: '' });
    var dias = h('div', { class: 'ag-dias', role: 'group', 'aria-label': 'Días con horarios', hidden: '' });
    var tituloSlots = h('p', { class: 'ag-sel-titulo', hidden: '' });
    var slots = h('div', { class: 'ag-slots', role: 'group', 'aria-label': 'Horarios del día', hidden: '' });
    vaciar(root);
    [zonaNota, aviso, msg, tituloDias, dias, tituloSlots, slots].forEach(function (n) { root.appendChild(n); });

    function ocultarLista() {
      [tituloDias, dias, tituloSlots, slots, zonaNota].forEach(function (n) { n.hidden = true; });
    }

    function mostrarAviso(texto) {
      aviso.textContent = texto || '';
      aviso.hidden = !texto;
    }

    function pintarSlots() {
      vaciar(slots);
      var tz = zona();
      var delDia = turnos.filter(function (t) { return claveDia(t.inicio, tz) === diaActivo; });
      tituloSlots.textContent = delDia.length ? cap(fechaLarga(delDia[0].inicio, tz)) : '';
      delDia.forEach(function (t) {
        var b = h('button', { type: 'button', class: 'ag-chip-btn', 'aria-pressed': 'false', texto: hora(t.inicio, tz) });
        if (difiere(t.inicio)) b.appendChild(h('small', { texto: hora(t.inicio, BA) + ' en Argentina' }));
        b.addEventListener('click', function () {
          Array.prototype.forEach.call(slots.children, function (x) { x.setAttribute('aria-pressed', 'false'); });
          b.setAttribute('aria-pressed', 'true');
          track('agenda_turno');
          opciones.alElegir(t);
        });
        slots.appendChild(b);
      });
      tituloSlots.hidden = false;
      slots.hidden = false;
    }

    function pintarDias() {
      vaciar(dias);
      var tz = zona();
      var vistos = {};
      turnos.forEach(function (t) {
        var k = claveDia(t.inicio, tz);
        if (vistos[k]) return;
        vistos[k] = true;
        var b = h('button', { type: 'button', class: 'ag-chip-btn', 'aria-pressed': 'false', texto: diaCorto(t.inicio, tz) });
        b.addEventListener('click', function () {
          diaActivo = k;
          Array.prototype.forEach.call(dias.children, function (x) { x.setAttribute('aria-pressed', 'false'); });
          b.setAttribute('aria-pressed', 'true');
          pintarSlots();
        });
        dias.appendChild(b);
      });
      tituloDias.hidden = false;
      dias.hidden = false;
      if (zona() !== BA && turnos.some(function (t) { return difiere(t.inicio); })) {
        zonaNota.textContent = 'Los horarios están en tu hora (' + zona() + '). Debajo de cada uno ves la hora de Argentina.';
        zonaNota.hidden = false;
      }
    }

    function mensajeConWa(texto, extra) {
      vaciar(msg);
      msg.appendChild(document.createTextNode(texto + ' '));
      msg.appendChild(linkWa('Escribime por WhatsApp'));
      msg.appendChild(document.createTextNode('.'));
      if (extra) msg.appendChild(extra);
    }

    function errorGenerico() {
      ocultarLista();
      vaciar(msg);
      msg.appendChild(document.createTextNode('No pudimos cargar los horarios.'));
      msg.appendChild(document.createElement('br'));
      var b = h('button', { type: 'button', class: 'btn-primary', texto: 'Reintentar' });
      b.addEventListener('click', cargar);
      msg.appendChild(b);
    }

    function cargar() {
      ocultarLista();
      diaActivo = null;
      vaciar(msg);
      msg.textContent = 'Cargando horarios…';
      return api('/api/agenda/horarios', { cache: 'no-store' }).then(function (r) {
        if (r.status === 200 && Array.isArray(r.json.turnos)) {
          turnos = r.json.turnos;
          // Una sola vez por carga de página, no en cada recarga del selector.
          if (!horariosEnviado) { horariosEnviado = true; track('agenda_horarios', { cantidad: turnos.length }); }
          if (!turnos.length) {
            mensajeConWa('No hay horarios libres en las próximas 2 semanas.');
            return;
          }
          vaciar(msg);
          pintarDias();
        } else if (r.status === 503) {
          mensajeConWa('La agenda no está disponible en este momento.');
        } else {
          errorGenerico();
        }
      }).catch(function () { errorGenerico(); });
    }

    return { cargar: cargar, aviso: mostrarAviso };
  }

  window.Agenda = {
    BA: BA, WA: WA, track: track, zona: zona, hora: hora, difiere: difiere, describir: describir,
    h: h, vaciar: vaciar, linkWa: linkWa, api: api, post: post, selector: selector,
    diaCorto: diaCorto, fechaLarga: fechaLarga, cap: cap, claveDia: claveDia
  };
})();
