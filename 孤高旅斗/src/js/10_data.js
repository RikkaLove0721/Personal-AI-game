/* ============================================================
 *  10_data.js — 全局配置 / 部件目录 / 技能目录 / 关卡
 * ============================================================ */
(function (LD) {
  "use strict";

  LD.CONF = {
    W: 960, H: 600,
    hero: { hp: 200, speed: 195, r: 15 },
    // 能量：命中敌人、被击中都回能，另加少量自然回复
    energy: { max: 150, onHit: 12, onHurt: 10, regen: 2.2, packGain: 60 },   // 大招需攒满 150
    critRate: 0.10, critMul: 2,
    dodge: { cd: 2.5, dist: 96 },                              // 双击方向键闪避
    parry: { cdBasic: 2, cdSkill: 8 },                         // 格挡反制：挡普攻 / 挡技能大招
    hitstop: { hit: 0.055, parry: 0.09, ult: 0.16 },
    shake: { hit: 4, parry: 11, ult: 16, dash: 5 },
    ultCinematic: 2.6,          // 大招演出时长（秒）
    body: { headR: 15, torsoW: 26, torsoH: 24, legH: 18 }
  };

  /* ---------------------------------------------------------- v2.7 世界尺寸
   * 所有对战模式统一的大地图（当前 1200 x 1200），视口仍是 960 x 600：
   * 人物固定在屏幕中心、背景随人物滚动，只有贴到地图边界时视口才停住、人物才开始偏移。
   * pt 是「地面线」——世界坐标 y 小于 pt 的区域属于天空/不可行走区。 */
  LD.WORLD = { w: 1200, h: 1200, pt: 120 };

  /* ---------------------------------------------------------- 部件目录
   * 每个部件 6 金币。玩家 = 头部 + 上身 + 下身，三段式自由搭配。 */
  const P = [];
  const push = (o) => P.push(o);

  // ---- 头部：14 款模型（v2.8 起同一模型只保留一种配色，去掉重复的换色版） ----
  const headModels = [
    { model: "robot", name: "机器人", c: ["银灰机兵", "#cbd5e1", "#22d3ee", "#334155"] },
    { model: "boy", name: "年轻男子", c: ["黑发少年", "#1f2937", "#0ea5e9", "#f6d0b0"] },
    { model: "girl", name: "粉发少女", c: ["粉发少女", "#f472b6", "#fbcfe8", "#fbdcc8"] },
    { model: "jianghu", name: "江湖斗篷侠", c: ["墨绿斗篷", "#14532d", "#86efac", "#e8c9a0"] },
    { model: "tophat", name: "高帽企业家", c: ["玄黑高帽", "#111827", "#d4a017", "#f2cfae"] },
    { model: "panda", name: "熊猫", c: ["墨竹熊猫", "#2f3237", "#f8fafc", "#f5f5f0"] },
    { model: "ninja", name: "忍者", c: ["暗夜忍者", "#1f2430", "#ef4444", "#e8c9a0"] },
    { model: "emperor", name: "皇帝", c: ["冕旒皇帝", "#b8860b", "#fbbf24", "#f2cfae"] },
    { model: "cat", name: "猫", c: ["橘猫", "#d97706", "#fde68a", "#fbdcc8"] },
    { model: "dog", name: "狗", c: ["柴犬", "#c2410c", "#fbbf24", "#f3d9b8"] },
    { model: "dragon", name: "龙", c: ["苍龙", "#0e7490", "#67e8f9", "#a5f3fc"] },
    { model: "golem", name: "石头人", c: ["岩壳石人", "#57534e", "#a8a29e", "#d6d3d1"] },
    { model: "gold", name: "黄金", c: ["黄金圣像", "#b45309", "#fcd34d", "#fde68a"] },
    { model: "elder", name: "白发老者", c: ["白发老者", "#e5e7eb", "#94a3b8", "#e8c9a0"] }
  ];
  headModels.forEach(m => push({
    id: "h_" + m.model + "_0", part: "head", model: m.model, price: 6,
    name: m.c[0], c1: m.c[1], c2: m.c[2], c3: m.c[3], star: m.model === "robot"
  }));

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

  // ---- v2.8 新版图片皮肤：高清贴图三件套（套装散件同样出现在上面三个部件页） ----
  // img 字段对应构建注入的 window.LD_SKIN_IMG 键名；c1/c2/c3 是贴图未加载时的兜底色。
  // 贴图统一规格（颈面锚点制）见 scripts/proc_skin.py 头部注释：
  //   头部底边锚 (0,-40)、上身顶边锚 (0,-40)、下身底边锚 (0,0)，中轴 x=0，绘制顺序 下→上→头。
  push({ id: "h_naiwa", part: "head", img: "naiwa_head", price: 8, suit: "naiwa",
         name: "奶蛙头套", c1: "#f7de8b", c2: "#e8c25a", c3: "#f7de8b" });
  push({ id: "u_naiwa", part: "upper", img: "naiwa_upper", price: 8, suit: "naiwa",
         name: "奶蛙抱臂圆身", c1: "#f7de8b", c2: "#f5e9c8" });
  push({ id: "l_naiwa", part: "lower", img: "naiwa_lower", price: 8, suit: "naiwa",
         name: "奶蛙扁脚短腿", c1: "#f7de8b", c2: "#a8946a" });
  // 五条悟：黑色高领长袖 + 圆墨镜 + 蓬松黑发，插兜站姿（手臂不参与摆动，符合角色设定）
  push({ id: "h_gojo", part: "head", img: "gojo_head", price: 8, suit: "gojo",
         name: "五条悟头", c1: "#17181c", c2: "#e8c9a0", c3: "#17181c" });
  push({ id: "u_gojo", part: "upper", img: "gojo_upper", price: 8, suit: "gojo",
         name: "五条悟高领衣", c1: "#1b1d24", c2: "#101116" });
  push({ id: "l_gojo", part: "lower", img: "gojo_lower", price: 8, suit: "gojo",
         name: "五条悟黑裤", c1: "#141519", c2: "#0a0a0d" });
  // 豆包：棕色波波头大眼女孩 + 白扣黑上衣 + 黑色长裤（半身参考图 AI 补全的下半身）
  push({ id: "h_doubao", part: "head", img: "doubao_head", price: 8, suit: "doubao",
         name: "豆包头", c1: "#4a3226", c2: "#fbe3d0", c3: "#4a3226" });
  push({ id: "u_doubao", part: "upper", img: "doubao_upper", price: 8, suit: "doubao",
         name: "豆包小黑衣", c1: "#1d1e22", c2: "#f5f0ea" });
  push({ id: "l_doubao", part: "lower", img: "doubao_lower", price: 8, suit: "doubao",
         name: "豆包黑长裤", c1: "#17181c", c2: "#0c0c10" });
  // 科比：深肤色 + 黄色湖人 24 号球衣球裤 + 黑白篮球鞋
  push({ id: "h_kobe", part: "head", img: "kobe_head", price: 8, suit: "kobe",
         name: "科比头", c1: "#3a2a20", c2: "#5c4033", c3: "#241a12" });
  push({ id: "u_kobe", part: "upper", img: "kobe_upper", price: 8, suit: "kobe",
         name: "湖人24号球衣", c1: "#f5c518", c2: "#552583" });
  push({ id: "l_kobe", part: "lower", img: "kobe_lower", price: 8, suit: "kobe",
         name: "湖人黄球裤", c1: "#f5c518", c2: "#552583" });
  // 鲲鲲：黑色中分长发 + 黑长袖白背带 + 灰裤黑鞋，怀里抱着一颗篮球
  push({ id: "h_kunkun", part: "head", img: "kunkun_head", price: 8, suit: "kunkun",
         name: "鲲鲲头", c1: "#1a1a1c", c2: "#f5dfd0", c3: "#1a1a1c" });
  push({ id: "u_kunkun", part: "upper", img: "kunkun_upper", price: 8, suit: "kunkun",
         name: "鲲鲲背带衣", c1: "#1d1d20", c2: "#f0ede8" });
  push({ id: "l_kunkun", part: "lower", img: "kunkun_lower", price: 8, suit: "kunkun",
         name: "鲲鲲灰长裤", c1: "#8a8a8e", c2: "#5f5f63" });
  // 袋鼠：黄色圆润大耳朵袋鼠玩偶，米白肚皮、棕色鼻子、直立站姿
  push({ id: "h_daishu", part: "head", img: "daishu_head", price: 8, suit: "daishu",
         name: "袋鼠头", c1: "#f0b429", c2: "#e39b12", c3: "#f0b429" });
  push({ id: "u_daishu", part: "upper", img: "daishu_upper", price: 8, suit: "daishu",
         name: "袋鼠圆肚", c1: "#f0b429", c2: "#f7ebc8" });
  push({ id: "l_daishu", part: "lower", img: "daishu_lower", price: 8, suit: "daishu",
         name: "袋鼠短腿", c1: "#f0b429", c2: "#d99a10" });
  // 高松灯：灰紫短发的人脸 + 企鹅身体，张开双翅的迷糊表情
  push({ id: "h_gaosongdeng", part: "head", img: "gaosongdeng_head", price: 8, suit: "gaosongdeng",
         name: "高松灯头", c1: "#8b8b9c", c2: "#fbe6da", c3: "#6f7080" });
  push({ id: "u_gaosongdeng", part: "upper", img: "gaosongdeng_upper", price: 8, suit: "gaosongdeng",
         name: "高松灯企鹅身", c1: "#e9e4d2", c2: "#1d2430" });
  push({ id: "l_gaosongdeng", part: "lower", img: "gaosongdeng_lower", price: 8, suit: "gaosongdeng",
         name: "高松灯小短腿", c1: "#e9e4d2", c2: "#e08a2e" });
  // 高雅人士：戴墨镜的西装企鹅，双手叉腰抱着白色公文
  push({ id: "h_gaoya", part: "head", img: "gaoya_head", price: 8, suit: "gaoya",
         name: "高雅人士头", c1: "#2a2d33", c2: "#f5c518", c3: "#1f2227" });
  push({ id: "u_gaoya", part: "upper", img: "gaoya_upper", price: 8, suit: "gaoya",
         name: "高雅人士西装身", c1: "#e9ecef", c2: "#2a2d33" });
  push({ id: "l_gaoya", part: "lower", img: "gaoya_lower", price: 8, suit: "gaoya",
         name: "高雅人士短腿", c1: "#e9ecef", c2: "#e08a2e" });
  // 胖猫：蓝色绒毛 + 大翅膀 + 蓝围巾与宝石，举爪打招呼
  push({ id: "h_pangmao", part: "head", img: "pangmao_head", price: 8, suit: "pangmao",
         name: "胖猫头", c1: "#7f9fe0", c2: "#eef2fb", c3: "#5a4a8c" });
  push({ id: "u_pangmao", part: "upper", img: "pangmao_upper", price: 8, suit: "pangmao",
         name: "胖猫毛绒身", c1: "#7f9fe0", c2: "#eef2fb" });
  push({ id: "l_pangmao", part: "lower", img: "pangmao_lower", price: 8, suit: "pangmao",
         name: "胖猫短腿", c1: "#7f9fe0", c2: "#5a72b8" });

  LD.PARTS = P;
  LD.partsBy = (part) => P.filter(p => p.part === part);
  LD.part = (id) => P.find(p => p.id === id) || null;

  /* v3.5 随机外观（人机 / 随机装扮共用）
   * 关键：图片皮肤是「只有 img、没有 model」的部件，随机时必须把 img 一起带上，
   * 否则绘制层既没有贴图也没有模型，人机会缺头 / 缺腿。 */
  LD.randomLook = function () {
    const pick = part => { const a = LD.partsBy(part); return a[(Math.random() * a.length) | 0]; };
    const head = pick("head"), upper = pick("upper"), lower = pick("lower");
    return {
      head: { model: head.model || "boy", c1: head.c1, c2: head.c2, c3: head.c3, img: head.img },
      upper: { c1: upper.c1, c2: upper.c2, img: upper.img },
      lower: { c1: lower.c1, c2: lower.c2, img: lower.img }
    };
  };

  // ---- 套装：一键购买 / 整套穿戴，散件仍可拆开混搭 ----
  LD.SUITS = [
    { id: "naiwa", name: "奶蛙", icon: "🐸", price: 18,
      desc: "人气吉祥物奶蛙：圆胖抱臂、奶油肚皮、扁平大脚。三件高清贴图，整套穿或拆开混搭都行。",
      pieces: { head: "h_naiwa", upper: "u_naiwa", lower: "l_naiwa" } },
    { id: "gojo", name: "五条悟", icon: "🕶", price: 18,
      desc: "黑发墨镜的高领咒术师：蓬松上翘的黑发、双手插兜、一身利落黑衣。三件高清贴图，整套穿或拆开混搭都行。",
      pieces: { head: "h_gojo", upper: "u_gojo", lower: "l_gojo" } },
    { id: "doubao", name: "豆包", icon: "👧", price: 18,
      desc: "棕色波波头的大眼女孩：白扣小黑衣配黑色长裤，元气满满。三件高清贴图，整套穿或拆开混搭都行。",
      pieces: { head: "h_doubao", upper: "u_doubao", lower: "l_doubao" } },
    { id: "kobe", name: "科比", icon: "🏀", price: 18,
      desc: "紫金传奇 24 号：黄色湖人球衣球裤、黑白色篮球鞋，笑容温暖。三件高清贴图，整套穿或拆开混搭都行。",
      pieces: { head: "h_kobe", upper: "u_kobe", lower: "l_kobe" } },
    { id: "kunkun", name: "鲲鲲", icon: "🎵", price: 18,
      desc: "黑色中分背带少年：黑长袖配白背带、灰裤黑鞋，怀里抱着一颗心爱的篮球。三件高清贴图，整套穿或拆开混搭都行。",
      pieces: { head: "h_kunkun", upper: "u_kunkun", lower: "l_kunkun" } },
    { id: "daishu", name: "袋鼠", icon: "🦘", price: 18,
      desc: "黄色圆润的呆萌袋鼠玩偶：大耳朵竖起、米白肚皮、棕色椭圆鼻子，直立站姿。三件高清贴图，整套穿或拆开混搭都行。",
      pieces: { head: "h_daishu", upper: "u_daishu", lower: "l_daishu" } },
    { id: "gaosongdeng", name: "高松灯", icon: "🎤", price: 18,
      desc: "灰紫短发配企鹅身子：张开双翅、张着嘴的迷糊表情，站都站不太稳。三件高清贴图，整套穿或拆开混搭都行。",
      pieces: { head: "h_gaosongdeng", upper: "u_gaosongdeng", lower: "l_gaosongdeng" } },
    { id: "gaoya", name: "高雅人士", icon: "🐧", price: 18,
      desc: "墨镜西装企鹅：双手叉腰、怀里抱着一叠白公文，气场两米八。三件高清贴图，整套穿或拆开混搭都行。",
      pieces: { head: "h_gaoya", upper: "u_gaoya", lower: "l_gaoya" } },
    { id: "pangmao", name: "胖猫", icon: "🐱", price: 18,
      desc: "蓝色绒毛大翅膀的小胖猫：蓝围巾配胸口宝石，举着爪子打招呼。三件高清贴图，整套穿或拆开混搭都行。",
      pieces: { head: "h_pangmao", upper: "u_pangmao", lower: "l_pangmao" } }
  ];
  LD.suit = (id) => (LD.SUITS || []).find(s => s.id === id) || null;
  LD.skinImgSrc = (key) => ((typeof window !== "undefined" && window.LD_SKIN_IMG) || {})[key] || null;
  // 新档免费赠送的三件
  LD.FREE = { head: "h_boy_0", upper: "u_0", lower: "l_0" };

  /* ---------------------------------------------------------- 技能目录
   * kind: basic 普攻（J） / skill 技能（K、L） / ult 大招（O，需要满能量）
   * 技能冷却分档（只针对 kind:"skill"，普攻与大招不受此限）：
   *   短CD 4-6s ／ 中CD 6-8s ／ 长CD 8-10s（区间左闭右开，8s 起算长CD）
   * tags 里的 CD 分类必须与 cd 数值一致，改数值时记得同步标签。 */
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
        tags: ["短CD", "位移", "无敌"], dash: 350, dashT: 0.22, invuln: 0.26, second: 2.0,
        desc: "向面朝方向一闪而过 350 距离，期间无敌并对路径上的敌人造成伤害。2 秒内再次使用会沿直线滑回起手原位，回程路径上的敌人也会被斩到（各结算一次）。" });

  add({ id: "laserWave", kind: "skill", name: "激光波", icon: "📡", price: 6, cd: 8, dmg: 32,
        tags: ["长CD", "蓄力", "贯穿"], charge: 1.1, range: 540, width: 128,
        desc: "蓄力 1.1 秒（期间无法移动无法转向，地面会出现预警光带，方向锁定为出手朝向）后向前轰出一道贯穿型激光，范围大，适合封走位。蓄力中双击方向键可直接取消该技能。" });

  add({ id: "windBlade", kind: "skill", name: "风刃", icon: "🌪", price: 6, cd: 5.5, dmg: 16,
        tags: ["短CD", "定身"], proj: { speed: 560, r: 34, life: 2.4 }, root: 2.0,
        desc: "打出一道大范围龙卷风，命中后定身对手 2 秒（对方仍可放技能），是抓人的好手段。" });

  add({ id: "meditate", kind: "skill", name: "冥思", icon: "🧘", price: 6, cd: 4.5, dmg: 0,
        tags: ["短CD", "回复"], heal: 11,
        desc: "按住技能进入冥想持续回血，期间无法移动与攻击。松开或被攻击都会打断并进入冷却；被打断时自己还会眩晕 1 秒。" });

  add({ id: "rockShield", kind: "skill", name: "岩土盾", icon: "🧱", price: 6, cd: 8.0, dmg: 16,
        tags: ["长CD", "护盾"], shield: 36, dur: 3.0, breakR: 78,
        desc: "在自身生成一个可吸收 36 点伤害的岩石护盾，持续 3 秒。护盾被打破时对近身敌人造成 16 点伤害；若护盾是被敌人主动打爆的，自己还会眩晕 0.6 秒——开盾时机要算准。" });

  add({ id: "dragonPalm", kind: "skill", name: "神龙掌", icon: "🐲", price: 6, cd: 8.0, dmg: 24,
        tags: ["长CD", "吸弹"], proj: { speed: 300, r: 92, life: 3.2 }, absorb: 20,
        desc: "推出一个缓慢前进的巨大掌印，会吸收沿途的远程攻击（最多吸收 20 点伤害，超出则掌印提前消失），命中时爆炸。对手越爱放远程，它越强。" });

  add({ id: "meatRush", kind: "skill", name: "肉弹冲击", icon: "💥", price: 6, cd: 8.0, dmg: 20,
        tags: ["长CD", "加速"], dur: 3.0, mul: 1.9, stun: 0.4,
        desc: "全身涌起金光，移速大幅提升持续 3 秒，撞到对手造成伤害、撞飞并眩晕 0.4 秒，随后立刻进入冷却。" });

  add({ id: "flyingRaijin", kind: "skill", name: "飞雷神", icon: "🌀", price: 6, cd: 6.0, dmg: 26,
        tags: ["中CD", "二段"], proj: { speed: 420, r: 10, life: 1.4 }, boomR: 78,
        desc: "向前方掷出一枚中速飞镖（本身不造成伤害），再按一次技能键即可瞬间闪到飞镖处并引发爆炸，造成 26 点伤害。进可攻退可撤。" });

  add({ id: "dung", kind: "skill", name: "粪击", icon: "💩", price: 6, cd: 7.0, dmg: 20,
        tags: ["中CD", "致盲"], proj: { speed: 420, r: 26, life: 2.6 }, blind: 3.0,
        desc: "向前方中速扔出一大坨东西，命中造成 20 点伤害，并让对手的视野被糊住 3 秒（行动不受限，只是看不见）。" });

  /* v3.9.1 停电夜战的固定 K 技能：蓄力 0.7 秒后掷出大型飞镖，首个命中目标吃 26 伤害 + 0.6 秒失明。
   * 失明复用粪击的 blind 通道，但只黑 0.6 秒——黑暗模式里这已经是致命的空档。
   * 注意 id 不能叫 "shuriken"：那是大招商店里的「螺旋手里剑」（IMPL.shuriken = IMPL.n_ult），
   * 同名会让技能表里后注册的大招顶掉这一条，IMPL 也会被大招实现反向覆盖。 */
  /* v4.13 失明效果改版：不再是粪击那种「糊一块棕色」，而是和夜战一样**整个屏幕直接变黑** */
  add({ id: "shurikenToss", kind: "skill", name: "手里剑", icon: "🎯", price: 6, cd: 7.0, dmg: 26,
        tags: ["中CD", "致盲"], windup: 0.7,
        proj: { speed: 920, r: 26, life: 0.85 }, blackout: 3.0,
        desc: "起手蓄力 0.7 秒（期间原地定身，方向在出手瞬间锁定），随后把一枚大型飞镖高速掷向前方。飞镖命中第一个敌人后消失，造成 26 点伤害并让对方**眼前一黑整整 3 秒**——和停电夜战一样，整个屏幕直接变黑，什么都看不见。" });

  add({ id: "blink", kind: "skill", name: "瞬身", icon: "✨", price: 6, cd: 7.5, dmg: 16,
        tags: ["中CD", "瞬移", "护盾"], charge: 0.85, shield: 20, shieldT: 2.0,
        desc: "蓄力时浑身红光，随后瞬移到对手身旁并造成伤害，瞬移后还会获得一个能吸收 20 点伤害、持续 2 秒的护盾。蓄力期间被打会眩晕 0.6 秒，属于高风险高回报。" });

  add({ id: "substitute", kind: "skill", name: "替身", icon: "🎭", price: 6, cd: 5.0, dmg: 24,
        tags: ["短CD", "陷阱"], back: 155, fuse: 1.0, bombR: 118, stun: 0.6,
        desc: "向后快速位移并在原地留下一颗炸弹，1 秒后爆炸，范围很大，被炸到的人会眩晕 0.6 秒。用来拉开距离、逼对手不敢追。" });

  add({ id: "bloodSlash", kind: "skill", name: "嗜血斩", icon: "🩸", price: 6, cd: 8.0, dmg: 26,
        tags: ["长CD", "吸血"], dash: 265, dashT: 0.2, selfCost: 12, heal: 18,
        desc: "燃烧自身 12 点生命向前突进一大段距离，穿过对手造成重创并回复生命。血少时慎用。" });

  add({ id: "frostWalk", kind: "skill", name: "冰霜行者", icon: "❄️", price: 6, cd: 8.0, dmg: 0,
        tags: ["长CD", "领域"], dur: 4.0, tick: 0.3, tickDmg: 6, zoneR: 24, zoneLife: 4.0, slow: 0.45,
        desc: "开启后 4 秒内，走过的位置都会结出冰痕（持续 4 秒后消融）。敌人踩在冰痕上每 0.3 秒受 6 点冻伤并被减速——把对手遛进你的冰原里。" });

  add({ id: "cang", kind: "skill", name: "苍", icon: "🌀", price: 6, cd: 7.0, dmg: 16,
        tags: ["中CD", "聚拢"], range: 240, slow: 1.0, wallDmg: 18,
        desc: "以自身为中心掀起蓝色涡流，把一定范围内的敌人全部吸到自己身边并造成 16 点伤害和 1 秒减速。团战里一吸三，堪称节奏发动机。" });

  add({ id: "he", kind: "skill", name: "赫", icon: "💥", price: 6, cd: 8.0, dmg: 15,
        tags: ["长CD", "击飞"], range: 210, kbDist: 400, wallDmg: 15, wallStun: 0.4,
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
        tags: ["中CD", "二段"], proj: { speed: 760, r: 8, life: 1.4 }, splitDmg: 6, splitN: 6, splitLife: 500,
        desc: "中高速射出一只箭，命中造成 15 点伤害并消失。如果在命中前再按一次，箭会散成六只小箭（每只 6 点伤害），散箭飞行 500 距离。一箭定乾坤，散箭封走位。" });

  add({ id: "hook", kind: "skill", name: "钩索", icon: "🧲", price: 6, cd: 7.0, dmg: 22,
        tags: ["中CD", "控制"], proj: { speed: 620, r: 11, life: 1.25 }, pullDist: 400, stun: 0.8,
        desc: "向远方扔出钩子，命中造成 22 点伤害和 0.8 秒眩晕，并把对手朝自己拖回最多 400 距离。钩中就是一套带走。" });

  /* ---------------- v3.1 新增技能 ---------------- */
  add({ id: "chain", kind: "skill", name: "钢链", icon: "⛓️", price: 6, cd: 7.0, dmg: 10,
        tags: ["中CD", "远程"], range: 250, charge: 0.4, farDmg: 22, farFrom: 0.66, halfW: 26,
        desc: "蓄力 0.4 秒（蓄力期间无法移动）后向前方 250 距离甩出锁链，沿途命中造成 10 点伤害；越靠近锁链末端威力越大，末端命中造成 22 点伤害。一条直线上的敌人一起吃。" });

  add({ id: "cargo", kind: "skill", name: "运货", icon: "📦", price: 6, cd: 9.5, dmg: 25,
        tags: ["长CD", "投掷", "召唤"], charge: 1.0, crateHp: 20, speed: 620, stun: 1.0,
        desc: "蓄力 1 秒后召唤一个木箱（20 血）并向前扔出：木箱飞行途中会吸收飞来的攻击，撞到人造成 25 点伤害并眩晕 1 秒，撞墙后落地变成普通可破坏木箱。再次释放时，上一个木箱会自动销毁。" });

  add({ id: "fish", kind: "skill", name: "咸鱼", icon: "🐟", price: 6, cd: 9.0, dmg: 26,
        tags: ["长CD", "吸能"], drain: 20, proj: { speed: 520, r: 15, life: 1.7 },
        desc: "向前扔出一条咸鱼，命中造成 26 点伤害，并抽取对手 20 点大招能量转化为自己的（对手不足 20 就有多少吸多少）。" });

  add({ id: "assault", kind: "skill", name: "突击枪", icon: "🔫", price: 6, cd: 10.0, dmg: 5,
        tags: ["长CD", "连射"], n: 8, gap: 0.06, range: 600, speed: 900,
        desc: "向前方 600 距离快速射出 8 发子弹，每发 5 点伤害。弹道密集、压制力强，适合封走位。" });

  add({ id: "voidSlash", kind: "ult", name: "虚空爆裂斩", icon: "🌀", price: 10, cd: 1.0, dmg: 15,
        tags: ["大招"], charge: 0.5, proj: { speed: 400, r: 124, life: 3.0 }, tick: 0.22, tickMax: 1.3,
        desc: "蓄力后放出一道巨大剑气，每段撕扯造成 15 点伤害并间歇性眩晕，是压制之王。" });

  add({ id: "bloodRage", kind: "ult", name: "血怒", icon: "😤", price: 10, cd: 1.0, dmg: 0,
        tags: ["大招", "吸血", "降伤"], dur: 6.0, lifesteal: 0.5, dmgM: 0.75,
        desc: "开启后 6 秒内，自己造成伤害的 50% 转化为治疗量，但期间造成的伤害减少 25%。越凶越难死，但爆发力也会打折扣。" });

  add({ id: "thousandSwords", kind: "ult", name: "千剑杀", icon: "⚔️", price: 10, cd: 1.0, dmg: 10,
        tags: ["大招", "穿透"], dur: 4.0, interval: 0.28, proj: { speed: 840, r: 12, life: 1.6 },
        /* v3.9 剑气穿透：命中后不消失，继续贯穿后面的目标（同一个人只吃一次） */
        pierce: true,
        desc: "施放瞬间锁定朝向，4 秒内向前方直线倾泻高速剑气（每把 10 点伤害），弹道不追踪。剑气自带穿透，命中后不会消失，会继续贯穿它后面的一切——把对手和后排一起串成一条线，才是这一招的正确用法。" });

  add({ id: "prison", kind: "ult", name: "绝望囚牢", icon: "⛓️", price: 10, cd: 1.0, dmg: 0,
        tags: ["大招", "控场"], dur: 4.0, zoneR: 180, formT: 0.8,
        desc: "以自身为中心画出一个束缚圈，0.8 秒后囚牢成形（有预警圈），持续 4 秒：圈内对手的技能与大招被禁用（普攻不受影响，冷却照常恢复）；囚牢是一堵圆形的墙，除了你，其他玩家都无法进出——但不会被吸到圈壁上，站位自由。束缚圈与场地边界都视作墙体。" });

  add({ id: "eatDust", kind: "ult", name: "败者食尘", icon: "⏳", price: 10, cd: 1.0, dmg: 0,
        tags: ["大招", "回复"], back: 3.0,
        desc: "时间倒流：把自己的血量和位置同时回溯到 3 秒前。刚被一套打残、被逼到死角？吃尘吧。" });

  add({ id: "waterOrbs", kind: "ult", name: "水之呼吸", icon: "💧", price: 10, cd: 1.0, dmg: 10,
        tags: ["大招", "防御", "吸弹"], dur: 7.0, orbR: 24, orbitR: 78, spd: 2.6, tick: 0.45, absorbMax: 12, hitPad: 32,
        desc: "开启后 7 秒内三颗水球环绕自身中速旋转：碰到敌人造成 10 点伤害并减速，敌方飞行物碰到水球会被吸收——每颗水球最多吸收 12 点伤害，吸满就碎。" });

  add({ id: "kingDrop", kind: "ult", name: "王从天降", icon: "👑", price: 10, cd: 1.0, dmg: 50,
        tags: ["大招", "二段"], rise: 1.0, boomR: 170, stun: 1.0, noAI: true,
        desc: "第一次按下在脚下画一个大范围红圈记号（只有你自己看得见，此时不放演出）。再按一次触发：你原地飞起，1 秒后（此刻红圈才会出现在所有人视野里）瞬移到红圈处轰然落地，圈内敌人受 50 点伤害并眩晕 1 秒。飞起过程无敌，但期间你被定在原地不能移动、也不能使用其他技能，是纯粹的蓄力赌注。" });

  /* ---------------- v3.1 新增大招 ---------------- */
  add({ id: "blaze", kind: "ult", name: "爆裂之火", icon: "🔥", price: 10, cd: 1.0, dmg: 13,
        tags: ["大招", "群伤", "减速"], charge: 0.6, outer: 150, inner: 55, slow: 2.5,
        dur: 2.0, drops: 12, gap: 0.16, ballR: 46, warn: 0.28,
        desc: "以自身为圆心画出 150 半径的火焰预警圈，蓄力 0.6 秒后圈内持续降下火球 2 秒，每颗火球 13 点伤害并减速 2.5 秒，火球落点有 0.28 秒预警。脚下 55 半径是安全区，贴身的人反而打不到。" });

  add({ id: "rockFist", kind: "ult", name: "流水碎岩拳", icon: "👊", price: 10, cd: 1.0, dmg: 10,
        tags: ["大招", "突进", "控制"], charge: 0.3, punches: 5, move: 200, stun: 0.16, kb: 95, reach: 86,
        desc: "蓄力 0.3 秒后向前打出五记蓝色重拳，身形随着拳势推进共 200 距离。每一拳对命中的敌人造成 10 点伤害、短暂眩晕与击退。拳头砸在墙上也不会中断，会贴着墙把这一套打完。" });

  add({ id: "goldCannon", kind: "ult", name: "黄金弹力炮", icon: "✨", price: 10, cd: 1.0, dmg: 18,
        tags: ["大招", "弹射"], dist: 2000, speed: 760, r: 8, stun: 0.25, passWall: false,
        desc: "射出一颗金色小子弹，命中墙体（包括可破坏障碍，并对其造成伤害）会像光一样弹射，总行程 2000 距离；途中每次碰到敌人都会造成 18 点伤害和短暂眩晕。" });

  add({ id: "shuriken", kind: "ult", name: "螺旋手里剑", icon: "🌀", price: 10, cd: 1.0, dmg: 12,
        tags: ["大招", "控场", "爆炸", "吸敌"], tick: 0.35, speed: 250, r: 54, life: 4.5, pull: 180, pullR: 225,
        boomDist: 520, boomR: 170, boomDmg: 25,
        desc: "朝锁定方向掷出一颗中速飞行的巨大蓝色能量球：球体把 225 范围内的敌人强力吸向自己（越近吸力越足），并每 0.35 秒造成 12 点持续伤害。能量球飞行 520 距离后（或飞满 4.5 秒）会引爆一次中范围爆炸，再造成 25 点伤害——既能聚人控场，也能补刀收割。" });

  /* ---------------------------------------------------------- 躲猫猫专用（v4.13f）
   * 这两个不是商店货：hideOnly = true 的条目会被商店与 AI 随机配装过滤掉，
   * 只在躲猫猫开局时按身份塞进 J 槽（人 = 隐匿，鬼 = 抓人）。
   * 做成「技能」而不是写死在 P 键上的好处：CD / 状态机 / HUD 的 J 槽 / 冷却读秒全部复用现成那套。 */
  add({ id: "hide_stealth", kind: "basic", name: "隐匿", icon: "🫥", price: 0, cd: 15, dmg: 0,
        tags: ["躲猫猫"], dur: 4.0, flashAt: 2.0, flashDur: 0.4, shield: 14, shieldT: 2.0,
        noAI: true, hideOnly: true,
        desc: "躲猫猫专属：4 秒内完全隐身，鬼看不见你（第 2 秒会短暂闪现一下轮廓）。冷却 15 秒。" });

  add({ id: "hide_catch", kind: "basic", name: "抓人", icon: "✋", price: 0, cd: 2.0, dmg: 100,
        tags: ["躲猫猫"], noAI: true, hideOnly: true,
        desc: "躲猫猫专属：向身边小范围伸手一抓，命中躲藏者造成 100 点伤害；对着柜子 / 草丛抓同样有效，会把人直接揪出来。冷却 2 秒。" });

  LD.SKILLS = S;
  LD.skill = (id) => S.find(s => s.id === id) || null;
  /* 商店与 AI 配装池：排除 hideOnly 的专用招式（否则玩家能在商店里装上「抓人」） */
  LD.shopSkillsBy = (kind) => S.filter(s => s.kind === kind && !s.hideOnly);

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
    },
    {
      id: 4, name: "机械蜂后", icon: "🐝", boss: "bee",
      desc: "盘踞在温室废墟的机械蜂群之心。会不断孵化自爆工蜂——先清小蜂还是先打本体，决定你的血线。",
      tip: "提示：工蜂碰到就会自爆，保持走位别被围住；蜂后血量过半会进入狂暴，孵化更快。"
    },
    {
      id: 5, name: "霜甲巨像", icon: "❄️", boss: "frost",
      desc: "雪山之巅的远古冰之守卫。寒霜领域会冻结地面拖慢你的脚步，绝对零度前必须站进它的安全圈。",
      tip: "提示：寒霜领域里移速大减，别恋战；绝对零度读条时往巨像身边跑，它脚下就是安全区。"
    },
    {
      id: 6, name: "双子剑客", icon: "⚔️", boss: "twin",
      desc: "共享一条命的孪生剑士。只有头戴真身标记的那位会吃满伤害，另一位只结算三成——每 8 秒换位互换真身。",
      tip: "提示：认准真身再出手，假身只吃 30% 伤害；换位瞬间两人位置互换，别把预判打反。"
    },
    {
      id: 7, name: "赌徒", icon: "🎲", boss: "gambler",
      desc: "把战斗当牌局的怪人。骰子伤害随机、抽牌好坏难料，出千能把你的飞行物全部打回来——俄罗斯轮盘六格落地，一格要命。",
      tip: "提示：出千发动时立刻收手停火；轮盘预警亮出一半落点，站到亮出的格子外就安全。"
    },
    {
      id: 8, name: "镜影", icon: "🪞", boss: "mirror",
      desc: "从镜中走出的另一个你：配装、皮肤与你完全相同，招式也一模一样——只是所有 CD 都比你的长三成。",
      tip: "提示：它就是你的镜子。用你最难躲的招式打它之前，先想想自己怎么躲。"
    },
    {
      id: 9, name: "磁暴坦克", icon: "🌩️", boss: "tesla",
      desc: "磁暴堡垒的心脏。极性反转会把你射出的飞行物全部拽向场地中心，电磁护盾破裂时还会放电伤人。",
      tip: "提示：极性反转期间远程弹道会被吸走，改打近身；它开盾时留着大招，破盾放电后再补伤害。"
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
    },

    /* ---------------- v2.6 新增六关怪物 ----------------
     * 通用规格不变：1 普攻 + 2 技能 + 1 大招；phase2 为血量过半的狂暴阶段。 */
    bee: {
      name: "机械蜂后", hp: 170, speedMul: 0.95,
      loadout: { basic: "b_needle", skill1: "b_hatch", skill2: "b_sweep", ult: "b_swarm" },
      look: { head: { model: "girl", c1: "#fbdcc8", c2: "#fbbf24", c3: "#fde68a" },
              upper: { c1: "#a16207", c2: "#fde68a" }, lower: { c1: "#713f12", c2: "#422006" } },
      basic:  { name: "尾针",     cd: 1.25, dmg: 7, speed: 640, r: 7, life: 2.0 },
      skill1: { name: "孵化",     cd: 9.0,  dmg: 0, n: 2 },
      skill2: { name: "蜂群冲锋", cd: 7.5,  dmg: 8, windup: 0.35, hits: 3, gap: 0.16, reach: 110 },
      ult:    { name: "蜂群倾巢", cd: 24.0, ultFirst: 12, dmg: 0, n: 5 },
      phase2: { hpPct: 0.5, rateMul: 1.3, dmgMul: 1.15 }
    },
    frost: {
      name: "霜甲巨像", hp: 240, speedMul: 0.80,
      loadout: { basic: "f_cone", skill1: "f_quake", skill2: "f_field", ult: "f_zero" },
      look: { head: { model: "boy", c1: "#dbeafe", c2: "#7dd3fc", c3: "#e0f2fe" },
              upper: { c1: "#334155", c2: "#94a3b8" }, lower: { c1: "#1e293b", c2: "#475569" } },
      basic:  { name: "冰锥",     cd: 1.50, dmg: 9, speed: 380, r: 12, life: 2.6 },
      skill1: { name: "霜压",     cd: 8.0,  dmg: 16, warn: 0.70, r: 150 },
      skill2: { name: "寒霜领域", cd: 10.0, dmg: 3, r: 175, dur: 6.0, tick: 0.5 },
      ult:    { name: "绝对零度", cd: 26.0, ultFirst: 13, dmg: 12, warn: 2.6, safeR: 210, stun: 1.5 },
      phase2: { hpPct: 0.5, rateMul: 1.35, dmgMul: 1.15 }
    },
    twin: {
      name: "双子剑客", hp: 110, speedMul: 1.12,
      loadout: { basic: "t_slash", skill1: "t_cross", skill2: null, ult: "t_duo" },
      look: { head: { model: "jianghu", c1: "#e8c9a0", c2: "#64748b", c3: "#f1f5f9" },
              upper: { c1: "#475569", c2: "#cbd5e1" }, lower: { c1: "#1e293b", c2: "#0f172a" } },
      basic:  { name: "交替突刺", cd: 1.10, dmg: 8 },
      skill1: { name: "交叉突进", cd: 7.0,  dmg: 12, windup: 0.30, reach: 130 },
      ult:    { name: "合璧斩",   cd: 25.0, ultFirst: 12, dmg: 18, windup: 0.50, reach: 160 },
      phase2: { hpPct: 0.5, rateMul: 1.3, dmgMul: 1.1 }
    },
    gambler: {
      name: "赌徒", hp: 160, speedMul: 1.00,
      loadout: { basic: "gm_dice", skill1: "gm_card", skill2: "gm_cheat", ult: "gm_roulette" },
      look: { head: { model: "tophat", c1: "#7c2d12", c2: "#22c55e", c3: "#f2cfae" },
              upper: { c1: "#065f46", c2: "#34d399" }, lower: { c1: "#1c1917", c2: "#292524" } },
      basic:  { name: "掷骰",      cd: 1.30, dmg: 9, speed: 560, r: 9, life: 2.2 },
      skill1: { name: "抽牌",      cd: 7.0,  dmg: 0 },
      skill2: { name: "出千",      cd: 9.0,  dmg: 0 },
      ult:    { name: "俄罗斯轮盘", cd: 22.0, ultFirst: 11, dmg: 40, small: 6, n: 6, warn: 1.0, r: 64 },
      phase2: { hpPct: 0.5, rateMul: 1.3, dmgMul: 1.1 }
    },
    mirror: {
      name: "镜影", hp: 150, speedMul: 1.02,
      loadout: null,              // mkBoss 运行时整套复制玩家配装（copyFrom）
      look: { head: { model: "boy", c1: "#cbd5e1", c2: "#94a3b8", c3: "#e2e8f0" },
              upper: { c1: "#64748b", c2: "#cbd5e1" }, lower: { c1: "#334155", c2: "#1e293b" } },
      basic:  null,               // 与玩家普攻相同
      skill1: null, skill2: null,
      ult:    null,               // 与玩家大招相同（BOSS 不吃能量，走 CD 制）
      cdMul: 1.3,                 // 全部 CD 为玩家的 1.3 倍
      ultCdMin: 16.0,             // 大招 CD 下限：商家大招的 cd 字段只是占位（勇者靠能量），
                                  // 镜影走 CD 制必须兜住，否则会疯狂开大
      phase2: { hpPct: 0.5, rateMul: 1.3, dmgMul: 1.1 }
    },
    tesla: {
      /* v2.7：困难模式血量下调到 300（困难统一 ×2，故基础值取 150） */
      name: "磁暴坦克", hp: 150, speedMul: 0.85,
      loadout: { basic: "ts_zap", skill1: "ts_polar", skill2: "ts_shield", ult: "ts_storm" },
      look: { head: { model: "boy", c1: "#a78bfa", c2: "#7c3aed", c3: "#ddd6fe" },
              upper: { c1: "#4c1d95", c2: "#8b5cf6" }, lower: { c1: "#2e1065", c2: "#4c1d95" } },
      basic:  { name: "电弧",     cd: 1.20, dmg: 8, speed: 1000, r: 6, life: 1.4 },
      skill1: { name: "极性反转", cd: 9.0,  dmg: 0, dur: 5.0 },
      skill2: { name: "电磁护盾", cd: 10.0, dmg: 0, shield: 60, dur: 6.0, boomR: 130, boomDmg: 10 },
      ult:    { name: "雷暴",     cd: 25.0, ultFirst: 12, dmg: 14, n: 10, warn: 1.0, r: 56 },
      phase2: { hpPct: 0.5, rateMul: 1.3, dmgMul: 1.15 }
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
    swapDelay: 0.3,      // 置换延迟：按键先照常出手，0.3 秒后完成置换
    /* v2.7 缩圈乱斗也用同一套掉落机制，但场上容量更大、节奏更密（技能 6 / 大招 3） */
    ring: {
      skillEvery: 6, ultEvery: 12, firstSkill: 3, firstUlt: 9,
      maxSkill: 6, maxUlt: 3, swapDelay: 0.3
    }
  };

  /* ---------------------------------------------------------- v2.7 血包
   * 「回复」修饰符与缩圈乱斗的圈外补给都用它。 */
  LD.HEALS = {
    amount: 45,        // 吃下一个回多少血
    every: 8,          // 每 8 秒随机掉落一个
    first: 4,          // 首个血包延迟
    fallT: 1.4,        // 降落耗时
    pickR: 32,         // 拾取判定半径
    max: 4,            // 场上最多同时存在几个
    life: 40           // 落地后 40 秒自动消失
  };

  /* ---------------------------------------------------------- v2.7 僵尸
   * 丧尸危机与「僵尸」修饰符共用：只带「突刺 / 撕咬」两个专属技能，
   * 不再抽取勇者技能池，也没有普攻、大招和闪避；100 血、移速为普通角色的 110%。 */
  LD.ZOMBIE = {
    hp: 100,                         // 固定血量
    speedMul: 1.1,                   // 移速 = 普通角色的 110%
    coin: 1,
    every: 11, first: 7, max: 6,     // 刷新节奏
    noUlt: true,                     // 兼容旧逻辑：僵尸永远没有大招
    maxCorpses: 10,                  // v3.5 场上最多保留 10 具丧尸尸体，多出来的老尸体消失
    skills: { skill1: "z_lunge", skill2: "z_bite" },   // 突刺 / 撕咬（50_ai.js 注册）
    look: { head: { model: "elder", c1: "#3f6212", c2: "#a3e635", c3: "#86efac" },
            upper: { c1: "#365314", c2: "#65a30d" }, lower: { c1: "#1a2e05", c2: "#3f6212" } }
  };

  /* ---------------------------------------------------------- v3.2 / v4.0 世界末日参数
   * 所有玩家同队（互不伤害），靠击杀僵尸 / 输出赚分，最后存活或时间到分数最高者获胜。
   * v4.0 地图重做：整张图由「左小岛（庇护所）+ 独木桥 + 右大陆（僵尸区）」三块陆地拼成，
   * 三块之外全是悬崖 —— 走位、位移、击退一律被夹回陆地，等于没有墙却处处是墙。
   * 庇护所不再砌石墙：岛缘就是地图墙，站上去不掉血反而缓慢回血，残血可以退回来喘口气。 */
  LD.DOOMSDAY = {
    world: { w: 2600, h: 1180, pt: 70 },  // 横向长图：左端放岛，右侧整块是大陆
    island: { x: 400, r: 320 },           // 庇护所小岛：圆心 x（y 恒取陆地垂直中点）+ 半径
    bridge: { len: 10, wide: 2 },         // 独木桥：10 格长 x 2 格宽（TILE=40 → 400 x 80）
    edge: 26,                            // 岛 / 大陆的留白：角色中心最多贴到离崖边这么近
    bridgeEdge: 10,                       // 桥面留白：桥只有两格宽，留白再大就走不上去了
    bridgeSlow: 0.3,                      // 僵尸过桥的移速倍率（0.3 = 减速 70%）
    gateSlow: 0.3,                        // 与 bridgeSlow 同值：僵尸在减速区里的移速倍率（复用既有减速通道）
    shelterHeal: 7,                       // 站在庇护所里每秒回血
    /* v4.2 危险区：整块右大陆等同「缩圈乱斗的圈外」，英雄站上去持续掉血（僵尸不受影响） */
    danger: { dmg: 5, tick: 0.5 },        // 每 0.5 秒扣 5 血
    sprayBase: 3.6,     // 刷怪基础间隔（秒）：存活玩家越多越快（除以存活人数）
    sprayMin: 0.9,      // 刷怪间隔下限
    maxBase: 4,         // 在场僵尸上限基准
    maxPer: 1.8,        // 每名存活玩家额外允许的僵尸数
    scoreDmg: 1,        // 对僵尸造成 1 点伤害 = 1 分
    scoreKill: 10,      // 击杀一只僵尸 = 10 分
    coin: 2,            // 击杀僵尸掉的局内金币
    /* v4.1 商店设施：末日局内商店（B 键）可买的防御建筑，买完立在脚下 */
    build: {
      fence:  { price: 6,  hp: 80 },                                    // 栅栏：挡人不挡弹
      turret: { price: 14, hp: 120, range: 300, dmg: 12, atk: 1.1,      // 小型枪台：高频点射
                projSpeed: 920, aggroR: 320 },
      cannon: { price: 22, hp: 160, range: 380, dmg: 34, atk: 3.2,      // 固定炮台：低频范围爆炸
                boomR: 90, shellT: 0.55, aggroR: 360 }
    }
  };

  /* ---------------------------------------------------------- v4.5 护送情报箱
   * 两队（左红 / 右蓝）：场中央反复投放一个 2x2 的大情报箱，箱子不能抱起来——
   * 靠近按交互键进入推箱状态，箱子跟着人朝移动方向挪，推箱时移速只有正常的 20%。
   * 被攻击会打断推箱并眩晕 1 秒、3 秒内不能再碰箱子；有人在推时再按 = 交互占用。
   * 把箱子推进【敌方】交付点就得 1 分。先到 3 分结束；时间到比分高者胜，同分比剩余总血量。 */
  LD.ESCORT = {
    world: { w: 2080, h: 1600, pt: 120 },  // v4.10 地图长度 1.3 倍（1600 → 2080），高度不变
    need: 3,             // 先到几分获胜
    goalInset: 220,      // 交付点圆心离左右边界的距离
    goalR: 110,          // 交付点半径
    boxW: 80,            // v4.10 箱子 2x2（80 x 80），不再是 30px 的小包裹
    pushRange: 96,       // 多近可以按交互键开始推箱（约两个身位）
    pushSpeed: 0.20,     // 推箱移速倍率（正常的 20%）
    stun: 1.0,           // 推箱被打断的眩晕
    noTouch: 3.0,        // 推箱被打断后，多久内不能再碰箱子
    respawn: 2.2,        // 交付后箱子重新投放的间隔
    protect: 0.8,        // 落地保护期：刚投放的箱子这么短时间内不能被推
    /* v4.11 阵亡复活：护送是推箱竞速，不该因为一次团灭就结束比赛。
     * 首次 3 秒，之后每阵亡一次 +3 秒，最长 24 秒（与占点同规格）。 */
    heroRespawn: 3.0, heroRespawnStep: 3.0, heroRespawnMax: 24
  };

  /* ---------------------------------------------------------- v4.7 占点争夺
   * 两队抢据点：站进圈里读条占领，占领后每秒产分，先到 need 分获胜。
   * v4.7 重做：
   *   - 地图 1600 → 2400（长宽各 1.5 倍）；
   *   - 据点每局随机 3~5 座，但「大点」永远在地图正中（权重 2、圈更大），
   *     小点随机撒在外围，彼此留出 minGap，也不能压在双方基地上；
   *   - 占领后据点中心升起一座炮塔（数值与塔防防御塔一致，射程 = 据点半径），
   *     易主时只换攻击目标、血量保留；炮塔被拆掉就永久消失（本局不再重建）；
   *   - 复活从 3 秒起，每次阵亡 +3 秒（上限 24 秒）；自家基地内缓慢回血。 */
  LD.CAPTURE = {
    world: { w: 1920, h: 1920, pt: 120 },   // v4.10 缩回 2400 的 80%：节奏更紧凑
    count: [3, 5],       // 每局据点总数（含中路大点）
    minGap: 576,         // 据点圆心之间的最小间距（随地图 ×0.8）
    edge: 208,           // 据点离地图边界的最小距离（随地图 ×0.8）
    baseGap: 384,        // 据点离双方基地的最小距离（随地图 ×0.8）
    big: { r: 180, w: 2, name: "B" },
    small: { r: 150, w: 1 },
    capRate: 0.20,       // 单人对空据点的占领速度（1 = 满进度，5 秒）
    contestMul: 2.0,     // 抢敌方已占领的据点：耗时 ×2（10 秒）
    stackMul: 1.0,       // v4.12 同队每多一人额外 +100%（2 人 ×2 / 3 人 ×3），人数有上限
    stackMax: 3,         // 占领加成的人数上限；多队争夺时的净值同样按此截断
    decay: 0.16,         // 圈里没人 / 己方已占领时，对方进度回落速度
    scoreRate: 1,        // 每个权重每秒产分（中央大点 2 分/秒）
    need: 80,            // 先到 80 分获胜
    tick: 0.5,           // 计分节拍
    respawn: 3.0,        // 首次阵亡复活时间
    respawnStep: 3.0,    // 每次阵亡后复活时间递增
    respawnMax: 24,      // 复活时间上限（防止后期一分钟不能动）
    invuln: 1.4,         // 复活无敌
    spawnInset: 170,     // 基地圆心离左右边界的距离
    baseR: 190,          // 基地回血圈半径
    baseHealPct: 0.05,   // 自家基地每秒回复最大生命的比例
    pointHeal: 2,        // v4.11 站在己方已占领的据点圈里，每秒回 2 滴血（原 5 太强）
    /* v4.11 据点数量规则：保底 3 座（左 / 中 / 右），之后每多 perExtra 名玩家再 +1 座，
     * 最多 maxPts 座。多出来的据点随机撒（仍受 minGap / edge / baseGap 约束）。 */
    basePts: 3, perExtra: 2, maxPts: 6,
    turretDmgMul: 0.8,   // v4.11 据点炮塔伤害 ×80%（原样照搬塔防数值偏疼）
    /* 据点炮塔：血量 / 伤害 / 攻速 / 弹速 / 追踪全部沿用塔防防御塔，
     * 射程不在这里配 —— 直接取据点半径（见 48_capture.js） */
    turret: { hp: 1200, dmg: 26, atk: 1.05, projSpeed: 1100, homing: 3.4, elev: 70 }
  };

  /* ---------------------------------------------------------- v4.8 碰碰车竞技
   * 圆环擂台（v4.10：中心也灌了一池水，可活动范围变成圆环）+ 每人一辆碰碰车：
   * 车与车对撞按接近速度结算伤害与击退，把对手撞出擂台（掉进水池，内圈外圈都是水）
   * 或撞爆他的车都能得分，先到 need 分获胜。
   * v4.10：技能与大招禁用；地图 1200 → 1600；击退随速度的增幅大幅提高；
   * 场上生成物减半、吹风机更多，气流也能吹动车。 */
  LD.BUMP = {
    world: { w: 1600, h: 1600, pt: 120 },  // v4.10 地图扩大（1200 → 1600）
    arenaMul: 0.40,      // 擂台外圈半径 = min(宽, 高 - 顶部条) × 该系数（1600 地图约 590）
    innerMul: 0.42,      // v4.10 中心水圈半径 = 外圈 × 该系数（活动范围 = 圆环）
    noSkill: true,       // v4.10 禁用技能与大招（普照常：喇叭）
    carHp: 100,          // 车辆耐久
    dmgPerSpd: 0.055,    // 撞击伤害 = 接近速度 × 系数（速度 300 → 16.5）
    dmgMin: 6, dmgMax: 30,
    selfMul: 0.35,       // 主动撞人的一方也要吃一点（对撞互损）
    minSpd: 110,         // 低于这个接近速度只是轻轻蹭开，不结算伤害
    kb: 300,             // 基础击退
    kbPerSpd: 1.5,       // v4.10 击退随接近速度的增幅大幅提高（0.62 → 1.5）
    hitCd: 0.35,         // 同一对车两次结算的最小间隔
    credit: 3.0,         // 撞击归属有效期（多久内被撞出圈算你的）
    scoreWreck: 2,       // 撞爆对方的车
    scoreDunk: 3,        // 把对方顶进水里（外圈 / 内圈都算）
    need: 12,            // 先到 12 分获胜
    respawn: 2.4,        // 落水后回到擂台的时间
    carRespawn: 4.0,     // 报废车辆的重生时间
    extraCars: 2,        // 车辆总数 = 参赛人数 + 该值（有人没车时就不会干等）
    invuln: 1.2,         // 复活后的无敌时间
    rimW: 16,            // 擂台边缘警示带宽度（视觉）
    propsKeep: 0.5,      // v4.10 场上随机生成物只保留一半
    blowers: 3,          // v4.10 环内额外摆放的吹风机数量（生成概率大幅提高）
    windCarMul: 0.35,    // v4.10 吹风机对车辆的推力系数（适度吹动）
    waterDmg: 0          // 掉进水里不再额外掉血（直接判出局）
  };

  /* ---------------------------------------------------------- v4.11 烫手山芋
   * 混战：普攻 / 技能 / 大招全部禁用（见 B.trySlot），只能靠跑位甩锅。
   * 山芋从天而降锁定一个人 → 接手 2 秒减速（传不出去）→ 之后提速 120% 去追人
   * → 碰到人就把山芋甩给他 → 引信 30 秒烧完爆炸扣血 → 重新抽人循环。 */
  LD.HOTPOTATO = {
    world: { w: 1600, h: 1600, pt: 120 },
    warn: 3.0,           // 天降前的预警时长
    drop: 0.85,          // 山芋从高空落到头顶的飞行时间
    slowT: 2.0,          // 刚接手的减速时长
    slowMul: 0.5,        // 减速到正常的 50%
    boostMul: 1.2,       // 减速结束后提速到正常的 120%
    fuse: 30,            // 引信：第 1 个山芋的倒计时（从山芋落到第一个人手上开始）
    fuseStep: 5,         // v4.12 每换一个新山芋，引信比上一个短 5 秒
    fuseMin: 15,         // v4.12 引信下限：降到 15 秒后固定，不再变短
    holderBase: 25,      // v4.12 爆炸时持有者掉血 = holderBase + 场上存活人数 × holderPerAlive
    holderPerAlive: 25,  // v4.12 场上每多一个存活玩家，持有者就多吃 25 点（人越多越疼）
    splashR: 130,        // 爆炸波及半径
    splashDmg: 50,       // 爆炸波及到的其他人掉的血（余波固定，不随人数变化）
    passR: 44,           // 传递判定：两人边缘净距小于该值即触发
    passCd: 0.5,         // 传递后的小冷却，防止一帧内来回弹
    respawn: 3.0,        // 被炸死后多久复活
    invuln: 1.2          // 复活后的无敌时间
  };

  /* ==========================================================
   *  v4.12 娱乐模式批次
   * ----------------------------------------------------------
   *  这一批（连同碰碰车 / 烫手山芋）统一叫「娱乐模式」：胜负与击杀脱钩，
   *  并且除碰碰车的喇叭外**全部禁用普攻 / 技能 / 大招**，P 键交互保留。
   *  五个新模式的数值各归各的配置块，共用一套分发器（见 49a_casual.js）。
   *  v4.13：冰面滑壶因玩法和碰碰车高度重复已删除。
   * ========================================================== */
  LD.CASUAL = ["statue", "chair", "hide", "lava", "barrage"];
  LD.ENTERTAIN = ["bump", "hotpotato"].concat(LD.CASUAL);
  LD.isCasual = function (rule) { return LD.CASUAL.indexOf(rule) >= 0; };
  LD.isEntertain = function (rule) { return LD.ENTERTAIN.indexOf(rule) >= 0; };
  LD.casualWorld = function (rule) {
    const M = { statue: LD.STATUE, chair: LD.CHAIR, hide: LD.HIDE, lava: LD.LAVA, barrage: LD.BARRAGE };
    const c = M[rule];
    return (c && c.world) ? c.world : null;
  };

  /* v4.13 规则专属钩子注册表（各模式文件自行注册，key = 规则 id）
   *   spd(f)      → 返回移速倍率（木头人全场 70%、渡江战役水里大幅减速等）
   *   interact(f) → 返回 true 表示这次 P 键已被模式消费（道具包 / 落座 / 登船）
   *   label(f)    → 返回 P 键提示文字（空串表示当前没有可交互的东西） */
  LD.RULE_SPD = {};
  LD.RULE_INTERACT = {};
  LD.RULE_LABEL = {};

  /* ---------------------------------------------------------- v4.13 一二三木头人（重做）
   * 长跑道（1920 = 原长度 ×2），从左跑到右。场上**没有坚守者实体**：
   * 取代它的是天上（地图右方天上）的监测者——不做实体，只是一个伤害来源坐标。
   *
   * 核心变化：玩家**无从得知监测者何时观测**（没有任何预警信号）。
   * 观测发生时，所有还在移动的人会被天上打下来的光束命中，掉血 + 往左击退。
   * 于是唯一的情报来源就是「看别人有没有被打」——这就是本模式的博弈点。
   *
   * 掩体（blockMove 的障碍）左方 coverTiles 格内是监测死角，站在那儿不会被打。
   * 场上还会刷新道具包，走近按 P 开包：回血 或 短暂提速。
   * 注意：**不退回到起点**（被打只吃伤害与击退，进度保留）。 */
  LD.STATUE = {
    world: { w: 1920, h: 600, pt: 96 },   // 长度 ×2（原 960），高度不变
    startX: 82, finishX: 1838,
    speedMul: 0.70,          // v4.13 全场移速只有正常的 70%（跑得慢，才需要算计）
    skyX: 1900, skyY: 34,    // 天上的监测者：只作伤害来源坐标，不生成实体
    idleMin: 2.4, idleMax: 4.6,           // 两次观测之间的间隔（随机，玩家看不见）
    scanMin: 0.85, scanMax: 1.5,          // 一次观测持续多久
    scanTick: 0.40,                       // 观测期间的结算间隔（还在动就再挨一发）
    scanDmg: 26, scanKb: 250,
    coverTiles: 2.4,         // 掩体左方这么多格内 = 监测死角
    coverCell: 44,           // 一格的大小（像素）
    packEvery: 8.5,          // 道具包刷新间隔
    packMax: 5,              // 场上道具包上限
    packR: 36,               // 开包交互距离
    packHeal: 80,            // 开到「急救包」回的血
    packSpdT: 5.0, packSpdMul: 1.55,      // 开到「加速包」的时长与倍率
    /* 人机节奏：前进一点 → 停 → 看见有人被打再等一会儿 → 前进一点
     * v4.13f：整体调「积极」——以前 AI 太保守，大半时间在站着发呆，
     * 玩家一路小跑就到终点了。等待变短、跑动变长、步子变大。 */
    aiRunMin: 0.80, aiRunMax: 1.90,        // 一次「前进一点」持续多久
    aiWaitMin: 0.40, aiWaitMax: 1.05,      // 看到有人被击中后先等多久
    aiQuiet: 3.0,                          // 这么久都没人被打 → 认为安全，主动前进
    aiQuietMul: 3.0,                       // 「安全」时的思考速度倍率（越大越急着走）
    aiStopMin: 0.14, aiStopMax: 0.40,      // 每次跑完停多久
    aiStepMin: 150, aiStepMax: 320,        // 没有掩体时一次闷头挪多远
    aiMinAhead: 80,                        // v4.13g：目标点至少要比脚下远这么多 ——
                                           //   以前「掩体左边 30px」会算到脚下，人机原地卡死
    /* v4.13h：贴墙的障碍物只能从另一侧绕 —— steer 只探 70px 看不到那条路，
     * 会给出「往后退」的方向，人机就在障碍物后面来回晃。下面这几个数控制自算绕行点。 */
    aiStallT: 1.1,                         // 连续这么久没往右挪 → 认为被挡住了
    aiBypassT: 1.2,                        // 绕行至少给这么久，别刚起步又被判定「该停了」
    aiBypassPad: 26,                       // 绕行点离障碍物边缘留多少（+ 身体半径）
    aiBypassBack: 24,                      // 绕行点定在障碍物左边缘再往左多少
    aiLaneStep: 34,                        // 目标点落进障碍里时，上下找空档的步长
    aiStuckMax: 3,                         // 连续绕障失败这么多次 → 退回去重来
    aiRetreatT: 1.4,                       // 退回状态最多持续多久
    aiRetreatD: 90,                        // 一次往后退多远
    aiCoverBias: 0.45,                     // 顺路蹭掩体的概率（太高会一路掩体一路停）
    respawn: 3.5, invuln: 1.2
  };

  /* ---------------------------------------------------------- v4.13 抢椅子（重做）
   * 一轮的流程：
   *   hint（只给「椅子将要出现」的时间提示，**不给位置**）
   *     → rush（几秒后椅子在地图上瞬间随机出现，所有人在这一刻才得知位置）
   *     → grabT 秒内跑到椅子边按 P 坐下（不是范围圈自动判定）
   *     → 结算：没坐到的人扣 missDmg 血（不出局）
   *     → rest（间歇，椅子清空，数量 -1）
   * 椅子数量：开局 = 存活人数 + extra，每轮 -1，最少 minSeats。
   * 每把椅子有 fakeP 的概率是**假椅子**：外观完全一样，坐上去直接散架（白跑一趟）。 */
  LD.CHAIR = {
    world: { w: 960, h: 720, pt: 110 },   // v4.13 原尺寸（1200×900）的 80%
    extra: 2,            // 椅子数量 = 存活人数 + extra
    hintMin: 2.6, hintMax: 4.5,           // 「椅子即将出现」的预告时长
    grabT: 2.6,          // 椅子出现后的抢座窗口
    fakeP: 0.22,         // 每把椅子是假椅子的概率
    fakeStun: 0.55,      // 坐到假椅子后愣神多久（这就是代价）
    sitR: 28,            // v4.13d 靠近到这个距离内按 P 才能坐下（原 44，判定缩了一圈）
    blowers: 5,          // v4.13d 场上的吹风机数量（抢座路上会被侧风推偏）
    missDmg: 55,         // 没抢到扣的血（高容错：不出局）
    restT: 2.4,          // 两轮之间的间歇
    seatR: 62,           // 椅子绘制半径 / 摆位最小间隔
    minSeats: 1,
    respawn: 4.0, invuln: 1.2
  };

  /* ---------------------------------------------------------- v4.13 躲猫猫（改版）
   * 一人当鬼，其余人躲。鬼靠近按 P 蓄力搜查柜子 / 草丛；抓到的人**加入鬼的阵营**。
   * 最后没被抓到的躲藏者获胜；躲藏者被抓光则鬼获胜。
   *
   * v4.13 的变化：
   *   - 取消「长时间躲在隐匿物里会被发现」——藏住了就是藏住了
   *   - 普通障碍大幅减少、柜子与草丛大幅增多（地图就是拿来躲的）
   *   - 开局的鬼 10 秒失明（整体屏幕变黑，和夜战一样）+ 10 秒定身
   *   - 躲藏者固定带一个 K 技能「隐匿」，CD 拉长到 15 秒
   *   - 每 30 秒场上刷一件道具，靠近按住 P 蓄力 2 秒拾取：
   *       鬼拾取 → 随机锁定一个躲藏者 10 秒（拿到对方位置）
   *       人拾取 → 所有鬼 10 秒定身 + 失明，且搜查耗时翻倍
   *   - 鬼的移速 120% */
  LD.HIDE = {
    world: { w: 1400, h: 1100, pt: 110 },
    seekerMul: 1.20,     // v4.13 鬼的移速倍率（原 1.06）
    hiderMul: 1.0,
    catchR: 46,          // 只作为 AI 索敌的贴身阈值（真正判定看下面的 catchR2）
    /* v4.13f：抓人从 P 键改成鬼的 J 键普攻（hide_catch，CD 2 秒），
     * 人的隐匿也从 P 键改成 J 键普攻（hide_stealth，CD 15 秒）。
     * 两个招式本身注册在技能表里（hideOnly），这里只放数值。 */
    catchR2: 88,         // 抓人的判定半径
    catchPull: 26,       // 对着柜子 / 草丛抓时额外给的够手距离（柜子是 blockMove，站不进去）
    catchDmg: 100,       // 抓人伤害（躲藏者 200 血 → 两下变鬼）
    catchKb: 70,         // 抓人的击退（v4.13g：150 → 70。击退太远的话，鬼吃完 2 秒 CD
                         //   人已经跑出半个屏幕，第二下永远补不上 →「打一下就跑掉了」）
    catchStun: 0.5,      // 抓到人时对方短暂踉跄，够鬼补第二下（两下才变鬼，不给人白跑）
    aiStealthR: 150,     // 人机躲藏者：鬼进这个距离就按 J 隐匿脱离（贴到抓人范围边上才交，太早交等于白送）
    searchNeed: 0.9,     // 自动搜查柜子 / 草丛的蓄力时长
    searchR: 88,         // 搜查的判定距离（v4.13f：64 → 88，鬼路过藏点就能顺手搜一下，覆盖面大很多）
    reSearchT: 6,        // v4.13f：同一个藏点搜空之后，过这么久还允许再搜（以前是永久拉黑 → 人躲进去就无敌）
    aiMemT: 3.4,         // v4.13f：鬼「记得」刚看见的人多久（对方按 J 隐匿之后仍会朝消失处扑一下）
    aiSniffCd: 9,        // v4.13g：AI 鬼每隔这么久可以「闻到」一次有人的藏点（只是给方向，还得读条 + J 打两下）
    aiSniffR: 560,       // 「直觉」的感知半径
    aiBail: 0.5,         // v4.13f：人机躲藏者被搜时「夺门而出」的概率（其余时候老实蹲着被揪出来）
    aiPanicR: 80,        // v4.13f：鬼贴到这么近，人机躲藏者才换藏身点。
                         //   必须小于「搜查触发距离」(searchR 88 + 半个柜子 40 = 128)，
                         //   否则人机永远在鬼开始搜查的前一瞬间溜走 → 鬼一整局搜空气。
    seekerHp: 300, hiderHp: 200,
    hintEvery: 6.0,      // 每隔多久给躲藏者一次「鬼大概在哪」的心跳提示
    hintR: 430,          // 鬼进入这个距离才提示（越近越急）
    /* v4.13 地形：普通障碍只留 propKeep，隐匿物补足到 (人数 × 2 + hideExtra) × hideMul */
    propKeep: 0.22, hideExtra: 6, bushRatio: 0.5, hideMul: 2,
    stealthCd: 15,       // 固定赠送的隐匿 CD（就是 hide_stealth 的 cd，两边必须一致）
    openBlind: 10,       // 开局的鬼：10 秒失明（整体屏幕变黑）
    openRoot: 10,        // 开局的鬼：10 秒定身
    relicEvery: 30,      // 道具刷新间隔（v4.13g：定死 30 秒一次）
    aiRelicR: 170,       // v4.13f：人机「顺路捡道具」的范围（以前是 340，一局捡三四次，鬼一直罚站）
    relicFirst: 30,      // 开局第一件道具的刷新时间（v4.13g：12 → 30，第一次也在第 30 秒）
    relicR: 60,          // 道具的交互距离
    relicNeed: 2.0,      // 长按 P 蓄力多久才拿得走
    lockT: 10,           // 鬼拿到道具 → 锁定一个躲藏者多久
    freezeT: 10,         // 人拿到道具 → 鬼定身 + 失明多久
    searchMul: 2         // 人拿到道具期间，鬼搜查耗时翻几倍
  };

  /* ---------------------------------------------------------- v4.13 地板是岩浆（改版）
   * 地砖周期发红：预警 warnT 秒 → 致命 hotT 秒（站上去每秒掉 dps 血）。
   * v4.13：
   *   - 地图缩到原尺寸的 70%
   *   - **取消安全台**：没有永远安全的地方了，只能靠走位躲红格
   *   - 每轮岩浆面积**大幅**增加（ratioStep 0.14，上限 0.78）
   *   - 加入冰面滑壶那套玩家互撞规则，但击退距离削弱到 70% */
  LD.LAVA = {
    world: { w: 840, h: 630, pt: 110 },   // 原 1200×900 的 70%
    cols: 8, rows: 6,
    warnT: 2.0, hotT: 2.6,     // v4.13d 安全格变少了，预警时间从 1.6 放宽到 2.0 才算得过来
    dps: 55,
    /* v4.13d 岩浆量不再按比例涨，改成按人数定：
     * 安全格 = 存活人数 + safeExtra（默认 1），其余全烧。人越少落脚地越少。 */
    safeExtra: 1, minSafe: 2,
    firstRatio: 0.28, ratioStep: 0.14, ratioMax: 0.78,   // 仅存档兼容，已不再参与计算
    gapT: 1.1,                 // 两轮之间的间歇
    bumpMinSpd: 80,            // v4.13d 相对速度超过它才算「撞上了」（原 130，太容易判不中）
    bumpKb: 330, bumpMul: 0.77, // v4.13d 击退在滑壶基础上 +10%（原 0.70）
    bumpPairCd: 0.4,           // v4.13d 同一对 0.4 秒内只结算一次，避免贴脸时有时无
    respawn: 4.0, invuln: 1.2
  };

  /* ---------------------------------------------------------- v4.12 弹幕生存
   * 边缘炮台持续发射弹幕（复用 B.projs），活得最久的赢；血最多的赢下限时局。
   * 弹幕模式每 waveEvery 秒轮换一次（扫射 / 环形 / 瞄准）。 */
  LD.BARRAGE = {
    world: { w: 1200, h: 900, pt: 110 },
    turrets: 5,
    fireEvery: 1.15,
    bulletSpd: 215, bulletDmg: 22, bulletR: 9, bulletLife: 6.5,
    kb: 130,
    waveEvery: 12,
    safeGap: 3.0,        // 每轮换弹幕模式时的安全间隙
    respawn: 4.0, invuln: 1.2
  };

  /* ---------------------------------------------------------- v4.13 渡江战役（战斗模式）
   * 竖窄横长的渡江战场：最左 / 最右各一小块滩头，中间全是水。
   *   - 地图尺寸：竖向宽 = 常规 1600 的 70%，横向长 = 1600 的 160%
   *   - 水里没有船就走不动（移速大幅下降），船是唯一的快速过江手段
   *   - 船的驾驶 / 油量 / 受伤强制下船全部复用汽车那套（kind = "car"）
   *   - 开局只能用普攻；冲上右岸、和中央旗子交互之后才解锁技能与大招
   *   - 活到最后的赢 */
  LD.RIVER = {
    world: { w: 2560, h: 1120, pt: 110 },
    shoreL: 250,          // 左岸滩头宽度
    shoreR: 250,          // 右岸滩头宽度
    shorePad: 46,         // 滩头上下留白（显示上更像一条岸）
    waterDeep: 0.34,      // 深水区移速倍率（"大幅下降"）
    waterShallow: 0.52,   // 靠岸浅水，稍快一点，鼓励贴边偷渡
    shallowBand: 190,
    flagX: 0,             // 0 = 自动取右岸中心（shoreR 区域内）
    flagR: 62,            // 旗子交互距离
    islets: 9,            // 水中零星小岛（可站、可停船）
    isletTiles: [2, 3],   // 小岛占地（格）
    isletProps: [1, 3],   // 小岛上再塞 1~3 个障碍，用来挡船
    shipEvery: 30,        // 每 30 秒重新刷一批船
    shipFirst: 6,         // 开局多少秒后第一次补船（先让玩家看清摊子）
    shipMinMul: 1.6,      // 1 艘船时的提速（人少时别让人等太久）
    /* v4.13b：油量大幅削减 —— 关键是**一艘船的油根本不足以一次渡江**。
     * 从左岸到右岸要横跨 2060px，而一艘船平均只能推进 800~1200px，
     * 所以过江必然是「坐一段 → 跳船 / 游一段 → 再找下一艘」的接力，
     * 渡江本身才成为主要玩法，而不是「跳上一辆车一路开到终点」。 */
    shipFuel: [900, 1600],
    shipSpeed: [1.55, 1.15], // [小船, 大船] 速度倍率
    /* 油量耗尽后的宽限：这段时间还能慢慢滑，到点沉没 */
    dryFade: 6.0,
    aggroShore: 420,      // 「即将上岸」的判定距离（离右岸这么近就算靶子）
    aggroMul: 0.45,       // 仇恨距离折扣，越小越优先
    respawn: 4.0, invuln: 1.4,

    /* ---- v4.13c：把「延长出来的时间」从纯等待变成有决策的操作时间 ---- *
     * 三件事互相关联：
     *   ① 涨潮  → 给你一个「为什么非渡不可」的理由（不然可以在左岸耗到最后一个人）
     *   ② 水流  → 给渡江过程本身加操作（不然就是按住右键盯着屏幕看 24 秒）
     *   ③ 补给桶 → 给航线加取舍（直线最快但可能没油，绕去捡油更稳却更慢）
     */
    riseAfter: 55,        // ① 开局多少秒后开始涨潮（先给一段自由交火的时间）
    riseEvery: 8,         // ① 之后每隔多少秒再涨一档
    riseStep: 1.0,        // ① 每次涨掉左岸几格（40px）
    riseMax: 5,           // ① 最多涨掉几格（留一格保底，左岸不会彻底没了）
    riseWarn: 5,          // ① 涨潮前几秒给预警
    drift: 16,            // ② 水流速度：每秒把水里的人和船往下游推多少 px
    driftShipMul: 0.85,   // ② 船吃水深，被冲得比人慢一点（13.6px/s）
    /* drift 这个值是用「真实游泳速度」倒推出来的，不是拿 LD.RIVER.waterDeep 直接算的：
     *   注意 40_battle 里还有一条「站在 water 地形上 ×0.55」，会和 RULE_SPD 叠乘，
     *   所以深水实际速度是 195 × 0.34 × 0.55 ≈ 36.5px/s，而不是 66px/s。
     *   按 36.5 算： sinθ = 16/36.5 → 把航向往上游抬 26° 就能维持高度，水平还剩 90%；
     *   最慢的福船 93px/s 只需抬 8°，几乎不损失水平速度 —— 船明显值得抢。
     *   加到 20 以上就会变成「永远爬不回上游」，人会被死死压在地图下缘，别再往高了调。 */
    drumFirst: 5,         // ③ 开局多少秒漂来第一只油桶
    drumEvery: 9,         // ③ 之后每隔多少秒再来一只
    drumMax: 5,           // ③ 江面上同时最多几只
    drumMul: [0.22, 0.34],// ③ 每只补多少油（占该船 fuelMax 的比例）
    drumR: 28,            // ③ 拾取半径（船按体积、人按距离）
    drumHeroHp: 30,       // ③ 没船的人捡到：回血与回能（总得有点用）
    drumHeroEn: 20,
    drumLife: 34          // ③ 漂过整条江太久就自己烂掉
  };
  /* 渡江战役的船只型号：全部走 kind = "car"，只是 vtype 与贴图不同。
   *
   * v4.13b 重新配平：船速整体砍半（`原来 × 0.5`），换来一个清晰的取舍——
   *   小船（竹筏 / 小木船）开得快但油箱小，带不了多远；
   *   大船（渔船 / 福船）慢吞吞但油箱大，一趟能推得更深。
   * 「快而短」和「慢而远」之间的选择，就是这一版渡江的核心决策。
   *
   * 参考速度（基础移速 195）：竹筏 171 / 小木船 151 / 渔船 117 / 福船 93；
   * 人在深水里只有 66 —— 所以哪怕是最慢的福船也比游泳快 40%。 */
  LD.SHIPS = {
    raft: { id: "raft", name: "竹筏", img: "boat_raft", tiles: [1, 2], speedMul: 0.875, fuelMul: 0.55, big: false },
    row:  { id: "row",  name: "小木船", img: "boat_row",  tiles: [2, 2], speedMul: 0.775, fuelMul: 0.70, big: false },
    fish: { id: "fish", name: "渔船",  img: "boat_fish", tiles: [3, 2], speedMul: 0.600, fuelMul: 1.15, big: true },
    junk: { id: "junk", name: "福船",  img: "boat_junk", tiles: [4, 2], speedMul: 0.475, fuelMul: 1.60, big: true }
  };
  LD.SHIP_IDS = ["raft", "row", "row", "fish", "fish", "junk"];   // 抽样池：小船多、大船稀少

  /* ---------------------------------------------------------- v3.3 交互键（P）
   * 一个键统一处理「拾取 / 躲藏 / 驾驶 / 上下车 / 扔泥土」。
   * 距离判定统一用「角色中心到物件边缘」的净距，避免大件汽车隔老远就能按。 */
  LD.INTERACT = {
    key: "P",
    range: 26,          // 净距（角色边缘到物件边缘）在 26px 内视为可交互
    giftRange: 34,      // 掉落物本身很小，放宽一点
    mudRange: 30,
    pickCd: 0.35,       // 连续交互的最短间隔（防按住连发）
    hideY: 8,           // 躲进柜子后视觉上略微下沉
    spotT: 2.0,         // 柜子 / 草丛藏超过 2 秒 → 被 AI 察觉（隐匿技能不受此限）
    spotAggro: 0.55,    // 被察觉的躲藏者在 AI 选敌时的距离权重（越小越优先）
    ejectStun: 2.0,     // 躲在柜子里挨打被揪出来后的眩晕
    noCarT: 5.0,        // v3.9 被远程打下车（震出）后，这段时间内禁止再上车
    noHideT: 5.0,       // v3.9 被从柜子里揪出来（或柜子被打碎）后，这段时间内禁止再躲进柜子
    mudDmg: 22,         // 泥土砸中伤害
    mudSpeed: 430,      // 泥土投掷初速
    refreshEvery: 30    // 「物资刷新」修饰符的间隔
  };

  /* v3.9 通用「长按蓄力」配置：能量包开包 / 霸主加冕共用一套 charge 框架。
   * need = 需要的秒数，keep = 允许离目标的最远距离（超出即中断）。 */
  LD.CHARGE = {
    pack:  { need: 5.0, keep: 60, label: "开启道具包", color: "#818cf8" },
    crown: { need: 3.0, keep: 70, label: "加冕中", color: "#fcd34d" },
    /* v3.9.1 停电夜战：充电站——靠近按住交互键 1.6 秒把手电筒充满 */
    station: { need: 1.6, keep: 96, label: "充电中", color: "#38bdf8" },
    /* v4.12 补给箱：走近按住交互键 1.5 秒搜刮，掉落与「打碎」完全同一条链路 */
    supply: { need: 1.5, keep: 96, label: "搜刮补给箱", color: "#7dd3fc" },
    /* v4.13 躲猫猫的场上道具：靠近按住交互键 2 秒才拿得走（鬼拿 = 锁人，人拿 = 定住鬼） */
    relic: { need: 2.0, keep: 96, label: "拾取道具", color: "#c084fc" }
  };

  /* v3.9 霸主争霸改版：天上掉皇冠取代巨龙
   * 开局 warnT 秒预告 → 皇冠落地 → 靠近按交互键蓄力 need 秒（受击中断）
   * → 加冕者血量 x hpMul、技能 CD 乘 cdMul → 持有 holdT 秒后剥夺并重新预告 */
  LD.CROWN = {
    warnT: 5.0,         // 天降预警时长（也是开局到第一顶皇冠落地的时间）
    fallT: 0.9,         // 皇冠从天而降的下落动画时长
    holdT: 30,          // 霸主有效时长
    nextWarnT: 5.0,     // 效果清除后，下一顶皇冠的预警时长
    hpMul: 2,           // 血量翻倍
    cdMul: 0.7,         // 技能 CD 缩短 30%
    range: 40           // 交互距离（比默认宽，皇冠落在地上不好贴）
  };

  /* ---------------------------------------------------------- v3.3 可驾驶车辆
   * speed：相对玩家基础移速（195）的倍率；fuel：满油可行驶距离（像素）
   * 速度 / 油量都在生成时按区间随机，同一颗种子两端一致。 */
  LD.VEHICLES = {
    sedan: { id: "sedan", name: "轿车", tiles: [2, 1], speed: [1.20, 1.70], fuel: [2000, 6000], hp: 0 },
    van:   { id: "van",   name: "面包车", tiles: [2, 1], speed: [1.15, 1.45], fuel: [2000, 5600], hp: 0 },
    bus:   { id: "bus",   name: "大巴", tiles: [3, 1], speed: [0.88, 1.02], fuel: [2000, 5200], hp: 0, big: true },
    tank:  { id: "tank",  name: "坦克", tiles: [2, 2], speed: [0.72, 0.86], fuel: [2000, 3200], hp: 0,
             cannon: { cd: 5, dmg: 15, speed: 460, r: 9 }, ejectStun: 2 },
    /* v4.8 碰碰车竞技专用：更快更跟手，电量（油）视为无限 */
    bumper: { id: "bumper", name: "碰碰车", tiles: [2, 1], speed: [1.95, 1.95], fuel: [1e9, 1e9], hp: 0 }
  };
  /* v4.13b 渡江战役的船只条目：**不再在这里抄第二份数值**。
   * 车型表只被要求提供 id / name / tiles / big / cannon，
   * 其中 name 会用在「驾驶 XX · 油 N%」的提示上，所以必须挂进来；
   * 速度与油量统一由 LD.SHIPS + LD.RIVER.shipFuel 推导，
   * 否则调平衡时要改两处，改漏一处就出现「提示写的和跑出来的不一样」。 */
  Object.keys(LD.SHIPS).forEach(function (k) {
    var s = LD.SHIPS[k];
    var fb = (LD.RIVER && LD.RIVER.shipFuel) || [900, 1600];
    LD.VEHICLES[k] = {
      id: k, name: s.name, tiles: s.tiles, hp: 0,
      big: !!s.big, ship: true,
      speed: [s.speedMul, s.speedMul],
      fuel: [Math.round(fb[0] * s.fuelMul), Math.round(fb[1] * s.fuelMul)]
    };
  });
  LD.VEHICLE_CFG = {
    ejectStun: 2,        // 行驶中被打下车后的眩晕（本次伤害免疫）
    ramDmg: 10,          // 撞人伤害
    ramCd: 2,            // 撞人伤害 CD
    ramKb: 300,          // 撞击击退
    hornCd: 0.45,        // 喇叭
    accel: 900,          // 加速度（px/s^2）
    turn: 9,             // 转向跟随速度（越大越跟手）
    tankChance: 0.10,    // 生成的特殊车占比：坦克
    busChance: 0.16,     // 大巴
    fuelPerDmg: 20       // v3.5 车体每受到 1 点伤害 → 油箱减少 20 可行驶距离
  };

  /* ---------------------------------------------------------- v3.5 吹风机
   * 一格宽的机身，朝固定方向持续喷出 1 格宽、多格长的气流。
   * 角色站在气流里会被吹开（不做伤害）；机身吃伤害，打坏后风停。 */
  LD.BLOWER = {
    force: 420,          // 风力（px/s），角色越大越难顶风（v3.6 由 560 下调，吹得没那么狠）
    lenMin: 3,           // 气流最短格数
    lenMax: 6,           // 气流最长格数
    hp: 110              // 机身血量
  };

  /* ---------------------------------------------------------- v2.7 缩圈乱斗参数 */
  LD.RING = {
    n: 4,               // 开局几个安全圈
    r0: 250,            // 安全圈初始半径（随 1200 地图同比缩小）
    gap: 1.15,          // 圈心最小间距（相对 r0）
    protectT: 0,        // 开场保护（毒圈不生效）
    shrinkStart: 14,    // 14 秒后开始收缩
    shrinkRate: 0.0078, // 每秒收缩比例
    minMul: 0.48,       // 最终收缩到初始半径的 48%
    killAt: [22, 46, 72],   // 第 22 / 46 / 72 秒各消失一个安全圈，最后只剩一个
    dmg: 5, tick: 0.5,  // 圈外每 0.5 秒掉 5 血
    limit: 165          // 兜底时限：超过则按血量最高者判胜（几乎用不到）
  };

  /* ---------------------------------------------------------- v2.7 追猎时刻参数 */
  LD.HUNT = {
    hp: 800,            // 猎人血量
    cdMul: 0.5,         // 猎人全部 CD 减半
    dmgPerRunner: 0.20, // 猎人伤害随存活幸存者数提升：1 + 20% × 存活人数
    roundT: 90,         // 生存者撑满 90 秒即获胜
    r0: 740,            // 开局大毒圈半径（1200 地图下取 0.75 倍）
    shrink: 4.7,        // 每秒收缩速度：90 秒后半径仍有 ~315，走位空间充足
    minR: 315,
    dmg: 6, tick: 0.5   // 圈外每 0.5 秒掉 6 血
  };

  /* ---------------------------------------------------------- v2.7 军备竞赛：局内商店定价 */
  LD.ASHOP = {
    healPrice: 3, healAmount: 45,   // 血包：3 币，立刻回 45 血
    hpPrice: 3, hpGain: 40,         // 血量加成：3 币，本局上限 +40（可叠加）
    spdPrice: 3, spdGain: 0.15, spdMax: 3,   // 移速加成：3 币，本局移速 +15%，最多叠 3 次
    energyPrice: 3, energyGain: 60  // v3.2 能量球：3 币，立刻补 60 点大招能量
  };

  /* ---------------------------------------------------------- 对局时间（房间统一选项） */
  LD.MATCH = {
    times: [60, 120, 180, 240, 300],   // 五档对局时间（秒）
    def: 120                 // 默认 120 秒
  };

  /* ---------------------------------------------------------- v2.7 乱斗热身参数
   * v3.9.1 计分改版：伤害是大头（每 20 点实际伤害 = 1 分），击杀 5 分是彩头 */
  LD.WARMUP = {
    respawn: 1.6,            // 阵亡后 1.6 秒原地复活
    invuln: 1.6,             // 复活后无敌时间
    scoreDmg: 0.05,          // 每 1 点实际伤害的得分（0.05 = 20 伤害 1 分）
    scoreKill: 5             // 击杀加分
  };

  /* ---------------------------------------------------------- v3.9.1 停电夜战
   * 全图黑：每人自带一圈私人视野（只有自己看得见），交互键 = 手电筒。
   * 手电筒照出的光锥是「公共光」——别人也能看见你照亮的地方，等于暴露自己。
   * 黑暗条：不受光时每秒 +1，满 30 点后每秒掉 20 血；受光时每秒 -6（v4.10 由 3 翻倍，
   * 公共光圈的「驱暗」效率更明显，摸黑压条更痛）。
   * 摸黑时自带隐匿，走进充电站的公共光圈就现形；本模式不产能量包（用不上）。 */
  LD.NIGHT = {
    /* 地图放大 1.5 倍（1200 → 1800）：黑灯瞎火里场地要够大，才躲得开、也才走得完 */
    world: { w: 1800, h: 1800, pt: 120 },
    /* 自带视野：画成竖着的椭圆，圆心抬到人物胸口高度，纵向多给一格把整个人照出来。
     * 只做圆形的话半径 46 只照到脚下，人物上半身是黑的。 */
    selfR: 50,               // 自带视野横向半径
    selfRy: 90,              // 自带视野纵向半径（= 向上扩了一格）
    selfDY: 42,              // 光斑圆心相对脚底上移多少（人物胸口）
    pubR: 40,                // 充电站公共亮光半径（直径两格）
    coneLen: 416,            // 手电筒照距（520 的 80%，约 10 格）
    coneHalf: 0.40,          // 光锥半角（约 23°）
    coneR: 62,               // 光锥根部的近端照亮半径（78 的 80%）
    batMax: 100,             // 电量上限
    batDrain: 6.5,           // 手电筒每秒耗电（满电约 15 秒）
    batLow: 20,              // 低电量阈值（UI 变红提示）
    darkMax: 30,             // 黑暗条上限（v4.10 由 15 扩到 30：满条要 30 秒，压条更从容）
    darkUp: 1,               // 无光时每秒积累
    darkDown: 6,             // 受光时每秒消退（v4.10 ×2：公共光下减值速度翻倍）
    darkDps: 20,             // 条满后每秒掉血
    /* 黑暗侵蚀按 0.25 秒一节结算，避免每帧都掉 0.33 血不停飘字 / 顿帧 */
    darkTick: 0.25,
    stations: 4,             // 地图上的充电站数量
    charge: { need: 1.6, keep: 96 },   // 充电站蓄力：按住交互键 1.6 秒充满
    /* 配装：普攻保留玩家自己选的，只把两个技能槽换成位移斩与手里剑，大招照常禁用 */
    skill: { skill1: "dashSlash", skill2: "shurikenToss" }
  };

  /* ---------------------------------------------------------- v3.7 塔防对战
   * 3v3 单线推塔：窄长地图，左右各一座水晶 + 两座防御塔，兵线从基地出发。
   * v3.9：地图 2800x600，无时限（打到水晶破），红蓝两队；中心野怪已移除。 */
  LD.TOWER = {
    world: { w: 2800, h: 600, pt: 80 },    // 窄长地图，可视区 960x600（刚好铺满一屏高）
    laneY: 400,                            // 兵线所在高度
    structDy: 110,                         // 水晶 / 防御塔在兵线上方多少像素
    perTeam: 3,
    matchT: 0,                             // 0 = 不限时，打到一方水晶破
    startGold: 200,
    gold: { minion: 32, hero: 240, assist: 120, tower: 180, towerShare: 60 },
    xp: { minion: 20, hero: 120, tower: 120, levels: [0, 100, 240, 420, 640, 900] },   // 6 级
    levelHp: 40,
    levelDmg: 0.04,
    /* v3.9 复活：5 秒 + 等级 × 5 秒（1 级 10s、5 级 30s） */
    respawn: { base: 5, perLv: 5, max: 30, invuln: 2.0 },
    wave: { first: 10, every: 32, count: 6, spread: 34 },
    minion: { hp: 67, dmg: 9, atk: 1.15, range: 40, aggro: 190, speed: 62, r: 12,
              gold: 32, xp: 20, scalePerTower: 0.15 },
    /* v3.9 血量下调到原值的 80%：塔 1200 / 水晶 2400 */
    tower: { hp: 1200, dmg: 26, range: 300, atk: 1.05, projSpeed: 1100, homing: 3.4, r: 46, h: 96 },
    crystal: { hp: 2400, dmg: 34, range: 340, atk: 1.2, projSpeed: 1050, homing: 3.8, r: 58, h: 110 },
    structurePower: 1,
    structDmgMul: 3.0,       // 英雄对建筑的伤害倍率（不吃这个倍率的话 1000 血的塔要拆太久）
    minionStructMul: 2.0,    // 小兵对建筑的伤害倍率
    fountain: { r: 170, healPct: 0.12 },   // 基地回血：12% 最大生命 / 秒（约 8 秒回满）
    assistT: 8,
    /* 小兵团队强化：可重复购买，最多 5 层 */
    minionUp: { price: 300, max: 5, hp: 0.12, atk: 0.08 },
    /* 汽油桶：只有坐在车上才能买，无限次，每次 +2000 油 */
    fuel: { price: 80, add: 2000 }
  };

  /* 局内装备：被动各买一次；主动装备最多携带 1 件（按 P 释放）；
   * 最后两条是团队强化，可重复购买 */
  LD.TOWER_SHOP = [
    { id: "hp",    name: "生命宝石", icon: "❤", price: 320, kind: "passive", desc: "生命上限 +160" },
    { id: "atk",   name: "力量护腕", icon: "⚔", price: 380, kind: "passive", desc: "造成的伤害 +18%" },
    { id: "spd",   name: "疾风之靴", icon: "👟", price: 300, kind: "passive", desc: "移动速度 +12%" },
    { id: "armor", name: "荆棘护甲", icon: "🛡", price: 420, kind: "passive", desc: "受到的伤害 -15%" },
    { id: "vamp",  name: "吸血獠牙", icon: "🩸", price: 450, kind: "passive", desc: "造成伤害的 12% 转化为生命" },
    { id: "cdr",   name: "冷却怀表", icon: "⏱", price: 420, kind: "passive", desc: "技能冷却 -18%" },
    { id: "energy", name: "能量水晶", icon: "🔮", price: 350, kind: "passive", desc: "能量获取 +15%" },
    { id: "regen", name: "续航宝石", icon: "🌿", price: 320, kind: "passive", desc: "5 秒不受伤后每秒回 2 点" },
    { id: "requiem", name: "还魂曲", icon: "🎵", price: 380, kind: "passive", desc: "生命低于 30 时每秒回 10，持续 5 秒（CD 60s）" },
    { id: "brave", name: "敢死队", icon: "🔥", price: 300, kind: "passive", desc: "生命低于 80 时免疫眩晕与击退" },
    { id: "steel", name: "钢甲", icon: "⛓", price: 320, kind: "passive", desc: "受到飞行物伤害 -20%" },
    { id: "cloak", name: "魔法斗篷", icon: "🧥", price: 360, kind: "passive", desc: "12% 概率完全闪避伤害" },
    { id: "heal",  name: "治疗卷轴", icon: "✚", price: 300, kind: "active", cd: 45, desc: "按 P 立刻回复 35% 生命（CD 45s）" },
    { id: "haste", name: "疾行符", icon: "⚡", price: 300, kind: "active", cd: 40, desc: "按 P 移速 +60%，持续 3 秒（CD 40s）" },
    { id: "ward",  name: "护盾发生器", icon: "◈", price: 350, kind: "active", cd: 40, desc: "按 P 获得 180 点护盾（CD 40s）" },
    { id: "bomb",  name: "高压弹", icon: "💣", price: 300, kind: "active", cd: 35, desc: "P：放炸弹，3 秒后 100 范围 100 伤害（含建筑）" },
    { id: "thorns", name: "刺甲", icon: "🌵", price: 380, kind: "active", cd: 45, desc: "P：4 秒内受到伤害的 50% 反弹给攻击者" },
    { id: "frost", name: "寒霜", icon: "❄", price: 350, kind: "active", cd: 40, desc: "P：冻结身边 80 范围敌人 2.5 秒" },
    { id: "minionHp",  name: "强化小兵血量", icon: "🛠", price: 300, kind: "team", desc: "我方小兵生命 +12%（最多 5 层）" },
    { id: "minionAtk", name: "强化小兵攻击", icon: "🔧", price: 300, kind: "team", desc: "我方小兵攻击 +8%（最多 5 层）" },
    { id: "fuel", name: "汽油桶", icon: "⛽", price: 80, kind: "fuel", desc: "驾驶车辆时可买：车辆 +2000 油（不限次数）" }
  ];
  LD.towerItem = (id) => (LD.TOWER_SHOP || []).find(i => i.id === id) || null;

  /* ---------------------------------------------------------- v2.6 杂兵目录
   * 蜂后的工蜂等小型召唤物：接触目标即自爆，可被弹道与近战清除。 */
  LD.MINIONS = {
    beeDrone: { hp: 14, speed: 175, dmg: 9, boomR: 46, r: 10, life: 12, name: "工蜂" }
  };

  /* ---------------------------------------------------------- v2.6 规则修饰符（可叠加）
   * 在对战房间勾选，随开局配置下发；闯关每日挑战也会引用。
   * v2.7：脆皮 → 回复（周期掉血包）、无大招 → 僵尸（随机刷僵尸）。 */
  LD.MODS = [
    { id: "lowgrav", name: "低重力", icon: "🌙", desc: "击退更远更飘，闪避距离 +50%" },
    { id: "speed",   name: "高速",   icon: "⚡", desc: "移速 +35%，所有 CD 缩短 30%" },
    { id: "heal",    name: "回复",   icon: "💊", desc: "场上每 8 秒掉落一个血包，吃下回复生命" },
    { id: "zombie",  name: "僵尸",   icon: "🧟", desc: "场上不断刷新僵尸干扰战局，击杀不掉金币、僵尸也不会放大招" },
    { id: "wheel",   name: "技能轮盘", icon: "🎰", desc: "每 12 秒全场随机换一套技能与大招" },
    { id: "refresh", name: "物资刷新", icon: "🔄", desc: "每 30 秒按地图预设刷新一次：可破坏物复原、车辆满油、道具包重生（固定障碍不动）" }
  ];

  /* ---------------------------------------------------------- v2.6 闯关词条（轻 roguelite）
   * 每通关一关，从池子里 3 选 1，只在本次闯关内生效，死亡或通关后清零。 */
  LD.PERKS = [
    { id: "power",  name: "力量",   icon: "💪", desc: "造成的伤害 +20%",      apply: f => { f.perkDmg = 1.2; } },
    { id: "regen",  name: "回春",   icon: "🌿", desc: "每 10 秒回复 3 点血量", apply: f => { f.perkRegen = true; } },
    { id: "dodge",  name: "疾风步", icon: "🌪", desc: "闪避冷却 -30%",        apply: f => { f.perkDodgeM = 0.7; } },
    { id: "ultcd",  name: "蓄能",   icon: "🔮", desc: "大招冷却 -25%",        apply: f => { f.perkUltM = 0.75; } },
    { id: "shield", name: "磐石",   icon: "🛡", desc: "每关开始获得 30 点护盾", apply: f => { f.shield = Math.max(f.shield, 30); f.shieldT = 9999; } },
    { id: "vigor",  name: "健壮",   icon: "❤️", desc: "血量上限 +25%（立即生效）", apply: f => { const add = Math.round(f.maxHp * 0.25); f.maxHp += add; f.hp += add; } }
  ];

  /* ---------------------------------------------------------- v2.6 成就与称号
   * cond(d, st)：d 为存档，st 为累计战绩；达成后解锁并自动获得对应称号。
   * v2.8 起「模式称号」统一口径：在对应对战模式里累计获胜 MODE_TITLE_WINS 次。
   * 胜场读的是 st.modeWins[rule]（旧档的 relayWins / huntWins / warmupWins 在
   * 20_profile.js 的 merge 里一次性迁移进新表，不会丢进度）。 */
  LD.MODE_TITLE_WINS = 10;
  LD.modeWins = (st, id) => ((st && st.modeWins && st.modeWins[id]) || 0);
  const mw = (id) => (d, st) => LD.modeWins(st, id) >= LD.MODE_TITLE_WINS;

  const allCleared = (d, diff) => (d.progress ? LD.LEVELS.every(l => d.progress[l.id + "_" + diff]) : false);
  LD.ACHIEVEMENTS = [
    { id: "first_win",   name: "初出茅庐", icon: "🌟", desc: "赢得第一场胜利",            cond: (d, st) => st.wins >= 1 },
    { id: "boss_slayer", name: "讨伐者",   icon: "🗡", desc: "击败任意一位关卡 BOSS",      cond: (d, st) => st.bossWins >= 1 },
    { id: "kills_100",   name: "百人斩",   icon: "💯", desc: "累计击杀 100 名对手",        cond: (d, st) => st.kills >= 100 },
    { id: "kills_500",   name: "修罗",     icon: "👻", desc: "累计击杀 500 名对手",        cond: (d, st) => st.kills >= 500 },
    { id: "rich",        name: "万贯家财", icon: "💰", desc: "累计获得 500 金币",          cond: (d, st) => st.coinsEarned >= 500 },
    { id: "all_normal",  name: "关卡大师", icon: "🗺️", desc: "普通难度通关全部关卡",       cond: d => allCleared(d, "normal") },
    { id: "all_hard",    name: "孤高之巅", icon: "🏔", desc: "困难难度通关全部关卡",       cond: d => allCleared(d, "hard") },
    /* ---- 九种对战模式的专属称号，统一要求「获胜 10 次」 ---- */
    { id: "brawl_win",    name: "乱斗之王", icon: "⚔", desc: "经典乱斗获胜 10 次",  cond: mw("brawl") },
    { id: "team_win",     name: "阵营统帅", icon: "🏳", desc: "阵营模式获胜 10 次",  cond: mw("team") },
    { id: "overlord_win", name: "君临天下", icon: "👑", desc: "霸主争霸获胜 10 次",  cond: mw("overlord") },
    { id: "gifts_win",    name: "天选之人", icon: "☄️", desc: "天外来物获胜 10 次",  cond: mw("gifts") },
    { id: "ring_win",     name: "缩圈之王", icon: "⭕", desc: "缩圈乱斗获胜 10 次",  cond: mw("ring") },
    { id: "auction_win",  name: "尸潮克星", icon: "💰", desc: "丧尸危机获胜 10 次",  cond: mw("auction") },
    { id: "relay_win",    name: "擂台霸主", icon: "🥋", desc: "车轮战获胜 10 次",    cond: mw("relay") },
    { id: "hunt_win",     name: "荒野猎人", icon: "🏹", desc: "追猎时刻获胜 10 次",  cond: mw("hunt") },
    { id: "warmup_win",   name: "热身达人", icon: "🎯", desc: "乱斗热身获胜 10 次",  cond: mw("warmup") },
    { id: "doomsday_win", name: "末日幸存者", icon: "☣️", desc: "世界末日获胜 10 次", cond: mw("doomsday") },
    { id: "tower_win",   name: "推塔大师", icon: "🏰", desc: "塔防对战获胜 10 次", cond: mw("tower") },
    { id: "blackout_win", name: "暗夜守望者", icon: "🔦", desc: "停电夜战获胜 10 次", cond: mw("blackout") },
    { id: "escort_win",  name: "情报护送者", icon: "📦", desc: "护送情报箱获胜 10 次", cond: mw("escort") },
    { id: "river_win",    name: "渡江先锋",   icon: "⛵", desc: "渡江战役获胜 10 次",       cond: mw("river") },
    { id: "capture_win", name: "据点之主", icon: "🚩", desc: "占点争夺获胜 10 次", cond: mw("capture") },
    { id: "bump_win",    name: "碰碰车之王", icon: "🚗", desc: "碰碰车竞技获胜 10 次", cond: mw("bump") },
    { id: "hotpotato_win", name: "甩锅高手", icon: "🥔", desc: "烫手山芋获胜 10 次", cond: mw("hotpotato") },
    /* v4.12 娱乐模式批次的专属称号，同样要求「获胜 10 次」 */
    { id: "statue_win",   name: "木头人冠军", icon: "🗿", desc: "一二三木头人获胜 10 次", cond: mw("statue") },
    { id: "chair_win",    name: "抢位达人",   icon: "🪑", desc: "抢椅子获胜 10 次",       cond: mw("chair") },
    { id: "hide_win",     name: "藏匿大师",   icon: "🙈", desc: "躲猫猫获胜 10 次",       cond: mw("hide") },
    { id: "lava_win",     name: "踏焰者",     icon: "🌋", desc: "地板是岩浆获胜 10 次",   cond: mw("lava") },
    { id: "barrage_win",  name: "弹幕舞者",   icon: "🌠", desc: "弹幕生存获胜 10 次",     cond: mw("barrage") },
    { id: "zombie_50",   name: "清道夫",   icon: "🧟", desc: "累计击杀 50 只僵尸",         cond: (d, st) => st.zombieKills >= 50 },
    { id: "daily_win",   name: "死战英雄",   icon: "⚔", desc: "通关一次死战闯关",         cond: (d, st) => st.dailyWins >= 1 }
  ];
  LD.TITLES = [
    { id: "chuwu",   name: "初出茅庐", ach: "first_win" },
    { id: "taofa",   name: "讨伐者",   ach: "boss_slayer" },
    { id: "bairen",  name: "百人斩",   ach: "kills_100" },
    { id: "xiuluo",  name: "修罗",     ach: "kills_500" },
    { id: "wanguan", name: "万贯家财", ach: "rich" },
    { id: "guanka",  name: "关卡大师", ach: "all_normal" },
    { id: "gugao",   name: "孤高之巅", ach: "all_hard" },
    { id: "luandou",  name: "乱斗之王", ach: "brawl_win" },
    { id: "zhenying", name: "阵营统帅", ach: "team_win" },
    { id: "junlin",   name: "君临天下", ach: "overlord_win" },
    { id: "tianxuan", name: "天选之人", ach: "gifts_win" },
    { id: "suoquan",  name: "缩圈之王", ach: "ring_win" },
    { id: "shichao",  name: "尸潮克星", ach: "auction_win" },
    { id: "leitai",  name: "擂台霸主", ach: "relay_win" },
    { id: "huangye", name: "荒野猎人", ach: "hunt_win" },
    { id: "reshen",  name: "热身达人", ach: "warmup_win" },
    { id: "moriren", name: "末日幸存者", ach: "doomsday_win" },
    { id: "tuita",   name: "推塔大师",   ach: "tower_win" },
    { id: "anye",    name: "暗夜守望者", ach: "blackout_win" },
    { id: "husong",  name: "情报护送者", ach: "escort_win" },
    { id: "dujiang", name: "渡江先锋",   ach: "river_win" },
    { id: "judian",  name: "据点之主",   ach: "capture_win" },
    { id: "pengpeng", name: "碰碰车之王", ach: "bump_win" },
    { id: "shuaiguo", name: "甩锅高手", ach: "hotpotato_win" },
    { id: "mutouren", name: "木头人冠军", ach: "statue_win" },
    { id: "qiangwei", name: "抢位达人",   ach: "chair_win" },
    { id: "cangni",   name: "藏匿大师",   ach: "hide_win" },
    { id: "tayan",    name: "踏焰者",     ach: "lava_win" },
    { id: "danmu",    name: "弹幕舞者",   ach: "barrage_win" },
    { id: "qingdao", name: "清道夫",   ach: "zombie_50" },
    { id: "meiri",   name: "死战英雄", ach: "daily_win" }
  ];

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
  /* v3.9 取队色的唯一入口：塔防只有红 / 蓝两队，不能沿用四队配色
   * （四队里 1 号是黄队，塔防的蓝队会被画成黄名 / 黄点）。
   * 房间分队、头顶名字、胜负文案统一走这里。 */
  LD.teamColor = function (team) {
    if (team == null || team < 0) return null;
    /* v4.10 红蓝两队规则统一取 TEAM2 配色——以前只有塔防特判，
     * 护送 / 占点的蓝队名字沿用四队配色的 1 号黄，看起来像第三支队伍（BUG）。 */
    if (LD.Battle && (LD.Battle.rule === "tower" || LD.Battle.rule === "escort" || LD.Battle.rule === "capture"))
      return team === 1 ? "#60a5fa" : "#f87171";
    return LD.TEAM_COLORS[team] || null;
  };
  LD.RULES = [
    { id: "brawl", name: "经典乱斗", icon: "⚔", short: "乱斗", desc: "所有人互相为敌，最后站着的赢下回合。" },
    { id: "team", name: "阵营模式", icon: "🏳", short: "阵营", desc: "红黄蓝绿四队，同队之间互不造成伤害，最后只剩一个阵营时获胜。" },
    { id: "overlord", name: "霸主争霸", icon: "👑", short: "霸主", desc: "所有人混战争夺一份滚动出现的加冕资格。开局 5 秒后，一顶皇冠自天而降（落地前 5 秒有预告与落点提示）；靠近皇冠按住交互键加冕 3 秒，期间不能移动、不能出手，一旦被击中就得重头再来。加冕成功者成为霸主：血量翻倍、所有技能冷却缩短 30%，头顶加冕特效且人机仇恨优先转向他。霸主效果持续 30 秒，到期自动剥夺（血量减半、冷却复原），随后再次进入落地预告，如此循环直到场上只剩一人。" },
    { id: "gifts", name: "天外来物", icon: "☄️", short: "天外", desc: "开局只有普攻，技能与大招全靠天上降落：每 10 秒落技能、20 秒落大招，落地后按 P 拾取；技能满两格时置换最早获得的那格，被换下的留在原地。最后活着的人获胜。" },
    { id: "ring", name: "缩圈乱斗", icon: "⭕", short: "缩圈", desc: "开局只有普攻，技能与大招全靠天上掉落（技能最多同时 6 个、大招 3 个）。地图上只有几个大圈是安全区，圈外全是毒，还会掉血包——想捡就得冒险出圈。安全圈会一个个消失、并持续缩小，最终只剩一个小圈，逼所有人正面开打。最后活着的人获胜。" },
    { id: "auction", name: "丧尸危机", icon: "💰", short: "丧尸", desc: "不限时，开局只有普攻，场地不断刷出僵尸（100 血、移速 110%，固定「突刺 + 撕咬」两个技能，没有普攻 / 大招 / 闪避）骚扰全场。你可以绕开它们，也可以杀掉爆局内金币；点战斗界面右上角的商店按钮（电脑按 B）打开局内商店，花金币买血包、血量加成、移速加成（商品只在当局有效）。商店开着时战斗照常进行，最后活着的人获胜。" },
    { id: "doomsday", name: "世界末日", icon: "☣️", short: "末日", desc: "所有玩家同一阵容、互不伤害，出生在地图左端的圆形小岛上——四周全是深渊，岛缘就是墙。中间一条 10 格长、2 格宽的独木桥通向右大陆：僵尸从大陆不断刷出、过桥移速 -70%，守桥清怪是主业。整块右大陆是危险区（等同缩圈圈外），站上去每 0.5 秒掉 5 血，安全区是岛；岛上每秒回血 7。对僵尸伤害与击杀都计分（1 伤 = 1 分、击杀 +10），击杀掉局内金币，按 B 可买血包 / 血量 / 移速 / 能量球，还能买栅栏、枪台、炮台守桥。最后存活者胜；时间到时仍有多人存活则分数最高者获胜。" },
    { id: "relay", name: "车轮战", icon: "🥋", short: "车轮", desc: "排队单挑：擂台上每次只有两人对决，败者永久出局，胜者回血 30% 迎接下一位挑战者。坚持到最后的人获胜。（仅本地面板可用）" },
    { id: "hunt", name: "追猎时刻", icon: "🏹", short: "追猎", desc: "开局随机抽一名玩家当猎人（头顶皇冠、血量 800、全部 CD 减半），其余人是生存者，各自保留自己选的技能。猎人的伤害随存活幸存者数提升：每多一名幸存者就 +20%。开场有大毒圈并缓慢收缩，猎人要在倒计时内清场（时长由房间「对局时间」决定），生存者撑到倒计时结束就赢。" },
    { id: "warmup", name: "乱斗热身", icon: "🎯", short: "热身", desc: "限时刷分：开局在房间「对局时间」统一选 60 / 120 / 180 / 240 / 300 秒，阵亡后 1.6 秒随机位置复活。造成伤害与击杀都计分——每 20 点实际伤害得 1 分（大头），击杀再额外 +5 分；自伤与溢出伤害不计。时间到分数最高者获胜——不计回合、没有淘汰，纯粹练手。" },
    { id: "blackout", name: "停电夜战", icon: "🔦", short: "夜战", desc: "全场断电，每人只看得见自己身边一格。交互键变成手电筒：按下照亮前方十多格，但照亮的区域别人也看得见——开灯等于把自己暴露出去。地图上有 4 座充电站（自带 3 格公共亮光），靠近按住交互键 1.6 秒把手电筒充满。手电筒有电量，满电约能照 15 秒。摸黑时黑暗条每秒涨 1 点，攒满 30 点开始每秒掉 20 血；待在光里（自己的手电、充电站、别人的光锥）黑暗条每秒退 6 点。另外：处于<b>隐匿状态</b>（隐匿技能、柜子、草丛）的人造成的伤害提高 50%。该模式禁用大招，配装固定为 J 位移斩 + K 手里剑：手里剑蓄力 0.7 秒后高速掷出大型飞镖，命中第一个敌人造成 26 伤害并让其失明 0.6 秒。最后活着的人获胜。" },
    { id: "escort", name: "护送情报箱", icon: "📦", short: "护送", desc: "两队对抗（红 / 蓝，默认 2 队，分驻左右两端）：场地正中反复投放一个 2x2 的大情报箱。箱子不能抱起来——靠近按交互键进入推箱状态，箱子跟着你朝移动方向挪，推箱时移速只有正常的 20%；被攻击会打断推箱并眩晕 1 秒、3 秒内不能再碰箱子；已有人在推时再按会提示交互占用。把箱子推进【敌方】交付点得 1 分。先到 3 分直接获胜；时间到比分高者胜，同分则比剩余总血量（按队伍合计）。" },
    { id: "bump", name: "碰碰车竞技", icon: "🚗", short: "碰碰车", cat: "casual", desc: "圆环擂台：外围和正中心都是水池，可活动范围是一圈环形赛道——开局每人自动坐上一辆碰碰车（电力无限，技能与大招全部禁用，普攻只是喇叭）。开车撞车：接近速度越快，造成的伤害和击退越大（击退增幅相当可观），主动撞人的一方也会吃点小亏。把对手的车撞爆（+2 分）或顶进水里（+3 分，外圈内圈都算）都能得分，先到 12 分获胜。撞爆的车 4 秒后重生，落水的人 2.4 秒后回到赛道并重新发车。场上有吹风机，气流能把车吹得偏航。" },
    { id: "river", name: "渡江战役", icon: "⛵", short: "渡江", desc: "竖直变窄、横向拉长的渡江战场：左岸出发，对岸在很远的右边，中间**整片都是水**。水里几乎走不动（移速只剩三成多），只能靠船——水面上每 30 秒会重新刷一批船（竹筏 / 木船 / 渔船 / 福船，大小与速度各不相同，数量 = 存活人数 − 1），已经坐在船上的人会被强制请下船。船不能上岸，驾驶 / 油量 / 被打就翻下船，规则和汽车完全一样；水里还零星散着小岛和礁石，挡船也挡人。**开局全员只能用普攻**，技能与大招全锁着；一路冲到右岸、在岸边中央的旗子前按 P 完成登岸，技能与大招就全部解锁。人机会优先抢船过江，上岸后进入正常战斗，并且对**快要靠岸的人**有更高的仇恨。**55 秒后江水开始上涨**，每隔几秒就从左边吃掉一条岸——赖着不动是会被泡进江里的。江面还有一个向下游的水流，人和船都会一直往下漂，过江必须边往右打舵边修正航向；顺水漂下来的**小油桶**可以给船加油（游泳的人捡到回血回能），要不要绕路去捡是这一局的核心取舍。活到最后的人获胜。" },
    { id: "capture", name: "占点争夺", icon: "🚩", short: "占点", desc: "两队对抗（红 / 蓝）：地图 1920 × 1920，据点保底 3 座（左、中、右各一），房间每多 2 名玩家再加 1 座（最多 6 座），多出来的随机分布；中央大点权重 2，其余各 1。站进圈内读条占领，人越多越快：空据点单人 5 秒，抢敌方已经占下的据点要花两倍时间（10 秒）；双方都在圈里则僵持，谁也推不动。占领后据点每秒产分，中央大点权重 2，其余各 1，先到 80 分获胜；圈里没人时对方的占领进度会缓慢回落。据点被占领后中心会升起一座炮塔，数值与塔防防御塔相同、射程等于据点半径，只打敌方角色；据点易主时炮塔跟着换攻击目标、血量不变，被拆掉后本局永久消失。阵亡后在**全图随机位置**复活，首次 3 秒，之后每死一次 +3 秒（最多 24 秒）；站在己方已占领的据点圈里每秒回 2 点血，据点炮塔伤害为基准的 80%。时间到比分高者胜，同分则比队伍剩余总血量。" },
    { id: "tower", name: "塔防对战", icon: "🏰", short: "推塔", desc: "两队单线推塔（人数不限、可对等也可不对等，一局 10 分钟）：地图窄长，左右各一座水晶与两座防御塔，塔和水晶会主动攻击进入范围的敌人。双方每 22 秒刷 6 只机器人小兵沿兵线推进；拆掉敌方全部防御塔才能打水晶。击杀小兵 / 英雄 / 助攻都给局内金币，买装备强化自己；阵亡后有复活倒计时，在基地复活。水晶被拆直接获胜，时间到按队伍击杀数判胜。该模式没有大招，英雄 1-6 级，升级加血加伤害。" },
    { id: "hotpotato", name: "烫手山芋", icon: "🥔", short: "山芋", cat: "casual", desc: "禁用普攻、技能与大招：开局随机抽一个人当「山芋」的第一任主人，先给 3 秒预警，随后山芋从天而降锁到他头上。刚接手的人会有 2 秒的 50% 减速，这 2 秒内传不出去；熬过这 2 秒后速度提升到正常的 120%（比别人快），可以去追人。碰到别人就把山芋甩给他——对方同样吃 2 秒减速且期间不能再传。从山芋落到第一个人手上开始计时，30 秒后爆炸：持有者直接掉 75 血，爆炸小范围内其他人掉 50 血。炸完重新抽人、重新计时，循环往复。" },

    /* ---- v4.12 娱乐模式批次：胜负与击杀脱钩，禁用普攻 / 技能 / 大招，P 键交互保留 ---- */
    { id: "statue", name: "一二三木头人", icon: "🗿", short: "木头人", cat: "casual", desc: "两倍长的跑道，全员从最左边跑到最右边的终点线，移速只有平时的 70%。场上**没有坚守者实体**——取代它的是地图右方天上的监测者，而它什么时候在观测**没有任何预警**：观测发生时，所有还在移动的人会被天上砸下来的光束命中，掉血并被往左击退（进度保留，不退回起点）。唯一的情报来源就是**看别人有没有被打**。躲在掩体左方几格内是监测死角，站着不动也不会挨打。场上还会刷新道具包，走近按 P 开包回血或短暂提速。本模式禁用普攻 / 技能 / 大招，先到终点线的人获胜。" },
    { id: "chair", name: "抢椅子", icon: "🪑", short: "抢椅子", cat: "casual", desc: "椅子数量从多到少：开局比人数多两把，每轮少一把，最少剩一把。每轮**先只给一个时间提示**，谁都不知道椅子会刷在哪；倒计时一结束，椅子在地图上**瞬间随机出现**，所有人在这一刻才拿到位置并立刻开抢。抢座不是靠范围圈自动判定——要**贴到椅子边按 P 才坐得下**（判定半径 28，比原来收紧了一圈，不再隔老远就能坐下）。场上还撒了 5 台**吹风机**，抢座的路上会被侧风推偏。其中可能混着**假椅子**，外观和真的一模一样，坐上去当场散架、白跑一趟还得愣神。没抢到只扣 55 血，不会出局。血空才出局，最后站着的人获胜；本模式禁用普攻 / 技能 / 大招。" },
    { id: "hide", name: "躲猫猫", icon: "🙈", short: "躲猫猫", cat: "casual", desc: "开局随机一人当鬼（血更厚、移速 120%），并且**开局的鬼要先黑 10 秒 + 定身 10 秒**。场上普通障碍很少、柜子与草丛极多，躲的人钻柜子 / 猫草丛就看不见；**躲多久都不会自己暴露**。**这个模式只发一个招式，就放在 J 键上**：躲的人 J = 隐匿（隐身 4 秒、CD 15 秒），鬼 J = 抓人（身边小范围 **100 伤害**、CD 2 秒）——**对着柜子或草丛抓也能把人直接揪出来**，所以「我看到他躲这儿了却打不到」不会再有。躲的人有 200 血，**不是一碰就抓到，要挨满两下（200 伤害）才会变成鬼**（不是死亡），J 键也随之从「隐匿」换成「抓人」。鬼靠近柜子 / 草丛停留 0.9 秒会自动搜查，**但搜查只负责把人揪出来（弹出 + 眩晕），伤害全部来自 J**。被抓的人**反过来加入鬼的阵营**一起抓剩下的人。当鬼时**看不到任何索敌指引**：没有视野外箭头、没有头顶身份标记、也不显示别人的名字。每 30 秒场上刷一件道具，靠近**按住 P 蓄力 2 秒**才拿得走：鬼拿到会随机锁定一个躲藏者 10 秒拿到他的位置，人拿到则让所有鬼定身 + 失明 10 秒、且搜查耗时翻倍。撑到时间结束还有人没被抓到就是躲藏者赢，被抓光则是鬼赢。" },
    { id: "lava", name: "地板是岩浆", icon: "🌋", short: "岩浆", cat: "casual", desc: "地图缩到常规场地的七成，地砖会周期性地发红：先闪 2 秒预告，然后真正致命 2.6 秒，站上去每秒掉 55 血（**按整个身体判定**，贴着格子边缘站也会被烫到）。**没有安全台**——不存在站着就绝对安全的地方，只能靠走位躲开红格；而且安全格只有**场上存活人数 + 1** 块，其余格子全烧——人越少落脚地越少，后期就是几个人抢最后几块砖。抢同一块格子时可以把人撞开：沿用冰面滑壶那套互撞规则（相对速度够快才算撞），但击退距离削弱到 77%。血空才出局，最后站着的人获胜；本模式禁用普攻 / 技能 / 大招。" },
    { id: "barrage", name: "弹幕生存", icon: "🌠", short: "弹幕", cat: "casual", desc: "场地边缘架着 5 座炮台，持续朝场内倾泻弹幕；弹幕每 12 秒换一种模式（来回扫射 / 环形齐射 / 瞄准追人），换模式时有 3 秒安全间隙喘口气。被弹幕打中掉 22 血并被推开。活得最久的人获胜，也可以靠走位把对手逼进弹道。本模式禁用普攻 / 技能 / 大招。" }
  ];
  LD.ruleInfo = (id) => LD.RULES.find(r => r.id === id) || LD.RULES[0];
  /* v4.12 分类：cat 缺省视为战斗模式；房间界面按这两个列表分组排布 */
  LD.rulesBy = (cat) => LD.RULES.filter(r => (r.cat || "combat") === cat);

  /* ---------------------------------------------------------- v4.19 新手教程
   *
   * 第一次进游戏时主菜单第一行不是「单人游戏」，而是「新手教程」。
   * 教程是一条横向走廊：出生在最左边，七个步骤依次往右推进，
   * 每一步在屏幕上方正中央给一条提示。
   *
   * 地图**不生成任何道具**（mapCfg 的 counts 全 0，也没有天外来物 / 血包）：
   * 教学要的是「眼前只有这一件事」，突然冒出来的血包和补给箱会打断节奏。
   *
   * dummy 是这一步要在哪个 x 放木桩（木桩 = 简单人机，aggr 0，不动也不出手）。
   * 一个木桩 4000 血，就是为了让玩家随便打都不会打死 —— 教程里不需要「赢」。
   */
  LD.TUT = {
    world: { w: 2600, h: 900, pt: 100 },
    spawnU: 0.07,          // 出生点（占世界宽的比例）
    firstReward: 50,       // 首次通关奖励
    againReward: 5,        // 之后再通关
    moveDist: 64,          // 走了多远算「学会移动」
    dummyHp: 4000,
    dir: "往右走",         // 每一步都挂在提示条上的方向牌
    endDelay: 5,           // 放完大招到结算之间留几秒（让爆炸演完、不打断玩家）
    /* 物件之间只隔 220~280px：上一版 mud 1400 / car 1780 / box 2140 走得太远，
     * 每一步都要跑两三秒空路，节奏全断。现在从出生点一路推过去不用停。 */
    steps: [
      { id: "move",   tip: "用 W A S D 向右走", sub: "点屏幕左侧的方向键也能走" },
      { id: "attack", tip: "按 J 普攻，砍中前面的木桩", sub: "J = 普攻", dummy: 560 },
      /* 技能沿用左边这根木桩，不再另刷一个（教程里只要两根木桩就够） */
      { id: "skill",  tip: "按 K 激光波、按 L 神龙掌，两个都要打中木桩", sub: "K = 技能一　L = 技能二" },
      /* 索敌：右边立第二根木桩，教 V 键把锁定切过去 */
      { id: "lock",   tip: "按 V 切换索敌，把锁定切到右边那个木桩", sub: "V = 切换锁定目标（Shift+V 反向）", dummy: 860 },
      /* 闪避：电脑双击方向键，手机点「闪」键。能穿墙、能靠位移躲开攻击，
       * 但和普攻共用冷却（闪完 2.5 秒内没法普攻）。这一步只要求「用出来一次」。 */
      { id: "dodge",  tip: "双击方向键闪避（手机按「闪」键）", sub: "能穿墙、能躲开攻击；闪避和普攻共用冷却，闪完要等一会儿才能砍" },
      { id: "mud",    tip: "走近泥土，按 P 捡起来", sub: "再按一次 P 朝前扔出去", mud: 1080 },
      { id: "car",    tip: "走近汽车按 P 上车，再按 P 下车", sub: "坐在车上被攻击会被震下车并眩晕 2 秒", car: 1320 },
      { id: "box",    tip: "走近补给箱，按住 P 搜刮打开", sub: "里面会掉血包 / 道具包 / 移速包", box: 1580 },
      { id: "ult",    tip: "能量已满！按 O 释放大招「虚空爆裂斩」", sub: "O = 大招" }
    ]
  };

  /* ==========================================================
   * v4.17 主菜单动态立绘（真·分层伪 Live2D）
   * ----------------------------------------------------------
   * 素材由 scripts/proc_char.py 从立绘里切出来：背景 / 人物底 / 头发 / 裙摆 / 双臂
   * 是六张独立的 RGBA 位图。位移只作用在部位自己的图层上，**背景一个像素都不动**，
   * 所以不会再出现「头发一动连山都歪了」。
   *
   * 取值原则（仍是「飘」不是「抖」）：
   *   · 周期 5.6~7.4 秒、阵风包络 9~11 秒，各层频率互不相同，不会同步抽动
   *   · 幅度 2~12 画布像素，头发最大、手臂最小
   *   · ramp 让根部钉死、梢部最大 —— 发根不动才像挂在头上，而不是整条在平移
   * 坐标全部用**整帧 UV**（0~1），换图只改 meta.json 与这里的数字。
   * ========================================================== */
  LD.LIVE2D = {
    on: true,
    w: 1600, h: 1000,        // 渲染缓冲：分层素材要这个尺寸才看得出细节
    fps: 30,                 // 菜单是静态界面，30 帧足够，省一半电
    focusX: 0.19,            // 横向取景：0=贴左边 1=贴右边（角色略偏左，右边留给菜单）
    focusY: 0.5,
    /* 呼吸：只缩人物、不缩背景（背景要是跟着缩，山会跟着一起「呼吸」，很假）。
     * 锚点放在画面底部（脚底），否则人物会上下滑。0.0035 只让头动 2~3px。 */
    breath: 0.0035,
    breathPer: 13,
    /* 重心摆动：绕**脚下**微转 + 横移。呼吸只管「上下」，站久了人还会左右换脚，
     * 这一项才是「整个人在动」。0.26 度在 900px 身高上约等于头顶 4px，
     * 单帧看不出来，连起来看就不僵。pivotUV 是支点：落在人物脚下的岩石上，
     * 脚才不会跟着慢慢打滑。 */
    sway: { amp: 1.6, rot: 0.26, per: 11.5, per2: 4.6, pivotUV: [0.33, 0.97] },
    motes: 22,               // 空气里缓慢上浮的光尘数量（0 = 关掉）
    /* 眨眼：静态图没有闭眼帧。近眼用**专门生成的闭眼皮肤层**（lid）：
     * 一块带真实肤色与皮肤纹理的上眼皮，运行时沿「眼皮下缘」裁切着扫下来，
     * 盖住眼球；眼球本身不动，眼线跟着下缘走。
     * 早先直接拿 body 垫底皮肤当眼睑，那块是归一化卷积外推出来的、只有低频，
     * 闭眼时就是一团糊（用户反馈）。lashes 每项 = 一只眼睛：
     *   u/v 眼睛中心，r 半宽，h 半高，len 眼线长度占眼宽比例
     *   p = 0    只画睫毛线、不铺眼睑皮肤
     *   lid = "lid"       近眼：有独立闭眼皮肤层，按眼皮下缘裁切
     *   lidFar = "lidFar" 远眼：只有皮肤贴片，同样按眼皮下缘裁切
     * 坐标是 4K 母版 UV，由暗像素行列剖面 / 4x 放大网格量出。 */
    blink: {
      on: true,
      /* 节奏偏慢：一次 0.40 秒（快眨是 0.15 秒，这里刻意放慢才显得松弛）。
       * 闭合和睁开都用较长的时长，中间几乎不停顿 —— 不停顿才不像「机械开关」。 */
      gapMin: 3.4, gapMax: 7.8,   // 两次眨眼间隔（秒），偶尔连着眨两下
      close: 0.11, hold: 0.08, open: 0.21,
      lashes: [
        { u: 0.3606, v: 0.1786, r: 0.0134, h: 0.0106, len: 0.76, lid: "lid" },
        /* 远眼在鼻梁右侧（不是更靠外的发丝上）：4x 面部放大 + 网格量出
         * u 0.3796~0.3867 / v 0.1751~0.1890。它没有独立眼球层，
         * 只有一张闭眼皮肤贴片 lidFar；眼线同样跟着下缘走。 */
        { u: 0.3832, v: 0.1820, r: 0.0036, h: 0.0070, len: 0.66, lidFar: "lidFar" }
      ],
      lashColor: "rgba(52,32,34,0.92)"
    },
    /* 绘制顺序（从后到前）。素材怎麼切就怎麼畫 —— 运行时只认这张表，
     * JS 里不再硬编码图层顺序。刀必须压在裙摆之上、右手之下：
     * 它是插在腰带里的实物，不能跟着裙摆摆。五官压在脸皮之上。 */
    order: ["body", "skirt", "sword", "armA", "armB", "hair", "eye", "mouth"],
    /* 部位动画：每个部位对应 proc_char.py 切出来的一张 RGBA 位图。
     * 两套变形器：
     *   band  —— 切横带的软体（头发 / 裙摆 / 手臂），模型是钟摆链
     *   rigid —— 整体刚体变换的硬物（眼睛 / 嘴），平移 + 缩放
     *
     * band 的参数：
     *   seg   链条分几节（每一节对应一个变形器，位移场按高度分段累加）
     *   gain  每往下一节衰减多少（0.9 = 越到梢越软、幅度越小）
     *   lag   每往下一节多滞后多少弧度（波从根跑到梢需要时间）
     *   per / per2  驱动力（风）的基频与二次谐波，秒
     *   pin   钉住窗口：pin[0] 以下一动不动（发根/腰头），pin[1] 以上满幅
     *   edge  底边也钉住的窗口宽度（手臂专用：两头钉、中间鼓）
     *   amp / vy   画布像素（画布 1600 宽）。amp 是**单节满幅**上限
     *   push / pushY  风向的恒定推力（负 = 往左吹），让左右摆不再对称
     *   wlag  这一层收到阵风的延迟（秒）。头发最先，裙摆最后 —— 差值就是「风跑过去」的感觉
     *   band  切带高度。**不是越小越好**：每条带的上下边缘都落在亚像素位置，
     *         canvas 会铺一排抗锯齿半透明像素；band 太小等于每几像素盖一层
     *         半透明白纱，整片发灰。12~24 够平滑又干净。
     */
    parts: {
      /* 长发：主戏。根钉在发绳上，梢最松，横向摆动为主。
       * 26px 是「看得见的风」，再大就会露出身体上被挖掉的那块洞。 */
      hair:  { band: 16, amp: 26, per: 6.2, per2: 3.8, seg: 8, gain: 0.90, lag: 0.16,
               vy: 0.16, pin: [0.02, 0.28], ph: 0.4, push: -0.30, pushY: -0.10, wlag: 0 },
      /* 黑袴：比头发沉，幅度小一截、节奏慢一点、收到风也晚 0.55 秒 */
      skirt: { band: 18, amp: 16.5, per: 7.2, per2: 4.4, seg: 6, gain: 0.93, lag: 0.13,
               vy: 0.09, pin: [0.06, 0.42], ph: 3.1, push: -0.22, wlag: 0.55 },
      /* 手臂：中间鼓、两头钉。v4.19 起 body **不再从手臂处挖洞**（psd2live 的
       * 「遮挡区域留余量」），手臂摆开时让位露出来的是 body 上同一块肤色，
       * 而不是天空 —— 所以这里终于可以给到 4px 以上，手也不会再从腕部断开。
       * 手 / 刀柄完全不在手臂层里（切层时下界收到 v 0.472）。 */
      armA:  { band: 12, amp: 4.2, per: 5.6, per2: 3.4, seg: 4, gain: 0.96, lag: 0.10,
               vy: 0.05, pin: [0.10, 0.45], edge: 0.18, ph: 1.7, push: -0.12, wlag: 0.25 },
      armB:  { band: 12, amp: 3.8, per: 6.2, per2: 3.6, seg: 4, gain: 0.96, lag: 0.10,
               vy: 0.05, pin: [0.10, 0.45], edge: 0.18, ph: 4.4, push: -0.10, wlag: 0.30 },
      /* 眼睛（近眼，远眼没有独立层）：微扫视 + 风大时微眯。
       * amp 只有 1.5px，但眼睛是整张图观众唯一会盯着看的地方，1.5px 就够。
       * **闭眼不在这里做** —— 纵向压扁会把虹膜压成扁疙瘩，
       * 改成在 drawBlink 里让「眼皮」从上面扫下来盖住眼球（见 86_live2d.js）。 */
      eye:   { kind: "rigid", amp: 1.5, ampY: 0.85, gaze: true, gazeStep: 1.25,
               squint: 0.035, anchor: "bottom", ph: 0.6, lidClip: true },
      /* 嘴：呼吸带着微微开合（锚在顶边 = 下唇往下走），另加 0.6px 的漂移 */
      mouth: { kind: "rigid", amp: 0.6, ampY: 0.35, open: 0.055, openPer: 13,
               openDy: 0.35, anchor: "top", ph: 2.2 }
    }

  };

  /* 全部默认值就绪后再应用平衡配置覆盖 */
  LD.applyBalance();
})(window.LD = window.LD || {});
