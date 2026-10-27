/* ============================================================
 *  主菜单动态背景（v4.29）：一段「正放 + 倒放」的循环视频
 *
 *  为什么是一整段视频而不是两个 <video> 轮播 / playbackRate=-1：
 *  接缝在编码阶段就被抹平了（scripts/make_menu_loop.py：倒放段剪掉首帧，
 *  于是「末帧 == 下一轮首帧」），浏览器只要普通的 loop 播放。
 *  Chrome 不支持负速率，靠 JS 控制反向一定会卡一帧。
 *
 *  想退回 v4.28 的分层立绘（live2d）：把下面的 USE_VIDEO 改成 false 重新构建；
 *  只是想临时对比两种效果，在地址后面加 ?bg=live2d / ?bg=video 就行，不用构建。
 *
 *  降级链：视频能播 -> 视频；视频 404 / 解码失败 -> 当场初始化 live2d 分层立绘；
 *  自动播放被拦 -> 先停在封面帧，等第一次点击 / 按键再播（不白屏、不阻塞）。
 * ============================================================ */
(function (LD) {
  const USE_VIDEO = true;

  const L = LD.MenuVid = { mode: "live2d", active: false, vid: null, ready: false };

  /* 是否启用视频底：构建开关 + 地址栏覆盖（对比用） */
  function wanted() {
    if (!USE_VIDEO) return false;
    let q = "";
    try { q = (location.search || "").toLowerCase(); } catch (e) { }
    if (q.indexOf("bg=live2d") >= 0) return false;
    return true;
  }

  function ovMenu() {
    return (typeof document !== "undefined") ? document.getElementById("ovMenu") : null;
  }

  /* 视频这条路彻底走不通时，把 live2d 分层立绘请回来。
   * boot 在视频模式下压根没初始化立绘（省 1MB 素材），所以这里要完整 init 一次。 */
  function fallback(reason) {
    if (L.mode === "live2d") return;
    L.mode = "live2d";
    L.active = false;
    const host = ovMenu();
    if (host) host.classList.remove("vidOn");
    if (L.vid) {
      try { L.vid.pause(); } catch (e) { }
      L.vid.style.display = "none";
    }
    if (LD.Live2D && LD.Live2D.init) {
      LD.Live2D.init(document.getElementById("menuBg"), window.LD_MENU_BG);
      LD.Live2D.setActive(LD.UI && LD.UI.screen === "ovMenu");
    }
    if (typeof console !== "undefined") console.warn("[menu] 视频底不可用，已回退到分层立绘：" + reason);
  }

  L.init = function (host) {
    L.mode = "live2d";
    if (!wanted()) return L;
    const src = window.LD_MENU_LOOP;
    if (!src || !host) return L;
    /* 没有 <video> 的环境（老内核 / 测试沙箱）直接留在 live2d 这条路。
     * 只判断 createElement 能不能拿到真的 HTMLVideoElement —— 假元素一律不算数，
     * 否则「装配看起来成功、其实一帧也放不出来」会白白把立绘关掉。 */
    try {
      if (typeof HTMLVideoElement === "undefined") return L;
      if (!(document.createElement("video") instanceof HTMLVideoElement)) return L;
    } catch (e) { return L; }

    let v = document.getElementById("menuVid");
    try {
      if (!v) {
        v = document.createElement("video");
        v.id = "menuVid";
        host.insertBefore(v, host.firstChild);
      }
      v.className = "menuVid";
      /* 逐个 setAttribute：某些老内核只认属性、不认 JS 属性 */
      v.setAttribute("muted", "");
      v.setAttribute("loop", "");
      v.setAttribute("autoplay", "");
      v.setAttribute("playsinline", "");
      v.setAttribute("webkit-playsinline", "");
      v.setAttribute("preload", "auto");
      v.setAttribute("aria-hidden", "true");
      v.muted = true;               // 必须走 JS 属性，否则 Chrome 会当成有声自动播放而拦掉
      v.loop = true;
      v.playsInline = true;
      if (window.LD_MENU_POSTER) v.poster = window.LD_MENU_POSTER;
      v.src = src;

      /* 能出画面了再淡入，避免先黑一下再跳出来 */
      const reveal = function () {
        if (L.ready) return;
        L.ready = true;
        v.classList.add("on");
      };
      v.addEventListener("canplay", reveal);
      v.addEventListener("playing", reveal);
      v.addEventListener("error", function () { fallback("加载失败"); });
      /* 解码层面也可能失败（编码参数不被支持时 error 事件不一定来） */
      v.addEventListener("stalled", function () {
        setTimeout(function () { if (!L.ready && v.readyState < 2) fallback("卡住不动"); }, 8000);
      });
    } catch (e) {
      /* 装配不起来（老内核 / 非浏览器环境）：当作没有视频这条路，
       * mode 留在 live2d，boot 会照常初始化分层立绘。 */
      L.vid = null;
      L.mode = "live2d";
      try {
        host.classList.remove("vidOn");
        if (v && v.parentNode) v.parentNode.removeChild(v);
      } catch (e2) { }
      return L;
    }

    L.vid = v;
    L.ready = false;
    L.mode = "video";
    /* 视频里的人物本来就是动的，再叠一层立绘就是两个人：把 canvas 藏掉 */
    host.classList.add("vidOn");

    if (L.active) L.kick();
    return L;
  };

  /* 播一次；被自动播放策略拦下就等第一次交互。
   * 不因为「被拦」就回退 —— 封面帧本来就是这张画，停在上面并不难看。 */
  L.kick = function () {
    if (L.mode !== "video" || !L.vid) return;
    const v = L.vid;
    v.muted = true;
    let p;
    try { p = v.play(); } catch (e) { p = null; }
    if (!p || !p.catch) return;
    p.catch(function () {
      const retry = function () {
        document.removeEventListener("pointerdown", retry, true);
        document.removeEventListener("keydown", retry, true);
        if (L.active) L.kick();
      };
      document.addEventListener("pointerdown", retry, true);
      document.addEventListener("keydown", retry, true);
    });
  };

  /* 只有停在主菜单时才解码；进游戏 / 打开商店都是同一个覆盖层体系，
   * 离开菜单就 pause —— 后台空转解码很费电。 */
  L.setActive = function (on) {
    on = !!on;
    L.active = on;
    if (L.mode !== "video" || !L.vid) return false;
    if (on) L.kick();
    else { try { L.vid.pause(); } catch (e) { } }
    return on;
  };
})(window.LD = window.LD || {});
