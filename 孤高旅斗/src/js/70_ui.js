/* ============================================================
 *  70_ui.js — 界面 / 商店 / 帮助 / HUD / 输入
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, C = LD.CONF, P = LD.Profile, V = LD.View;
  const $ = id => document.getElementById(id);

  /* ==========================================================
   *  音效（WebAudio，无外部资源）
   * ========================================================== */
  const Audio2 = LD.Audio = {
    ctx: null, muted: false,
    init() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } } },
    beep(freq, dur, type, vol) {
      if (this.muted) return; this.init(); if (!this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type || "square"; o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime((vol == null ? 0.07 : vol), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + dur);
      } catch (e) {}
    },
    hit() { this.beep(180, 0.07, "square", 0.06); this.beep(90, 0.09, "triangle", 0.05); },
    parry() { this.beep(1180, 0.16, "sawtooth", 0.06); this.beep(720, 0.12, "square", 0.04); },
    ult() { this.beep(150, 0.5, "sawtooth", 0.07); setTimeout(() => this.beep(320, 0.4, "square", 0.05), 90); },
    cast() { this.beep(430, 0.09, "triangle", 0.05); },
    buy() { this.beep(760, 0.1, "sine", 0.06); setTimeout(() => this.beep(1080, 0.14, "sine", 0.05), 80); },
    ui() { this.beep(560, 0.05, "sine", 0.035); },
    win() { [520, 660, 800, 1040].forEach((f, i) => setTimeout(() => this.beep(f, 0.2, "sine", 0.06), i * 110)); },
    lose() { [420, 330, 250].forEach((f, i) => setTimeout(() => this.beep(f, 0.28, "triangle", 0.06), i * 150)); }
  };

  /* ==========================================================
   *  界面控制
   * ========================================================== */
  const OVS = ["ovMenu", "ovSolo", "ovLevels", "ovDuelSetup", "ovMulti", "ovJoin", "ovWait", "ovSkin", "ovSkill", "ovLoad", "ovHelp", "ovEnd", "ovPause", "ovPerk", "ovArmy", "ovTower", "ovAch"];
  const UI = LD.UI = { screen: "ovMenu" };

  UI.show = function (id) {
    OVS.forEach(o => { const e = $(o); if (e) e.classList.toggle("hide", o !== id); });
    this.screen = id;
    $("hud").classList.toggle("on", id === "game");
    UI.coins();
    if (id === "ovSkin") UI.renderSkin();
    if (id === "ovSkill") UI.renderSkill();
    if (id === "ovLevels") UI.renderLevels();
    if (id === "ovSolo") UI.renderGauntletCard();
    if (id === "ovLoad") UI.renderLoad();
    if (id === "ovHelp") UI.renderHelp();
    if (id === "ovSolo") UI.renderGauntletCard();
    if (id === "ovAch") UI.renderAch();
    if (id === "ovArmy") UI.renderArmy();
    if (id === "ovTower") UI.renderTowerShop();
    /* 回到多人房间（含从装扮/技能页返回）→ 同步一次自己的配装给房主 */
    if (id === "ovWait" && LD.Net.ws) LD.Net.sendProfile();
  };

  UI.coins = function () {
    document.querySelectorAll(".coinNum").forEach(e => { e.textContent = P.d.coins; });
    const c = $("cheatCount");
    if (c) c.textContent = P.d.cheat ? "已使用 " + P.d.cheat + " 次" : "";
  };

  UI.toast = function (msg, gold, ms) {
    const w = $("toast");
    const d = document.createElement("div");
    d.className = "tst" + (gold ? " gold" : "");
    /* v2.7：支持换行（技能介绍浮框会一次贴好几行），并可自定义停留时长 */
    d.style.whiteSpace = "pre-line";
    d.style.maxWidth = "min(560px, 86vw)";
    d.style.textAlign = "left";
    d.textContent = msg;
    w.appendChild(d);
    setTimeout(() => { d.style.transition = "opacity .3s"; d.style.opacity = "0"; setTimeout(() => d.remove(), 320); }, ms || 1500);
  };

  UI.tip = function (msg) {
    const t = $("tip");
    if (!msg) { t.classList.remove("on"); return; }
    t.textContent = msg; t.classList.add("on");
  };

  /* ==========================================================
   *  金币购买通用
   * ========================================================== */
  function doBuy(r, name) {
    if (r.ok) { Audio2.buy(); UI.toast("已购买「" + name + "」", true); UI.coins(); }
    else { Audio2.beep(200, 0.14, "square", 0.05); UI.toast("购买失败：" + r.why); }
    return r.ok;
  }

  /* ==========================================================
   *  皮肤商店
   * ========================================================== */
  UI.skinTab = "suit";
  UI.renderSkin = function () {
    const part = this.skinTab;
    const wrap = $("skinShop");
    wrap.innerHTML = "";
    if (part === "suit") {
      /* v2.8 套装页：一键购买 / 整套穿戴；散件仍出现在头部 / 上身 / 下身三页 */
      (LD.SUITS || []).forEach(s => {
        const owned = P.ownsSuit(s.id);
        const eq = owned && Object.keys(s.pieces).every(k => P.d.equip[k] === s.pieces[k]);
        const d = document.createElement('div');
        d.className = 'item' + (owned ? ' own' : '') + (eq ? ' eq' : '') + (!owned && P.d.coins >= s.price ? ' can' : '');
        d.style.gridColumn = 'span 2';
        d.innerHTML =
          '<div class="pv"><canvas width="120" height="150" style="width:90px;height:112px"></canvas></div>' +
          '<div class="nm">' + s.icon + ' ' + s.name + '</div>' +
          '<div class="pr">' + (eq ? '整套穿戴中' : owned ? '点击整套穿上' : '<i class="coin"></i> ' + s.price) + '</div>' +
          (owned ? '<div class="st' + (eq ? ' eq' : '') + '">' + (eq ? '★' : '✓') + '</div>' : '');
        d.title = s.desc || '';
        d.onclick = () => {
          Audio2.ui();
          if (owned) { P.equipSuit(s.id); UI.toast('已整套穿上「' + s.name + '」'); UI.renderSkin(); }
          else if (doBuy(P.buySuit(s.id), s.name)) UI.renderSkin();
        };
        wrap.appendChild(d);
        const cv = d.querySelector('canvas');
        V.heroPreview(cv, suitLookFor(s), 0);
      });
    } else {
    LD.partsBy(part).forEach(p => {
      const owned = P.ownsPart(p.id), eq = P.d.equip[part] === p.id;
      const d = document.createElement("div");
      d.className = "item" + (owned ? " own" : "") + (eq ? " eq" : "") + (!owned && P.d.coins >= p.price ? " can" : "");
      d.innerHTML =
        '<div class="pv"><canvas width="120" height="150" style="width:60px;height:75px"></canvas></div>' +
        '<div class="nm">' + p.name + '</div>' +
        '<div class="pr">' + (eq ? "已装备" : owned ? "点击穿上" : '<i class="coin"></i> ' + p.price) + '</div>' +
        (owned ? '<div class="st' + (eq ? ' eq' : '') + '">' + (eq ? "★" : "✓") + '</div>' : '');
      d.onclick = () => {
        Audio2.ui();
        if (owned) { P.equipPart(p.id); UI.toast("已换上「" + p.name + "」"); UI.renderSkin(); }
        else if (doBuy(P.buyPart(p.id), p.name)) UI.renderSkin();
      };
      wrap.appendChild(d);
      const cv = d.querySelector("canvas");
      V.heroPreview(cv, previewLookFor(p), 0);
    });
    }
    document.querySelectorAll("#skinTabs .tab").forEach(t => t.classList.toggle("on", t.dataset.part === part));
    UI.refreshSkinPv();
  };

  // 预览：把某个部件临时换上（v2.8 图片部件带上 img 键）
  function previewLookFor(p) {
    const look = P.look();
    const key = p.part === "head" ? "head" : p.part;
    if (p.part === "head") look.head = { model: p.model, c1: p.c1, c2: p.c2, c3: p.c3, img: p.img };
    else if (p.part === "upper") look.upper = { c1: p.c1, c2: p.c2, img: p.img };
    else look.lower = { c1: p.c1, c2: p.c2, img: p.img };
    return look;
  }

  // 预览：整套穿上
  function suitLookFor(s) {
    const look = P.look();
    const h = LD.part(s.pieces.head), u = LD.part(s.pieces.upper), l = LD.part(s.pieces.lower);
    if (h) look.head = { model: h.model, c1: h.c1, c2: h.c2, c3: h.c3, img: h.img };
    if (u) look.upper = { c1: u.c1, c2: u.c2, img: u.img };
    if (l) look.lower = { c1: l.c1, c2: l.c2, img: l.img };
    return look;
  }

  UI.refreshSkinPv = function () { V.heroPreview($("skinPv"), P.look(), 0); };
  /* v2.8：贴图（data URL）是异步解码的，首帧预览可能还没图；加载完成后若商店开着就重画一遍 */
  V.onSkinImgLoad = function () {
    const ov = $("ovSkin");
    if (ov && !ov.classList.contains("hide")) UI.renderSkin();
  };

  /* ==========================================================
   *  技能商店
   * ========================================================== */
  UI.skillTab = "basic";
  const SLOT_LAB = { basic: "J", skill1: "K", skill2: "L", ult: "O" };

  UI.renderSkill = function () {
    const kind = this.skillTab;
    // 装配栏
    const lb = $("loadBar");
    lb.innerHTML = "";
    ["basic", "skill1", "skill2", "ult"].forEach(slot => {
      const id = P.d.loadout[slot], sk = LD.skill(id);
      const d = document.createElement("div");
      d.className = "lslot" + (sk ? "" : " sel");
      d.innerHTML = '<div class="lb">' + SLOT_LAB[slot] + ' · ' + (slot === "basic" ? "普攻" : slot === "ult" ? "大招" : "技能" + (slot === "skill1" ? "1" : "2")) + '</div>' +
        '<div class="ls">' + (sk ? sk.icon + " " + sk.name : "（空）") + '</div>' +
        '<div class="lk">' + (sk ? (sk.kind === "ult" ? "需满能量" : "CD " + (sk.cdText || sk.cd + "s")) : "未装配") + '</div>';
      lb.appendChild(d);
    });

    const wrap = $("skillShop");
    wrap.innerHTML = "";
    LD.skillsBy(kind).forEach(s => {
      const owned = P.ownsSkill(s.id), slot = P.findSlotOf(s.id);
      const d = document.createElement("div");
      d.className = "item" + (owned ? " own" : "") + (slot ? " eq" : "") + (!owned && P.d.coins >= s.price ? " can" : "");
      let acts = "";
      if (owned && s.kind === "skill") {
        ["skill1", "skill2"].forEach(k => {
          acts += '<button class="btn sm" data-eq="' + k + '" style="padding:3px 9px;font-size:10px">装配 ' + SLOT_LAB[k] + '</button>';
        });
      }
      if (owned && s.kind !== "skill") {
        const k = s.kind === "basic" ? "basic" : "ult";
        acts += '<button class="btn sm" data-eq="' + k + '" style="padding:3px 9px;font-size:10px">装配 ' + SLOT_LAB[k] + '</button>';
      }
      if (slot) acts += '<button class="btn sm ghost" data-un="' + s.id + '" style="padding:3px 9px;font-size:10px">卸下</button>';
      d.innerHTML =
        '<button class="sinfo" data-info="1" aria-label="查看技能介绍" title="技能介绍">▾</button>' +
        '<div style="font-size:22px;margin:4px 0">' + s.icon + '</div>' +
        '<div class="nm">' + s.name + '</div>' +
        '<div style="font-size:10px;color:#8fa0c8;margin-top:3px;line-height:1.5">' + s.tags.join(" · ") + '</div>' +
        '<div class="pr">' + (owned ? (slot ? "已装配 " + SLOT_LAB[slot] : "点击装配") : '<i class="coin"></i> ' + s.price) + '</div>' +
        (s.dmg ? '<div style="font-size:10px;color:#fb923c">伤害 ' + s.dmg + (s.cd ? ' · CD ' + (s.cdText || s.cd + "s") : '') + '</div>' : (s.cd ? '<div style="font-size:10px;color:#8fa0c8">CD ' + (s.cdText || s.cd + "s") + '</div>' : '')) +
        '<div style="display:flex;gap:4px;justify-content:center;margin-top:6px;flex-wrap:wrap">' + acts + '</div>' +
        (owned ? '<div class="st' + (slot ? ' eq' : '') + '">' + (slot ? "★" : "✓") + '</div>' : '');
      d.title = s.desc;
      d.onclick = (ev) => {
        /* 右上角小箭头：只弹技能介绍，不购买不装配 */
        if (ev.target.dataset && ev.target.dataset.info) {
          ev.stopPropagation();
          UI.showSkillCard(s);
          return;
        }
        if (ev.target.dataset && ev.target.dataset.eq) {
          const k = ev.target.dataset.eq;
          const r = P.equipSkill(k, s.id);
          if (r.ok) { Audio2.ui(); UI.toast("「" + s.name + "」已装配到 " + SLOT_LAB[k]); UI.renderSkill(); }
          else UI.toast(r.why);
          return;
        }
        if (ev.target.dataset && ev.target.dataset.un) {
          const found = P.findSlotOf(ev.target.dataset.un);
          if (found) { P.equipSkill(found, null); Audio2.ui(); UI.toast("已卸下「" + s.name + "」"); UI.renderSkill(); }
          return;
        }
        Audio2.ui();
        if (!owned) { if (doBuy(P.buySkill(s.id), s.name)) UI.renderSkill(); return; }
        // 已拥有：自动装到第一个空槽
        const slotKey = s.kind === "basic" ? "basic" : s.kind === "ult" ? "ult" : (!P.d.loadout.skill1 ? "skill1" : !P.d.loadout.skill2 ? "skill2" : "skill1");
        const r = P.equipSkill(slotKey, s.id);
        if (r.ok) { UI.toast("「" + s.name + "」已装配到 " + SLOT_LAB[slotKey]); UI.renderSkill(); }
        else UI.toast(r.why);
      };
      wrap.appendChild(d);
    });
    document.querySelectorAll("#skillTabs .tab").forEach(t => t.classList.toggle("on", t.dataset.kind === kind));
  };

  /* v2.7 手机端技能介绍浮框：不购买、不装配，只把技能讲清楚 */
  UI.showSkillCard = function (s) {
    if (!s) return;
    Audio2.ui();
    const tags = (s.tags && s.tags.length) ? '<div style="color:#7fe6f7;font-size:11.5px;margin:2px 0 6px">' + s.tags.join(" · ") + '</div>' : "";
    const num = (s.dmg ? ("伤害 " + s.dmg) : "") + (s.cd ? ((s.dmg ? " · " : "") + "CD " + (s.cdText || s.cd + "s")) : "");
    UI.toast(
      s.icon + " " + s.name + (num ? "（" + num + "）" : "") + "\n" + s.desc,
      false, 3200
    );
  };

  /* ==========================================================
   *  我的配装
   * ========================================================== */
  UI.renderLoad = function () {
    V.heroPreview($("loadPv"), P.look(), 0);
    const rows = [
      ["头部", LD.part(P.d.equip.head)],
      ["上身", LD.part(P.d.equip.upper)],
      ["下身", LD.part(P.d.equip.lower)]
    ].map(([k, p]) => '<div style="margin:5px 0">' + k + '：<b>' + (p ? p.name : "-") + '</b></div>').join("");
    const sk = ["basic", "skill1", "skill2", "ult"].map(slot => {
      const s = LD.skill(P.d.loadout[slot]);
      return '<div style="margin:5px 0">' + SLOT_LAB[slot] + ' ' + (slot === "basic" ? "普攻" : slot === "ult" ? "大招" : "技能" + (slot === "skill1" ? "1" : "2")) +
        '：<b>' + (s ? s.icon + " " + s.name : "（空）") + '</b>' +
        (s ? '<span style="color:#8fa0c8;font-size:11.5px"> — ' + s.desc + '</span>' : '') + '</div>';
    }).join("");
    const prog = LD.LEVELS.map(l =>
      '<div style="margin:5px 0">' + l.icon + ' ' + l.name + '：普通 ' + (P.cleared(l.id, "normal") ? "✅" : "⬜") +
      ' / 困难 ' + (P.cleared(l.id, "hard") ? "✅" : "⬜") + '</div>').join("");
    $("loadInfo").innerHTML =
      '<div style="font-size:13px;color:#7fe6f7;letter-spacing:1px;margin-bottom:6px">名字</div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
      '<input id="nameInput" maxlength="8" placeholder="勇者" value="' + (P.d.name || "") + '" ' +
      'style="width:150px;background:#0b1220;color:#e8eeff;border:1px solid rgba(120,160,255,.3);border-radius:8px;padding:7px 11px;font-size:13px;outline:none">' +
      '<button class="btn sm" id="btnRename">改名</button>' +
      '<span style="font-size:11px;color:#8fa0c8">最多 8 个字，战斗与联机中都会显示</span></div>' +
      '<div style="font-size:13px;color:#7fe6f7;letter-spacing:1px">外观</div>' + rows +
      '<div style="font-size:13px;color:#7fe6f7;letter-spacing:1px;margin-top:12px">技能</div>' + sk +
      '<div style="font-size:13px;color:#7fe6f7;letter-spacing:1px;margin-top:12px">关卡进度</div>' + prog;
    const nameBtn = $("btnRename");
    if (nameBtn) nameBtn.onclick = () => {
      const r = P.rename($("nameInput").value);
      if (r.ok) { Audio2.ui(); UI.toast("已改名为「" + r.name + "」"); UI.renderLoad(); if (LD.Net.ws) LD.Net.sendProfile(); }
      else UI.toast(r.why);
    };
  };

  /* ==========================================================
   *  关卡
   * ========================================================== */
  UI.renderLevels = function () {
    const g = $("levelGrid");
    g.innerHTML = "";
    LD.LEVELS.forEach(l => {
      ["normal", "hard"].forEach(k => {
        const d = LD.DIFF[k], done = P.cleared(l.id, k);
        const c = document.createElement("div");
        c.className = "card";
        c.innerHTML =
          '<div class="t">' + l.icon + ' ' + l.name + '</div>' +
          '<div class="d">' + l.desc + '</div>' +
          '<div class="d" style="margin-top:6px;color:' + d.color + '">' +
            '奖励 <i class="coin"></i> ' + d.reward + ' · 怪物血量 ×' + d.hpM + ' · 伤害 ×' + d.dmgM + ' · 频率 ×' + d.rateM + '</div>' +
          '<div class="badge' + (k === "hard" ? " hard" : "") + '">' + d.name + (done ? " · 已通关" : "") + '</div>';
        c.onclick = () => { Audio2.ui(); UI.startDragon(l, d); };
        g.appendChild(c);
      });
    });
  };

  /* ==========================================================
   *  帮助
   * ========================================================== */
  UI.renderHelp = function () {
    $("helpBody").innerHTML = [
      '<h3>操作</h3>',
      '<ul>',
      '<li><span class="k">W</span><span class="k">A</span><span class="k">S</span><span class="k">D</span> 或方向键：四向移动；<b>快速双击同一方向键</b>可短距离闪避（无无敌帧，冷却 2.5 秒，与普攻共享冷却——闪避后普攻同样要等 2.5 秒）</li>',
      '<li><span class="k">J</span> 普攻　<span class="k">K</span> 技能 1　<span class="k">L</span> 技能 2　<span class="k">O</span> 大招　<span class="k">P</span> 交互　<span class="k">V</span> 切换索敌目标</li>',
      '<li><b>交互键 P</b>（手机端在大招键正上方）：靠近可交互物时角色头顶会弹出提示——掉落物 / 泥土显示「拾取」，柜子显示「躲藏」，汽车显示「驾驶」；再按一次 P 离开柜子或下车。手里拿着泥土时按 P 直接朝面向方向扔出。</li>',
      '<li><b>汽车</b>：油量以车顶的横条显示（2000~6000 距离随机），车上不能使用技能与大招，普攻变成喇叭（坦克是 5 秒 CD 的火炮）。撞到敌人造成 10 伤害 + 击退（同一辆车 2 秒 CD）；在车上受到任何伤害都会免疫该次伤害并被甩下车、眩晕 2 秒。车体被打中会漏油：每 1 点伤害少 20 可行驶距离，打空就开不动了。</li>',
      '<li><b>吹风机</b>：朝一个方向持续喷出 1 格宽、3~6 格长的气流，走进去会被顺着风向吹开（撞墙则贴墙滑）。气流本身不掉血，但机身可以打坏（110 血），打坏后立刻停风。</li>',
      '<li><b>柜子</b>：躲进去后敌人看不见；但藏超过 2 秒会被 AI 察觉（已经被锁定的目标躲进去也没用）。被发现后任何攻击命中都会免疫这次伤害、但把你揪出柜子并眩晕 2 秒；柜子被打碎时同样会被弹出并眩晕 2 秒。<b>隐匿</b>技能是更高级的隐身，AI 完全发现不了。</li>',
      '<li><span class="k">M</span> 静音　<span class="k">Esc</span> 暂停菜单（可继续战斗 / 返回房间 / 回主菜单）　<span class="k">B</span> 局内商店（丧尸危机 / 世界末日 / 塔防对战，不暂停战斗）</li>',
      '<li>技能槽位可以在「技能商店」里自由更换，最多 1 个普攻 + 2 个技能 + 1 个大招。<b>格挡</b>属于普攻分类，装在 J 槽。</li>',
      '</ul>',
      '<h3>大地图与视角</h3>',
      '<ul>',
      '<li>所有对战模式的场地都是 <b>1200 × 1200</b> 的大地图，而画面只有 960 × 600。</li>',
      '<li>视角<b>跟随你的角色</b>：角色始终待在屏幕中心，走到哪里背景就滚到哪里；只有贴到地图边界时视角才会停住，这时角色才开始在屏幕上偏移。</li>',
      '<li>视野外的敌人会在屏幕边缘显示<b>红色箭头</b>指示方位，按 <span class="k">V</span> 也能切换锁定目标。</li>',
      '</ul>',
      '<h3>索敌机制</h3>',
      '<ul>',
      '<li>当前锁定的对手头顶会有<b>黄色三角标记</b>，按 <span class="k">V</span> 在存活的敌人之间循环切换（Shift+V 反向）。</li>',
      '<li>追踪类与需要瞄准的技能（远程普攻、瞬身等）会<b>优先朝锁定的目标</b>出手；锁定目标倒下后自动回退到最近的敌人。</li>',
      '</ul>',
      '<h3>能量与大招</h3>',
      '<ul>',
      '<li>大招统一需要 <b>能量满 150</b> 才能释放。能量条在血量条下方。</li>',
      '<li>回能方式：<b>命中敌人 +12</b>、<b>被击中 +10</b>、以及每秒 <b>+2.2</b> 的自然回复。</li>',
      '<li>任何角色（包括巨龙）释放大招时都会<b>全局暂停并给出局部特写</b>，技能名逐字出现——这是预警，注意躲。</li>',
      '</ul>',
      '<h3>战斗技巧</h3>',
      '<ul>',
      '<li><b>格挡</b>：空放或挡下普攻 → 冷却 2 秒；挡下技能或大招 → 冷却 8 秒。代价不同，读招要准。</li>',
      '<li>格挡还能把飞来的远程攻击<b>原路反弹</b>，反弹后伤害更高。</li>',
      '<li>位移类技能冲刺过程中<b>无敌</b>，可以穿过弹幕。</li>',
      '<li>被击中会打断「冥思」，被打断时自己会眩晕 1 秒，谨慎使用。</li>',
      '</ul>',
      '<h3>关卡与金币</h3>',
      '<ul>',
      '<li>单人「闯关模式」为关卡制，每关有普通 / 困难两档。困难模式怪物血更厚、更疼、出手更频繁。</li>',
      '<li>单人「闯关模式」普通通关 <b>+4 金币</b>，困难通关 <b>+10 金币</b>；'
      + '<b>人机对战</b>胜利普通 <b>+6 金币</b>、困难 <b>+12 金币</b>（三局两胜整局结算）。</li>',
      '<li>部件（头 / 上身 / 下身）与普攻 / 技能均 <b>6 金币</b>，大招 <b>10 金币</b>。皮肤商店新增<b>套装</b>页：高清整装（如奶蛙）<b>18 金币</b>一套，也可拆开按件 <b>8 金币</b> 单买、与老部件自由混搭。</li>',
      '</ul>',
      '<h3>房间设置</h3>',
      '<ul>',
      '<li>房间界面已精简：模式按钮与修饰符按钮<b>悬停鼠标</b>可看到介绍；「⏱ 时间」「🗺 地图」两个按钮点开小窗编辑。</li>',
      '<li><b>对局时间</b>（60 / 120 / 180 / 240 / 300 秒）只有经典乱斗、阵营、追猎、热身、世界末日会用到；缩圈由毒圈计时，霸主 / 天外来物不限时，丧尸危机打到只剩一人，车轮战每场固定 60 秒。</li>',
      '<li><b>地图配置</b>：先选预设（全部随机 / 雨林 / 沙漠 / 废墟 / 雪原 / 竞技场 / 熔炉 / 城市），再用 15 条滑条微调各类设施数量（0 = 不生成）：实心柱、可破坏箱、可推动方块、围栏、草丛（站进去隐身）、炸药桶（打爆原地爆炸）、汽车（多格可推）、水池（减速）、轮胎（很轻）、补给箱（打破掉血包 / 能量 / 移速）、路障、建筑（石墙房间）、柜子（可躲藏）、泥土（可搬起投掷）、吹风机（持续喷风）。位置每局随机。</li>',
      '<li>联机房间里以上配置由房主设定，客机只能看到摘要。</li>',
      '</ul>',
      '<h3>对战模式（单人与联机都可选，共 11 种；塔防仅本地面板）</h3>',
      '<ul>',
      '<li><b>经典乱斗</b>：所有人互相为敌，最后站着的赢下回合。</li>',
      '<li><b>阵营模式</b>：红黄蓝绿四队，同队之间互不造成伤害（名字前有队伍色点），最后只剩一个阵营时获胜；全同阵营不能开局。</li>',
      '<li><b>霸主争霸</b>：巨龙同场混战。击败巨龙会爆出<b>能量石</b>并飞向随机位置，第一个抢到的人成为<b>霸主</b>：血量上限与当前血量 ×1.5、头顶加皇冠，其他人机的仇恨会转向霸主；霸主阵亡后能量石直接消散，不再掉落。</li>',
      '<li><b>天外来物</b>：开局只有普攻，技能与大招全靠天上降落。每 10 秒落一个技能、每 20 秒落一个大招（降落 2 秒后可拾取），走到掉落物旁按 <span class="k">P</span> 拾取：技能进 K/L 两格，两格都满时替换<b>最早获得</b>的那个；大招替换当前大招，被换下的会留在原地。最后活着的人获胜。AI 也会捡。</li>',
      '<li><b>缩圈乱斗</b>：开局也只有普攻，技能与大招靠天上掉落——场上最多同时 6 个技能、3 个大招，而且有一半概率<b>落在圈外</b>，想捡就得冒着中毒的风险出去。地图上只有 4 个大圈是安全区、其余全是毒；安全圈会一个个消失并持续缩小，最后只剩一个小圈逼大家正面开打。圈外每 0.5 秒掉 5 血，但圈外也会掉<b>血包</b>。最后活着的人获胜。</li>',
      '<li><b>丧尸危机</b>：<b>不限时</b>，场地不断刷出<b>僵尸</b>（100 血、移速 110%，固定「突刺 + 撕咬」两个技能，没有普攻、大招和闪避）。僵尸专盯玩家。你可以绕开它们，也可以杀掉爆<b>局内金币</b>（僵尸 1 枚 / 只、玩家 3 枚 / 人）；点战斗界面右上角的 <span class="k">🛒 商店</span> 按钮（电脑按 <span class="k">B</span>）打开<b>局内商店</b>，花 3 金币买血包、血量加成或移速加成（移速最多叠 3 次）。商店开着时战斗<b>不会暂停</b>，商品只在当局有效。打到只剩一人即获胜。</li>',
      '<li><b>世界末日</b>：所有玩家<b>同一阵容、互不伤害</b>，出生在地图左端的<b>圆形小岛</b>上——四周全是深渊，岛缘就是墙。中间一条 10 格长、2 格宽的<b>独木桥</b>通向右大陆：僵尸从大陆不断刷出（存活玩家越多刷得越快），<b>过桥移速 -70%</b>，守桥清怪是主业。<b>整块右大陆是危险区</b>（等同缩圈乱斗的圈外），站上去每 0.5 秒掉 5 血，头顶会亮「☠ 危险区」；回到岛上每秒回血 7。对僵尸造成的伤害与击杀都计入个人分数（1 伤 = 1 分、击杀 +10 分），击杀还掉局内金币，可按 <span class="k">B</span> 买血包 / 血量 / 移速 / 能量球，还能买<b>栅栏 / 枪台 / 炮台</b>守桥（枪台炮台会吸引僵尸仇恨）。最后存活的玩家获胜；时间到时仍有多人存活，则<b>分数最高者获胜</b>（不看剩余血量）。</li>',
      '<li><b>车轮战</b>：排队单挑，擂台上每次只有两人对决，败者永久出局，胜者回血 30% 迎接下一位挑战者。（仅本地面板可用）</li>',      '<li><b>追猎时刻</b>：开局<b>随机抽一名玩家当猎人</b>——先播一段猎人特写，猎人头顶加皇冠、血量 <b>800</b>、全部 CD 减半，且<b>伤害随存活幸存者数提升</b>（每多一名 +20%）；其余人是生存者，各自保留自己选的技能、互相同队。开场就有一个大毒圈并缓慢收缩（90 秒过去仍有大片走位空间）。猎人要在 90 秒内清场，生存者撑到倒计时结束就赢。</li>',
      '<li><b>乱斗热身</b>：限时刷分。对局时长在房间界面的「对局时间」里统一选 <b>60 / 120 / 180 / 240 / 300 秒</b>，阵亡不淘汰、1.6 秒后在随机位置复活，每次击杀得 1 分，时间到分数最高者获胜。不计回合、没有淘汰，纯粹练手。</li>',
      '<li><b>护送情报箱</b>：两队对抗（房间界面选红队 / 蓝队，默认 2 队）。场地正中会反复投放一个<b>情报箱</b>，任何英雄<b>走到箱子旁边自动抱起</b>（不用按键）；抱着箱子走进<b>敌方交付点</b>（地图左右两侧的红 / 蓝大圈）得 <b>1 分</b>。抱箱期间<b>移速降 8%</b>，而且头顶有金色标记与指向敌方基地的虚线，是全场最显眼的活靶子，得靠队友开路。持箱者阵亡时箱子<b>掉在原地</b>，0.8 秒保护期过后任何人都能捡。先到 <b>3 分</b>直接获胜；时间到比分高者胜，同分则比两队剩余总血量。该模式<b>没有大招限制</b>，配装、商店与常规对局一致。</li>',
      '<li><b>占点争夺</b>：两队对抗（房间界面选红队 / 蓝队）。地图 <b>2400×2400</b>，每局随机生成 <b>3~5 座据点</b>，其中最大的据点永远在地图正中（权重 ×2）。站进圈内开始读条占领，<b>人越多越快</b>：空据点单人 <b>5 秒</b>，抢敌方已经占下的据点要花<b>两倍时间</b>（10 秒）；双方都在圈里则僵持，谁也推不动。占领后据点持续产分，大点 2 分/秒、小点 1 分/秒，先到 <b>80 分</b>获胜；圈里没人时，对方留下的占领进度会缓慢回落。据点被占领后中心会升起一座<b>炮塔</b>（1200 血、伤害 26、攻速 1.05，射程就等于据点半径），只打敌方角色；据点易主时炮塔跟着换攻击目标、<b>血量不变</b>，被拆掉后本局永久消失。阵亡后在本方基地复活：首次 <b>3 秒</b>，之后每死一次 <b>+3 秒</b>（最多 24 秒），基地圈内每秒回复 5% 最大生命。时间到比分高者胜，同分则比两队剩余总血量。</li>',
      '<li><b>碰碰车竞技</b>：圆形擂台，台外全是水池，开局每人自动坐上一辆碰碰车（电力无限，车上不能用技能，普攻只是喇叭）。开车对撞时<b>接近速度越快，伤害和击退越大</b>，主动撞人的一方也会吃到 35% 的反伤。把对手的车<b>撞爆 +2 分</b>、直接把他<b>顶出擂台 +3 分</b>，先到 <b>12 分</b>获胜。撞爆的车 4 秒后重生，掉进水里的人 2.4 秒后回到擂台中心并重新发车。诀窍是：绕到侧面撞、把人往边缘推，同时别让自己顺着惯性滑出去。</li>',
      '<li><b>塔防对战</b>：3v3 单线推塔，<b>没有时间限制</b>，一直打到一方水晶爆掉。地图 2800×600，左右镜像，红蓝一塔之间留出一大片中心战区。双方每 32 秒刷 6 只机器人小兵沿兵线推进，拆掉敌塔后自家小兵变强。防御塔（1200 血 / 射程 300）与水晶（2400 血 / 射程 340）会发射<b>高速追踪弹</b>，走进敌方范围时会显示一圈红圈警告；<b>防御塔没拆完水晶免疫伤害</b>。击杀小兵 / 英雄 / 助攻都给<b>局内金币</b>，按 <span class="k">B</span> 买被动装备（生命 / 攻击 / 护盾 / 能量 / 回血 / 霸体 / 闪避等，每件一次）、<b>主动装备</b>（最多 1 件，按 <span class="k">P</span> 释放）、可重复购买的<b>小兵强化</b>，以及开车时才能买的<b>汽油桶</b>（80 金，+2000 油，不限次数）。英雄 1–6 级，升级加血加伤害；阵亡后在原地立<b>墓碑</b>显示复活倒计时（<b>5 秒 + 等级 × 5 秒</b>，1 级 10 秒、5 级 30 秒），倒计时结束回基地复活，基地回血圈每秒回复 12% 生命。房间界面可以选红队 / 蓝队。</li>',
      '<li>单人「勇者格斗」的房间就是角色卡房间：第一张卡是你（可直接换装扮 / 技能），后面的人机卡可增删（最多 5 个，塔防会自动补满 5 个凑 3v3）、可选难度（木桩 / 普通 / 困难）与配装。</li>',
      '</ul>',
      '<h3>规则修饰符（可多选叠加）</h3>',
      '<ul>',
      '<li><b>低重力</b>：击退更远更飘，闪避距离 +50%。</li>',
      '<li><b>高速</b>：移速 +35%，所有 CD 缩短 30%。</li>',
      '<li><b>回复</b>：场上每 8 秒随机掉落一个血包，吃下回复 45 点生命。</li>',
      '<li><b>僵尸</b>：场上会不断刷新僵尸干扰战局，僵尸只有<b>突刺 / 撕咬</b>两个技能，没有普攻、大招和闪避，击杀也<b>不掉</b>局内金币。</li>',
      '<li><b>技能轮盘</b>：每 12 秒全场勇者随机换一套技能与大招。</li>',
      '<li><b>物资刷新</b>：每 30 秒按当前地图预设刷新一次物资——被打碎的可破坏物复原、车辆回到原位并加满油、空地上重生两个能量包；石柱 / 墙体等固定障碍不受影响。</li>',
      '</ul>',
      '<h3>关卡（怪物规格：1 普攻 + 2 技能 + 1 大招）</h3>',
      '<ul>',
      '<li><b>第 1 关 熔核巨龙</b>：火球 / 突刺爪击 / 爆裂火焰。</li>',
      '<li><b>第 2 关 神秘黑侠客</b>：飞镖 / 暗影分身（同血量同外形，打它白费）/ 突袭三连斩 / 螺旋手里剑（吸引 + 持续伤害）。</li>',
      '<li><b>第 3 关 西部快枪手</b>：全程 1s 快枪 / 炸弹投掷 / 连环十响 / 8 秒隐身（隐身期间照常开枪且不现形）。</li>',
      '<li><b>第 4 关 机械蜂后</b>：尾针 / 孵化自爆工蜂 / 蜂群冲锋 / 蜂群倾巢。先清小蜂还是先打本体，决定你的血线。</li>',
      '<li><b>第 5 关 霜甲巨像</b>：冰锥 / 霜压 / 寒霜领域（减速）/ 绝对零度（读条时要躲进它脚下的安全圈）。</li>',
      '<li><b>第 6 关 双子剑客</b>：两个共享血量的剑士，只有戴真身标记的那个吃满伤害（另一位只结算三成），每 8 秒换位。</li>',
      '<li><b>第 7 关 赌徒</b>：掷骰 / 抽牌 / 出千（把你的飞行物全部打回来）/ 俄罗斯轮盘。</li>',
      '<li><b>第 8 关 镜影</b>：配装与皮肤完全复制你的另一个自己，招式一模一样，只是所有 CD 比你长三成（大招 CD 另有下限，不会疯狂开大）。</li>',
      '<li><b>第 9 关 磁暴坦克</b>：电弧 / 极性反转（把飞行物吸向场地中心）/ 电磁护盾（破盾放电）/ 雷暴。困难模式血量 300。</li>',
      '<li>困难模式：怪物血量为普通的 <b>2 倍</b>，技能释放频率更高，伤害 ×1.4。通关后可 3 选 1 拿一个词条，叠加着连打后面的关卡。</li>',
      '</ul>',
      '<h3>成就与称号</h3>',
      '<ul>',
      '<li>主菜单 → <b>🏆 成就称号</b> 可查看全部成就，并佩戴已解锁的称号（称号会以紫色显示在你名字前）。</li>',
      '<li>十种对战模式各有一个专属称号，条件统一为<b>在该模式中获胜 10 次</b>：乱斗之王（经典乱斗）/ 阵营统帅（阵营）/ 君临天下（霸主）/ 天选之人（天外来物）/ 缩圈之王（缩圈）/ 尸潮克星（丧尸危机）/ 末日幸存者（世界末日）/ 擂台霸主（车轮战）/ 荒野猎人（追猎）/ 热身达人（热身）。</li>',
      '<li>其余称号看累计战绩：初出茅庐 / 讨伐者 / 百人斩 / 修罗 / 万贯家财 / 关卡大师 / 孤高之巅 / 清道夫 / 死战英雄。</li>',
      '<li><b>死战闯关</b>：连续 6 关，前 4 关随机普通 BOSS、后 2 关随机困难 BOSS，每关一局定胜负；每关之间可 3 选 1 拿一个 Buff 叠加。中途失败即结束，通关奖励 <b>50 金币</b>。</li>',
      '</ul>',
      '<h3>联机方法（2-4 人）</h3>',
      '<ul>',
      '<li>1. 所有电脑连同一个 Wi-Fi / 手机热点。</li>',
      '<li>2. 用 exe 启动的话服务器已经开好了；如提示防火墙，勾选「专用」和「公用」并允许。</li>',
      '<li>3. 房主：主菜单 → 多人游戏 → 创建房间，拿到 4 位房号。</li>',
      '<li>4. 朋友：浏览器打开房主的地址（形如 <b>http://192.168.x.x:8123</b>）→ 多人游戏 → 加入房间 → 输入房号。</li>',
      '<li>5. 房间准备阶段所有人都是角色卡：可以换装扮 / 技能，房主可以增删人机（最多 5 个）并选择模式，2-4 人随时开局。</li>',
      '<li>⚠️ 朋友不要开服务器，只开房主那一台；连不上先查防火墙与路由器「AP 隔离」。</li>',
      '</ul>'
    ].join("");
    UI.coins();
  };

  /* ==========================================================
   *  人机对战设置（旧面板已由 75_room.js 的角色卡房间取代，
   *  这里只保留 startDuel 兜底所需的最小状态）
   * ========================================================== */
  const DuelSetup = UI.duel = { level: "normal", loadout: null };
  function ensureAiLoadout() { if (!DuelSetup.loadout) DuelSetup.loadout = LD.AI.randomLoadout(); return DuelSetup.loadout; }

  /* ==========================================================
   *  HUD
   * ========================================================== */
  const slotEls = [];
  let actEl = null;                      // v3.8：P 键交互框
  function buildHud() {
    $("slots").innerHTML = "";
    slotEls.length = 0;
    ["basic", "skill1", "skill2", "ult"].forEach((slot, i) => {
      const d = document.createElement("div");
      d.className = "slot" + (slot === "ult" ? " big" : "");
      d.innerHTML = '<span class="kb">' + SLOT_LAB[slot] + '</span><span class="ic"></span><span class="nm"></span>' +
        '<span class="cd" style="display:none"></span><span class="en"></span>';
      $("slots").appendChild(d);
      slotEls.push({ slot, el: d, ic: d.querySelector(".ic"), nm: d.querySelector(".nm"), cd: d.querySelector(".cd"), en: d.querySelector(".en") });
    });
    /* v3.8 交互键 P：电脑端所有模式都显示当前可交互内容（与手机端同一个判定） */
    const act = document.createElement("div");
    act.className = "slot act empty";
    act.innerHTML = '<span class="kb">P</span><span class="ic">✋</span><span class="nm">无</span>' +
      '<span class="cd" style="display:none"></span><span class="en"></span>';
    $("slots").appendChild(act);
    actEl = { el: act, ic: act.querySelector(".ic"), nm: act.querySelector(".nm"), cd: act.querySelector(".cd") };
  }

  /* v2.7：名字里若带成就称号（形如「称号」名字），把称号单独高亮成紫色 */
  function fmtName(n) {
    if (!n) return "";
    const m = /^「([^」]*)」(.*)$/.exec(n);
    if (!m) return n;
    return '<span class="ttl">「' + m[1] + '」</span>' + m[2];
  }

  UI.updateHud = function () {
    const me = B.hero(B.mySide == null ? 0 : B.mySide) || B.hero(0);
    if (!me) return;
    const pb = $("pBars"), eb = $("eBars");
    /* v3.7 塔防：6 个人 6 条血，右侧列表压扁 */
    if (eb) eb.classList.toggle("compact", B.rule === "tower");
    /* 左上角 = 自己的血量与能量（带名字与队伍标识，避免混淆）
     * v2.7：自己的名牌高亮成金色，成就称号部分再单独用紫色描出，局内一眼可辨 */
    const myTags = [];
    if (me.name) myTags.push(nameHtml(me));
    if (B.rule === "team" && me.team >= 0) myTags.push(LD.TEAM_NAMES[me.team]);
    if (me.overlord) myTags.push("👑 霸主");
    if (B.rule === "hunt") myTags.push(me.huntRole === "hunter" ? "👑 猎人" : "🏃 生存者");
    if (B.rule === "auction") myTags.push("<i class='coin'></i> " + (me.bcoins || 0));
    if (B.rule === "warmup") myTags.push("得分 " + Math.round(B.wScore[B.fighters.indexOf(me)] || 0));
    if (B.rule === "ring") myTags.push(B.inPoison(me.x, me.y) ? "☠ 毒圈中" : "🛡 安全区");
    if (B.rule === "doomsday" && B.inDoomDanger)
      myTags.push(B.inDoomDanger(me.x, me.y) ? "☠ 危险区" : "🛡 安全区");
    if (B.rule === "escort" && B.escort)
      myTags.push("📦 " + ((B.escort.score && B.escort.score[0]) || 0) + " : " + ((B.escort.score && B.escort.score[1]) || 0));
    if (B.rule === "escort" && me.intel) myTags.push("抱箱中");
    if (B.rule === "bump" && B.bump) {
      const i = B.fighters.indexOf(me);
      myTags.push("🚗 " + Math.round(B.bump.score[i] || 0) + " 分"
        + (me.rideCar ? " · 车 " + Math.max(0, Math.round(me.rideCar.bumpHp || 0)) : " · 找车（按 P 上车）"));
    }
    if (B.rule === "capture" && B.capture) {
      const sc = B.capture.score || [0, 0];
      const myT = me.team > 0 ? 1 : 0;
      const pts = B.capture.pts || [];
      const own = pts.filter(p => p.owner === myT).length;
      myTags.push("🚩 " + Math.round(sc[0]) + " : " + Math.round(sc[1]) + " · 据点 " + own + "/" + pts.length);
    }
    if (B.rule === "zombiehouse" && B.zh) {
      const hp = Math.max(0, Math.round(B.zh.house.hp || 0));
      const ks = B.zhScoreOf ? B.zhScoreOf(me.side) : 0;
      const inside = Math.hypot(me.x - B.zh.house.x, me.y - B.zh.house.y) <= B.zh.house.r;
      myTags.push("🏠 房子 " + hp + " · 击杀 " + ks + (inside ? " · 修房中" : ""));
    }
    /* v3.9 顺序统一为 血条 → 能量条 → 击杀/死亡；塔防也要显示能量条（之前被整条跳过） */
    /* v3.9.1 停电夜战：血量、能量之后补两条——手电筒电量与黑暗条。
     * 黑暗条是本模式的第二条命，必须和血条并排显示，不能塞进模式信息条里。 */
    let nightBars = "";
    if (B.rule === "blackout") {
      const N = LD.NIGHT || {};
      const batMax = N.batMax || 100, bat = me.battery || 0;
      const drkMax = N.darkMax || 15, drk = me.dark || 0;
      /* v3.9.1 摸黑时是隐匿状态（走到公共光里就解除），所以黑暗条后缀直接把状态说清楚 */
      nightBars = bar("电量", bat, batMax, "bat" + (bat <= (N.batLow || 20) ? " low" : ""), me.flash ? " · 开" : " · 关") +
        bar("黑暗", drk, drkMax, "drk" + (drk >= drkMax ? " full" : ""), me.lit ? " · 受光" : " · 摸黑 · 隐匿");
    }
    pb.innerHTML = (myTags.length ? '<div class="tag me">你 · ' + myTags.join(" · ") + '</div>' : "") +
      bar("HP", me.hp, me.maxHp, "hp") +
      bar("能量", me.energy, me.maxEnergy, "en" + (me.energy >= me.maxEnergy ? " full" : "")) +
      nightBars +
      '<div class="kd">击杀 <b style="color:#ffd98a">' + (me.kills || 0) + '</b> · 死亡 <b style="color:#fca5a5">' + (me.deaths || 0) + '</b></div>';
    /* 敌方：除自己以外的参战者（僵尸 / 杂兵 / 分身不占血条位，只在下面报数量）
     * v2.7 修复：以前只收 kind === "hero"，导致闯关里的巨龙（kind === "dragon"）
     * 在困难模式下血厚、玩家需要盯着血条打时却完全没有血条显示。 */
    const foes = B.fighters.filter(x => (x.kind === "hero" || x.kind === "dragon") && !x.isZombie && !x.isClone && x.side !== me.side && !x.bench);
    let html = foes.map(foe => {
      const tags = [];
      if (foe.kind === "dragon") {
        tags.push(foe.name + (foe.rageStage === 2 ? " · 狂暴" : foe.rageStage === 1 ? " · 暴怒" : ""));
      } else {
        if (B.rule === "team" && foe.team >= 0) tags.push(LD.TEAM_NAMES[foe.team]);
        if (foe.overlord) tags.push("👑 霸主");
        if (foe.huntRole === "hunter") tags.push("👑 猎人");
        if (foe.huntRole === "runner") tags.push("生存者");
        if (B.rule === "warmup") tags.push(Math.round(B.wScore[B.fighters.indexOf(foe)] || 0) + " 分");
        /* 霸主标记只在 crown.holder 身上：foe.overlord 由 finishCrown/stripOverlord 维护，勿按 crown.phase 全员加冠 */
        if (foe.name) tags.push(nameHtml(foe));
        if (foe.dead) tags.push(foe.respawnT > 0 && B.rule === "warmup" ? "复活中" : "已倒下");
      }
      const extra = tags.length ? '<div class="tag">' + tags.join(" · ") + '</div>' : "";
      return extra + bar("HP", foe.hp, foe.maxHp, "hp foe",
        " · " + (foe.kills || 0) + "杀 " + (foe.deaths || 0) + "死");
    }).join("");
    /* v2.7：僵尸 / 杂兵数量单独一行，避免十几个血条把屏幕糊满 */
    const zN = B.fighters.filter(x => x.isZombie && !x.dead).length;
    const mN = B.fighters.filter(x => x.kind === "minion" && !x.dead).length;
    if (zN || mN) {
      const parts = [];
      if (zN) parts.push("🧟 僵尸 ×" + zN);
      if (mN) parts.push("🐝 杂兵 ×" + mN);
      html += '<div class="tag" style="color:#a3e635">' + parts.join("　") + '</div>';
    }
    eb.innerHTML = html;
    slotEls.forEach(s => {
      const id = me.loadout[s.slot], sk = LD.skill(id);
      if (!sk) {
        /* v2.7：空槽位统一显示「无」，不再残留上一局装过的技能名 */
        s.el.className = "slot empty" + (s.slot === "ult" ? " big" : "");
        s.ic.textContent = "—"; s.nm.textContent = "无"; s.cd.style.display = "none"; s.en.style.transform = "scaleX(0)";
        return;
      }
      s.ic.textContent = sk.icon; s.nm.textContent = sk.name;
      const cdv = me.cd[s.slot];
      if (cdv > 0.05) { s.cd.style.display = "flex"; s.cd.textContent = cdv.toFixed(1); }
      else s.cd.style.display = "none";
      let cls = "slot" + (s.slot === "ult" ? " big" : "");
      if (sk.kind === "ult") {
        s.en.style.transform = "scaleX(" + (me.energy / me.maxEnergy) + ")";
        if (me.energy >= me.maxEnergy) cls += " ultready";
      } else {
        s.en.style.transform = "scaleX(0)";
        if (cdv <= 0.05) cls += " ready";
      }
      s.el.className = cls;
    });
    if (actEl) {
      const label = (B.interactLabel ? B.interactLabel(me) : "") || "";
      actEl.nm.textContent = label || "无";
      actEl.el.classList.toggle("empty", !label);
      actEl.el.classList.toggle("ready", !!label);
      const cd = me.activeCd || 0;
      if (B.rule === "tower" && me.activeItem && cd > 0.05) {
        actEl.cd.style.display = "flex";
        actEl.cd.textContent = Math.ceil(cd);
      } else actEl.cd.style.display = "none";
    }
    UI.updateModeHud();
  };

  /* v2.7 顶部模式信息条：模式名 + 计时 + 各模式专属读数 */
  UI.updateModeHud = function () {
    const el = $("modeHud");
    if (!el) return;
    /* v2.7 丧尸危机 / v3.2 世界末日：战斗界面上的商店按钮只在局内显示，方便手机端随时买装备 */
    const shopBtn = $("btnShopHud");
    if (shopBtn) {
      shopBtn.style.display = ((B.rule === "auction" || B.rule === "doomsday" || B.rule === "tower") && B.state === "fight") ? "" : "none";
      shopBtn.classList.toggle("tower", B.rule === "tower");
    }
    const ri = LD.ruleInfo(B.rule);
    const mmss = v => {
      const s = Math.max(0, Math.ceil(v || 0));
      const m = Math.floor(s / 60), ss = s % 60;
      return m > 0 ? m + ":" + (ss < 10 ? "0" : "") + ss : ss + "s";
    };
    let title = ri ? ri.icon + " " + ri.name : "";
    if (B.mode === "dragon" && B.level) title = "🗺 " + B.level.name + "（" + ((B.diff && B.diff.name) || "普通") + "）";
    const subs = [];
    const clock = B.rule === "tower" ? (B.towerT || 0) : B.roundT;
    if (B.state === "countdown") subs.push('<span class="big">准备中…</span>');
    else if (clock > 0) subs.push('<span class="big' + (clock <= 10 ? " warn" : "") + '">' + mmss(clock) + '</span>');
    if (B.rule === "ring") {
      const alive = (B.rings || []).filter(c => !c.dead).length;
      const men = B.humans(true).length;
      subs.push("安全圈 <b>" + alive + "</b> · 存活 <b>" + men + "</b> · 掉落 <b>" + (B.gifts || []).length + "</b>");
    } else if (B.rule === "hunt") {
      const hf = B.fighters.find(f => f.kind === "hero" && f.huntRole === "hunter");
      const runners = B.humans(true).filter(f => f.huntRole === "runner").length;
      subs.push("猎人 <b>" + ((hf && hf.name) || "-") + "</b> · 生存者 <b>" + runners + "</b>");
    } else if (B.rule === "auction") {
      const zN = B.fighters.filter(x => x.isZombie && !x.dead).length;
      const meH = B.hero(B.mySide == null ? 0 : B.mySide);
      subs.push("🧟 僵尸 <b>" + zN + "</b> · <i class='coin'></i> 局内金币 <b>" + (meH ? (meH.bcoins || 0) : 0) + "</b>");
    } else if (B.rule === "doomsday") {
      const zN = B.fighters.filter(x => x.isZombie && !x.dead).length;
      const meH = B.hero(B.mySide == null ? 0 : B.mySide);
      const my = meH ? (B.wScore[B.fighters.indexOf(meH)] || 0) : 0;
      let top = 0;
      B.humans().forEach(f => { const s = B.wScore[B.fighters.indexOf(f)] || 0; if (s > top) top = s; });
      subs.push("🧟 僵尸 <b>" + zN + "</b> · 存活 <b>" + B.humans(true).length + "</b> · 你 <b>" + my + "</b> 分 · 最高 <b>" + top + "</b> 分"
        + " · <i class='coin'></i> <b>" + (meH ? (meH.bcoins || 0) : 0) + "</b>");
    } else if (B.rule === "warmup") {
      const my = Math.round(B.wScore[B.fighters.indexOf(B.hero(B.mySide == null ? 0 : B.mySide))] || 0);
      let top = 0;
      B.humans().forEach(f => { const s = Math.round(B.wScore[B.fighters.indexOf(f)] || 0); if (s > top) top = s; });
      subs.push("你 <b>" + my + "</b> 分 · 最高 <b>" + top + "</b> 分 · 伤害计分 · 击杀 +5 · 阵亡后随机复活");
    } else if (B.rule === "blackout") {
      const N = LD.NIGHT || {};
      const meH = B.hero(B.mySide == null ? 0 : B.mySide);
      subs.push("🔦 充电站 <b>" + ((B.stations || []).length) + "</b> 座 · 手电筒 <b>" + Math.round(meH ? (meH.battery || 0) : 0) + "%</b>"
        + " · P 开关灯，靠近充电站按住 P 充电" + (meH && meH.lit ? "" : " · 摸黑隐匿中"));
      if (meH && !meH.dead && (meH.dark || 0) >= (N.darkMax || 15) - 0.01)
        subs.push('<span class="warn">黑暗条已满，正在掉血——快回到光里</span>');
      else if (meH && !meH.dead && (meH.dark || 0) >= (N.darkMax || 15) * 0.6)
        subs.push('<span class="warn">黑暗条快满了</span>');
    } else if (B.rule === "escort") {
      const st = B.escort || {};
      const sc = st.score || [0, 0];
      const meH = B.hero(B.mySide == null ? 0 : B.mySide);
      subs.unshift('<span class="big">红 <b style="color:#f87171">' + (sc[0] || 0) + '</b> : <b style="color:#60a5fa">' + (sc[1] || 0) + '</b> 蓝</span>');
      subs.push("📦 先到 <b>" + ((LD.ESCORT || {}).need || 3) + "</b> 分获胜 · "
        + (meH && meH.intel ? "抱着情报箱，冲向敌方交付点" : "去中央抢情报箱"));
    } else if (B.rule === "capture") {
      const st = B.capture || {};
      const sc = st.score || [0, 0];
      const pts = st.pts || [];
      const own0 = pts.filter(p => p.owner === 0).length;
      const own1 = pts.filter(p => p.owner === 1).length;
      subs.unshift('<span class="big">红 <b style="color:#f87171">' + Math.round(sc[0] || 0) + '</b> : <b style="color:#60a5fa">' + Math.round(sc[1] || 0) + '</b> 蓝</span>');
      subs.push("🚩 据点 <b>红 " + own0 + " / 蓝 " + own1 + "</b> · 先到 <b>" + ((LD.CAPTURE || {}).need || 80) + "</b> 分 · 大点 ×2 · 占点出炮塔");
      const meH = B.hero(B.mySide == null ? 0 : B.mySide);
      if (meH && !meH.dead) {
        const myT = meH.team > 0 ? 1 : 0;
        const inPt = pts.find(p => Math.hypot(meH.x - p.x, meH.y - p.y) <= p.r);
        if (inPt) {
          const enemyIn = myT === 0 ? inPt.c1 > 0 : inPt.c0 > 0;
          const mateIn = myT === 0 ? inPt.c0 : inPt.c1;
          subs.push(inPt.owner === myT
            ? "站在 <b>" + inPt.name + "</b> 圈内（己方据点）"
            : enemyIn ? '<span class="warn">据点 ' + inPt.name + ' 正在争夺，把敌人赶出去</span>'
              : "正在占领 <b>" + inPt.name + "</b> · 圈内己方 " + mateIn + " 人"
                + (inPt.owner >= 0 ? " · 抢点耗时 ×2" : ""));
        } else {
          subs.push("离开据点圈了——去抢地图上的据点" + (((LD.CAPTURE || {}).turret) ? "（占下来会升起炮塔）" : ""));
        }
      }
    } else if (B.rule === "bump") {
      const st = B.bump || {};
      const meH = B.hero(B.mySide == null ? 0 : B.mySide);
      const rows = B.fighters.map((f, i) => ({ f: f, s: (st.score && st.score[i]) || 0 }))
        .filter(x => x.f && x.f.kind === "hero").sort((a, b) => b.s - a.s);
      subs.unshift('<span class="big">' + rows.slice(0, 3).map(x =>
        (x.f.name || ("玩家" + (x.f.side + 1))) + ' <b>' + x.s + '</b>').join(" · ") + '</span>');
      subs.push("🚗 先到 <b>" + ((LD.BUMP || {}).need || 12) + "</b> 分 · 撞爆车 <b>+" + ((LD.BUMP || {}).scoreWreck || 2)
        + "</b> · 撞出擂台 <b>+" + ((LD.BUMP || {}).scoreDunk || 3) + "</b> · 车速越快撞得越狠");
      if (meH && !meH.dead) {
        if (meH.rideCar) {
          const k = Math.max(0, meH.rideCar.bumpHp || 0) / (meH.rideCar.bumpMax || 1);
          subs.push(k > 0.3 ? "车况 <b>" + Math.round(k * 100) + "%</b> · 别贴着边缘开"
            : '<span class="warn">车快散架了——先拉开距离，等它报废后换一辆</span>');
        } else {
          subs.push('<span class="warn">没车！走到碰碰车旁按 P 上车</span>');
        }
      }
    } else if (B.rule === "zombiehouse" && B.zh) {
      const Z = LD.ZOMBIEHOUSE || {};
      const H = B.zh.house;
      const wv = B.zh.wave || 0, tot = Z.waves || 5;
      const pct = Math.round(Math.max(0, H.hp) / (H.maxHp || 1) * 100);
      if (B.zh.phase === "gap") {
        subs.push("🏠 第 <b>" + (wv + 1) + "</b> / " + tot + " 波 · 准备中 <b>"
          + Math.max(0, Math.ceil(B.zh.gapT || 0)) + "</b> 秒 · 站在房子里修房");
      } else {
        const left = (B.zh.queue || 0) + B.fighters.filter(f => f.isZombie && !f.dead).length;
        subs.push("🏠 第 <b>" + wv + "</b> / " + tot + " 波 · 本波剩余僵尸 <b>" + left + "</b>");
      }
      subs.push(pct > 50 ? "房子耐久 <b>" + pct + "%</b> · 别放僵尸贴上来"
        : '<span class="warn">房子耐久只剩 <b>' + pct + "%</b> —— 快清怪，趁喘息期站回房里</span>");
    } else if (B.rule === "relay" && B.relay) {
      const onStage = B.fighters.filter(f => f.kind === "hero" && !f.dead && !f.bench);
      subs.push("擂台上 " + onStage.map(f => f.name).join(" vs ") + " · 剩余 " + B.fighters.filter(f => f.kind === "hero" && !f.dead).length + " 人");
    } else if (B.rule === "team") {
      subs.push("剩余阵营 <b>" + B.teamsAlive() + "</b>");
    } else if (B.rule === "tower") {
      const meH = B.hero(B.mySide == null ? 0 : B.mySide);
      const ps = B.terrain ? B.terrain.props.filter(o => !o.dead && o.kind === "tower") : [];
      const t0 = ps.filter(o => o.side === 0).length, t1 = ps.length - t0;
      const s0 = (B.tScore && B.tScore[0]) || 0, s1 = (B.tScore && B.tScore[1]) || 0;
      /* v3.8 无时限：时间那行改成双方比分 */
      subs.unshift('<span class="big">红 <b style="color:#f87171">' + s0 + '</b> : <b style="color:#60a5fa">' + s1 + '</b> 蓝</span>');
      const it = meH && meH.activeItem ? LD.towerItem(meH.activeItem) : null;
      const itTxt = it ? (it.icon + " " + it.name + ((meH.activeCd || 0) > 0 ? " (" + Math.ceil(meH.activeCd) + "s)" : " 就绪")) : "无";
      subs.push("剩余塔 <b>" + t0 + " / " + t1 + "</b> · 兵线 <b>" + (B.fighters.filter(f => f.kind === "laneMinion" && !f.dead).length) + "</b> 只");
      subs.push("Lv.<b>" + (meH ? (meH.level || 1) : 1) + "</b> · 金币 <b>" + (meH ? (meH.bcoins || 0) : 0) + "</b> · 主动：<b>" + itTxt + "</b> · B 商店 / P 装备");
    } else if (B.rule === "gifts") {
      subs.push("天降技能 <b>" + (B.gifts || []).length + "</b> 个");
    } else if (B.rule === "overlord") {
      const cw = B.crown;
      if (cw && cw.phase === "held") {
        const who = cw.holder;
        const nm = who ? (who.name || ("玩家" + (who.side + 1))) : "-";
        subs.push("霸主 <b>" + nm + "</b> · 剩余 <b>" + Math.ceil(Math.max(0, cw.holdT)) + "s</b>");
      } else if (cw && cw.phase === "fallen") {
        subs.push('<span class="big">👑 皇冠已落地！靠近按交互键争夺</span>');
      } else if (cw && cw.phase === "warn") {
        subs.push('<span class="big">👑 皇冠将在 ' + Math.ceil(Math.max(0, cw.warnT)) + "s 后降落</span>");
      }
    }
    if (B.mods && B.mods.length) {
      subs.push('<span style="color:#c4b5fd">' + B.mods.map(id => {
        const m = (LD.MODS || []).find(x => x.id === id);
        return m ? m.icon + m.name : id;
      }).join(" · ") + '</span>');
    }
    el.innerHTML = '<div class="mt">' + title + '</div>' + subs.map(s => '<div class="ms">' + s + '</div>').join("");
  };

  function bar(lab, v, max, cls, extra) {
    const p = Math.max(0, Math.min(1, v / max));
    return '<div class="barrow">' +
      '<span class="barlab">' + lab + '</span>' +
      '<div class="bartrack ' + cls + '"><div class="barfill" style="transform:scaleX(' + p + ')"></div>' +
      '<div class="bartxt">' + Math.ceil(v) + " / " + Math.round(max) + (extra || "") + '</div></div></div>';
  }
  /* v3.8 塔防：红队红名、蓝队蓝名（统一走 LD.teamColor，别再各写一套） */
  function teamColor(f) {
    if (!f || f.team == null || f.team < 0) return null;
    return (LD.teamColor && LD.teamColor(f.team)) || null;
  }
  function nameHtml(f) {
    const c = teamColor(f);
    const n = fmtName(f && f.name) || "";
    return c ? '<span style="color:' + c + '">' + n + '</span>' : n;
  }

  /* ==========================================================
   *  输入
   * ========================================================== */
  const keys = {};
  const ctrl = UI.ctrl = { mx: 0, my: 0, dodge: null, hold: { basic: false, skill1: false, skill2: false, ult: false, interact: false }, press: { basic: false, skill1: false, skill2: false, ult: false, interact: false } };
  const KEYMAP = {
    KeyJ: "basic", KeyK: "skill1", KeyL: "skill2", KeyO: "ult",
    Space: "skill2", ShiftLeft: "skill1", ShiftRight: "skill1"
  };
  // 双击方向键 → 闪避
  const DIRKEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyS: [0, 1], ArrowDown: [0, 1], KeyD: [1, 0], ArrowRight: [1, 0]
  };
  const lastTap = {};

  UI.bindKeys = function () {
    const down = e => {
      const c = e.code;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(c) >= 0) e.preventDefault();
      if (keys[c]) return;
      keys[c] = true;
      if (c === "KeyM") { Audio2.muted = !Audio2.muted; $("btnMute").textContent = Audio2.muted ? "🔇 静音" : "🔊 音效"; return; }
      if (c === "Escape") { if (UI.screen === "ovPause") UI.resumeGame(); else if (UI.screen === "ovArmy") UI.closeArmy(); else UI.openPause(); return; }
      if (c === "KeyR" && B.state === "over") { UI.restart(); return; }
      if (c === "KeyV") { ctrl.lockNext = e.shiftKey ? -1 : 1; return; }   // V 键：切换索敌目标（Shift+V 反向）
      if (c === "KeyB") {                                                   // B 键：局内商店
        if (B.rule === "tower") UI.openTower(); else UI.openArmy();
        return;
      }
      if (c === "KeyP") { ctrl.press.interact = true; return; }             // v3.3 P 键：交互（拾取 / 躲藏 / 驾驶）
      const slot = KEYMAP[c];
      if (slot) { ctrl.press[slot] = true; ctrl.hold[slot] = true; }
      const dk = DIRKEYS[c];
      if (dk) {
        const now = performance.now();
        if (lastTap[c] && now - lastTap[c] < 280) { ctrl.dodge = { x: dk[0], y: dk[1] }; lastTap[c] = 0; }
        else lastTap[c] = now;
      }
      updateAxis();
    };
    const up = e => {
      const c = e.code; keys[c] = false;
      const slot = KEYMAP[c];
      if (slot) ctrl.hold[slot] = false;
      updateAxis();
    };
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    window.addEventListener("blur", () => { Object.keys(keys).forEach(k => keys[k] = false); updateAxis(); ctrl.hold.basic = ctrl.hold.skill1 = ctrl.hold.skill2 = ctrl.hold.ult = false; Object.keys(lastTap).forEach(k => lastTap[k] = 0); });
    function updateAxis() {
      let mx = 0, my = 0;
      if (keys.KeyA || keys.ArrowLeft) mx -= 1;
      if (keys.KeyD || keys.ArrowRight) mx += 1;
      if (keys.KeyW || keys.ArrowUp) my -= 1;
      if (keys.KeyS || keys.ArrowDown) my += 1;
      ctrl.mx = mx; ctrl.my = my;
    }
  };

  UI.clearCtrl = function () { ctrl.mx = ctrl.my = 0; ctrl.dodge = null; ["basic", "skill1", "skill2", "ult", "interact"].forEach(k => { ctrl.hold[k] = false; ctrl.press[k] = false; }); Object.keys(lastTap).forEach(k => lastTap[k] = 0); };

  /* ==========================================================
   *  开局
   * ========================================================== */
  function botLook() {
    /* 每局人机的皮肤随机搭配：头 / 上身 / 下身各从全目录随机抽一款
     * v3.5：统一走 LD.randomLook，图片皮肤会带上 img，不再出现缺头 / 缺裤子 */
    return LD.randomLook();
  }

  UI.enterGame = function () {
    UI.clearCtrl();
    B.paused = false;                  // v2.7：进局前统一清掉暂停，避免卡在倒计时「2」
    buildHud();
    $("hudVer").textContent = "v" + LD.VERSION;
    UI.show("game");
  };

  /* v2.6 闯关词条：连续挑战时叠加生效，重新从主菜单进入闯关页时清零 */
  UI.runPerks = [];
  UI.applyRunPerks = function (hero) {
    (UI.runPerks || []).forEach(id => {
      const perk = (LD.PERKS || []).find(x => x.id === id);
      if (perk && hero) perk.apply(hero);
    });
  };
  UI.resetRunPerks = function () { UI.runPerks = []; };

  UI.startDragon = function (level, diff, opts) {
    opts = opts || {};
    B.dailyRun = false;
    B.gauntletRun = !!opts.gauntlet;
    $("endSub").dataset.daily = "";
    const hero = B.mkHero(0, { x: B.world.w * 0.26, y: B.world.h * 0.5, look: P.look(), loadout: P.d.loadout, name: P.displayName(), energy: 0 });
    hero.ctrl = ctrl;
    /* v2.6 关卡工厂：双子剑客返回两个共享血量的个体；镜影复制玩家配装 */
    const bosses = B.mkBossForLevel(level.boss, diff, hero);
    B.setup({ mode: "dragon", diff, level, fighters: [hero].concat(bosses),
      mods: opts.mods || [],
      theme: { top: "#1a1226", bottom: "#08060f", grid: "rgba(251,113,133,.35)", moon: "rgba(251,146,60,.22)" } });
    UI.applyRunPerks(hero);
    B.onEnd = win => opts.gauntlet ? UI.endGauntlet(win, level, diff) : UI.endDragon(win, level, diff);
    UI.enterGame();
  };

  UI.startDuel = function () {
    const lo = ensureAiLoadout();
    const hero = B.mkHero(0, { x: C.W * 0.26, y: C.H * 0.56, look: P.look(), loadout: P.d.loadout, name: P.displayName() });
    hero.ctrl = ctrl;
    const bot = B.mkHero(1, { x: C.W * 0.74, y: C.H * 0.56, look: botLook(), loadout: { basic: lo.basic, skill1: lo.skill1, skill2: lo.skill2, ult: lo.ult }, name: "电脑" });
    LD.AI.mkBot(bot, DuelSetup.level);
    B.setup({ mode: "duel", fighters: [hero, bot], theme: {} });
    B.roundT = 75;
    B.onEnd = win => UI.endDuel(win);
    UI.enterGame();
  };

  UI.endDragon = function (win, level, diff) {
    $("btnEndRoom").style.display = "none";   // 闯关没有房间概念
    P.battleEnd(win, "dragon");
    const meH = B.hero(0);
    if (meH) P.stat("kills", meH.kills || 0);
    if (win) {
      const reward = diff.reward;
      const first = P.clear(level.id, diff.key, reward);
      Audio2.win();
      $("endTitle").textContent = "讨伐成功";
      $("endSub").innerHTML = "击败了 <b>" + level.name + "</b>（" + diff.name + "）<br>获得 <b style='color:#ffd98a'><i class='coin'></i> " + reward + " 金币</b>" +
        (first ? "<br><span style='color:#7ff0c4'>首次通关该难度！</span>" : "") +
        "<br><span style='color:#8fa0c8'>当前金币：" + P.d.coins + "</span>" +
        ($("endSub").dataset.daily ? "<br><span style='color:#fcd34d'>" + $("endSub").dataset.daily + "</span>" : "");
    } else {
      Audio2.lose();
      $("endTitle").textContent = "挑战失败";
      $("endSub").innerHTML = "被 <b>" + level.name + "</b>（" + diff.name + "）击败了<br><span style='color:#8fa0c8'>" + level.tip + "</span>";
    }
    UI.show("ovEnd");
    /* v2.6 通关后提供词条 3 选 1 */
    if (win) UI.offerPerk(level, diff);
  };

  /* ---------------- v2.6 闯关词条 3 选 1 ---------------- */
  UI.offerPerk = function (level, diff) {
    const h2 = document.querySelector("#ovPerk h2");
    const sub = document.querySelector("#ovPerk .sub");
    if (h2) h2.textContent = "选择一个词条";
    if (sub) sub.textContent = "词条只在本次闯关内生效，可以不断叠加";
    const pool = (LD.PERKS || []).filter(x => UI.runPerks.indexOf(x.id) < 0);
    UI.perkChoices = [];
    const bag = pool.slice();
    while (UI.perkChoices.length < 3 && bag.length) {
      UI.perkChoices.push(bag.splice((Math.random() * bag.length) | 0, 1)[0]);
    }
    if (!UI.perkChoices.length) return;
    UI.perkLevel = level; UI.perkDiff = diff;
    $("perkGrid").innerHTML = UI.perkChoices.map((pk, i) =>
      '<div class="card" data-perk="' + i + '"><div class="t">' + pk.icon + " " + pk.name + '</div><div class="d">' + pk.desc + '</div></div>'
    ).join("");
    $("perkGrid").querySelectorAll("[data-perk]").forEach(el => {
      el.onclick = () => {
        Audio2.ui();
        const pk = UI.perkChoices[+el.dataset.perk];
        UI.runPerks.push(pk.id);
        UI.toast("已获得词条：" + pk.name + "（下次闯关生效）", 1);
        UI.show("ovLevels");
      };
    });
    UI.show("ovPerk");
  };

  UI.endDuel = function (win) {
    /* 人机对战奖励：普通胜利 +6，困难胜利 +12（三局两胜整局结算一次） */
    $("btnEndRoom").style.display = "";       // 对局结束也可以回房间调整配装再打
    const reward = win ? (DuelSetup.level === "hard" ? 12 : 6) : 0;
    /* v2.7：战绩与特殊模式计数终于记进档案（以前人机对战是不统计的） */
    P.battleEnd(win, "duel", B.rule);       // 热身 / 车轮 / 追猎等特殊模式的计数都在 battleEnd 里统一处理
    /* v2.7 乱斗热身：结算显示计分板 */
    let scoreTxt = "";
    if (B.rule === "tower") {
      /* v3.7 塔防：结算显示队伍击杀与水晶体结果，而不是三局两胜的比分 */
      scoreTxt = "红队 " + ((B.tScore && B.tScore[0]) || 0) + " : " + ((B.tScore && B.tScore[1]) || 0) + " 蓝队" +
        (B.towerResult ? " · " + B.towerResult : "");
    }
    if (B.rule === "warmup") {
      scoreTxt = B.humans().map(f => {
        const s = Math.round(B.wScore[B.fighters.indexOf(f)] || 0);
        return (f.name || ("玩家" + (f.side + 1))) + " " + s;
      }).join(" · ");
    }
    if (win) {
      P.addCoins(reward);
      Audio2.win();
      $("endTitle").textContent = B.rule === "tower" ? "推塔胜利" : "对决胜利";
      $("endSub").innerHTML =
        (scoreTxt ? "最终比分 " + scoreTxt + "<br>" : "比分 " + B.score.join(" : ") + "<br>") +
        "获得 <b style='color:#ffd98a'><i class='coin'></i> " + reward + " 金币</b>（" +
        (DuelSetup.level === "hard" ? "困难" : "普通") + "难度）" +
        "<br><span style='color:#8fa0c8'>当前金币：" + P.d.coins + "</span>";
    } else {
      Audio2.lose();
      $("endTitle").textContent = B.rule === "tower" ? "推塔失败" : "对决失败";
      $("endSub").innerHTML = (scoreTxt ? "最终比分 " + scoreTxt + "<br>" : "比分 " + B.score.join(" : ") + "<br>") +
        "<span style='color:#8fa0c8'>再战一局，胜利才有奖励（普通 6 / 困难 12）</span>";
    }
    UI.show("ovEnd");
  };

  UI.endNet = function (win) {
    $("btnEndRoom").style.display = "";
    P.battleEnd(win, "net", B.rule);
    const champ = B.fighters[B.matchWinner];
    const champName = champ ? (champ.name || "玩家" + (B.matchWinner + 1)) : "未知";
    if (win) { Audio2.win(); $("endTitle").textContent = "你赢了！"; }
    else { Audio2.lose(); $("endTitle").textContent = "你输了"; }
    $("endSub").innerHTML = "本局冠军：<b style='color:#ffd98a'>" + champName + "</b>" +
      "<br>比分 " + B.score.map((v, i) => ((B.fighters[i] && B.fighters[i].name) || "P" + (i + 1)) + " " + v).join(" · ") +
      "<br><span style='color:#8fa0c8'>" + (LD.Net.peerIn ? "对手仍在房间" : "对手已离开") + "</span>";
    UI.show("ovEnd");
  };

  UI.restart = function () {
    B.paused = false;
    if (B.mode === "net") {
      if (LD.Net.isHost) UI.netHostStart();
      else { LD.Net.toPeer({ t: "again" }); UI.toast("已请求再战，等待房主开始…"); }
    }
    else if (B.mode === "dragon") UI.startDragon(B.level, B.diff);
    else if (UI.room && UI.room.bots.length) UI.roomStart();
    else UI.startDuel();
  };

  UI.quitGame = function () {
    if (B.state !== "idle" && B.state !== "over") {
      B.state = "over";
      if (B.mode === "net") LD.Net.toPeer({ t: "bye" });
    }
    B.fighters = []; B.projs = []; B.zones = [];
    LD.FX.clear(); LD.Cine.active = false;
    B.paused = false; B.dailyRun = false;
    UI.show("ovMenu");
  };

  /* 战斗中 Esc / 主菜单按钮 → 暂停面板（不退房、不退联机） */
  UI.openPause = function () {
    if (UI.screen !== "game" || B.state === "idle") return;
    $("btnPauseRoom").style.display = B.mode === "dragon" ? "none" : "";
    $("btnArmyShop").style.display = (B.rule === "auction" || B.rule === "doomsday") ? "" : "none";
    if (B.mode !== "net") B.paused = true;   // v2.6 本地对局真正暂停；联机只弹面板不冻结
    UI.show("ovPause");
  };
  UI.resumeGame = function () {
    if (B.mode !== "net") B.paused = false;
    UI.show("game");
  };

  /* ---------------- v2.7 军备竞赛：局内商店（B 开关，不暂停战斗，背景半透明） ---------------- */
  UI.openArmy = function () {
    /* v3.2：丧尸危机 / 世界末日都吃局内商店 */
    if ((B.rule !== "auction" && B.rule !== "doomsday") || B.state !== "fight") return;
    /* 按 B 再按一次 = 关闭 */
    if (UI.screen === "ovArmy") { UI.closeArmy(); return; }
    /* v2.7：商店不再暂停——开着商店世界照常跑，风险自担 */
    UI.show("ovArmy");
  };
  UI.closeArmy = function () {
    if (UI.screen === "ovArmy") UI.show("game");
  };
  UI.armyBuy = function (id) {
    const me = B.hero(B.mySide == null ? 0 : B.mySide);
    if (!me) return;
    if (B.mode === "net" && !B.isHost) { UI.toast("联机对局中商店暂只对房主生效"); return; }
    const item = B.armyShop().find(i => i.id === id);
    if (!item) return;
    if ((me.bcoins || 0) < item.price) {
      Audio2.beep(200, 0.14, "square", 0.05);
      UI.toast("局内金币不足，还差 " + (item.price - (me.bcoins || 0)) + " 枚");
      return;
    }
    if (!B.armyBuy(me, id)) {
      Audio2.beep(200, 0.14, "square", 0.05);
      UI.toast(id === "heal" ? "满血状态买不了血包" : (id === "spd" ? "移速加成已叠满" : "买不了这件商品"));
      return;
    }
    UI.toast("已购买：" + item.icon + " " + item.name);
    UI.renderArmy();
  };
  UI.renderArmy = function () {
    const me = B.hero(B.mySide == null ? 0 : B.mySide);
    const coins = me ? (me.bcoins || 0) : 0;
    const ce = $("armyCoins"); if (ce) ce.textContent = coins;
    const hint = $("armyHint");
    const grid = $("armyGrid");
    if (!grid) return;
    const coinPer = B.rule === "doomsday" ? ((LD.DOOMSDAY || {}).coin || 2) : ((LD.ZOMBIE || {}).coin || 1);
    if (hint) hint.textContent = "击杀僵尸掉 " + coinPer + " 枚局内金币、击杀玩家掉 3 枚；商品只在当局有效，商店开着时战斗不会暂停";
    const Z = LD.ZOMBIE || {};
    grid.innerHTML = B.armyShop().map(it => {
      const afford = coins >= it.price;
      return '<div class="card" data-buy="' + it.id + '" style="cursor:' + (afford ? "pointer" : "default") +
        ';opacity:' + (afford ? "1" : ".58") + '">' +
        '<div class="t">' + it.icon + " " + it.name + '</div>' +
        '<div class="d">' + it.desc + '</div>' +
        '<div style="margin-top:8px;font-weight:800;color:' + (afford ? "#ffd98a" : "#8b93a7") + '">💰 ' + it.price + ' 金币</div></div>';
    }).join("");
    grid.querySelectorAll("[data-buy]").forEach(el => {
      el.onclick = () => { Audio2.ui(); UI.armyBuy(el.dataset.buy); };
    });
  };

  /* ---------------- v3.7 塔防：局内装备商店 ---------------- */
  UI.openTower = function () {
    if (B.rule !== "tower" || B.state !== "fight") return;
    if (UI.screen === "ovTower") { UI.show("game"); return; }
    UI.show("ovTower");
  };
  UI.towerBuy = function (id) {
    const me = B.hero(B.mySide == null ? 0 : B.mySide);
    if (!me) return;
    if (B.mode === "net" && !B.isHost) { UI.toast("联机对局中商店暂只对房主生效"); return; }
    const r = B.towerCanBuy(me, id);
    if (!r.ok) {
      Audio2.beep(200, 0.14, "square", 0.05);
      UI.toast(r.why);
      return;
    }
    B.towerBuy(me, id);
    UI.toast("已购买：" + r.item.icon + " " + r.item.name);
    UI.renderTowerShop();
  };
  UI.renderTowerShop = function () {
    const me = B.hero(B.mySide == null ? 0 : B.mySide);
    const coins = me ? (me.bcoins || 0) : 0;
    const ce = $("towerCoins"); if (ce) ce.textContent = coins;
    const grid = $("towerGrid");
    if (!grid) return;
    const hint = $("towerHint");
    if (hint) {
      const own = me && me.items ? Object.keys(me.items).length : 0;
      const act = me && me.activeItem ? LD.towerItem(me.activeItem) : null;
      hint.innerHTML = "已购 <b>" + own + "</b> 件 · 主动装备：" +
        (act ? "<b style='color:#7ff0c4'>" + act.icon + " " + act.name + "</b>（按 P 释放）" : "<b>未携带</b>") +
        " · 击杀小兵 32 / 英雄 240 / 助攻 120 金币";
    }
    const U = LD.TOWER.minionUp || { max: 5 };
    grid.innerHTML = B.towerShop().map(it => {
      const isTeam = it.kind === "team";
      const isFuel = it.kind === "fuel";
      const stack = isTeam ? B.towerStack(me, it.id) : 0;
      const own = !!(me && me.items && me.items[it.id]);
      const full = isTeam && stack >= (U.max || 5);
      const actOwn = !!(me && me.activeItem);
      /* v3.9 汽油桶：没上车 / 油箱满 都买不了，tag 直接说明原因 */
      const car = me && me.rideCar;
      const carFull = !!(car && (car.fuel || 0) >= (car.fuelMax || 0));
      const fuelBlocked = isFuel && (!car || carFull);
      const blocked = own || full || fuelBlocked || (it.kind === "active" && actOwn && me.activeItem !== it.id);
      const afford = coins >= it.price;
      const col = (own || full) ? "#7ff0c4" : (blocked ? "#8b93a7" : (afford ? "#ffd98a" : "#8b93a7"));
      const tag = isFuel ? (!car ? "需上车" : (carFull ? "油箱已满" : "油 " + Math.round((car.fuel || 0) / (car.fuelMax || 1) * 100) + "%"))
        : isTeam ? ("×" + stack + "/" + (U.max || 5))
        : (own ? "已拥有" : (it.kind === "active" ? (me && me.activeItem === it.id ? "携带中" : "主动") : "被动"));
      return '<div class="card" data-tbuy="' + it.id + '" style="cursor:' +
        (blocked || !afford ? "default" : "pointer") + ';opacity:' + ((own || full) ? ".55" : (blocked ? ".45" : (afford ? "1" : ".62"))) + '">' +
        '<div class="t">' + it.icon + " " + it.name +
        ' <span style="float:right;font-size:10px;color:' + col + '">' + tag + '</span></div>' +
        '<div class="d">' + it.desc + '</div>' +
        '<div style="margin-top:8px;font-weight:800;color:' + col + '"><i class="coin"></i> ' + it.price + '</div></div>';
    }).join("");
    grid.querySelectorAll("[data-tbuy]").forEach(el => {
      el.onclick = () => { Audio2.ui(); UI.towerBuy(el.dataset.tbuy); };
    });
  };

  /* ---------------- v2.6 成就与称号 ---------------- */
  UI.renderAch = function () {
    const st = P.d.stats || {};
    const clearedN = LD.LEVELS.filter(l => P.cleared(l.id, "normal")).length;
    $("achStats").innerHTML = "累计击杀 <b>" + (st.kills || 0) + "</b> · 胜利 <b>" + (st.wins || 0) + "</b> · 失败 <b>" +
      (st.losses || 0) + "</b> · 闯关通关 <b>" + clearedN + "/" + LD.LEVELS.length + "</b> · 累计金币 <b>" + (st.coinsEarned || 0) + "</b>";
    $("titleGrid").innerHTML = (LD.TITLES || []).map(t => {
      const ok = P.achUnlocked(t.ach);
      const cur = P.d.title === t.id;
      return '<div class="card" data-title="' + t.id + '" style="' + (ok ? "cursor:pointer" : "opacity:.4") + '">' +
        '<div class="t">' + t.name + '</div><div class="d">' + (ok ? (cur ? "佩戴中（点击摘下）" : "点击佩戴") : "未解锁") + '</div></div>';
    }).join("");
    $("titleGrid").querySelectorAll("[data-title]").forEach(el => {
      el.onclick = () => {
        Audio2.ui();
        const id = el.dataset.title;
        const cur = P.d.title === id;
        if (cur) P.setTitle("");
        else if (!P.setTitle(id)) UI.toast("该称号尚未解锁");
        UI.renderAch();
      };
    });
    $("achGrid").innerHTML = (LD.ACHIEVEMENTS || []).map(a => {
      const ok = P.achUnlocked(a.id);
      return '<div class="card" style="' + (ok ? "" : "opacity:.4") + '"><div class="t">' + a.icon + " " + a.name + '</div><div class="d">' +
        a.desc + (ok ? " · 已达成" : "") + '</div></div>';
    }).join("");
  };

  /* ---------------- v3.1 死战闯关（替代每日挑战） ---------------- */
  UI.gauntlet = null;
  const GAUNTLET_N = 6;

  function pickRandom(list, n) {
    const bag = list.slice(), out = [];
    while (out.length < n && bag.length) out.push(bag.splice((Math.random() * bag.length) | 0, 1)[0]);
    return out;
  }

  UI.renderGauntletCard = function () {
    const el = $("gauntletDesc");
    if (!el) return;
    const g = UI.gauntlet;
    if (g && g.stage < GAUNTLET_N) {
      el.textContent = "进行中：第 " + (g.stage + 1) + " / " + GAUNTLET_N + " 关 · " +
        g.picks[g.stage].level.name + "（" + g.picks[g.stage].diff.name + "）";
    } else {
      el.textContent = "连打 6 关（前 4 关普通 / 后 2 关困难），每关之间选一个 Buff，通关 50 金币";
    }
  };

  UI.startGauntlet = function () {
    /* 前四关普通 BOSS，后两关困难 BOSS；关卡不重复 */
    const picks = [];
    const six = pickRandom(LD.LEVELS, GAUNTLET_N);
    six.slice(0, 4).forEach(l => picks.push({ level: l, diff: LD.DIFF.normal }));
    six.slice(4, 6).forEach(l => picks.push({ level: l, diff: LD.DIFF.hard }));
    UI.gauntlet = { stage: 0, picks: picks, buffs: [] };
    UI.resetRunPerks();
    UI.gauntletStage();
  };

  UI.gauntletStage = function () {
    const g = UI.gauntlet;
    if (!g) return;
    const p = g.picks[g.stage];
    if (!p) return;
    UI.toast("死战闯关 " + (g.stage + 1) + " / " + GAUNTLET_N + "：" + p.level.name + "（" + p.diff.name + "）", 1.4);
    UI.startDragon(p.level, p.diff, { gauntlet: true });
  };

  UI.endGauntlet = function (win, level, diff) {
    const g = UI.gauntlet;
    $("btnEndRoom").style.display = "none";
    B.gauntletRun = false;
    P.battleEnd(win, "dragon");
    const meH = B.hero(0);
    if (meH) P.stat("kills", meH.kills || 0);
    const stageNo = g ? Math.min(g.stage + 1, GAUNTLET_N) : 1;

    if (!win) {
      Audio2.lose();
      $("endTitle").textContent = "死战中断";
      $("endSub").innerHTML = "倒在第 <b>" + stageNo + " / " + GAUNTLET_N + " 关</b>：" + level.name +
        "（" + diff.name + "）<br><span style='color:#8fa0c8'>" + level.tip + "</span>";
      UI.gauntlet = null;
      UI.show("ovEnd");
      return;
    }

    Audio2.win();
    g.stage++;
    if (g.stage >= GAUNTLET_N) {
      P.addCoins(50);
      P.stat("dailyWins", 1);
      P.checkAch(); P.save();
      $("endTitle").textContent = "死战通关";
      $("endSub").innerHTML = "连破 <b>" + GAUNTLET_N + " 关</b>，最后一战击败了 <b>" + level.name + "</b>（" + diff.name + "）<br>" +
        "获得 <b style='color:#ffd98a'><i class='coin'></i> 50 金币</b><br>" +
        "<span style='color:#8fa0c8'>当前金币：" + P.d.coins + "</span>";
      UI.gauntlet = null;
      UI.show("ovEnd");
      return;
    }

    $("endTitle").textContent = "第 " + stageNo + " 关通过";
    $("endSub").innerHTML = "击败了 <b>" + level.name + "</b>（" + diff.name + "）<br>" +
      "接下来是第 <b>" + (g.stage + 1) + " / " + GAUNTLET_N + " 关</b>，先选一个 Buff";
    UI.offerGauntletPerk();
  };

  /* 死战闯关的 Buff 三选一：与词条共用一套效果，选完直接进下一关 */
  UI.offerGauntletPerk = function () {
    const g = UI.gauntlet;
    if (!g) return;
    const h2 = document.querySelector("#ovPerk h2");
    const sub = document.querySelector("#ovPerk .sub");
    if (h2) h2.textContent = "第 " + (g.stage + 1) + " / " + GAUNTLET_N + " 关 · 选择 Buff";
    if (sub) sub.textContent = "本次死战内叠加生效；不选则直接进入下一关";
    const pool = (LD.PERKS || []).filter(x => UI.runPerks.indexOf(x.id) < 0);
    const choices = pickRandom(pool, 3);
    $("perkGrid").innerHTML = choices.map((pk, i) =>
      '<div class="card" data-gperk="' + i + '"><div class="t">' + pk.icon + " " + pk.name +
      '</div><div class="d">' + pk.desc + '</div></div>').join("");
    $("perkGrid").querySelectorAll("[data-gperk]").forEach(el => {
      el.onclick = () => {
        Audio2.ui();
        const pk = choices[+el.dataset.gperk];
        UI.runPerks.push(pk.id);
        g.buffs.push(pk.id);
        UI.toast("获得 Buff：" + pk.name, 1);
        UI.gauntletStage();
      };
    });
    UI.show("ovPerk");
  };

  /* 词条页「跳过」在死战里表示直接进下一关 */
  UI.perkSkip = function () {
    if (UI.gauntlet) { UI.gauntletStage(); return; }
    UI.show("ovLevels");
  };

  /* 返回房间：结束当前对局，但回到准备界面（联机保持房间与连接） */
  UI.backToRoom = function () {
    if (B.state !== "idle" && B.state !== "over") B.state = "over";
    B.fighters = []; B.projs = []; B.zones = [];
    LD.FX.clear(); LD.Cine.active = false;
    /* v2.7：这里不清暂停，下一局会永远停在倒计时「2」——旧版最常被报的卡读条 bug */
    B.paused = false;
    if (B.mode === "net") { UI.show("ovWait"); UI.renderNetRoom(); UI.toast("已返回房间，等房主重新开始"); }
    else { UI.show("ovDuelSetup"); UI.renderRoom(); }
  };

  /* ==========================================================
   *  联机
   * ========================================================== */
  UI.startNetBattle = function (roster, rule, dragonDiff, mods, matchT, mapCfg) {
    const N = LD.Net;
    LD.Net.buildNetBattle({
      isHost: N.isHost, mySide: N.mySide, roster: roster || null,
      rule: rule || "brawl", dragonDiff: dragonDiff || "normal", mods: mods || [],
      matchT: matchT || 120, mapCfg: mapCfg || null
    });
    B.onEnd = win => UI.endNet(win);
    UI.enterGame();
  };

  UI.bindNet = function () {
    const N = LD.Net;
    N.on("status", s => {
      if (UI.screen !== "ovMulti") return;
      const e = $("multiState");
      if (s.ok) e.innerHTML = '<span class="dot"></span> 服务器已连接，可以创建或加入房间';
      else if (s.why === "file") e.innerHTML = '⚠️ 当前是直接打开 HTML 文件，联机需要先启动服务器（双击「孤高旅斗.exe」或让房主开服）';
      else e.innerHTML = '<span class="dot off"></span> 服务器未连接，请确认已启动服务器';
    });
    N.on("created", code => {
      N.peersIn.length = 0; N.roster = {};
      UI.netRoom.rule = "brawl"; UI.netRoom.teams = {}; UI.netRoom.bots = []; UI.netRoom.players = [];
      UI.netRoom.mods = []; UI.netRoom.matchT = 120;
      UI.show("ovWait");
      UI.renderNetRoom();
      UI.toast("房间已创建，房号 " + code + "，把房号告诉朋友吧");
    });
    N.on("joined", () => {
      UI.toast("房间已加入，等待房主开始");
      UI.show("ovWait");
      UI.renderNetRoom();
    });
    N.on("err", msg => { Audio2.beep(200, 0.15, "square", 0.05); UI.toast(msg); });
    N.on("profile", () => { if (N.isHost) UI.netPushRoom(); else UI.renderNetRoom(); });
    N.on("roomTeam", d => {           // 客机选了队伍 → 房主记账并广播
      if (N.isHost) { UI.netRoom.teams[d.side] = d.team; UI.netPushRoom(); }
    });
    N.on("room", d => { UI.applyNetRoom(d); });
    N.on("peerJoined", seat => {
      if (N.isHost) UI.netPushRoom();          // 立刻把完整房间状态推给所有人（否则新客机看不到角色卡）
      else UI.renderNetRoom();
      UI.toast(N.isHost ? ("玩家 " + (seat + 1) + " 已加入，当前 " + (1 + N.peersIn.length) + "/4 人") : "对手已加入");
      LD.Net.sendProfile();
    });
    N.on("peerLeft", () => {
      UI.renderNetRoom();
      UI.toast("有玩家离开了");
      if (B.mode === "net" && B.state !== "over" && B.state !== "idle") { B.state = "over"; UI.endNet(false); }
    });
    N.on("start", d => { UI.startNetBattle(d && d.roster, d && d.rule, d && d.dragonDiff, d && d.mods,
      (d && (d.matchT || d.warmupT)) || 120, d && d.mapCfg); });
    N.on("again", () => { if (LD.Net.isHost) UI.netHostStart(); });
    N.on("matchEnd", mw => { if (!LD.Net.isHost && B.mode === "net") { B.matchWinner = mw; UI.endNet(mw === LD.Net.mySide); } });
  };

  /* ==========================================================
   *  绑定
   * ========================================================== */
  UI.init = function () {
    this.bindKeys();
    this.bindNet();

    const go = (id, fn) => { const e = $(id); if (e) e.onclick = () => { Audio2.init(); Audio2.ui(); fn(); }; };
    document.querySelectorAll("[data-back]").forEach(e => {
      e.onclick = () => { Audio2.ui(); UI.show(UI.backTo && UI.backTo !== e.dataset.back ? UI.backTo : e.dataset.back); UI.backTo = null; };
    });

    go("mSolo", () => UI.show("ovSolo"));
    go("mMulti", () => { UI.show("ovMulti"); LD.Net.connect(); });
    go("mHelp", () => UI.show("ovHelp"));
    go("mSkin", () => UI.show("ovSkin"));
    go("mSkill", () => UI.show("ovSkill"));
    go("mLoad", () => UI.show("ovLoad"));

    go("sDrag", () => UI.show("ovLevels"));
    go("sDuel", () => { UI.show("ovDuelSetup"); UI.renderRoom(); });
    go("sGauntlet", () => UI.startGauntlet());
    go("mAch", () => { UI.renderAch(); UI.show("ovAch"); });

    go("btnCreate", () => { LD.Net.connect(); LD.Net.create(); });
    go("btnGoJoin", () => { LD.Net.connect(); UI.show("ovJoin"); const ci = $("codeInput"); if (ci) { ci.value = ""; ci.focus(); } });
    go("btnJoin", () => {
      const v = ($("codeInput").value || "").replace(/\D/g, "");
      if (v.length !== 4) { UI.toast("请输入 4 位房号"); return; }
      LD.Net.connect(); LD.Net.join(v);
    });
    go("btnLeaveWait", () => { LD.Net.leave(); UI.show("ovMulti"); });

    document.querySelectorAll("#skinTabs .tab").forEach(t => {
      t.onclick = () => { UI.skinTab = t.dataset.part; Audio2.ui(); UI.renderSkin(); };
    });
    document.querySelectorAll("#skillTabs .tab").forEach(t => {
      t.onclick = () => { UI.skillTab = t.dataset.kind; Audio2.ui(); UI.renderSkill(); };
    });

    go("btnCheat", () => {
      P.cheatCoins();
      Audio2.buy();
      UI.toast("作弊 +10 金币 → 当前 " + P.d.coins, true);
      UI.renderHelp();
    });

    go("btnAgain", () => UI.restart());
    go("btnEndRoom", () => UI.backToRoom());
    go("btnEndMenu", () => UI.quitGame());
    go("btnQuit", () => UI.openPause());
    go("btnArmyShop", () => UI.openArmy());
    /* v2.7 丧尸危机：战斗界面上的商店入口 + 商店关闭按钮（手机端以前没法关） */
    go("btnShopHud", () => { if (B.rule === "tower") UI.openTower(); else UI.openArmy(); });
    go("towerClose", () => UI.show("game"));
    go("towerCloseBtn", () => UI.show("game"));
    go("armyClose", () => UI.closeArmy());
    go("armyCloseBtn", () => UI.closeArmy());
    /* 通关后的词条面板：跳过按钮以前没有绑事件，点上去毫无反应（人会被卡在这一页） */
    go("btnPerkSkip", () => { UI.runPerks.push("__skip__"); UI.perkSkip(); });
    go("btnPauseResume", () => UI.resumeGame());
    go("btnPauseRoom", () => UI.backToRoom());
    go("btnPauseMenu", () => UI.quitGame());
    go("btnMute", () => { Audio2.muted = !Audio2.muted; $("btnMute").textContent = Audio2.muted ? "🔇 静音" : "🔊 音效"; });

    /* 主菜单右上角：背景音乐开关（状态写进存档，下次启动保持一致） */
    const bgmBtn = $("btnBgm");
    if (bgmBtn && LD.BGM) {
      LD.BGM.applyProfile();                     // Profile 已在本函数之前的 boot 里 load 过
      const paint = () => {
        bgmBtn.textContent = LD.BGM.label();
        bgmBtn.classList.toggle("off", !LD.BGM.isOn());
      };
      paint();
      bgmBtn.onclick = () => { LD.BGM.toggle(); paint(); };
    }

    $("codeInput").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); });
    $("codeInput").addEventListener("keydown", e => { if (e.key === "Enter") $("btnJoin").onclick(); });

    $("menuVer").textContent = "v" + LD.VERSION + " · 听雨的声音";
    $("hudVer").textContent = "v" + LD.VERSION;
    this.show("ovMenu");
  };
})(window.LD = window.LD || {});
