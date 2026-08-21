/**
 * מונה שליחות יוצאות לכל שיחת לקוח (waId) — תשובת שירות מול תבנית.
 *
 * מ-01.10.2026 Meta מחייבת כל הודעה בנפרד גם בתוך חלון 24 השעות, ולכן
 * הספירה נעשית ברגע המסירה בפועל (transport.send שהצליח) — מה שנמסר הוא
 * מה שמחויב. התראות lead_alert נזקפות לשיחת הלקוח שגרמה להן, לא למספר
 * הצוות שמקבל אותן.
 */

'use strict';

function createMeter() {
  const perWa = new Map(); // waId → { reply, template }

  function bucket(waId) {
    if (!perWa.has(waId)) perWa.set(waId, { reply: 0, template: 0 });
    return perWa.get(waId);
  }

  /** רושם מסירה אחת; kind הוא 'reply' או 'template'. מחזיר את המונה המעודכן. */
  function record(waId, kind) {
    const b = bucket(waId);
    if (kind === 'template') b.template += 1;
    else b.reply += 1;
    return { reply: b.reply, template: b.template, total: b.reply + b.template };
  }

  function get(waId) {
    const b = perWa.get(waId) || { reply: 0, template: 0 };
    return { reply: b.reply, template: b.template, total: b.reply + b.template };
  }

  function totals() {
    let reply = 0;
    let template = 0;
    for (const b of perWa.values()) { reply += b.reply; template += b.template; }
    return { reply, template, total: reply + template, conversations: perWa.size };
  }

  /** סיכום קריא לסוף ריצת sim/selftest. */
  function summary() {
    const t = totals();
    const lines = ['📊 סיכום שליחות לפי שיחה (תשובות שירות + תבניות = הודעות לחיוב):'];
    if (!perWa.size) {
      lines.push('   (לא נמסרה שום הודעה)');
      return lines.join('\n');
    }
    for (const [waId, b] of perWa) {
      lines.push(`   ${waId}: ${b.reply} תשובות + ${b.template} תבניות = ${b.reply + b.template} הודעות`);
    }
    lines.push(`   סה"כ ${t.conversations} שיחות: ${t.reply} תשובות + ${t.template} תבניות = ${t.total} הודעות`);
    return lines.join('\n');
  }

  function reset() { perWa.clear(); }

  return { record, get, totals, summary, reset };
}

module.exports = { createMeter };
