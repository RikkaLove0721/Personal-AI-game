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

  // ---- 头部：14 款模型 × 2 配色 ----
  const headModels = [
    { model: "robot", name: "机器人", cs: [["银灰机兵", "#cbd5e1", "#22d3ee", "#334155"], ["铜橙机兵", "#d97706", "#fde68a", "#7c2d12"]] },
    { model: "boy", name: "年轻男子", cs: [["黑发少年", "#1f2937", "#0ea5e9", "#f6d0b0"], ["棕发少年", "#78350f", "#f59e0b", "#f3c9a4"]] },
    { model: "girl", name: "粉发少女", cs: [["粉发少女", "#f472b6", "#fbcfe8", "#fbdcc8"], ["蓝发少女", "#60a5fa", "#bfdbfe", "#fbdcc8"]] },
    { model: "jianghu", name: "江湖斗篷侠", cs: [["墨绿斗篷", "#14532d", "#86efac", "#e8c9a0"], ["暗红斗篷", "#7f1d1d", "#fca5a5", "#e8c9a0"]] },
    { model: "tophat", name: "高帽企业家", cs: [["玄黑高帽", "#111827", "#d4a017", "#f2cfae"], ["酒红高帽", "#7f1d1d", "#fbbf24", "#f2cfae"]] },
    { model: "panda", name: "熊猫", cs: [["墨竹熊猫", "#2f3237", "#f8fafc", "#f5f5f0"], ["赤霞熊猫", "#8c2f39", "#fde68a", "#f5f5f0"]] },
    { model: "ninja", name: "忍者", cs: [["暗夜忍者", "#1f2430", "#ef4444", "#e8c9a0"], ["青影忍者", "#134e4a", "#22d3ee", "#e8c9a0"]] },
    { model: "emperor", name: "皇帝", cs: [["冕旒皇帝", "#b8860b", "#fbbf24", "#f2cfae"], ["玄冕皇帝", "#1f2937", "#fbbf24", "#f2cfae"]] },
    { model: "cat", name: "猫", cs: [["橘猫", "#d97706", "#fde68a", "#fbdcc8"], ["灰猫", "#64748b", "#cbd5e1", "#fbdcc8"]] },
    { model: "dog", name: "狗", cs: [["柴犬", "#c2410c", "#fbbf24", "#f3d9b8"], ["哈士奇", "#475569", "#e2e8f0", "#f3d9b8"]] },
    { model: "dragon", name: "龙", cs: [["苍龙", "#0e7490", "#67e8f9", "#a5f3fc"], ["赤龙", "#b91c1c", "#fb923c", "#fecaca"]] },
    { model: "golem", name: "石头人", cs: [["岩壳石人", "#57534e", "#a8a29e", "#d6d3d1"], ["青金石人", "#1e3a5f", "#60a5fa", "#cbd5e1"]] },
    { model: "gold", name: "黄金", cs: [["黄金圣像", "#b45309", "#fcd34d", "#fde68a"], ["白金圣像", "#94a3b8", "#e2e8f0", "#f8fafc"]] },
    { model: "elder", name: "白发老者", cs: [["白发老者", "#e5e7eb", "#94a3b8", "#e8c9a0"], ["灰袍智者", "#475569", "#e2e8f0", "#e8c9a0"]] }
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

  add({ id: "parry", kind: "basic", name: "格挡", icon: "🛡", price: 0, cd: 0.4, cdText: "2/8s", dmg: 8,
        tags: ["默认携带", "反制"], parry: true,
        desc: "举盾格挡正面来的攻击并小幅反击，同时把对手打退。空放或挡下普攻 → 冷却 2 秒；挡下技能或大招 → 冷却 8 秒，判断要准。（属于普攻分类，可装在 J 槽）" });

  add({ id: "fireball", kind: "basic", name: "火球", icon: "🔥", price: 6, cd: 2.10, dmg: 12,
        tags: ["远程"], proj: { speed: 640, r: 9, life: 2.4 },
        desc: "射出追踪不佳但速度很快的火球。伤害比斩击略低，胜在安全，可以和对手拉锯。" });

  add({ id: "pistol", kind: "basic", name: "手枪", icon: "🔫", price: 6, cd: 3.0, dmg: 13,
        tags: ["远程", "直线"], proj: { speed: 820, r: 7, life: 1.6 },
        desc: "射出一发高速子弹，伤害与火球相当、飞行更快，但不带任何追踪，纯靠准头。" });

  add({ id: "rock", kind: "basic", name: "石头", icon: "⛰️", price: 6, cd: 4.0, dmg: 8,
        tags: ["远程", "眩晕"], proj: { speed: 640, r: 12, life: 2.2 }, stun: 0.4,
        desc: "丢出一块石头，伤害不高，但命中会让对手眩晕 0.4 秒——打断和起手都好用。" });

  add({ id: "mace", kind: "basic", name: "狼牙棒", icon: "🏏", price: 6, cd: 5.0, dmg: 24,
        tags: ["近战", "眩晕"], reach: 76, half: 1.15, windup: 0.3, stun: 0.4,
        desc: "举起狼牙棒蓄力 0.3 秒后砸下，范围大、伤害高，命中还会让对手眩晕 0.4 秒。前摇是可被读到的破绽。" });

  add({ id: "dashSlash", kind: "skill", name: "位移斩", icon: "💫", price: 6, cd: 4.0, dmg: 18,
        tags: ["短CD"], dash: 350, dashT: 0.22, invuln: 0.26, second: 2.0,
        desc: "向面朝方向一闪而过 350 距离，期间无敌并对路径上的敌人造成伤害。2 秒内再次使用会沿直线滑回起手原位，回程路径上的敌人也会被斩到（各结算一次）。" });

  add({ id: "laserWave", kind: "skill", name: "激光波", icon: "📡", price: 6, cd: 8, dmg: 32,
        tags: ["中CD"], charge: 1.1, range: 540, width: 128,
        desc: "蓄力 1.1 秒（期间无法移动无法转向，地面会出现预警光带，方向锁定为出手朝向）后向前轰出一道贯穿型激光，范围大，适合封走位。蓄力中双击方向键可直接取消该技能。" });

  add({ id: "windBlade", kind: "skill", name: "风刃", icon: "🌪", price: 6, cd: 5.5, dmg: 16,
        tags: ["中CD", "定身"], proj: { speed: 560, r: 34, life: 2.4 }, root: 2.0,
        desc: "打出一道大范围龙卷风，命中后定身对手 2 秒（对方仍可放技能），是抓人的好手段。" });

  add({ id: "meditate", kind: "skill", name: "冥思", icon: "🧘", price: 6, cd: 4.5, dmg: 0,
        tags: ["中CD", "回复"], heal: 11,
        desc: "按住技能进入冥想持续回血，期间无法移动与攻击。松开或被攻击都会打断并进入冷却；被打断时自己还会眩晕 1 秒。" });

  add({ id: "rockShield", kind: "skill", name: "岩土盾", icon: "🧱", price: 6, cd: 8.0, dmg: 16,
        tags: ["长CD", "护盾"], shield: 36, dur: 3.0, breakR: 78,
        desc: "在自身生成一个可吸收 36 点伤害的岩石护盾，持续 3 秒。护盾被打破时对近身敌人造成 16 点伤害；若护盾是被敌人主动打爆的，自己还会眩晕 0.6 秒——开盾时机要算准。" });

  add({ id: "dragonPalm", kind: "skill", name: "神龙掌", icon: "🐲", price: 6, cd: 8.0, dmg: 24,
        tags: ["中CD", "吸弹"], proj: { speed: 300, r: 92, life: 3.2 }, absorb: 20,
        desc: "推出一个缓慢前进的巨大掌印，会吸收沿途的远程攻击（最多吸收 20 点伤害，超出则掌印提前消失），命中时爆炸。对手越爱放远程，它越强。" });

  add({ id: "meatRush", kind: "skill", name: "肉弹冲击", icon: "💥", price: 6, cd: 8.0, dmg: 20,
        tags: ["中CD", "加速"], dur: 3.0, mul: 1.9, stun: 0.4,
        desc: "全身涌起金光，移速大幅提升持续 3 秒，撞到对手造成伤害、撞飞并眩晕 0.4 秒，随后立刻进入冷却。" });

  add({ id: "flyingRaijin", kind: "skill", name: "飞雷神", icon: "🌀", price: 6, cd: 6.0, dmg: 26,
        tags: ["中CD", "二段"], proj: { speed: 420, r: 10, life: 1.4 }, boomR: 78,
        desc: "向前方掷出一枚中速飞镖（本身不造成伤害），再按一次技能键即可瞬间闪到飞镖处并引发爆炸，造成 26 点伤害。进可攻退可撤。" });

  add({ id: "dung", kind: "skill", name: "粪击", icon: "💩", price: 6, cd: 7.0, dmg: 20,
        tags: ["中CD", "致盲"], proj: { speed: 420, r: 26, life: 2.6 }, blind: 3.0,
        desc: "向前方中速扔出一大坨东西，命中造成 20 点伤害，并让对手的视野被糊住 3 秒（行动不受限，只是看不见）。" });

  add({ id: "blink", kind: "skill", name: "瞬身", icon: "✨", price: 6, cd: 7.5, dmg: 16,
        tags: ["长CD", "瞬移", "护盾"], charge: 0.85, shield: 20, shieldT: 2.0,
        desc: "蓄力时浑身红光，随后瞬移到对手身旁并造成伤害，瞬移后还会获得一个能吸收 20 点伤害、持续 2 秒的护盾。蓄力期间被打会眩晕 0.6 秒，属于高风险高回报。" });

  add({ id: "substitute", kind: "skill", name: "替身", icon: "🎭", price: 6, cd: 5.0, dmg: 24,
        tags: ["中CD", "陷阱"], back: 155, fuse: 1.0, bombR: 118, stun: 0.6,
        desc: "向后快速位移并在原地留下一颗炸弹，1 秒后爆炸，范围很大，被炸到的人会眩晕 0.6 秒。用来拉开距离、逼对手不敢追。" });

  add({ id: "bloodSlash", kind: "skill", name: "嗜血斩", icon: "🩸", price: 6, cd: 8.0, dmg: 26,
        tags: ["长CD", "吸血"], dash: 265, dashT: 0.2, selfCost: 12, heal: 18,
        desc: "燃烧自身 12 点生命向前突进一大段距离，穿过对手造成重创并回复生命。血少时慎用。" });

  add({ id: "frostWalk", kind: "skill", name: "冰霜行者", icon: "❄️", price: 6, cd: 8.0, dmg: 0,
        tags: ["中CD", "领域"], dur: 4.0, tick: 0.3, tickDmg: 6, zoneR: 24, zoneLife: 4.0, slow: 0.45,
        desc: "开启后 4 秒内，走过的位置都会结出冰痕（持续 4 秒后消融）。敌人踩在冰痕上每 0.3 秒受 6 点冻伤并被减速——把对手遛进你的冰原里。" });

  add({ id: "cang", kind: "skill", name: "苍", icon: "🌀", price: 6, cd: 7.0, dmg: 16,
        tags: ["中CD", "聚拢"], range: 240, slow: 1.0,
        desc: "以自身为中心掀起蓝色涡流，把一定范围内的敌人全部吸到自己身边并造成 16 点伤害和 1 秒减速。团战里一吸三，堪称节奏发动机。" });

  add({ id: "he", kind: "skill", name: "赫", icon: "💥", price: 6, cd: 8.0, dmg: 20,
        tags: ["中CD", "击飞"], range: 210, kbDist: 400,
        desc: "脚下的红色纹路轰然炸开，把周围敌人击飞出去 400 距离并造成 20 点伤害。被围住时的解场技，也能把对手轰出你的攻击范围。" });

  add({ id: "boomerang", kind: "skill", name: "回旋镖", icon: "🥏", price: 6, cd: 5.0, dmg: 20,
        tags: ["短CD", "双段"], proj: { speed: 480, r: 12, life: 4.0 }, backSpeed: 780, maxDist: 330, backDmg: 26,
        desc: "中速掷出回旋镖，飞到尽头后高速折返并始终追踪你。去程碰到敌人造成 20 点伤害，回程命中 26 点。扔出后你可以自由走位，镖回到手上才进入冷却。" });

  add({ id: "fireAura", kind: "skill", name: "火男", icon: "🔥", price: 6, cd: 7.0, dmg: 0,
        tags: ["中CD", "领域"], dur: 4.0, tick: 0.3, tickDmg: 6, auraR: 110, moveMul: 0.85,
        desc: "开启后 4 秒内周身燃起熊熊红焰，靠近你的敌人每 0.3 秒被烧掉 6 点生命。期间自身移速略微降低——追着人跑就是移动炼狱，但别指望能追上满血的对手。" });

  add({ id: "stealth", kind: "skill", name: "隐匿", icon: "👻", price: 6, cd: 8.0, dmg: 0,
        tags: ["长CD", "隐身"], dur: 4.0, flashAt: 2.0, flashDur: 0.4, shield: 14, shieldT: 2.0,
        desc: "开启后 4 秒内进入隐身：你自己的视角是半透明并带有蓝色灵光环绕（只有你能看见），敌人则完全看不见你。第 2 秒你会闪现 0.4 秒原形提醒对手。隐身期间使用普攻或技能会立刻现形并进入冷却；隐身结束后你会获得一个能吸收 14 点伤害、持续 2 秒的护盾。" });

  add({ id: "hbomb", kind: "skill", name: "高压炸弹", icon: "🧨", price: 6, cd: 8.0, dmg: 34, selfDmg: 20,
        tags: ["长CD", "倒计时"], fuse: 4.0, boomR: 150, noAI: true,
        desc: "按下后掏出一颗炸弹开始 4 秒倒计时（倒计时就写在炸弹旁边），再按一次朝前方中速扔出，飞行一段距离后停下。倒计时归零时大范围爆炸，敌人受 34 点伤害——注意，你自己离得太近也会被炸掉 20 点！留在手里就是自爆。" });

  add({ id: "splitArrow", kind: "skill", name: "穿云箭", icon: "🏹", price: 6, cd: 7.0, dmg: 15,
        tags: ["长CD", "二段"], proj: { speed: 760, r: 8, life: 1.4 }, splitDmg: 6, splitN: 6, splitLife: 500,
        desc: "中高速射出一只箭，命中造成 15 点伤害并消失。如果在命中前再按一次，箭会散成六只小箭（每只 6 点伤害），散箭飞行 500 距离。一箭定乾坤，散箭封走位。" });

  add({ id: "hook", kind: "skill", name: "钩索", icon: "🧲", price: 6, cd: 7.0, dmg: 22,
        tags: ["长CD", "控制"], proj: { speed: 620, r: 11, life: 1.25 }, pullDist: 400, stun: 0.8,
        desc: "向远方扔出钩子，命中造成 22 点伤害和 0.8 秒眩晕，并把对手朝自己拖回最多 400 距离。钩中就是一套带走。" });

  add({ id: "voidSlash", kind: "ult", name: "虚空爆裂斩", icon: "🌀", price: 10, cd: 1.0, dmg: 15,
        tags: ["大招"], charge: 0.5, proj: { speed: 400, r: 124, life: 3.0 }, tick: 0.22, tickMax: 1.3,
        desc: "蓄力后放出一道巨大剑气，每段撕扯造成 15 点伤害并间歇性眩晕，是压制之王。" });

  add({ id: "bloodRage", kind: "ult", name: "血怒", icon: "😤", price: 10, cd: 1.0, dmg: 0,
        tags: ["大招"], dur: 6.0, lifesteal: 0.5,
        desc: "开启后 6 秒内，自己造成伤害的 50% 转化为治疗量。越凶越难死。" });

  add({ id: "thousandSwords", kind: "ult", name: "千剑杀", icon: "⚔️", price: 10, cd: 1.0, dmg: 10,
        tags: ["大招"], dur: 4.0, interval: 0.28, proj: { speed: 840, r: 12, life: 1.6 },
        desc: "施放瞬间锁定朝向，4 秒内向前方直线倾泻高速剑气（每把 10 点伤害），弹道不追踪，靠走位把对手压进火力线。" });

  add({ id: "prison", kind: "ult", name: "绝望囚牢", icon: "⛓️", price: 10, cd: 1.0, dmg: 0,
        tags: ["大招", "控场"], dur: 4.0, zoneR: 180, formT: 0.8,
        desc: "以自身为中心画出一个束缚圈，0.8 秒后囚牢成形（有预警圈），持续 4 秒：圈内对手的技能与大招被禁用（普攻不受影响，冷却照常恢复）；囚牢是一堵圆形的墙，除了你，其他玩家都无法进出——但不会被吸到圈壁上，站位自由。束缚圈与场地边界都视作墙体。" });

  add({ id: "eatDust", kind: "ult", name: "败者食尘", icon: "⏳", price: 10, cd: 1.0, dmg: 0,
        tags: ["大招", "回复"], back: 3.0,
        desc: "时间倒流：把自己的血量和位置同时回溯到 3 秒前。刚被一套打残、被逼到死角？吃尘吧。" });

  add({ id: "waterOrbs", kind: "ult", name: "水之呼吸", icon: "💧", price: 10, cd: 1.0, dmg: 10,
        tags: ["大招", "防御"], dur: 5.0, orbR: 24, orbitR: 78, spd: 2.6, tick: 0.45, absorbMax: 12, hitPad: 32,
        desc: "开启后 5 秒内三颗水球环绕自身中速旋转：碰到敌人造成 10 点伤害并减速，敌方飞行物碰到水球会被吸收——每颗水球最多吸收 12 点伤害，吸满就碎。" });

  add({ id: "kingDrop", kind: "ult", name: "王从天降", icon: "👑", price: 10, cd: 1.0, dmg: 50,
        tags: ["大招", "二段"], rise: 1.0, boomR: 170, stun: 1.0, noAI: true,
        desc: "第一次按下在脚下画一个大范围红圈记号（只有你自己看得见，此时不放演出）。再按一次触发：你原地飞起，1 秒后（此刻红圈才会出现在所有人视野里）瞬移到红圈处轰然落地，圈内敌人受 50 点伤害并眩晕 1 秒。飞起过程无敌，但期间你被定在原地不能移动、也不能使用其他技能，是纯粹的蓄力赌注。" });

  add({ id: "shuriken", kind: "ult", name: "螺旋手里剑", icon: "🌀", price: 10, cd: 1.0, dmg: 12,
        tags: ["大招", "控场"], tick: 0.35, speed: 250, r: 54, life: 4.5, pull: 130, pullR: 175,
        desc: "朝锁定方向掷出一颗中速飞行的巨大蓝色能量球，飞行 4.5 秒。球体把附近的敌人朝自己拽过来（中度吸引），并每 0.35 秒造成 12 点持续伤害——吸住就出不去，是最强的控场大招之一。" });

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
    if (B.BOSS && B.BOSS.ninja && LD.BOSS) deep(LD.BOSS.ninja, B.BOSS.ninja);
    if (B.BOSS && B.BOSS.gun && LD.BOSS) deep(LD.BOSS.gun, B.BOSS.gun);
    if (B.diff) {
      if (B.diff.normal && LD.DIFF) deep(LD.DIFF.normal, B.diff.normal);
      if (B.diff.hard && LD.DIFF) deep(LD.DIFF.hard, B.diff.hard);
    }
    if (B.gifts && LD.GIFTS) deep(LD.GIFTS, B.gifts);
    const sk = B.skills || {};
    (LD.SKILLS || []).forEach(s => { if (sk[s.id]) deep(s, sk[s.id]); });
  };
  LD.skillsBy = (kind) => S.filter(s => s.kind === kind);
  LD.SKILL_IMPL = {};   // 由 40_battle.js 填充

  // 新档默认携带（v2.0 起格挡属于普攻分类，J 槽只能装一个，默认给斩击）
  LD.DEFAULT_LOADOUT = { basic: "slash", skill1: null, skill2: null, ult: null };

  /* ---------------------------------------------------------- 难度
   * v2.5：困难模式血量统一为普通的 2 倍，且技能释放频率更高 */
  LD.DIFF = {
    normal: { key: "normal", name: "普通", hpM: 1.00, dmgM: 1.00, rateM: 1.00, reward: 4,  color: "#34d399" },
    hard:   { key: "hard",   name: "困难", hpM: 2.00, dmgM: 1.40, rateM: 1.60, reward: 10, color: "#fb7185" }
  };

  /* ---------------------------------------------------------- 关卡
   * 后续加关卡：往这个数组里继续 push 即可，框架会自动生成选择卡片。
   * v2.5 起怪物统一按「1 普攻 + 2 技能 + 1 大招」的规格设计。 */
  LD.LEVELS = [
    {
      id: 1, name: "熔核巨龙", icon: "🐉", boss: "dragon",
      desc: "沉睡在废弃熔炉里的机械巨龙。火球封锁走位，爪击专治站桩。",
      tip: "提示：它的火球可以弹反，爪击要看红圈预警提前闪避。"
    },
    {
      id: 2, name: "神秘黑侠客", icon: "🥷", boss: "ninja",
      desc: "暗影中的飞镖刺客。会召唤出与自己一模一样的分身共同进攻——打在分身上的伤害全部白费，认错人就是白给。",
      tip: "提示：分身不会放暗影分身（不能召唤分身的分身）；被螺旋手里剑吸住要立刻垂直走位逃出吸力范围。"
    },
    {
      id: 3, name: "西部快枪手", icon: "🤠", boss: "gun",
      desc: "枪速快到看不清的荒野枪手。全程持续开枪，还会扔炸弹与连环十响；开大后隐身 8 秒，隐身期间照常开枪且不现形——听声辨位吧。",
      tip: "提示：隐身中的枪手完全看不见，但子弹会暴露他的大致方位；贴脸时他也会慌着扔炸弹。"
    }
  ];

  /* ---------------------------------------------------------- 新 BOSS 数值
   * v2.5 新增两个人形 BOSS（沿用勇者骨架驱动，配装为 boss 专属技能）。
   * look 是固定外观；speedMul 相对普通勇者移速的倍率。 */
  LD.BOSS = {
    dragon: null,     // 巨龙走独立的 LD.DRAGON / mkDragon 通道
    ninja: {
      name: "神秘黑侠客", hp: 150, speedMul: 1.08,
      loadout: { basic: "n_shuriken", skill1: "n_clone", skill2: "n_raid", ult: "n_ult" },
      look: { head: { model: "ninja", c1: "#111827", c2: "#22d3ee", c3: "#e8c9a0" },
              upper: { c1: "#111827", c2: "#334155" }, lower: { c1: "#0b1220", c2: "#1f2937" } },
      basic:  { name: "飞镖",     cd: 1.30, dmg: 9,  speed: 700, r: 9, life: 2.2 },
      skill1: { name: "暗影分身", cd: 10.0, dmg: 0,  dur: 6.0 },
      skill2: { name: "突袭",     cd: 7.0,  dmg: 12, windup: 0.4, hits: 3, gap: 0.17, reach: 96 },
      ult:    { name: "螺旋手里剑", cd: 20.0, ultFirst: 10, dmg: 12, tick: 0.35,
                speed: 250, r: 54, life: 4.5, pull: 130, pullR: 175 }
    },
    gun: {
      name: "西部快枪手", hp: 190, speedMul: 1.05,
      loadout: { basic: "g_shot", skill1: "g_bomb", skill2: "g_burst", ult: "g_ghost" },
      look: { head: { model: "tophat", c1: "#7f1d1d", c2: "#fbbf24", c3: "#f2cfae" },
              upper: { c1: "#b45309", c2: "#fde68a" }, lower: { c1: "#3f3222", c2: "#1c1917" } },
      basic:  { name: "快枪",     cd: 1.00, dmg: 8, speed: 860, r: 7, life: 1.5 },
      skill1: { name: "炸弹投掷", cd: 6.00, dmg: 22, fuse: 1.05, boomR: 112 },
      skill2: { name: "连环十响", cd: 8.00, dmg: 7, n: 10, gap: 0.07, spread: 0.15, speed: 900, r: 6, life: 1.3 },
      ult:    { name: "幻影隐身", cd: 26.0, ultFirst: 12, dur: 8.0 }
    }
  };

  /* ---------------------------------------------------------- 天外来物（掉落模式）参数 */
  LD.GIFTS = {
    skillEvery: 10,      // 每 10 秒降落一个技能
    ultEvery: 20,        // 每 20 秒降落一个大招
    firstSkill: 3,       // 首个技能掉落延迟（别让开局太空）
    firstUlt: 8,         // 首个大招掉落延迟
    fallT: 2.0,          // 降落过程耗时：图标出现到落地可拾取共 2 秒
    maxSkill: 3,         // 场上最多同时 3 个技能掉落物
    maxUlt: 2,           // 场上最多同时 2 个大招掉落物
    pickR: 30,           // 拾取判定半径（加在人物半径上）
    swapDelay: 0.3       // 置换延迟：按键先照常出手，0.3 秒后完成置换
  };

  /* ---------------------------------------------------------- 巨龙数值
   * v2.3 大幅削弱：血量 100、全技能 CD 加长 / 伤害下调、爆裂火焰前摇更长（可躲） */
  LD.DRAGON = {
    hp: 100, r: 46, speed: 92,
    basic:  { name: "火球",     cd: 2.60, dmg: 10, speed: 400, r: 15, windup: 0.60, burst: [1, 1, 2] },
    skill1: { name: "突刺爪击", cd: 6.00, dmg: 14, windup: 0.70, dashT: 0.22, dash: 620, r: 62 },
    ult:    { name: "爆裂火焰", cd: 42.0, dmg: 12, ultFirst: 14, windup: 1.60, pillars: 6, pillarR: 62, gap: 0.16, dur: 0.85, warn: 0.9 }
  };

  /* ---------------------------------------------------------- 对战规则（模式） */
  LD.TEAM_COLORS = ["#f87171", "#fbbf24", "#60a5fa", "#34d399"];
  LD.TEAM_NAMES = ["红队", "黄队", "蓝队", "绿队"];
  LD.RULES = [
    { id: "brawl", name: "乱斗模式", icon: "⚔", short: "乱斗", desc: "所有人互相为敌，最后站着的赢下回合。" },
    { id: "team", name: "阵营模式", icon: "🏳", short: "阵营", desc: "红黄蓝绿四队，同队之间互不造成伤害，最后只剩一个阵营时获胜。" },
    { id: "overlord", name: "霸主争霸", icon: "👑", short: "霸主", desc: "所有人 + 巨龙同场混战。巨龙被击败会爆出能量石并飞向随机位置，第一个抢到的人成为霸主：血量上限与当前血量翻 1.5 倍，头顶加皇冠；人机仇恨会转向霸主。霸主阵亡后能量石直接消散，不再掉落。" },
    { id: "gifts", name: "天外来物", icon: "☄️", short: "天外", desc: "开局只有普攻，技能与大招全靠天上降落：每 10 秒落一个技能、20 秒落一个大招，碰到即装备（K/L 两格，满了按键置换，被换下的留在原地）。最后活着的人获胜。" }
  ];
  LD.ruleInfo = (id) => LD.RULES.find(r => r.id === id) || LD.RULES[0];

  /* 全部默认值就绪后再应用平衡配置覆盖 */
  LD.applyBalance();
})(window.LD = window.LD || {});
