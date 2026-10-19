/* ============================================================
 *  13_terrain_data.js — v3.1 地图地形：材质、预设、BOSS 地图
 * ============================================================
 *  所有障碍以「格」为最小单位（1 格 = 40 x 40 世界像素）。
 *  一个障碍可以占多格，摆放时整格对齐，生成后位置固定；
 *  只有「可推动障碍」被击打 / 被角色推挤后才会脱离格子自由移动。
 *
 *  地形类别：
 *    solid     实心障碍：挡人 + 挡飞行物，不可破坏（石柱 / 木柱 / 钢柱 / 晶柱）
 *    breakable 可破坏：  挡人 + 挡飞行物，吃伤害，血量归零后碎裂（木箱 / 铁箱 / 陶罐）
 *    pushable  可推动：  挡人 + 挡飞行物，不可破坏，吃伤害产生速度（近战推力更大）
 *    fence     围栏：    挡人，但飞行物可以穿过（木栅 / 铁栅 / 竹篱）
 *    bush      草丛：    不挡人不挡弹，站进去隐身；多格成片生成
 *    water     水池：    不挡人不挡弹，踩上去减速；多格成片生成
 *    barrel    炸药桶：  挡人挡弹，受击积累伤害，被打爆后原地大范围爆炸
 *    car       汽车：    多格，可推动、不可破坏；不同车型质量不同
 *    tire      轮胎：    可推动，质量很轻，一碰就滚
 *    supply    补给箱：  可破坏，蓝白配色带蓝光，打破后掉出血包 / 能量包 / 移速包
 *    barricade 路障：    可破坏，挡人挡弹
 *    room      建筑：    生成时铺成一圈石墙围出的房间（留 1-2 个门洞），墙本身算 solid
 * ============================================================ */
