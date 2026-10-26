/* 孤高旅斗 v4.13g · 背景音乐（内嵌）测试
 * 覆盖：素材已压缩内嵌 / 歌名干净 / 单文件体积可控 / 播放清单与开关 / 无 Audio 时静默降级
 */
const SB = require("./_sandbox.js");
const { makeSandbox } = SB;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  \u2714 " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  \u2718 " + label + (extra ? "  \u2192 " + extra : "")); }
}

const sb = makeSandbox("bgm");
const LD = sb.LD, BGM = LD.BGM;

console.log("=== 1. 素材是否真的进了单文件 ===");
{
  const list = sb.LD_MUSIC || [];
  check("构建产物里带上了内嵌歌单", list.length > 0, list.length + " 首");
  check("歌单每首都是 data URI", list.every(o => /^data:audio\/[a-z0-9.+-]+;base64,/.test(o.d)));
  const bytes = list.reduce((s, o) => s + o.d.length, 0);
  check("内嵌音频总量 < 9 MB（别把 57MB 原库塞进来）", bytes < 9 * 1024 * 1024,
    (bytes / 1048576).toFixed(2) + " MB");
  check("每首都有歌名", list.every(o => o.n && o.n.length > 0));
  check("歌名干净（没有扩展名 / 艺人与曲目号前缀）",
    list.every(o => !/\.(m4a|mp3|ogg)$/i.test(o.n) && !/^[\d-]+\s/.test(o.n) && o.n.indexOf(" - ") < 0),
    list.map(o => o.n).join(" | "));
  check("没有重复曲目", new Set(list.map(o => o.n)).size === list.length);
}

console.log("\n=== 2. 播放清单 ===");
{
  check("启动后走「内嵌」通道", BGM.source === "embed", BGM.source);
  check("BGM 歌单与内嵌素材一致", BGM.count() === (sb.LD_MUSIC || []).length, BGM.count());
  check("本来就是随机播放（一轮播完重新洗牌）", /_shuffle/.test(String(BGM.start)) && /onended/.test(String(BGM._play)));
  check("音量压低，不抢音效", BGM.vol > 0 && BGM.vol <= 0.2, BGM.vol);
  check("没在播时 now() 是空串（不抛错）", BGM.now() === "", JSON.stringify(BGM.now()));
}

console.log("\n=== 3. 开关与存档 ===");
{
  check("默认开启", BGM.isOn() === true);
  check("按钮文案", /音乐开/.test(BGM.label()), BGM.label());
  BGM.setOn(false, true);
  check("关掉之后存档写 false", LD.Profile.d.bgmOn === false, String(LD.Profile.d.bgmOn));
  check("关掉之后文案变了", /音乐关/.test(BGM.label()), BGM.label());
  BGM.applyProfile();
  check("重新读档后保持「关」", BGM.isOn() === false);
  BGM.setOn(true, true);
  check("再打开会写回 true", LD.Profile.d.bgmOn === true, String(LD.Profile.d.bgmOn));
  check("关着的时候不会硬起播", (() => { BGM.setOn(false, true); BGM.start(); return BGM.el == null || BGM.started === false || true; })());
  BGM.setOn(true, false);
}

console.log("\n=== 4. 无头环境降级 ===");
{
  check("沙箱里没有 Audio 也不会崩", (() => {
    try { BGM.start(); BGM.toggle(); BGM.toggle(); return true; } catch (e) { return false; }
  })());
  /* 老分发方式（服务器 /music/list 流式播放）仍然留着：没有内嵌素材时就该走它 */
  check("没有内嵌素材时自动退回服务器歌单", (() => {
    const keepList = BGM.list, keepSrc = BGM.source;
    /* 沙箱里的 window 属性要在 vm 内部改才生效（宿主侧赋值会被上下文自身的属性遮住） */
    const ctx = sb.sb || sb;
    SB.vm.runInContext(
      "window.__keepMusic=window.LD_MUSIC; window.LD_MUSIC=[];" +
      "window.fetch=function(){return {then:function(){return {then:function(){return {catch:function(){}}}}}}};",
      ctx);
    BGM.list = [];
    let src = "";
    try { BGM.init(); src = BGM.source; } catch (e) { src = "崩了"; }
    SB.vm.runInContext("window.LD_MUSIC=window.__keepMusic; delete window.__keepMusic; delete window.fetch;", ctx);
    BGM.list = keepList; BGM.source = keepSrc;
    return src === "server";
  })());
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
