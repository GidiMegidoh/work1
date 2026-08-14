/**
 * נגן הצ'אט של אולפן הדמו.
 *
 * הסוכן רץ כולו בדפדפן (agent.js הוא אותו קובץ שרץ ב-Node) — לכן כל טאב הוא
 * שיחה מבודדת לגמרי, ואין שום קריאת רשת חוץ מטעינת קובץ הטננט עצמו.
 */

/* global ShibutzAgent */
'use strict';

(function () {
  var VERTICAL_EMOJI = {
    dental: '🦷', medical: '🩺', aesthetics: '✨',
    legal: '⚖️', fitness: '💪', general: '💬',
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var messagesEl, tenant, agent, sessionId, alertCount = 0;

  function timeNow() {
    return new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  function scrollDown() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addBubble(kind, text) {
    var div = document.createElement('div');
    div.className = 'msg ' + kind;
    div.textContent = text;
    var meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = timeNow();
    div.appendChild(meta);
    messagesEl.appendChild(div);
    scrollDown();
    return div;
  }

  function addButtons(buttons) {
    if (!buttons || !buttons.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'btns';
    buttons.forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'reply-btn';
      btn.type = 'button';
      btn.textContent = b.title;
      btn.addEventListener('click', function () {
        send({ buttonId: b.id, buttonTitle: b.title });
      });
      wrap.appendChild(btn);
    });
    messagesEl.appendChild(wrap);
    scrollDown();
  }

  function showTyping() {
    var t = document.createElement('div');
    t.className = 'typing';
    t.innerHTML = '<i></i><i></i><i></i>';
    messagesEl.appendChild(t);
    scrollDown();
    return t;
  }

  function toast(text) {
    var el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 3500);
  }

  /** מציג תשובת סוכן עם השהיית "מקליד..." קצרה לתחושת שיחה אמיתית. */
  function addBotReply(reply, delay) {
    var typing = showTyping();
    setTimeout(function () {
      typing.remove();
      addBubble('in', reply.text);
      addButtons(reply.buttons);
      if (reply.alert) {
        alertCount += 1;
        var phones = (reply.alert.notifyPhones || []).join(', ') || '(לא הוגדרו נמענים)';
        toast('🚨 דמו: התראת SMS לצוות → ' + phones);
      }
      renderPanel();
    }, delay != null ? delay : 500 + Math.min(reply.text.length * 6, 900));
  }

  function send(input) {
    var label = typeof input === 'string' ? input : input.buttonTitle;
    addBubble('out', label);
    var reply = agent.handleMessage(sessionId, input);
    addBotReply(reply);
  }

  // ---- פאנל "מאחורי הקלעים" ----

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderPanel() {
    var state = agent.getState();
    var body = $('#panel-body');
    body.innerHTML = '';

    var secLeads = el('div', 'panel-section');
    secLeads.appendChild(el('h3', null, '🧲 לידים שנאספו בשיחה'));
    if (!state.leads.length) secLeads.appendChild(el('div', 'panel-empty', 'עוד אין — ברגע שלקוח משאיר שם, הוא מופיע כאן.'));
    state.leads.forEach(function (l) {
      var card = el('div', 'panel-card');
      var top = el('div', 'row');
      top.appendChild(el('strong', null, l.name || '(עדיין ללא שם)'));
      top.appendChild(el('span', 'tag ' + (l.hot ? 'hot' : 'off'), l.hot ? '🔥 ליד חם · ' + l.score : 'ניקוד ' + l.score));
      card.appendChild(top);
      Object.keys(l.answers).forEach(function (k) {
        var q = (tenant.qualification || []).find(function (x) { return x.id === k; });
        card.appendChild(el('div', 'muted', (q ? q.question.split('?')[0] : k) + ': ' + l.answers[k]));
      });
      secLeads.appendChild(card);
    });
    body.appendChild(secLeads);

    var secBook = el('div', 'panel-section');
    secBook.appendChild(el('h3', null, '📅 תורים ביומן (זיכרון)'));
    if (!state.bookings.length) secBook.appendChild(el('div', 'panel-empty', 'אין תורים עדיין.'));
    state.bookings.forEach(function (b) {
      var card = el('div', 'panel-card');
      var top = el('div', 'row');
      top.appendChild(el('strong', null, b.service));
      top.appendChild(el('span', 'tag ' + (b.status === 'active' ? 'ok' : 'off'),
        b.status === 'active' ? 'פעיל' : 'בוטל'));
      card.appendChild(top);
      card.appendChild(el('div', 'muted', b.slotLabel + ' · ' + (b.name || '') + ' · ' + b.id));
      secBook.appendChild(card);
    });
    body.appendChild(secBook);

    var secAlerts = el('div', 'panel-section');
    secAlerts.appendChild(el('h3', null, '🚨 התראות לצוות'));
    if (!state.alerts.length) secAlerts.appendChild(el('div', 'panel-empty', 'אין התראות. בקשת נציג או שאלה שאין עליה תשובה יופיעו כאן.'));
    state.alerts.forEach(function (a) {
      var card = el('div', 'panel-card');
      var top = el('div', 'row');
      var label = a.type === 'handoff' ? 'בקשת נציג' : a.type === 'trigger' ? 'טריגר הסלמה' : 'שאלה ללא מענה';
      top.appendChild(el('span', 'tag alert', label));
      top.appendChild(el('span', 'muted', a.at.slice(11)));
      card.appendChild(top);
      card.appendChild(el('div', null, '"' + a.message + '"'));
      card.appendChild(el('div', 'muted', 'SMS אל: ' + ((a.notifyPhones || []).join(', ') || '(לא הוגדרו)')));
      secAlerts.appendChild(card);
    });
    body.appendChild(secAlerts);

    $('#panel-badge').textContent = state.alerts.length ? String(state.alerts.length) : '';
  }

  // ---- אתחול ----

  function init() {
    messagesEl = $('#messages');
    if (new URLSearchParams(location.search).has('embedded')) {
      document.body.classList.add('embedded');
    }

    // הקריאה היחידה לרשת בכל הדמו: קובץ הטננט עצמו
    fetch('tenant.json')
      .then(function (res) { return res.json(); })
      .then(function (t) {
        tenant = t;
        agent = ShibutzAgent.createAgent(tenant);
        sessionId = 'web-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

        document.title = tenant.businessName + ' · דמו וואטסאפ';
        $('#biz-name').textContent = tenant.businessName;
        $('#avatar').textContent = VERTICAL_EMOJI[tenant.vertical] || '💬';

        var day = el('div', 'day-chip', 'היום');
        messagesEl.appendChild(day);

        // שאלות נפוצות כצ'יפים מעל שורת הקלט
        var strip = $('#faq-strip');
        (tenant.faq || []).slice(0, 6).forEach(function (f) {
          var chip = el('button', 'faq-chip', f.q);
          chip.type = 'button';
          chip.addEventListener('click', function () { send(f.q); });
          strip.appendChild(chip);
        });

        // הבוט פותח את השיחה
        addBotReply(agent.handleMessage(sessionId, 'שלום'), 700);
        renderPanel();
      })
      .catch(function (err) {
        addBubble('in', 'שגיאה בטעינת קובץ הטננט: ' + err.message);
      });

    $('#composer').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var input = $('#msg-input');
      var text = input.value.trim();
      if (!text || !agent) return;
      input.value = '';
      send(text);
    });

    $('#panel-toggle').addEventListener('click', function () {
      $('#app').classList.toggle('panel-open');
      renderPanel();
    });
    $('#panel-backdrop').addEventListener('click', function () {
      $('#app').classList.remove('panel-open');
    });
    $('#reset-btn').addEventListener('click', function () { location.reload(); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