(function (LD) {
  "use strict";

  LD.TERRAIN = {
    tile: 40,

    /* 各类地形的通行规则（战斗层直接读这里，不要在各处硬编码） */
    types: {
      solid:     { name: "实心障碍", blockMove: true,  blockProj: true,  damageable: false, pushable: false },
      breakable: { name: "可破坏",   blockMove: true,  blockProj: true,  damageable: true,  pushable: false },
      pushable:  { name: "可推动",   blockMove: true,  blockProj: true,  damageable: false, pushable: true },
      fence:     { name: "围栏",     blockMove: true,  blockProj: false, damageable: false, pushable: false },
      bush:      { name: "草丛",     blockMove: false, blockProj: false, damageable: false, pushable: false, soft: true },
      water:     { name: "水池",     blockMove: false, blockProj: false, damageable: false, pushable: false, soft: true, slow: 0.55 },
      barrel:    { name: "炸药桶",   blockMove: true,  blockProj: true,  damageable: true,  pushable: false, explosive: true },
      car:       { name: "汽车",     blockMove: true,  blockProj: true,  damageable: false, pushable: true },
      tire:      { name: "轮胎",     blockMove: true,  blockProj: true,  damageable: false, pushable: true },
      supply:    { name: "补给箱",   blockMove: true,  blockProj: true,  damageable: true,  pushable: false, drop: true },
      barricade: { name: "路障",     blockMove: true,  blockProj: true,  damageable: true,  pushable: false },
      room:      { name: "建筑",     blockMove: true,  blockProj: true,  damageable: false, pushable: false },
      /* v3.3：柜子可破坏、可躲藏；泥土不挡人不挡弹，按 P 拾起再扔 */
      locker:    { name: "柜子",     blockMove: true,  blockProj: true,  damageable: true,  pushable: false, hide: true },
      mud:       { name: "泥土",     blockMove: false, blockProj: false, damageable: false, pushable: false, pickup: true },
      /* v3.5 吹风机：机身挡人挡弹、可打坏；朝固定方向持续喷风（气流本身不挡人） */
      blower:    { name: "吹风机",   blockMove: true,  blockProj: true,  damageable: true,  pushable: false, wind: true },
      /* v3.7 塔防对战：建筑沿用「可破坏障碍」逻辑（有血量、被打坏后 dead） */
      tower:     { name: "防御塔",   blockMove: true,  blockProj: true,  damageable: true,  pushable: false, structure: true },
      crystal:   { name: "水晶",     blockMove: true,  blockProj: true,  damageable: true,  pushable: false, structure: true },
    },

    /* 障碍材质：pal 为程序化像素贴图的调色板，elev 为视觉高度（像素），mass 越小越好推 */
    mats: {
      solid: [
        { id: "stone", name: "石柱", shape: "round", elev: 34, mass: 2.6,
          pal: { top: "#5b6472", hi: "#7b8798", lo: "#414957", edge: "#232935", spec: "#9aa6b8" } },
        /* v3.2 世界末日：方形石墙块（只由庇护所生成器使用，不进随机池） */
        { id: "wall_stone", name: "石墙", shape: "square", elev: 34, mass: 3.2, noRandom: true,
          pal: { top: "#565f6c", hi: "#78848f", lo: "#3c434e", edge: "#1e232b", spec: "#9aa6b8" } },
        { id: "wood", name: "木柱", shape: "round", elev: 32, mass: 1.4,
          pal: { top: "#6b5236", hi: "#8a6a45", lo: "#4a3823", edge: "#2a1e12", spec: "#a8875c" } },
        { id: "metal", name: "钢柱", shape: "square", elev: 38, mass: 3.2,
          pal: { top: "#4a5563", hi: "#69788a", lo: "#333c48", edge: "#1b212a", spec: "#93a4b8" } },
        { id: "crystal", name: "晶柱", shape: "round", elev: 30, mass: 2.2,
          pal: { top: "#5b4b8a", hi: "#8b74c9", lo: "#3d3261", edge: "#221a3a", spec: "#c4b5fd" } }
      ],
      breakable: [
        { id: "crate_wood", name: "木箱", shape: "square", elev: 26, hp: 55, mass: 1.2,
          pal: { top: "#7a5a34", hi: "#9a7444", lo: "#5a4125", edge: "#2f2113", spec: "#c39a62" } },
        { id: "crate_metal", name: "铁箱", shape: "square", elev: 28, hp: 95, mass: 2.4,
          pal: { top: "#59636f", hi: "#7d8b9b", lo: "#3e4651", edge: "#1c222a", spec: "#aab8c8" } },
        { id: "crate_clay", name: "陶罐", shape: "round", elev: 24, hp: 35, mass: 0.8,
          pal: { top: "#8a4a33", hi: "#b06446", lo: "#653424", edge: "#331a12", spec: "#d9997a" } }
      ],
      pushable: [
        { id: "block_stone", name: "石墩", shape: "square", elev: 26, mass: 2.8,
          pal: { top: "#626b78", hi: "#828d9c", lo: "#464e5a", edge: "#262c35", spec: "#a3afbf" } },
        { id: "block_wood", name: "木箱墩", shape: "square", elev: 26, mass: 1.2,
          pal: { top: "#77552f", hi: "#997142", lo: "#573c20", edge: "#2e1f11", spec: "#c49a60" } },
        { id: "block_metal", name: "铁墩", shape: "square", elev: 28, mass: 3.8,
          pal: { top: "#505a66", hi: "#74818f", lo: "#38414b", edge: "#1a2027", spec: "#a4b2c3" } }
      ],
      fence: [
        { id: "fence_wood", name: "木栅栏", shape: "bar", elev: 28, mass: 1,
          pal: { top: "#7b5a33", hi: "#9c7444", lo: "#5b4022", edge: "#2f2012", spec: "#c9a06a" } },
        { id: "fence_metal", name: "铁栅栏", shape: "bar", elev: 30, mass: 1,
          pal: { top: "#5a6470", hi: "#7f8d9c", lo: "#3d4650", edge: "#1c2229", spec: "#aebbcb" } },
        { id: "fence_bamboo", name: "竹篱", shape: "bar", elev: 28, mass: 1,
          pal: { top: "#6d6a35", hi: "#8f8b4a", lo: "#4e4b23", edge: "#2a2811", spec: "#c2bd78" } }
      ],
      bush: [
        { id: "bush_leaf", name: "灌木丛", shape: "bush", elev: 0,
          pal: { top: "#2f5a33", hi: "#4a7d4b", lo: "#1c3a21", edge: "#102315", spec: "#86b982" } },
        { id: "bush_flower", name: "花丛", shape: "bush", elev: 0,
          pal: { top: "#3a5c38", hi: "#578a52", lo: "#22401f", edge: "#132612", spec: "#d9c2f0" } },
        { id: "bush_dry", name: "枯草丛", shape: "bush", elev: 0,
          pal: { top: "#6a6338", hi: "#8d8349", lo: "#47421f", edge: "#262310", spec: "#c9bf7d" } }
      ],
      water: [
        { id: "water_pool", name: "水池", shape: "water", elev: 0,
          pal: { top: "#2f6f86", hi: "#4c9ab5", lo: "#1d4b5c", edge: "#12313d", spec: "#a5e8f7" } },
        { id: "water_swamp", name: "浊水", shape: "water", elev: 0,
          pal: { top: "#3c6152", hi: "#578776", lo: "#26443a", edge: "#162c25", spec: "#9fd3bb" } }
      ],
      barrel: [
        { id: "barrel_red", name: "炸药桶", shape: "barrel", elev: 32, hp: 32, mass: 1.1,
          boomR: 152, boomDmg: 46,
          pal: { top: "#b91c1c", hi: "#ef4444", lo: "#7f1d1d", edge: "#1f1113", spec: "#fca5a5" } },
        { id: "barrel_oil", name: "油桶", shape: "barrel", elev: 34, hp: 26, mass: 1.0,
          boomR: 176, boomDmg: 38,
          pal: { top: "#a16207", hi: "#eab308", lo: "#713f12", edge: "#1f1a0a", spec: "#fde68a" } }
      ],
      car: [
        { id: "car_red", name: "红色轿车", shape: "car", elev: 30, mass: 3.0, vehicle: "sedan",
          pal: { top: "#b91c1c", hi: "#ef4444", lo: "#7f1d1d", edge: "#1c1917", spec: "#fecaca" } },
        { id: "car_blue", name: "蓝色轿车", shape: "car", elev: 30, mass: 3.0, vehicle: "sedan",
          pal: { top: "#1d4ed8", hi: "#3b82f6", lo: "#1e3a8a", edge: "#0f172a", spec: "#bfdbfe" } },
        { id: "car_taxi", name: "出租车", shape: "car", elev: 30, mass: 2.9, vehicle: "sedan",
          pal: { top: "#ca8a04", hi: "#facc15", lo: "#854d0e", edge: "#1c1917", spec: "#fef08a" } },
        { id: "car_van", name: "面包车", shape: "car", elev: 34, mass: 3.8, vehicle: "van",
          pal: { top: "#cbd5e1", hi: "#f1f5f9", lo: "#94a3b8", edge: "#334155", spec: "#ffffff" } },
        { id: "car_truck", name: "小货车", shape: "car", elev: 36, mass: 4.4, vehicle: "van",
          pal: { top: "#3f6212", hi: "#65a30d", lo: "#2a4210", edge: "#141c0a", spec: "#d9f99d" } },
        /* v3.3 新增涂装 */
        { id: "car_white", name: "白色轿车", shape: "car", elev: 30, mass: 3.0, vehicle: "sedan",
          pal: { top: "#cbd5e1", hi: "#f8fafc", lo: "#94a3b8", edge: "#1e293b", spec: "#ffffff" } },
        { id: "car_black", name: "黑色轿车", shape: "car", elev: 30, mass: 3.1, vehicle: "sedan",
          pal: { top: "#27272a", hi: "#52525b", lo: "#18181b", edge: "#09090b", spec: "#a1a1aa" } },
        { id: "car_mint", name: "薄荷轿车", shape: "car", elev: 30, mass: 2.9, vehicle: "sedan",
          pal: { top: "#0f766e", hi: "#2dd4bf", lo: "#115e59", edge: "#042f2e", spec: "#ccfbf1" } },
        { id: "car_police", name: "警车", shape: "car", elev: 31, mass: 3.2, vehicle: "sedan",
          pal: { top: "#1e3a8a", hi: "#3b82f6", lo: "#172554", edge: "#0b1120", spec: "#f8fafc" } },
        /* v3.3 特殊车：大巴 / 坦克（坦克刷新概率小，见 LD.VEHICLE_CFG.tankChance） */
        { id: "car_bus", name: "大巴", shape: "car", elev: 40, mass: 7.5, vehicle: "bus", tiles: [3, 1],
          pal: { top: "#b45309", hi: "#f59e0b", lo: "#78350f", edge: "#1c1108", spec: "#fef3c7" } },
        { id: "car_tank", name: "坦克", shape: "car", elev: 38, mass: 8.0, vehicle: "tank", tiles: [2, 2],
          pal: { top: "#3f4a35", hi: "#6b7a58", lo: "#2a3223", edge: "#12160e", spec: "#a3b18a" } }
      ],
      tire: [
        { id: "tire_black", name: "轮胎", shape: "round", elev: 14, mass: 0.45,
          pal: { top: "#27272a", hi: "#3f3f46", lo: "#18181b", edge: "#0a0a0b", spec: "#a1a1aa" } },
        { id: "tire_white", name: "白胎", shape: "round", elev: 14, mass: 0.5,
          pal: { top: "#a1a1aa", hi: "#d4d4d8", lo: "#71717a", edge: "#3f3f46", spec: "#fafafa" } }
      ],
      supply: [
        { id: "crate_supply", name: "补给箱", shape: "square", elev: 26, hp: 20, mass: 1.2, glow: "#7dd3fc",
          pal: { top: "#1e40af", hi: "#3b82f6", lo: "#1e3a8a", edge: "#172554", spec: "#dbeafe" } }
      ],
      barricade: [
        { id: "barricade_wood", name: "木路障", shape: "bar", elev: 26, hp: 30, mass: 1,
          pal: { top: "#b45309", hi: "#f59e0b", lo: "#7c2d12", edge: "#231107", spec: "#fde68a" } },
        { id: "barricade_metal", name: "铁路障", shape: "bar", elev: 28, hp: 46, mass: 1,
          pal: { top: "#64748b", hi: "#94a3b8", lo: "#475569", edge: "#1e293b", spec: "#e2e8f0" } }
      ],
      /* v3.3 柜子：可以按 P 躲进去，获得隐匿；被打碎时里面的人会被弹出 */
      locker: [
        { id: "locker_wood", name: "木柜", shape: "square", elev: 42, hp: 55, mass: 2.4,
          pal: { top: "#6b5433", hi: "#8f7047", lo: "#4a3922", edge: "#241a10", spec: "#c7a877" } },
        { id: "locker_metal", name: "铁柜", shape: "square", elev: 46, hp: 85, mass: 3.4,
          pal: { top: "#4b5563", hi: "#6b7787", lo: "#333b47", edge: "#161b22", spec: "#a7b5c6" } }
      ],
      /* v3.3 泥土：不挡路，按 P 拾起，再按 P 朝前方扔出 */
      mud: [
        { id: "mud_pile", name: "泥土", shape: "mud", elev: 10, mass: 1,
          pal: { top: "#5b4632", hi: "#7a5f44", lo: "#3f3021", edge: "#221810", spec: "#a3855f" } }
      ],
      /* v3.5 吹风机：工业风机，正面出风口，机身可破坏 */
      blower: [
        { id: "blower_steel", name: "吹风机", shape: "blower", elev: 44, hp: 110, mass: 5,
          pal: { top: "#475569", hi: "#94a3b8", lo: "#1e293b", edge: "#0b1220", spec: "#e2e8f0" } }
      ],
      /* v3.7 塔防建筑：只用于破坏粒子与兜底绘制，真正的贴图见 33_tower_view.js */
      tower: [
        { id: "tower", name: "防御塔", shape: "square", elev: 96, mass: 99,
          pal: { top: "#8fb7d9", hi: "#c7dff2", lo: "#3f6f96", edge: "#1b3a52", spec: "#eaf6ff" } }
      ],
      crystal: [
        { id: "crystal", name: "水晶", shape: "square", elev: 110, mass: 99,
          pal: { top: "#9be7f5", hi: "#d8fbff", lo: "#1f9bb8", edge: "#0b4a5c", spec: "#f0feff" } }
      ]
    },

    /* 地面材质：只换视觉，不影响数值。整体压低亮度，避免抢角色与技能的视觉焦点 */
    grounds: [
      { id: "grass", name: "草地", pal: { base: "#233829", a: "#2b4530", b: "#1b2b1e", c: "#35543a" } },
      { id: "dirt",  name: "泥地", pal: { base: "#3a3025", a: "#453829", b: "#2c241b", c: "#54452f" } },
      { id: "sand",  name: "沙地", pal: { base: "#5b4e38", a: "#665741", b: "#4b402e", c: "#756349" } },
      { id: "stone", name: "石地", pal: { base: "#333944", a: "#3c4350", b: "#2a2f38", c: "#4a5361" } },
      { id: "snow",  name: "雪地", pal: { base: "#4b5867", a: "#576577", b: "#3d4855", c: "#6c7d91" } },
      { id: "ash",   name: "灰烬", pal: { base: "#2d2926", a: "#37322e", b: "#211e1c", c: "#4a3a2c" } },
      { id: "wood",  name: "木地板", pal: { base: "#3a2c1e", a: "#463523", b: "#2b2116", c: "#57412a" } },
      { id: "metal", name: "金属地", pal: { base: "#2c323a", a: "#353d46", b: "#232830", c: "#48535f" } }
    ]
  };

  /* ----------------------------------------------------------
   *  地图预设：数量偏好 + 材质风格 + 地面
   *  counts 为滑条初始值，玩家可以在此基础上微调
   * ---------------------------------------------------------- */
  LD.MAPS = {
    sliderMax: 8,
    sliders: [
      { key: "solid",     name: "实心障碍", hint: "石柱 / 木柱 / 钢柱" },
      { key: "breakable", name: "可破坏",   hint: "木箱 / 铁箱 / 陶罐" },
      { key: "pushable",  name: "可推动",   hint: "吃伤害会被击飞的方块" },
      { key: "fence",     name: "围栏",     hint: "挡人不挡飞行物" },
      { key: "bush",      name: "草丛",     hint: "站进去隐身，成片生成" },
      { key: "barrel",    name: "炸药桶",   hint: "打爆后原地大范围爆炸", max: 5 },
      { key: "car",       name: "汽车",     hint: "多格、可推动、不可破坏", max: 4 },
      { key: "water",     name: "水池",     hint: "成片大池（约 12 格），踩上去减速", max: 4 },
      { key: "tire",      name: "轮胎",     hint: "很轻，一碰就滚", max: 5 },
      { key: "supply",    name: "补给箱",   hint: "20 血，打破后掉血包 / 能量 / 移速", max: 4 },
      { key: "barricade", name: "路障",     hint: "可破坏的临时掩体", max: 5 },
      { key: "room",      name: "建筑",     hint: "石墙围成的房间，留 1-2 个门洞", max: 3 },
      { key: "locker",    name: "柜子",     hint: "按 P 躲进去；藏超过 2 秒会被 AI 察觉", max: 5 },
      { key: "mud",       name: "泥土",     hint: "按 P 拾起，再按 P 扔出砸人", max: 6 },
      { key: "blower",    name: "吹风机",   hint: "持续喷出气流把角色吹开，打坏后停风", max: 3 }
    ],
    presets: [
      { id: "random", name: "全部随机", icon: "🎲", ground: null, random: true,
        counts: { solid: 3, breakable: 2, pushable: 2, fence: 2, bush: 2, barrel: 1, car: 1, water: 1,
                  tire: 1, supply: 1, barricade: 1, room: 0, locker: 2, mud: 2, blower: 1},
        mats: null, patches: null,
        desc: "数量、位置、材质全随机，每局都不一样" },
      { id: "rainforest", name: "雨林", icon: "🌿", ground: "grass",
        counts: { solid: 4, breakable: 2, pushable: 2, fence: 3, bush: 5, barrel: 1, car: 0, water: 2,
                  tire: 0, supply: 1, barricade: 1, room: 0, locker: 1, mud: 3, blower: 0},
        mats: { solid: ["wood", "stone"], breakable: ["crate_wood", "crate_clay"],
                pushable: ["block_wood", "block_stone"], fence: ["fence_bamboo", "fence_wood"],
                bush: ["bush_leaf", "bush_flower"], water: ["water_swamp"] },
        patches: ["dirt"],
        desc: "草木与木石掩体，草丛成片、可埋伏" },
      { id: "desert", name: "沙漠", icon: "🏜", ground: "sand",
        counts: { solid: 2, breakable: 2, pushable: 3, fence: 1, bush: 1, barrel: 2, car: 1, water: 0,
                  tire: 2, supply: 1, barricade: 1, room: 0, locker: 1, mud: 2, blower: 1},
        mats: { solid: ["stone"], breakable: ["crate_clay", "crate_wood"],
                pushable: ["block_stone", "block_wood"], fence: ["fence_wood"],
                bush: ["bush_dry"], barrel: ["barrel_oil"] },
        patches: ["stone"],
        desc: "沙地开阔，路障与油桶点缀" },
      { id: "ruins", name: "废墟", icon: "🏚", ground: "stone",
        counts: { solid: 5, breakable: 3, pushable: 2, fence: 2, bush: 1, barrel: 1, car: 1, water: 0,
                  tire: 1, supply: 2, barricade: 3, room: 0, locker: 3, mud: 1, blower: 1},
        mats: { solid: ["stone", "metal"], breakable: ["crate_metal", "crate_wood"],
                pushable: ["block_stone", "block_metal"], fence: ["fence_metal", "fence_wood"],
                bush: ["bush_dry"], car: ["car_van"] },
        patches: ["dirt"],
        desc: "断柱与铁箱密集，补给箱散落" },
      { id: "snow", name: "雪原", icon: "❄️", ground: "snow",
        counts: { solid: 3, breakable: 1, pushable: 2, fence: 1, bush: 0, barrel: 1, car: 2, water: 0,
                  tire: 1, supply: 1, barricade: 1, room: 0, locker: 1, mud: 0 },
        mats: { solid: ["stone", "crystal"], breakable: ["crate_metal"],
                pushable: ["block_stone"], fence: ["fence_wood"],
                car: ["car_van", "car_truck"] },
        patches: ["stone"],
        desc: "空旷雪地，冰晶与抛锚车辆" },
      { id: "arena", name: "竞技场", icon: "🏟", ground: "stone",
        counts: { solid: 3, breakable: 1, pushable: 1, fence: 1, bush: 0, barrel: 0, car: 0, water: 0,
                  tire: 0, supply: 0, barricade: 0, room: 0, locker: 0, mud: 0, blower: 0},
        mats: { solid: ["stone", "metal"], breakable: ["crate_wood"],
                pushable: ["block_stone"], fence: ["fence_metal"] },
        patches: ["sand"],
        desc: "克制而对称的赛场，走位空间最大" },
      { id: "forge", name: "熔炉", icon: "🔥", ground: "ash",
        counts: { solid: 4, breakable: 2, pushable: 1, fence: 1, bush: 0, barrel: 3, car: 0, water: 0,
                  tire: 1, supply: 1, barricade: 1, room: 0, locker: 1, mud: 2, blower: 1},
        mats: { solid: ["stone", "metal"], breakable: ["crate_metal", "crate_clay"],
                pushable: ["block_stone", "block_metal"], fence: ["fence_metal"],
                barrel: ["barrel_oil", "barrel_red"] },
        patches: ["stone"],
        desc: "灰烬与钢架，油桶密布" },
      { id: "city", name: "城市", icon: "🏙", ground: "metal",
        counts: { solid: 3, breakable: 2, pushable: 2, fence: 2, bush: 1, barrel: 2, car: 4, water: 0,
                  tire: 2, supply: 2, barricade: 3, room: 3, locker: 3, mud: 2, blower: 2},
        mats: { solid: ["metal", "stone"], breakable: ["crate_metal", "crate_wood"],
                pushable: ["block_metal", "block_stone"], fence: ["fence_metal"],
                car: ["car_red", "car_blue", "car_taxi", "car_van", "car_truck"],
                barricade: ["barricade_metal", "barricade_wood"],
                barrel: ["barrel_red", "barrel_oil"] },
        patches: ["stone"],
        desc: "街区巷战：多间石墙房、成排汽车与路障" }
    ]
  };

  /* ----------------------------------------------------------
   *  闯关 BOSS 地图预设（固定种子，每次进入同一关布局一致）
   * ---------------------------------------------------------- */
  LD.BOSS_MAPS = {
    dragon: { preset: "forge", seed: 1201, counts: { solid: 4, breakable: 2, pushable: 1, fence: 0, barrel: 2 } },
    ninja:  { preset: "ruins", seed: 1202, counts: { solid: 4, breakable: 2, pushable: 2, fence: 2, bush: 2, barricade: 2 } },
    gun:    { preset: "desert", seed: 1203, counts: { solid: 3, breakable: 2, pushable: 2, fence: 1, car: 2, barricade: 2 } },
    bee:    { preset: "rainforest", seed: 1204, counts: { solid: 3, breakable: 2, pushable: 2, fence: 2, bush: 4, water: 2 } },
    frost:  { preset: "snow", seed: 1205, counts: { solid: 3, breakable: 1, pushable: 2, fence: 1, car: 2, tire: 2 } },
    twin:   { preset: "arena", seed: 1206, counts: { solid: 4, breakable: 1, pushable: 1, fence: 2 } },
    gambler:{ preset: "arena", seed: 1207, counts: { solid: 3, breakable: 2, pushable: 2, fence: 1 },
              ground: "wood" },
    mirror: { preset: "arena", seed: 1208, counts: { solid: 4, breakable: 1, pushable: 1, fence: 2 },
              ground: "metal" },
    tesla:  { preset: "forge", seed: 1209, counts: { solid: 4, breakable: 2, pushable: 1, fence: 2, barrel: 2 },
              ground: "metal" }
  };

  /* 取某个预设；未知 id 回退到全部随机 */
  LD.mapPreset = function (id) {
    const list = LD.MAPS.presets;
    return list.find(p => p.id === id) || list[0];
  };

  /* 把任意输入整理成合法的地图配置：
   *   { preset, ground, counts:{...}, seed, mats, patches }
   * 缺省值来自预设，保证旧存档 / 旧房间消息也能用 */
  LD.mapCfg = function (src) {
    src = src || {};
    const p = LD.mapPreset(src.preset || "random");
    const clampN = (v, s) => Math.max(0, Math.min(s.max || LD.MAPS.sliderMax, Math.round(+v || 0)));
    const counts = {};
    LD.MAPS.sliders.forEach(s => {
      const base = src.counts && src.counts[s.key] != null ? src.counts[s.key]
        : (p.counts ? p.counts[s.key] : 0);
      counts[s.key] = clampN(base, s);
    });
    return {
      preset: src.preset && LD.MAPS.presets.some(x => x.id === src.preset) ? src.preset : "random",
      ground: src.ground || p.ground || "grass",
      counts: counts,
      seed: (src.seed != null ? src.seed : (Math.random() * 1e9) | 0) >>> 0,
      mats: src.mats || p.mats || null,
      patches: src.patches || p.patches || null
    };
  };
})(window.LD = window.LD || {});
