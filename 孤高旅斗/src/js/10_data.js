/* ============================================================
 *  10_data.js — 全局配置 / 部件目录 / 技能目录 / 关卡
 * ============================================================ */
(function (LD) {
  "use strict";

  LD.CONF = {
    W: 960, H: 600,
    hero: { hp: 200, speed: 195, r: 15 },
    // 能量：命中敌人、被击中都回能，另加少量自然回复
    energy: { max: 150, onHit: 12, onHurt: 10, regen: 2.2 },   // 大招需攒满 150
    critRate: 0.10, critMul: 2,
    dodge: { cd: 2.5, dist: 96 },                              // 双击方向键闪避
    parry: { cdBasic: 2, cdSkill: 8 },                         // 格挡反制：挡普攻 / 挡技能大招
    hitstop: { hit: 0.055, parry: 0.09, ult: 0.16 },
    shake: { hit: 4, parry: 11, ult: 16, dash: 5 },
    ultCinematic: 2.6,          // 大招演出时长（秒）
    body: { headR: 15, torsoW: 26, torsoH: 24, legH: 18 }
  };

  /* ---------------------------------------------------------- 部件目录
   * 每个部件 6 金币。玩家 = 头部 + 上身 + 下身，三段式自由搭配。 */
  const P = [];
  const push = (o) => P.push(o);

  // ---- 头部：5 款模型 × 2 配色 = 10 件 ----
  const headModels = [
    { model: "robot", name: "机器人", cs: [["银灰机兵", "#cbd5e1", "#22d3ee", "#334155"], ["铜橙机兵", "#d97706", "#fde68a", "#7c2d12"]] },
    { model: "boy", name: "年轻男子", cs: [["黑发少年", "#1f2937", "#0ea5e9", "#f6d0b0"], ["棕发少年", "#78350f", "#f59e0b", "#f3c9a4"]] },
    { model: "girl", name: "粉发少女", cs: [["粉发少女", "#f472b6", "#fbcfe8", "#fbdcc8"], ["蓝发少女", "#60a5fa", "#bfdbfe", "#fbdcc8"]] },
    { model: "jianghu", name: "江湖斗篷侠", cs: [["墨绿斗篷", "#14532d", "#86efac", "#e8c9a0"], ["暗红斗篷", "#7f1d1d", "#fca5a5", "#e8c9a0"]] },
    { model: "tophat", name: "高帽企业家", cs: [["玄黑高帽", "#111827", "#d4a017", "#f2cfae"], ["酒红高帽", "#7f1d1d", "#fbbf24", "#f2cfae"]] }
  ];
  headModels.forEach((m, mi) => m.cs.forEach((c, ci) => push({
    id: "h_" + m.model + "_" + ci, part: "head", model: m.model, price: 6,
    name: c[0], c1: c[1], c2: c[2], c3: c[3], star: mi === 0 && ci === 0
  })));

  // ---- 上身：10 种配色战衣 ----
  [["玄墨", "#1f2937", "#22d3ee"], ["月白", "#e5e7eb", "#6366f1"], ["赤焰", "#b91c1c", "#fb923c"],
   ["碧波", "#0e7490", "#67e8f9"], ["紫电", "#6d28d9", "#c4b5fd"], ["青松", "#047857", "#6ee7b7"],
   ["橙阳", "#c2410c", "#fdba74"], ["樱粉", "#db2777", "#fbcfe8"], ["鎏金", "#b45309", "#fcd34d"],
   ["苍蓝", "#1e40af", "#93c5fd"]].forEach((c, i) => push({
    id: "u_" + i, part: "upper", price: 6, name: c[0] + "战衣", c1: c[1], c2: c[2], star: i === 0
  }));

  // ---- 下身：10 种配色 ----
  [["深蓝", "#1e3a8a", "#0f172a"], ["玄黑", "#111827", "#374151"], ["卡其", "#a8894f", "#3f3222"],
   ["米白", "#e8e2d4", "#b8ae97"], ["酒红", "#7f1d1d", "#3f1010"], ["墨绿", "#14532d", "#0a2e18"],
   ["石墨", "#374151", "#1f2937"], ["雪白", "#f1f5f9", "#cbd5e1"], ["丁香", "#6d28d9", "#3b1d7a"],
   ["沙棕", "#8b5e3c", "#4b3222"]].forEach((c, i) => push({
    id: "l_" + i, part: "lower", price: 6, name: c[0] + "装束", c1: c[1], c2: c[2], star: i === 0
  }));

  LD.PARTS = P;
  LD.partsBy = (part) => P.filter(p => p.part === part);
  LD.part = (id) => P.find(p => p.id === id) || null;
  // 新档免费赠送的三件
  LD.FREE = { head: "h_boy_0", upper: "u_0", lower: "l_0" };

  /* ---------------------------------------------------------- 技能目录
   * kind: basic 普攻（J） / skill 技能（K、L） / ult 大招（O，需要满能量） */
  const S = [];
  const add = (o) => { o.tags = o.tags || []; S.push(o); return o; };

  add({ id: "slash", kind: "basic", name: "斩击", icon: "🗡", price: 0, cd: 1.6, dmg: 14,
        tags: ["近战"], desc: "面朝方向挥出一道光刃，范围近但出手极快，是你的看家本领。" });

  add({ id: "parry", kind: "basic", name: "格挡", icon: "🛡", price: 0, cd: 0.4, dmg: 8,
        tags: ["默认携带", "反制"], parry: true,
        desc: "举盾格挡正面来的攻击并小幅反击，同时把对手打退。空放或挡下普攻 → 冷却 2 秒；挡下技能或大招 → 冷却 8 秒，判断要准。（属于普攻分类，可装在 J 槽）" });

  add({ id: "fireball", kind: "basic", name: "远程普攻", icon: "🔥", price: 6, cd: 2.10, dmg: 12,
        tags: ["远程"], proj: { speed: 640, r: 9, life: 2.4 },
        desc: "射出追踪不佳但速度很快的火球。伤害比斩击略低，胜在安全，可以和对手拉锯。" });

  add({ id: "pistol", kind: "basic", name: "手枪", icon: "🔫", price: 6, cd: 5.0, dmg: 13,
        tags: ["远程", "直线"], proj: { speed: 820, r: 7, life: 1.6 },
        desc: "射出一发高速子弹，伤害与火球相当、飞行更快，但不带任何追踪，纯靠准头。" });

  add({ id: "rock", kind: "basic", name: "石头", icon: "🪨", price: 6, cd: 4.0, dmg: 8,
        tags: ["远程", "眩晕"], proj: { speed: 640, r: 12, life: 2.2 }, stun: 0.4,
        desc: "丢出一块石头，伤害不高，但命中会让对手眩晕 0.4 秒——打断和起手都好用。" });

  add({ id: "mace", kind: "basic", name: "狼牙棒", icon: "🏏", price: 6, cd: 5.0, dmg: 18,
        tags: ["近战"], reach: 76, half: 1.15, windup: 0.3,
        desc: "举起狼牙棒蓄力 0.3 秒后砸下，范围比斩击大、伤害更高，前摇是可被读到的破绽。" });

  add({ id: "dashSlash", kind: "skill", name: "位移斩", icon: "💫", price: 6, cd: 3.2, dmg: 18,
        tags: ["短CD"], dash: 175, dashT: 0.18, invuln: 0.26, second: 2.0,
        desc: "向面朝方向一闪而过，期间无敌并对路径上的敌人造成伤害。2 秒内再次使用可闪回原位并再斩一次。" });

  add({ id: "laserWave", kind: "skill", name: "激光波", icon: "📡", price: 6, cd: 8, dmg: 32,
        tags: ["中CD"], charge: 1.1, range: 540, width: 128,
        desc: "蓄力 1.1 秒（期间无法移动无法转向，地面会出现预警光带，方向锁定为出手朝向）后向前轰出一道贯穿型激光，范围大，适合封走位。蓄力中双击方向键可直接取消该技能。" });

  add({ id: "windBlade", kind: "skill", name: "风刃", icon: "🌪", price: 6, cd: 5.5, dmg: 16,
        tags: ["中CD", "定身"], proj: { speed: 560, r: 34, life: 2.4 }, root: 2.0,
        desc: "打出一道大范围龙卷风，命中后定身对手 2 秒（对方仍可放技能），是抓人的好手段。" });

  add({ id: "meditate", kind: "skill", name: "冥思", icon: "🧘", price: 6, cd: 4.5, dmg: 0,
        tags: ["中CD", "回复"], heal: 11,
        desc: "按住技能进入冥想持续回血，期间无法移动与攻击。松开或被攻击都会打断并进入冷却；被打断时自己还会眩晕 1 秒。" });

  add({ id: "rockShield", kind: "skill", name: "岩土盾", icon: "🪨", price: 6, cd: 8.0, dmg: 16,
        tags: ["长CD", "护盾"], shield: 36, dur: 3.0, breakR: 78,
        desc: "在自身生成一个可吸收 36 点伤害的岩石护盾，持续 3 秒。护盾被打破时对近身敌人造成 16 点伤害；若护盾是被敌人主动打爆的，自己还会眩晕 0.6 秒——开盾时机要算准。" });

  add({ id: "dragonPalm", kind: "skill", name: "神龙掌", icon: "🐲", price: 6, cd: 8.0, dmg: 24,
        tags: ["中CD", "吸弹"], proj: { speed: 300, r: 92, life: 3.2 }, absorb: 20,
        desc: "推出一个缓慢前进的巨大掌印，会吸收沿途的远程攻击（最多吸收 20 点伤害，超出则掌印提前消失），命中时爆炸。对手越爱放远程，它越强。" });

  add({ id: "meatRush", kind: "skill", name: "肉弹冲击", icon: "💥", price: 6, cd: 8.0, dmg: 20,
        tags: ["中CD", "加速"], dur: 3.0, mul: 1.9, stun: 0,
        desc: "全身涌起金光，移速大幅提升持续 3 秒，撞到对手造成伤害并将其撞飞（不再眩晕），随后立刻进入冷却。" });

  add({ id: "flyingRaijin", kind: "skill", name: "飞雷神", icon: "🌀", price: 6, cd: 6.0, dmg: 26,
        tags: ["中CD", "二段"], proj: { speed: 420, r: 10, life: 1.4 }, boomR: 78,
        desc: "向前方掷出一枚中速飞镖（本身不造成伤害），再按一次技能键即可瞬间闪到飞镖处并引发爆炸，造成 26 点伤害。进可攻退可撤。" });

  add({ id: "dung", kind: "skill", name: "粪击", icon: "💩", price: 6, cd: 7.0, dmg: 20,
        tags: ["中CD", "致盲"], proj: { speed: 420, r: 26, life: 2.6 }, blind: 3.0,
        desc: "向前方中速扔出一大坨东西，命中造成 20 点伤害，并让对手的视野被糊住 3 秒（行动不受限，只是看不见）。" });

  add({ id: "blink", kind: "skill", name: "瞬身", icon: "✨", price: 6, cd: 7.5, dmg: 16,
        tags: ["长CD", "瞬移"], charge: 0.85,
        desc: "蓄力时浑身红光，随后瞬移到对手身旁并造成伤害。蓄力期间被打会眩晕 0.6 秒，属于高风险高回报。" });

  add({ id: "substitute", kind: "skill", name: "替身", icon: "🎭", price: 6, cd: 5.0, dmg: 24,
        tags: ["中CD", "陷阱"], back: 155, fuse: 1.0, bombR: 118, stun: 0.6,
        desc: "向后快速位移并在原地留下一颗炸弹，1 秒后爆炸，范围很大，被炸到的人会眩晕 0.6 秒。用来拉开距离、逼对手不敢追。" });

  add({ id: "bloodSlash", kind: "skill", name: "嗜血斩", icon: "🩸", price: 6, cd: 8.0, dmg: 26,
        tags: ["长CD", "吸血"], dash: 265, dashT: 0.2, selfCost: 12, heal: 18,
        desc: "燃烧自身 12 点生命向前突进一大段距离，穿过对手造成重创并回复生命。血少时慎用。" });

  add({ id: "voidSlash", kind: "ult", name: "虚空爆裂斩", icon: "🌀", price: 10, cd: 1.0, dmg: 11,
        tags: ["大招"], charge: 0.5, proj: { speed: 400, r: 124, life: 3.0 }, tick: 0.22, tickMax: 1.3,
        desc: "蓄力后放出一道巨大剑气，接触敌人会持续撕扯并间歇性眩晕，是压制之王。" });

  add({ id: "bloodRage", kind: "ult", name: "血怒", icon: "😤", price: 10, cd: 1.0, dmg: 0,
        tags: ["大招"], dur: 6.0, lifesteal: 0.5,
        desc: "开启后 6 秒内，自己造成伤害的 50% 转化为治疗量。越凶越难死。" });

  add({ id: "thousandSwords", kind: "ult", name: "千剑杀", icon: "⚔️", price: 10, cd: 1.0, dmg: 9,
        tags: ["大招"], dur: 4.0, interval: 0.28, proj: { speed: 840, r: 12, life: 1.6 },
        desc: "施放瞬间锁定朝向，4 秒内向前方直线倾泻高速剑气，弹道不追踪，靠走位把对手压进火力线。" });

  LD.SKILLS = S;
  LD.skill = (id) => S.find(s => s.id === id) || null;

  /* ---------------------------------------------------------- 平衡配置覆盖
   * src/config/balance.js（构建后为 dist/balance.js）定义 window.LD_BALANCE，
   * 启动时把里面的数值深合并覆盖到默认值上。改平衡只需要改 balance.js，不必动源码。
   * 注意：本函数只在这里定义，调用统一放在文件末尾（LD.DRAGON 等全部就绪之后）。 */
  LD.applyBalance = function () {
    const B = window.LD_BALANCE;
    if (!B) return;
    const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    const deep = (t, s) => {
      if (!isObj(t) || !isObj(s)) return;   // 目标不存在时跳过，绝不让配置文件崩掉游戏
      for (const k in s) {
        if (isObj(s[k])) deep(t[k], s[k]);
        else t[k] = s[k];
      }
    };
    if (B.hero) deep(LD.CONF && LD.CONF.hero, B.hero);
    if (B.energy) deep(LD.CONF && LD.CONF.energy, B.energy);
    if (B.dodge) deep(LD.CONF && LD.CONF.dodge, B.dodge);
    if (B.parry) deep(LD.CONF && LD.CONF.parry, B.parry);
    if (B.crit && LD.CONF) {
      if (B.crit.rate != null) LD.CONF.critRate = B.crit.rate;
      if (B.crit.mul != null) LD.CONF.critMul = B.crit.mul;
    }
    if (B.dragon) deep(LD.DRAGON, B.dragon);
    const sk = B.skills || {};
    (LD.SKILLS || []).forEach(s => { if (sk[s.id]) deep(s, sk[s.id]); });
  };
  LD.skillsBy = (kind) => S.filter(s => s.kind === kind);
  LD.SKILL_IMPL = {};   // 由 40_battle.js 填充

  // 新档默认携带（v2.0 起格挡属于普攻分类，J 槽只能装一个，默认给斩击）
  LD.DEFAULT_LOADOUT = { basic: "slash", skill1: null, skill2: null, ult: null };

  /* ---------------------------------------------------------- 难度 */
  LD.DIFF = {
    normal: { key: "normal", name: "普通", hpM: 1.00, dmgM: 1.00, rateM: 1.00, reward: 4,  color: "#34d399" },
    hard:   { key: "hard",   name: "困难", hpM: 1.55, dmgM: 1.40, rateM: 1.38, reward: 10, color: "#fb7185" }
  };

  /* ---------------------------------------------------------- 关卡
   * 后续加关卡：往这个数组里继续 push 即可，框架会自动生成选择卡片。 */
  LD.LEVELS = [
    {
      id: 1, name: "熔核巨龙", icon: "🐉", boss: "dragon",
      desc: "沉睡在废弃熔炉里的机械巨龙。火球封锁走位，爪击专治站桩。",
      tip: "提示：它的火球可以弹反，爪击要看红圈预警提前闪避。"
    }
  ];

  /* ---------------------------------------------------------- 巨龙数值 */
  LD.DRAGON = {
    hp: 320, r: 46, speed: 92,
    basic:  { name: "火球",     cd: 1.65, dmg: 13, speed: 400, r: 15, windup: 0.45, burst: [1, 1, 2] },
    skill1: { name: "突刺爪击", cd: 4.20, dmg: 20, windup: 0.55, dashT: 0.22, dash: 620, r: 62 },
    ult:    { name: "爆裂火焰", cd: 15.0, dmg: 26, windup: 1.15, pillars: 7, pillarR: 62, gap: 0.13, dur: 0.85 }
  };

  /* ---------------------------------------------------------- 对战规则（模式） */
  LD.TEAM_COLORS = ["#f87171", "#fbbf24", "#60a5fa", "#34d399"];
  LD.TEAM_NAMES = ["红队", "黄队", "蓝队", "绿队"];
  LD.RULES = [
    { id: "brawl", name: "乱斗模式", icon: "⚔", short: "乱斗", desc: "所有人互相为敌，最后站着的赢下回合。" },
    { id: "team", name: "阵营模式", icon: "🏳", short: "阵营", desc: "红黄蓝绿四队，同队之间互不造成伤害，最后只剩一个阵营时获胜。" },
    { id: "overlord", name: "霸主争霸", icon: "👑", short: "霸主", desc: "所有人 + 巨龙同场混战。巨龙被击败会爆出能量石并飞向随机位置，第一个抢到的人成为霸主：血量上限与当前血量翻 1.5 倍，头顶加皇冠；人机仇恨会转向霸主。" }
  ];
  LD.ruleInfo = (id) => LD.RULES.find(r => r.id === id) || LD.RULES[0];

  /* 全部默认值就绪后再应用平衡配置覆盖 */
  LD.applyBalance();
})(window.LD = window.LD || {});
