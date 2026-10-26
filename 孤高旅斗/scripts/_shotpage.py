# -*- coding: utf-8 -*-
"""给 dist 产物注入一小段导航脚本，用来截指定界面。

和 _mk_shot.py 的区别：这里只做「打开某个覆盖层」这一件事，
注入的代码短、可读，改动界面时方便临时加状态（比如开局人数、模式）。
用法：
    python scripts/_shotpage.py duel        -> temp/shotpage.html
    python scripts/_shotpage.py net
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist", "孤高旅斗.html")
OUT = os.path.join(ROOT, "temp", "shotpage.html")

ROOM = """
(function () {
  function boot() {
    var LD = window.LD;
    if (!LD || !LD.UI) { setTimeout(boot, 60); return; }
    LD.Audio && LD.Audio.mute && LD.Audio.mute();
    LD.BGM && LD.BGM.stop && LD.BGM.stop();
    %s
  }
  if (document.readyState === "complete") setTimeout(boot, 260);
  else window.addEventListener("load", function () { setTimeout(boot, 260); });
})();
"""

ACT = {
    "duel": 'LD.UI.show("ovDuelSetup"); LD.UI.renderRoom();',
    "duelfoot": ('LD.UI.show("ovDuelSetup"); LD.UI.renderRoom();'
                 'setTimeout(function(){var o=document.getElementById("ovDuelSetup");'
                 'if(o)o.scrollTop=o.scrollHeight;},420);'),
    "net": 'LD.UI.show("ovWait"); LD.UI.renderNetRoom();',
    "menu": 'LD.UI.show("ovMenu");',
    "solo": 'LD.Profile.d.tutDone = true; LD.UI.show("ovSolo");',
    "tut": 'LD.Profile.d.tutDone = false; LD.UI.startTutorial();',
    "tutlime": ('LD.Profile.d.tutDone = false; LD.UI.startTutorial();'
                'var st=document.createElement("style");'
                'st.textContent="#tutTip{background:#22ff22 !important;border:1px solid #22ff22 !important}";'
                'document.head.appendChild(st);'),
    # 直接跳到索敌那一步：看提示条的文字、方向牌、以及两根木桩的相对位置
    "tutlock": ('LD.Profile.d.tutDone = false; LD.UI.startTutorial();'
                'setTimeout(function(){var B=LD.Battle, h=B.tutHero;'
                'h.x = 640; B.tutGo(3);'
                'if (B.tut.dummy) h.x = B.tut.dummy.x - 210;'
                '}, 300);'),
    "tutnohud": 'LD.Profile.d.tutDone = false; LD.UI.startTutorial(); setTimeout(function(){var o=document.getElementById("hud"); if(o) o.style.display="none";}, 400);',
    "tutnotip": 'LD.Profile.d.tutDone = false; LD.UI.startTutorial(); setTimeout(function(){var e=document.getElementById("tutTip"); if(e) e.parentNode.removeChild(e);}, 400);',
    "duelnow": 'LD.UI.startDuel();',
    "tut2": ('LD.Profile.d.tutDone = false; LD.UI.startTutorial();'
             'setTimeout(function(){var h=LD.Battle.tutHero;'
             'if(h){h.x+=520;h.y-=0;}}, 300);'),
    "multi": 'LD.UI.show("ovMulti");',
}


def main():
    which = (sys.argv[1] if len(sys.argv) > 1 else "duel").strip()
    act = ACT.get(which, ACT["duel"])
    src = io.open(DIST, encoding="utf-8").read()
    tag = "<script>" + ROOM % act + "</script></body>"
    out = src.replace("</body>", tag, 1)
    io.open(OUT, "w", encoding="utf-8").write(out)
    print("已生成 temp/shotpage.html (%s) %.0f KB" % (which, len(out.encode("utf-8")) / 1024))


if __name__ == "__main__":
    main()
