# -*- coding: utf-8 -*-
"""生成截图用的调试页面：在游戏 HTML 末尾注入一段自动导航脚本。"""
import io
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
src = io.open(os.path.join(ROOT, "孤高旅斗.html"), encoding="utf-8").read()

AUTO = """
<script>
/* ==== 仅截图调试用：按 ?s=xxx 自动切到指定界面 ==== */
(function () {
  function go() {
    var s = new URLSearchParams(location.search).get("s") || "menu";
    var LD = window.LD;
    if (!LD || !LD.UI || !LD.Battle) return;
    var UI = LD.UI, B = LD.Battle, P = LD.Profile;
    LD.Audio && LD.Audio.mute && LD.Audio.mute();
    /* 调试面板：把关键状态写进 DOM，便于 --dump-dom 读取 */
    var dbg = document.createElement("div");
    dbg.id = "dbg";
    document.body.appendChild(dbg);
    setInterval(function () {
      var B = window.LD.Battle, Cine = window.LD.Cine;
      if (!B || !Cine) return;
      var h = B.fighters && B.fighters[0];
      dbg.textContent = "state=" + B.state + " cd=" + (B.countdown || 0).toFixed(2)
        + " cine=" + Cine.active + " t=" + (Cine.t || 0).toFixed(2)
        + " shown=" + Cine.shown() + " name=[" + (Cine.name || "") + "]"
        + " energy=" + (h ? h.energy.toFixed(1) : "-")
        + " flash=" + (window.LD.FX && window.LD.FX.flashT ? window.LD.FX.flashT.toFixed(2) : "?");
    }, 50);

    if (s === "skin")     { UI.renderSkin(); UI.show("ovSkin"); }
    else if (s === "skill")  { UI.renderSkill(); UI.show("ovSkill"); }
    else if (s === "levels") { UI.renderLevels(); UI.show("ovLevels"); }
    else if (s === "load")   { UI.renderLoad(); UI.show("ovLoad"); }
    else if (s === "help")   { UI.renderHelp(); UI.show("ovHelp"); }
    else if (s === "duel")   { UI.show("ovDuelSetup"); }
    else if (s === "heads") {   /* 美术 QA：把 5 款头部模型放大排列 */
      var heads = LD.partsBy("head");
      var cv = document.createElement("canvas");
      cv.width = 1000; cv.height = 300;
      cv.style.cssText = "position:fixed;left:0;top:0;z-index:99;background:#0d1424";
      document.body.appendChild(cv);
      var c2 = cv.getContext("2d");
      heads.forEach(function (p, i) {
        c2.save();
        c2.translate(70 + i * 185, 250);
        c2.scale(3.0, 3.0);
        LD.View.chibi(c2, 0, 0, { x: 1, y: 0 },
          { head: { model: p.model, c1: p.c1, c2: p.c2, c3: p.c3 },
            upper: { c1: "#334155", c2: "#64748b" }, lower: { c1: "#1e293b", c2: "#475569" } },
          { t: 0.6, moving: false, blinkAmt: 1 });
        c2.restore();
        c2.fillStyle = "#fff"; c2.font = "600 13px sans-serif"; c2.textAlign = "center";
        c2.fillText(p.name + " (" + p.model + ")", 70 + i * 185, 288);
      });
    }
    else if (s === "heads") {   /* 美术 QA：把 5 款头部模型放大排列 */
      var heads = LD.partsBy("head");
      var cv = document.createElement("canvas");
      cv.width = 1000; cv.height = 300;
      cv.style.cssText = "position:fixed;left:0;top:0;z-index:99;background:#0d1424";
      document.body.appendChild(cv);
      var c2 = cv.getContext("2d");
      heads.forEach(function (p, i) {
        c2.save();
        c2.translate(70 + i * 185, 250);
        c2.scale(3.0, 3.0);
        LD.View.chibi(c2, 0, 0, { x: 1, y: 0 },
          { head: { model: p.model, c1: p.c1, c2: p.c2, c3: p.c3 },
            upper: { c1: "#334155", c2: "#64748b" }, lower: { c1: "#1e293b", c2: "#475569" } },
          { t: 0.6, moving: false, blinkAmt: 1 });
        c2.restore();
        c2.fillStyle = "#fff"; c2.font = "600 13px sans-serif"; c2.textAlign = "center";
        c2.fillText(p.name + " (" + p.model + ")", 70 + i * 185, 288);
      });
    }

    else if (s === "clicktest") {   /* 复现：帮助界面点哪里都加金币？ */
      UI.renderHelp(); UI.show("ovHelp");
      var coins0 = P.d.coins;
      setTimeout(function () {
        var ov = document.getElementById("ovHelp");
        var info = "ovHelp.class=" + ov.className + " display=" + getComputedStyle(ov).display
          + " rect=" + JSON.stringify(ov.getBoundingClientRect());
        try {
          var btn = document.getElementById("btnCheat");
          info += " BTN.rect=" + JSON.stringify(btn.getBoundingClientRect())
            + " BTN.cs=" + ["position", "width", "height", "alignSelf", "flexGrow"].map(function (k) {
              return k + "=" + getComputedStyle(btn)[k];
            }).join(",");
        } catch (e) { info += " BTN.err=" + e.message; }
        var r = ov.getBoundingClientRect();
        /* 按 app 矩形比例取点，保证点在帮助层内部 */
        var fr = [[0.1, 0.08], [0.5, 0.12], [0.5, 0.45], [0.5, 0.80], [0.9, 0.92], [0.3, 0.93], [0.5, 0.955]];
        var pts = fr.map(function (f) { return [Math.round(r.left + f[0] * r.width), Math.round(r.top + f[1] * r.height)]; });
        var log = [];
        pts.forEach(function (p) {
          var el = document.elementFromPoint(p[0], p[1]);
          if (!el) { log.push(p + ":null"); return; }
          var before = P.d.coins;
          el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: p[0], clientY: p[1] }));
          log.push(p + "->" + (el.id || el.className || el.tagName) + " coins:" + before + ">" + P.d.coins);
        });
        var out = document.createElement("div");
        out.id = "ctdbg";
        out.textContent = "CLICKTEST " + info + " coins0=" + coins0
          + " coinsEnd=" + P.d.coins + " | " + log.join("  ||  ");
        document.body.appendChild(out);
      }, 700);
    }

    else if (s === "dueltest") {   /* 验证：人机随机皮肤 + 胜利奖励 */
      var looks = [], coins0 = P.d.coins;
      for (var i = 0; i < 4; i++) {
        UI.startDuel();
        var bot = B.fighters[1];
        looks.push(JSON.stringify([bot.look.head.model, bot.look.upper.c1, bot.look.lower.c1]));
        UI.quitGame();
      }
      var out = document.createElement("div");
      out.id = "ctdbg";
      out.textContent = "DUELTEST coins0=" + coins0 + " AI皮肤4局=" + looks.join(" / ")
        + " DIFF奖励=" + LD.DIFF.normal.reward + "/" + LD.DIFF.hard.reward;
      document.body.appendChild(out);
    }

    else if (s === "battle" || s === "ult") {
      UI.startDragon(1, LD.DIFF.normal);
      B.state = "fight"; B.countdown = 0;            // 跳过倒计时，让时机可预测
      var hero = B.fighters[0], boss = B.fighters[1];
      setInterval(function () {                       // 持续把两人摆到有代表性的位置
        if (!B.fighters || B.fighters.length < 2) return;
        hero.x = LD.CONF.W * 0.40; hero.y = LD.CONF.H * 0.62; hero.face = 1;
        boss.x = LD.CONF.W * 0.68; boss.y = LD.CONF.H * 0.48;
      }, 60);
      setTimeout(function () {
        if (s === "ult") {
          hero.loadout.ult = "voidSlash";             // 默认配装大招槽是空的，先装上
          hero.energy = hero.maxEnergy;               // 能量满
          hero.ctrl.press.ult = true;
          try { B.ctrlFire(hero, hero.ctrl, 0.016); } catch (e) {}
          /* 无头浏览器里 rAF 很稀疏，Cine.t 累积极慢；为了稳定截到演出中段（名字逐字），直接拨到 0.62s */
          if (window.LD.Cine.active) window.LD.Cine.t = 0.62;
        } else {
          hero.vx = 160; hero.vy = -60;
          try { B.damage(hero, boss, 18, { type: "basic" }); } catch (e) {}
        }
      }, 800);
    }
  }
  if (document.readyState === "complete") setTimeout(go, 260);
  else window.addEventListener("load", function () { setTimeout(go, 260); });
})();
</script>
</body>"""

out = src.replace("</body>", AUTO, 1)
io.open(os.path.join(ROOT, "_shot.html"), "w", encoding="utf-8").write(out)
print("已生成 _shot.html  (%d KB)" % (len(out.encode("utf-8")) / 1024))
