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
        tags: ["大招"], dur: 4.0, interval: 0.28, proj: { speed: 840, r: 12, life: 1.6 },
        desc: "施放瞬间锁定朝向，4 秒内向前方直线倾泻高速剑气（每把 10 点伤害），弹道不追踪，靠走位把对手压进火力线。" });

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

  /* ---------------------------------------------------------- v3.2 世界末日参数
   * 所有玩家同队（互不伤害），靠击杀僵尸 / 输出赚分，最后存活或时间到分数最高者获胜。
   * 庇护所固定在场地中心，石墙环 + 左右两个两格宽门洞；墙外持续掉血。 */
  LD.DOOMSDAY = {
    r: 280,             // 庇护所外墙半径
    gap: 2,             // 门洞宽度（格），左右各一个
    sprayBase: 3.6,     // 刷怪基础间隔（秒）：存活玩家越多越快（除以存活人数）
    sprayMin: 0.9,      // 刷怪间隔下限
    maxBase: 4,         // 在场僵尸上限基准
    maxPer: 1.8,        // 每名存活玩家额外允许的僵尸数
    outTick: 0.6,       // 墙外红圈掉血间隔
    outDmg: 4,          // 墙外每次掉血
    gateR: 92,          // 门洞减速圈半径（僵尸在圈内减速）
    gateSlow: 0.5,      // 减速圈内的移速倍率
    scoreDmg: 1,        // 对僵尸造成 1 点伤害 = 1 分
    scoreKill: 10,      // 击杀一只僵尸 = 10 分
    coin: 2             // 击杀僵尸掉的局内金币
  };

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
    mudDmg: 22,         // 泥土砸中伤害
    mudSpeed: 430,      // 泥土投掷初速
    refreshEvery: 30    // 「物资刷新」修饰符的间隔
  };

  /* ---------------------------------------------------------- v3.3 可驾驶车辆
   * speed：相对玩家基础移速（195）的倍率；fuel：满油可行驶距离（像素）
   * 速度 / 油量都在生成时按区间随机，同一颗种子两端一致。 */
  LD.VEHICLES = {
    sedan: { id: "sedan", name: "轿车", tiles: [2, 1], speed: [1.20, 1.70], fuel: [2000, 6000], hp: 0 },
    van:   { id: "van",   name: "面包车", tiles: [2, 1], speed: [1.15, 1.45], fuel: [2000, 5600], hp: 0 },
    bus:   { id: "bus",   name: "大巴", tiles: [3, 1], speed: [0.88, 1.02], fuel: [2000, 5200], hp: 0, big: true },
    tank:  { id: "tank",  name: "坦克", tiles: [2, 2], speed: [0.72, 0.86], fuel: [2000, 3200], hp: 0,
             cannon: { cd: 5, dmg: 15, speed: 460, r: 9 }, ejectStun: 2 }
  };
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
    times: [60, 120, 180],   // 三档对局时间（秒）
    def: 120                 // 默认 120 秒
  };

  /* ---------------------------------------------------------- v2.7 乱斗热身参数 */
  LD.WARMUP = {
    respawn: 1.6,            // 阵亡后 1.6 秒原地复活
    invuln: 1.6,             // 复活后无敌时间
    scoreKill: 1
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
    respawn: { base: 8, perLv: 2.2, max: 28, invuln: 2.0 },
    wave: { first: 10, every: 32, count: 6, spread: 34 },
    minion: { hp: 67, dmg: 9, atk: 1.15, range: 40, aggro: 190, speed: 62, r: 12,
              gold: 32, xp: 20, scalePerTower: 0.15 },
    tower: { hp: 1500, dmg: 26, range: 300, atk: 1.05, projSpeed: 1100, homing: 3.4, r: 46, h: 96 },
    crystal: { hp: 3000, dmg: 34, range: 340, atk: 1.2, projSpeed: 1050, homing: 3.8, r: 58, h: 110 },
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
    { id: "refresh", name: "物资刷新", icon: "🔄", desc: "每 30 秒按地图预设刷新一次：可破坏物复原、车辆满油、能量包重生（固定障碍不动）" }
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
  LD.RULES = [
    { id: "brawl", name: "经典乱斗", icon: "⚔", short: "乱斗", desc: "所有人互相为敌，最后站着的赢下回合。" },
    { id: "team", name: "阵营模式", icon: "🏳", short: "阵营", desc: "红黄蓝绿四队，同队之间互不造成伤害，最后只剩一个阵营时获胜。" },
    { id: "overlord", name: "霸主争霸", icon: "👑", short: "霸主", desc: "所有人 + 巨龙同场混战。巨龙被击败会爆出能量石并飞向随机位置，第一个抢到的人成为霸主：血量上限与当前血量翻 1.5 倍，头顶加皇冠；人机仇恨会转向霸主。霸主阵亡后能量石直接消散，不再掉落。" },
    { id: "gifts", name: "天外来物", icon: "☄️", short: "天外", desc: "开局只有普攻，技能与大招全靠天上降落：每 10 秒落技能、20 秒落大招，落地后按 P 拾取；技能满两格时置换最早获得的那格，被换下的留在原地。最后活着的人获胜。" },
    { id: "ring", name: "缩圈乱斗", icon: "⭕", short: "缩圈", desc: "开局只有普攻，技能与大招全靠天上掉落（技能最多同时 6 个、大招 3 个）。地图上只有几个大圈是安全区，圈外全是毒，还会掉血包——想捡就得冒险出圈。安全圈会一个个消失、并持续缩小，最终只剩一个小圈，逼所有人正面开打。最后活着的人获胜。" },
    { id: "auction", name: "丧尸危机", icon: "💰", short: "丧尸", desc: "不限时，开局只有普攻，场地不断刷出僵尸（100 血、移速 110%，固定「突刺 + 撕咬」两个技能，没有普攻 / 大招 / 闪避）骚扰全场。你可以绕开它们，也可以杀掉爆局内金币；点战斗界面右上角的商店按钮（电脑按 B）打开局内商店，花金币买血包、血量加成、移速加成（商品只在当局有效）。商店开着时战斗照常进行，最后活着的人获胜。" },
    { id: "doomsday", name: "世界末日", icon: "☣️", short: "末日", desc: "所有玩家同一阵容、互不伤害，出生在地图中央的石墙庇护所里（左右各一个两格宽门洞）。墙外不断刷出僵尸，存活玩家越多刷新越快；僵尸会直冲门洞闯进来，而门洞外有一圈减速带，僵尸进圈后移速减半，玩家要守住庇护所、清掉它们。墙外是红圈，待在外面会持续掉血。对僵尸造成的伤害与击杀都计分，击杀还会掉局内金币（按 B 开商店买血包 / 血量 / 移速 / 能量球）。最后存活的玩家获胜；时间到时还有多人存活，则分数最高者获胜（不看剩余血量）。" },
    { id: "relay", name: "车轮战", icon: "🥋", short: "车轮", desc: "排队单挑：擂台上每次只有两人对决，败者永久出局，胜者回血 30% 迎接下一位挑战者。坚持到最后的人获胜。（仅本地面板可用）" },
    { id: "hunt", name: "追猎时刻", icon: "🏹", short: "追猎", desc: "开局随机抽一名玩家当猎人（头顶皇冠、血量 800、全部 CD 减半），其余人是生存者，各自保留自己选的技能。猎人的伤害随存活幸存者数提升：每多一名幸存者就 +20%。开场有大毒圈并缓慢收缩，猎人要在倒计时内清场（时长由房间「对局时间」决定），生存者撑到倒计时结束就赢。" },
    { id: "warmup", name: "乱斗热身", icon: "🎯", short: "热身", desc: "限时刷分：开局在房间「对局时间」统一选 60 / 120 / 180 秒，阵亡后 1.6 秒随机位置复活，每次击杀得 1 分。时间到分数最高者获胜——不计回合、没有淘汰，纯粹练手。" },
    { id: "tower", name: "塔防对战", icon: "🏰", short: "推塔", desc: "3v3 单线推塔（一局 10 分钟）：地图窄长，左右各一座水晶与两座防御塔，塔和水晶会主动攻击进入范围的敌人。双方每 22 秒刷 6 只机器人小兵沿兵线推进；拆掉敌方全部防御塔才能打水晶。击杀小兵 / 英雄 / 助攻都给局内金币，买装备强化自己；阵亡后有复活倒计时，在基地复活。水晶被拆直接获胜，时间到按队伍击杀数判胜。该模式没有大招，英雄 1-6 级，升级加血加伤害。" }
  ];
  LD.ruleInfo = (id) => LD.RULES.find(r => r.id === id) || LD.RULES[0];

  /* 全部默认值就绪后再应用平衡配置覆盖 */
  LD.applyBalance();
})(window.LD = window.LD || {});
