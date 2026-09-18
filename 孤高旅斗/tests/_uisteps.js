module.exports = [
  `(() => { const w = t => new Promise(r => setTimeout(r, t));
    const log = []; const q = s => document.querySelector(s); const qa = s => [].slice.call(document.querySelectorAll(s));
    const click = s => { const e = q(s); if (!e) { log.push("MISS " + s); return; } e.click(); };
    return (async () => {
      q("#mSolo").click(); q("#sDuel").click(); await w(700);
      log.push("room h2: " + (q(".roomwrap h2") || {}).textContent);
      log.push("room: cards=" + qa(".pcard").length + " rules=" + qa(".rule").length + " sel=" + ((q(".rule.sel b") || {}).textContent || "-"));
      log.push("names: " + qa(".pcard .pn").map(e => e.textContent.trim()).join(" | "));
      qa("[data-rule]").filter(e => e.dataset.rule === "team")[0].click(); await w(400);
      log.push("team: chips=" + qa(".tchip").length + " mineSel=" + ((q(".pcard.mine .tchip.sel") || {}).textContent || "-") + " names=" + qa(".pcard .pn").map(e => e.textContent.trim()).join(" | "));
      qa("[data-rule]").filter(e => e.dataset.rule === "overlord")[0].click(); await w(300);
      q("#roomStart").click(); await w(1300);
      const B = window.LD.Battle;
      log.push("battle: rule=" + B.rule + " n=" + B.fighters.length + " kinds=" + B.fighters.map(f => f.kind).join(",") + " pos=" + B.fighters.map(f => Math.round(f.x) + "," + Math.round(f.y)).join(" ") + " roundT=" + B.roundT);
      await w(2500);
      log.push("battle run: state=" + B.state);
      window.LD.UI.quitGame(); await w(400);
      q("#mMulti").click(); await w(900);
      log.push("multiState: " + (q("#multiState") || {}).textContent);
      q("#btnGoJoin").click(); await w(400);
      log.push("ovJoin h2: " + ((q("#ovJoin h2") || {}).textContent || "MISSING"));
      q("#ovJoin [data-back]").click(); await w(300);
      q("#btnCreate").click(); await w(1300);
      log.push("netroom: cards=" + qa("#netRoomBody .pcard").length + " startBtn=" + !!q("#netStart"));
      log.push("netfoot: " + (((q("#netRoomBody .roomfoot .hint") || {}).textContent || "").slice(0, 70)));
      qa("#netRoomBody [data-open]").filter(e => e.dataset.open === "ovSkin")[0].click(); await w(500);
      log.push("skinBackTo: " + window.LD.UI.backTo);
      q("#ovSkin [data-back]").click(); await w(500);
      log.push("netroom after back: cards=" + qa("#netRoomBody .pcard").length);
      for (let i = 0; i < 3; i++) { const b = q("#netAddBot"); if (b) b.click(); }
      await w(600);
      log.push("netroom x4: cards=" + qa("#netRoomBody .pcard").length + " addBtn=" + !!q("#netAddBot"));
      q("#netStart").click(); await w(1500);
      log.push("netbattle: mode=" + B.mode + " n=" + B.fighters.length + " auth=" + B.authoritative + " rule=" + B.rule + " bots=" + B.fighters.filter(f => f.isBot).length);
      await w(3000);
      log.push("netbattle run: state=" + B.state);
      return log.join("\\n");
    })();
  })()`
];
