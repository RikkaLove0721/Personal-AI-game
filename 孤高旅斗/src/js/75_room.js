/* ============================================================
 *  75_room.js — 开房间式准备界面（角色卡 / 模式 / 阵营 / 人机）
 * ============================================================
 *  单人对决与多人模式的准备阶段都用同一套「角色卡」：
 *    · 第一张卡永远是玩家自己（可在这里直接换装扮、换技能）
 *    · 后面的卡是人机 / 其他玩家（展示外貌与技能）
 *    · 支持增删人机、选择人机难度与技能、选择对战模式与阵营
 *  ============================================================ */
(function (LD) {
  "use strict";
  const UI = LD.UI, P = LD.Profile, A = LD.Audio, B = LD.Battle;

  const LEVELS = [
    { id: "easy", name: "木桩" },
    { id: "normal", name: "普通" },
    { id: "hard", name: "困难" }
  ];
  const SLOTS = ["basic", "skill1", "skill2", "ult"];
  const SLOT_LAB = { basic: "J", skill1: "K", skill2: "L", ult: "O" };

  function botLook() {
    const pick = part => { const a = LD.partsBy(part); return a[(Math.random() * a.length) | 0]; };
    const h = pick("head"), u = pick("upper"), l = pick("lower");
    return {
      head: { model: h.model, c1: h.c1, c2: h.c2, c3: h.c3 },
      upper: { c1: u.c1, c2: u.c2 },
      lower: { c1: l.c1, c2: l.c2 }
    };
  }

  /* 单人对决房间状态 */
  const room = UI.room = {
    rule: "brawl",
    myTeam: -1,
    bots: []                     // { level, loadout, look }
  };

  /* 玩家自己的阵营（未选时按座位给默认阵营） */
  function myTeam() { return room.myTeam; }

  /** 统计已占用的阵营，用于「不能全同阵营」校验 */
  function teamsUsed(list) {              // list: [{team}]
    const s = {};
    list.forEach(x => { if (x.team >= 0) s[x.team] = 1; });
    return Object.keys(s).length;
  }

  function hardLevelOf(bots) {
    if (bots.some(b => b.level === "hard")) return "hard";
    if (bots.some(b => b.level === "normal")) return "normal";
    return "easy";
  }

  /* ---------------- 卡片渲染 ---------------- */
  function teamBar(sel, who) {
    return '<div class="teamrow">' + LD.TEAM_COLORS.map((c, i) =>
      '<button class="tchip' + (sel === i ? " sel" : "") + '" data-team="' + i + '" data-twho="' + who + '" style="--tc:' + c + '">' +
      '<i style="background:' + c + '"></i>' + LD.TEAM_NAMES[i] + '</button>').join("") + '</div>';
  }

  function teamTag(t) {
    if (t == null || t < 0) return "";
    return '<i class="ttag" style="background:' + LD.TEAM_COLORS[t] + '"></i>';
  }

  function skillSelect(attr, ids, val) {
    return '<select class="mini" ' + attr + '>' +
      ids.map(id => { const s = LD.skill(id); if (!s) return ""; return '<option value="' + id + '"' + (id === val ? " selected" : "") + '>' + s.icon + " " + s.name + '</option>'; }).join("") +
      '</select>';
  }

  function cardHtml(idx, data, opts) {
    /* opts: { kind: "me"|"bot"|"player", team, teamSel, level, loadout, name, rule } */
    const k = opts.kind;
    const teamMode = (opts.rule || room.rule) === "team";
    const badge = k === "me" ? '<span class="cb me">你</span>'
      : k === "bot" ? '<span class="cb bot">人机</span>'
      : '<span class="cb p">玩家</span>';
    let body = "";
    if (k === "bot") {
      body += '<div class="crow"><span class="cl">难度</span>' +
        '<div class="lvtabs">' + LEVELS.map(l =>
          '<button class="lv' + (opts.level === l.id ? " sel" : "") + '" data-blv="' + idx + '" data-lv="' + l.id + '">' + l.name + '</button>').join("") + '</div></div>';
      body += '<div class="crow"><span class="cl">技能</span><div class="skgrid">' +
        SLOTS.map(slot => {
          const ids = slot === "basic" ? LD.AI.ALL_BASIC() : slot === "ult" ? LD.AI.ALL_ULT() : LD.AI.ALL_SKILL();
          return '<span class="ski"><span class="tk">' + SLOT_LAB[slot] + '</span>' +
            skillSelect('data-bsk="' + idx + '|' + slot + '"', ids, opts.loadout[slot]) + '</span>';
        }).join("") + '</div></div>';
      body += '<div class="crow"><button class="btn sm ghost" data-brnd="' + idx + '">随机配装</button>' +
        '<button class="btn sm ghost" data-bdel="' + idx + '">删除</button></div>';
    } else if (k === "me") {
      body += '<div class="crow"><button class="btn sm" data-open="ovSkin">装扮</button>' +
        '<button class="btn sm" data-open="ovSkill">技能</button><button class="btn sm ghost" data-open="ovLoad">总览</button></div>';
    } else {
      body += '<div class="crow sktext">' + SLOTS.map(slot => {
        const s = LD.skill(opts.loadout && opts.loadout[slot]);
        return '<span>' + SLOT_LAB[slot] + ' ' + (s ? s.icon : "—") + '</span>';
      }).join("") + '</div>';
    }
    if (teamMode && opts.teamSel) body += teamBar(opts.team, opts.twho || "me");
    return '<div class="pcard' + (k === "me" ? " mine" : "") + '">' +
      '<canvas class="pv" width="112" height="126"></canvas>' + badge +
      '<div class="pn">' + (teamMode ? teamTag(opts.team) : "") + (opts.name || "玩家") + '</div>' + body + '</div>';
  }

  function drawPreviews(host, list) {
    const cvs = host.querySelectorAll("canvas.pv");
    list.forEach((it, i) => {
      const cv = cvs[i]; if (!cv) return;
      try { LD.View.heroPreview(cv, it.look, 0); } catch (e) {}
    });
  }

  /* ---------------- 单人对决房间 ---------------- */
  UI.renderRoom = function () {
    const host = document.getElementById("roomBody");
    if (!host) return;
    // 首次进入给两张人机卡
    if (!room.bots.length) {
      room.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: botLook() });
      room.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: botLook() });
      if (room.myTeam < 0) room.myTeam = 0;
    }
    const ruleBar = '<div class="rulebar">' + LD.RULES.map(r =>
      '<button class="rule' + (room.rule === r.id ? " sel" : "") + '" data-rule="' + r.id + '"><b>' + r.icon + " " + r.name + '</b><span>' + r.desc + '</span></button>').join("") + '</div>';
    const cards = [cardHtml(0, null, { kind: "me", name: (P.d.name || "你"), look: P.look(), team: myTeam(), teamSel: true, twho: "me", level: null, loadout: P.d.loadout, rule: room.rule })]
      .concat(room.bots.map((bb, i) => cardHtml(i, null, { kind: "bot", name: "人机 " + (i + 1), look: bb.look, team: botTeam(i), teamSel: true, twho: "b" + i, level: bb.level, loadout: bb.loadout, rule: room.rule })));
    host.innerHTML =
      '<h2>创建房间 · 选择模式</h2>' + ruleBar +
      '<div class="cardgrid">' + cards.join("") +
      (room.bots.length < 3 ? '<div class="card add" id="roomAddBot">+<span>添加人机</span></div>' : '') +
      '</div>' +
      '<div class="roomfoot">' +
      '<div class="hint">' + LD.ruleInfo(room.rule).desc + '</div>' +
      '<div class="btnrow"><div class="back" data-back="ovMenu">‹ 返回</div>' +
      '<button class="btn" id="roomStart">开始对决</button></div></div>';

    const list = [{ look: P.look() }].concat(room.bots.map(bb => ({ look: bb.look })));
    drawPreviews(host, list);
    bindRoom(host);
  };

  /* 人机阵营：阵营模式下默认按顺序轮流分到 4 个阵营；房主点卡片上的队伍色可手动指定 */
  function botTeam(i) {
    if (room.rule !== "team") return -1;
    const bb = room.bots[i];
    if (bb && bb.team != null && bb.team >= 0) return bb.team;
    return (i + 1) % 4;
  }

  /* 动态生成的「返回」按钮要就地绑定（初始化时的那批只覆盖静态 DOM） */
  function bindBack(host) {
    host.querySelectorAll("[data-back]").forEach(e => {
      e.onclick = () => {
        A.ui();
        UI.show(UI.backTo && UI.backTo !== e.dataset.back ? UI.backTo : e.dataset.back);
        UI.backTo = null;
      };
    });
  }

  function bindRoom(host) {
    const q = (sel) => host.querySelectorAll(sel);
    bindBack(host);
    q("[data-rule]").forEach(el => {
      el.onclick = () => { A.ui(); room.rule = el.dataset.rule; UI.renderRoom(); };
    });
    q("[data-open]").forEach(el => {
      el.onclick = () => { A.ui(); UI.backTo = "ovDuelSetup"; UI.show(el.dataset.open); };
    });
    q("[data-team]").forEach(el => {
      el.onclick = () => {
        A.ui();
        const t = +el.dataset.team, who = el.dataset.twho || "me";
        if (who === "me") room.myTeam = t;
        else {
          const i = +String(who).slice(1);
          if (room.bots[i]) room.bots[i].team = t;
        }
        UI.renderRoom();
      };
    });
    q("[data-blv]").forEach(el => {
      el.onclick = () => { A.ui(); room.bots[+el.dataset.blv].level = el.dataset.lv; UI.renderRoom(); };
    });
    q("[data-brnd]").forEach(el => {
      el.onclick = () => { A.ui(); const i = +el.dataset.brnd; room.bots[i].loadout = LD.AI.randomLoadout(); room.bots[i].look = botLook(); UI.renderRoom(); };
    });
    q("[data-bdel]").forEach(el => {
      el.onclick = () => { A.ui(); room.bots.splice(+el.dataset.bdel, 1); UI.renderRoom(); };
    });
    q("[data-bsk]").forEach(el => {
      el.onchange = () => {
        const [i, slot] = el.dataset.bsk.split("|");
        const bb = room.bots[+i];
        bb.loadout[slot] = el.value;
        if (slot !== "basic" && slot !== "ult" && bb.loadout.skill1 === bb.loadout.skill2) {
          const all = LD.AI.ALL_SKILL();
          const other = slot === "skill1" ? "skill2" : "skill1";
          bb.loadout[other] = all.find(id => id !== el.value) || bb.loadout[other];
          UI.toast("两个技能槽不能相同，已自动调整");
        }
        A.ui();
      };
    });
    const add = host.querySelector("#roomAddBot");
    if (add) add.onclick = () => {
      A.ui();
      room.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: botLook() });
      UI.renderRoom();
    };
    const st = host.querySelector("#roomStart");
    if (st) st.onclick = () => { A.ui(); UI.roomStart(); };
  }

  /* ---------------- 开打 ---------------- */
  UI.roomStart = function () {
    if (room.rule === "team") {
      const all = [{ team: myTeam() }].concat(room.bots.map((bb, i) => ({ team: botTeam(i) })));
      if (teamsUsed(all) < 2) { UI.toast("至少要有两个阵营才能开局"); return; }
    }
    UI.duel.level = hardLevelOf(room.bots);
    const fighters = [];
    const me = B.mkHero(0, { x: 0, y: 0, look: P.look(), loadout: Object.assign({}, P.d.loadout), name: P.displayName() });
    me.ctrl = UI.ctrl;
    me.team = room.rule === "team" ? myTeam() : -1;
    fighters.push(me);
    room.bots.forEach((bb, i) => {
      const bot = B.mkHero(i + 1, { x: 0, y: 0, look: bb.look, loadout: Object.assign({}, bb.loadout), name: (bb.level === "easy" ? "木桩" : "人机 " + (i + 1)) });
      LD.AI.mkBot(bot, bb.level);
      bot.team = room.rule === "team" ? botTeam(i) : -1;
      fighters.push(bot);
    });
    if (room.rule === "overlord") {
      const dr = B.mkDragon({ diff: room.bots.some(b => b.level === "hard") ? LD.DIFF.hard : LD.DIFF.normal });
      dr.side = fighters.length; dr.id = dr.side; dr.team = -1;
      fighters.push(dr);
    }
    B.setup({ mode: "duel", rule: room.rule, fighters, theme: {} });
    B.resetRound(false);                 // 按座位号摆位（最多 4 人），并设置对应规则的限时
    B.onEnd = win => UI.endDuel(win);
    UI.enterGame();
  };

  /* ---------------- 多人准备阶段（角色卡） ---------------- */
  UI.netRoom = { rule: "brawl", teams: {}, bots: [], players: [] };

  /* 当前房里都有谁：房主按 peesIn 推导，客机用房主同步下来的 players */
  UI.netPlayers = function () {
    const N = LD.Net, R = UI.netRoom, P0 = LD.Profile;
    if (!N.isHost && R.players && R.players.length) {
      return R.players.map(p => ({
        side: p.side, mine: p.side === N.mySide, name: p.name, team: p.team == null ? -1 : p.team,
        look: p.side === N.mySide ? P0.look() : (p.look || (N.roster[p.side] && N.roster[p.side].look) || P0.look()),
        loadout: p.side === N.mySide ? P0.d.loadout : (p.loadout || (N.roster[p.side] && N.roster[p.side].loadout) || LD.DEFAULT_LOADOUT)
      }));
    }
    const seats = [0].concat(N.peersIn.slice().sort((a, b) => a - b));
    return seats.map(seat => {
      const r = seat === N.mySide ? null : N.roster[seat];
      return {
        side: seat, mine: seat === N.mySide,
        name: (r && r.name) || (seat === 0 ? "房主" : "玩家 " + (seat + 1)),
        look: (r && r.look) || P0.look(),
        loadout: (r && r.loadout) || P0.d.loadout,
        team: R.teams[seat] == null ? -1 : R.teams[seat]
      };
    });
  };

  /* 阵营模式下：玩家按座位轮流分阵营，人机接在玩家后面继续轮流分 */
  function netBotTeam(i, offset) { return (offset + i) % 4; }

  function netTeamOf(players, i) {
    const R = UI.netRoom;
    const seat = players[i].side;
    if (R.teams[seat] == null) R.teams[seat] = i % 4;
    return R.teams[seat];
  }

  UI.setNetTeam = function (seat, team) { UI.netRoom.teams[seat] = team; UI.netPushRoom(); };

  /** 全部参战者的阵营数组，用于「不能全同阵营」校验 */
  function netAllTeams(players) {
    const R = UI.netRoom;
    return players.map((p, i) => ({ team: netTeamOf(players, i) }))
      .concat(R.bots.map((b, i) => ({ team: b.team == null ? netBotTeam(i, players.length) : b.team })));
  }

  UI.renderNetRoom = function () {
    const host = document.getElementById("netRoomBody");
    if (!host) return;
    const N = LD.Net, R = UI.netRoom, isHost = N.isHost;
    const players = UI.netPlayers();
    R.players = players;
    if (R.rule === "team") players.forEach((p, i) => netTeamOf(players, i));

    const ruleBar = '<div class="rulebar">' + LD.RULES.map(r =>
      '<button class="rule' + (R.rule === r.id ? " sel" : "") + '"' + (isHost ? ' data-nrule="' + r.id + '"' : " disabled") +
      '><b>' + r.icon + " " + r.name + '</b><span>' + r.desc + '</span></button>').join("") + '</div>';

    const cards = players.map((p, i) => cardHtml(i, null, {
      kind: p.mine ? "me" : "player", name: p.name, look: p.look,
      team: R.rule === "team" ? netTeamOf(players, i) : -1,
      teamSel: R.rule === "team" && (p.mine || isHost), twho: p.mine ? "me" : "s" + p.side,
      loadout: p.loadout, rule: R.rule
    }));
    R.bots.forEach((bb, i) => {
      /* 注意：这里必须传 i 而不是 100+i —— cardHtml 会把 idx 写进 data-blv/data-bdel 等属性，
         绑定层直接用 +dataset 索引 R.bots，传 100+i 会导致删除 / 难度 / 技能全部失灵 */
      cards.push(cardHtml(i, null, {
        kind: isHost ? "bot" : "player", name: "人机 " + (i + 1), look: bb.look,
        team: R.rule === "team" ? (bb.team == null || bb.team < 0 ? netBotTeam(i, players.length) : bb.team) : -1,
        teamSel: R.rule === "team" && isHost, twho: "b" + i,
        level: bb.level, loadout: bb.loadout, rule: R.rule
      }));
    });
    const canAdd = isHost && R.bots.length < 3;
    host.innerHTML =
      '<h2>房间准备 · ' + players.length + ' 名玩家' + (R.bots.length ? " + " + R.bots.length + " 个人机" : "") + '</h2>' + ruleBar +
      '<div class="cardgrid">' + cards.join("") +
      (canAdd ? '<div class="card add" id="netAddBot">+<span>添加人机</span></div>' : '') + '</div>' +
      '<div class="roomfoot"><div class="hint">房号 <b>' + (N.room || "----") + '</b>　朋友打开 <b>' + location.origin +
      '</b> 输入房号即可加入　' + LD.ruleInfo(R.rule).desc + '</div>' +
      '<div class="btnrow"><button class="btn sm ghost" id="netCopy">复制地址+房号</button>' +
      '<div class="back" data-back="ovMulti">‹ 返回大厅</div>' +
      (isHost ? '<button class="btn" id="netStart">开始对决</button>' : '<div class="hint">等房主开始…</div>') + '</div></div>';

    drawPreviews(host, players.concat(R.bots));
    bindNetRoom(host);
  };

  function bindNetRoom(host) {
    const R = UI.netRoom;
    bindBack(host);
    host.querySelectorAll("[data-nrule]").forEach(el => {
      el.onclick = () => { A.ui(); R.rule = el.dataset.nrule; UI.netPushRoom(); };
    });
    host.querySelectorAll("[data-open]").forEach(el => {
      el.onclick = () => { A.ui(); UI.backTo = "ovWait"; UI.show(el.dataset.open); };
    });
    host.querySelectorAll("[data-team]").forEach(el => {
      el.onclick = () => {
        A.ui();
        const t = +el.dataset.team, who = el.dataset.twho || "me", N = LD.Net;
        if (who === "me") {
          if (N.isHost) { R.teams[N.mySide] = t; UI.netPushRoom(); }
          else { N.toPeer({ t: "rt", side: N.mySide, team: t }); R.teams[N.mySide] = t; UI.renderNetRoom(); }
        } else if (N.isHost) {
          /* 房主可以给任何玩家 / 人机指定阵营 */
          if (who[0] === "s") R.teams[+who.slice(1)] = t;
          else if (R.bots[+who.slice(1)]) R.bots[+who.slice(1)].team = t;
          UI.netPushRoom();
        }
      };
    });
    host.querySelectorAll("[data-blv]").forEach(el => {
      el.onclick = () => { A.ui(); R.bots[+el.dataset.blv].level = el.dataset.lv; UI.netPushRoom(); };
    });
    host.querySelectorAll("[data-brnd]").forEach(el => {
      el.onclick = () => { A.ui(); const i = +el.dataset.brnd; R.bots[i].loadout = LD.AI.randomLoadout(); R.bots[i].look = botLook(); UI.netPushRoom(); };
    });
    host.querySelectorAll("[data-bdel]").forEach(el => {
      el.onclick = () => { A.ui(); R.bots.splice(+el.dataset.bdel, 1); UI.netPushRoom(); };
    });
    host.querySelectorAll("[data-bsk]").forEach(el => {
      el.onchange = () => {
        const parts = el.dataset.bsk.split("|");
        const bb = R.bots[+parts[0]];
        if (!bb) return;
        bb.loadout[parts[1]] = el.value;
        A.ui(); UI.netPushRoom();
      };
    });
    const add = host.querySelector("#netAddBot");
    if (add) add.onclick = () => {
      A.ui();
      R.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: botLook(), team: -1 });
      UI.netPushRoom();
    };
    const st = host.querySelector("#netStart");
    if (st) st.onclick = () => { A.ui(); UI.netHostStart(); };
    const cp = host.querySelector("#netCopy");
    if (cp) cp.onclick = () => {
      const txt = location.origin + "　房号 " + (LD.Net.room || "");
      try { navigator.clipboard.writeText(txt); UI.toast("已复制：" + txt, true); }
      catch (e) { UI.toast(txt); }
    };
  }

  /* 房主：把房间状态同步给所有挑战者（含人机、模式、阵营、名单） */
  UI.netPushRoom = function () {
    const N = LD.Net, R = UI.netRoom;
    if (!N.isHost) { UI.renderNetRoom(); return; }
    const players = UI.netPlayers();
    R.players = players;
    const teams = players.map((p, i) => (R.rule === "team" ? netTeamOf(players, i) : -1));
    N.toPeer({
      t: "room", rule: R.rule, bots: R.bots,
      /* 外观与配装随房间状态一起下发：客机之间可能互相漏收 pl 消息，
         只靠花名册兜底会让某些客机眼里两个非房主穿成一模一样 */
      players: players.map((p, i) => ({ side: p.side, name: p.name, team: teams[i], look: p.look, loadout: p.loadout }))
    });
    UI.renderNetRoom();
  };

  /* 客机：收到房间状态后渲染 */
  UI.applyNetRoom = function (d) {
    const R = UI.netRoom, N = LD.Net, P0 = LD.Profile;
    R.rule = d.rule || R.rule;
    R.bots = d.bots || [];
    R.players = (d.players || []).map(p => ({
      side: p.side, name: p.name, team: p.team == null ? -1 : p.team,
      /* 优先用房主下发的真实外观；旧版房间消息没有 look 时按花名册兜底 */
      look: p.look || (p.side === N.mySide ? P0.look() : (N.roster[p.side] && N.roster[p.side].look) || P0.look()),
      loadout: p.loadout || (p.side === N.mySide ? P0.d.loadout : (N.roster[p.side] && N.roster[p.side].loadout) || LD.DEFAULT_LOADOUT)
    }));
    UI.renderNetRoom();
  };

  /* 房主开打：把角色卡房间整理成花名册（玩家 + 人机）后广播并本地开局 */
  UI.netHostStart = function () {
    const N = LD.Net, R = UI.netRoom;
    if (!N.isHost) return;
    const players = UI.netPlayers();
    R.players = players;
    if (R.rule === "team" && teamsUsed(netAllTeams(players)) < 2) { UI.toast("至少要有两个阵营才能开局"); return; }
    const roster = players.map((p, i) => ({
      look: p.look, loadout: Object.assign({}, p.loadout || {}), name: p.name,
      team: R.rule === "team" ? netTeamOf(players, i) : -1
    })).concat(R.bots.map((b, i) => ({
      look: b.look, loadout: Object.assign({}, b.loadout), name: "人机 " + (i + 1),
      team: R.rule === "team" ? (b.team == null || b.team < 0 ? netBotTeam(i, players.length) : b.team) : -1,
      bot: true, level: b.level
    })));
    if (roster.length < 2) { UI.toast("至少需要两名参战者才能开局"); return; }
    const dragonDiff = R.bots.some(b => b.level === "hard") ? "hard" : "normal";
    N.toPeer({ t: "go", roster, rule: R.rule, dragonDiff });
    UI.startNetBattle(roster, R.rule, dragonDiff);
  };
})(window.LD = window.LD || {});
