import React, { useEffect, useRef, useState } from "react";

/**
 * Zeta Gluck – Scratch Card（单文件 React App）
 *
 * 修复：
 * - 解决 GiftCard JSX 结构中多余 </div> 导致的 “Adjacent JSX elements…” 报错。
 * - 保持你已要求的改动：无语言切换、百分比无“剩余”、网格按 0.2→1→10→100→1000→周边 排序、刮奖卡片“来自”无 logo。
 */

// ---- 工具：本地持久化 ----
const LS_KEY = "zeta_scratch_inventory_v4"; // 升级版本以便切换到新奖池（0.2 档）
const LS_FIRST_VISIT = "zeta_first_visit_done_v1";

const DEFAULT_INVENTORY = {
  // 展示用（六档，包含 0.2）
  zeropointtwo: { max: 5000, left: 5000, value: 0.2 }, // 0.2 ZETA * 5000
  one: { max: 1000, left: 1000, value: 1 },
  ten: { max: 100, left: 100, value: 10 },
  hundred: { max: 10, left: 10, value: 100 },
  twohundred: { max: 5, left: 5, value: 200 }, // 保留（不在网格）
  fivehundred: { max: 2, left: 2, value: 500 }, // 保留（不在网格）
  // 仅抽奖用（也在网格展示）
  thousand: { max: 1, left: 1, value: 1000 },           // 1000 ZETA * 1
  merch: { max: 10, left: 10, value: 0, label: "ZETA特别周边" }, // 周边 * 10
};

function loadInventory() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_INVENTORY };
    const parsed = JSON.parse(raw);
    // 合并默认结构，兼容旧字段
    return {
      zeropointtwo: { ...DEFAULT_INVENTORY.zeropointtwo, ...(parsed.zeropointtwo || {}) },
      one: { ...DEFAULT_INVENTORY.one, ...(parsed.one || {}) },
      ten: { ...DEFAULT_INVENTORY.ten, ...(parsed.ten || {}) },
      hundred: { ...DEFAULT_INVENTORY.hundred, ...(parsed.hundred || {}) },
      twohundred: { ...DEFAULT_INVENTORY.twohundred, ...(parsed.twohundred || {}) },
      fivehundred: { ...DEFAULT_INVENTORY.fivehundred, ...(parsed.fivehundred || {}) },
      thousand: { ...DEFAULT_INVENTORY.thousand, ...(parsed.thousand || {}) },
      merch: { ...DEFAULT_INVENTORY.merch, ...(parsed.merch || {}) },
    };
  } catch (e) {
    return { ...DEFAULT_INVENTORY };
  }
}

function saveInventory(inv) {
  localStorage.setItem(LS_KEY, JSON.stringify(inv));
}

// ---- 抽奖逻辑 ----
/**
 * 概率模型（相对权重）：
 * 0.2 ZETA: 50%
 * 1 ZETA:   5%
 * 10 ZETA:  0.5%
 * 100 ZETA: 0.05%
 * 1000 ZETA:0.005%
 * 未中奖：  44.445%
 *
 * 说明：有限库存 prize 用对应权重；若抽到某档但售罄，则按高→低顺序降级。
 */
const BASE_WEIGHTS = [
  { key: "thousand", weight: 0.005, unlimited: false, value: 1000 },
  { key: "hundred",  weight: 0.05,  unlimited: false, value: 100 },
  { key: "ten",      weight: 0.5,   unlimited: false, value: 10 },
  { key: "one",      weight: 5,     unlimited: false, value: 1 },
  { key: "zeropointtwo", weight: 50, unlimited: false, value: 0.2 },
  { key: "none",     weight: 44.445, unlimited: true, value: 0 },
  // 保留键（本分布不赋权重）
  { key: "fivehundred", weight: 0, unlimited: false, value: 500 },
  { key: "twohundred",  weight: 0, unlimited: false, value: 200 },
  { key: "merch",       weight: 0, unlimited: false, value: 0 },
];

function weightedPick(weights) {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  const r = Math.random() * total;
  let acc = 0;
  for (const w of weights) {
    acc += w.weight;
    if (r <= acc) return w.key;
  }
  return weights[weights.length - 1].key; // fallback → 最后一项
}

function demotePrize(key, inv) {
  // 从高到低降级链
  const chain = [
    "thousand",
    "fivehundred",
    "twohundred",
    "hundred",
    "ten",
    "one",
    "zeropointtwo",
    "merch",
    "none",
  ];
  let idx = chain.indexOf(key);
  if (idx === -1) return "none";
  while (idx < chain.length) {
    const k = chain[idx];
    if (k === "none") return k; // 未中奖无限
    if (inv[k] && inv[k].left > 0) return k;
    idx++;
  }
  return "none";
}

function drawPrize(inv) {
  // 有货的 prize 使用权重；售罄则权重为 0
  const dynamicWeights = BASE_WEIGHTS.map((w) => {
    if (w.unlimited) return w;
    const has = inv[w.key]?.left > 0;
    return has ? w : { ...w, weight: 0 };
  }).filter((w) => w.weight > 0 || w.unlimited);

  const picked = weightedPick(dynamicWeights);
  const actual = demotePrize(picked, inv);
  return actual;
}

function consumeInventory(inv, key) {
  const copy = JSON.parse(JSON.stringify(inv));
  if ([
    "zeropointtwo",
    "one",
    "ten",
    "hundred",
    "twohundred",
    "fivehundred",
    "thousand",
    "merch",
  ].includes(key) && copy[key].left > 0) {
    copy[key].left -= 1;
  }
  saveInventory(copy);
  return copy;
}

// ---- i18n ----
const I18N = {
  zh: {
    primaryLabel: "今日手气如何？",
    headline: "立即抽卡",
    desc: "每地址每天30次免费机会，23:59 UTC +8重置",
    draw: "免费来一张",
    secondaryLabel: "奖品库存",
    secondaryTitle: "剩余奖品库存",
    secondaryNote: "更多奖品正在路上",
    giftFrom: "来自",
    checkWin: "查看你中奖了吗👀",
    congrats: (title) => `🎉 恭喜获得 ${title}!`,
    sorry: "🙌 谢谢参与，祝你下次好运！",
    scratchHint: "用手指/鼠标刮开",
    tryAgain: "再来一张",
    receiptTitle: "ZetaChain 收据",
    receiptItem: "Gluck刮刮卡",
    receiptOrder: (n) => `· 订单号：ZETA-${n}`,
    receiptPaid: "· 状态：等待签名",
    receiptTime: () => `· 时间：${new Date().toLocaleString()}`,
    receiptPrinting: "· 正在出票…",
    merchLabel: "ZETA 限量周边 * 10",
  },
  en: {
    primaryLabel: "How's your luck today?",
    headline: "Draw now",
    desc: "30 free plays per address. Resets at 23:59 UTC+8",
    draw: "Draw one",
    secondaryLabel: "Prize inventory",
    secondaryTitle: "Remaining prize inventory",
    secondaryNote: "More prizes are on the way",
    giftFrom: "A gift from",
    checkWin: "See if you won 👀",
    congrats: (title) => `🎉 Congrats! You got ${title}!`,
    sorry: "🙌 Thanks for playing — better luck next time!",
    scratchHint: "Scratch with finger/mouse",
    tryAgain: "Try again",
    receiptTitle: "ZetaChain Receipt",
    receiptItem: "· Item: Scratch card (1 of 6)",
    receiptOrder: (n) => `· Order: ZETA-${n}`,
    receiptPaid: "· Status: Paid",
    receiptTime: () => `· Time: ${new Date().toLocaleString()}`,
    receiptPrinting: "· Printing…",
    merchLabel: "ZETA limited merch * 10",
  },
};

// ---- UI：Logo（图片优先，失败回退到内置SVG） ----
const ZetaLogo = (props) => (
  <svg viewBox="0 0 120 120" aria-hidden className={props.className}>
    <circle cx="60" cy="60" r="58" fill="#0c503d" />
    <path d="M30 35h60l-40 50h40v10H30l40-50H30z" fill="white" />
  </svg>
);

function ZetaLogoImg({ className }) {
  const [ok, setOk] = useState(true);
  // 通过 window.ZETA_LOGO_URL 注入自定义 LOGO 地址（可为 data: URL）
  const src = typeof window !== 'undefined' ? (window).ZETA_LOGO_URL : undefined;
  if (src && ok) {
    return <img src={src} className={className} alt="Zeta logo" onError={() => setOk(false)} />;
    }
  return <ZetaLogo className={className} />;
}

// ---- UI：GiftCard（无图案，居中结果） ----
function GiftCard({ prize, t }) {
  const title = prize.label || (prize.value > 0 ? `${prize.value} ZETA` : (t.sorry.includes('谢谢') ? '谢谢参与' : 'Better luck next time'));
  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-[360px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-center text-slate-500 text-sm">
          <span>{t.giftFrom}</span>
        </div>
        <div className="text-center text-2xl font-semibold mb-3">ZetaChain</div>
        <div className="text-center text-emerald-600 mb-4">{t.checkWin}</div>

        <div className="rounded-xl border-2 border-slate-200 p-4">
          <div className="mx-auto max-w-[320px]">
            <div className="rounded-xl border border-slate-200 bg-white p-4 min-h-[220px] flex flex-col items-center justify-center">
              <div className="text-center text-3xl font-extrabold my-2">{title}</div>
              <div className="text-center text-sm text-emerald-700 font-medium mt-2">ZetaChain</div>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-emerald-50 text-emerald-700 p-3 text-center">
          {prize.value > 0 || prize.label ? t.congrats(title) : t.sorry}
        </div>
      </div>
    </div>
  );
}

// ---- UI：ScratchCanvas ----
function ScratchCanvas({ onReveal, t }) {
  const canvasRef = useRef(null);
  const revealRef = useRef(false);
  const lastRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      paint();
    }

    function noise(ctx, w, h) {
      const img = ctx.createImageData(w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = 200 + Math.random() * 40; // 金属感
        img.data[i] = n;
        img.data[i + 1] = n;
        img.data[i + 2] = n;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }

    function paint() {
      const { width, height } = canvas.getBoundingClientRect();
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, "#e6e6e6");
      grad.addColorStop(1, "#c9c9c9");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
      noise(ctx, width, height);
      ctx.fillStyle = "#6b7280";
      ctx.font = "bold 14px system-ui, -apple-system, Segoe UI, Roboto";
      ctx.textAlign = "center";
      ctx.fillText(t.scratchHint, width / 2, height / 2);
      ctx.globalCompositeOperation = "destination-out"; // 擦除模式
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
    }

    resize();
    window.addEventListener("resize", resize);

    let scratching = false;
    const radius = 16;

    function scratchLine(x1, y1, x2, y2) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = radius * 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x2, y2, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    function percentCleared() {
      const { width, height } = canvas;
      const sample = ctx.getImageData(0, 0, width, height).data;
      let cleared = 0;
      for (let i = 3; i < sample.length; i += 4) {
        if (sample[i] === 0) cleared++;
      }
      return cleared / (width * height);
    }

    function pointerPos(e) {
      const rect = canvas.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      return { x, y };
    }

    function start(e) {
      scratching = true;
      if (navigator.vibrate) navigator.vibrate(3);
      const { x, y } = pointerPos(e);
      lastRef.current = { x, y };
      scratchLine(x, y, x, y);
    }
    function move(e) {
      if (!scratching) return;
      const { x, y } = pointerPos(e);
      const last = lastRef.current || { x, y };
      scratchLine(last.x, last.y, x, y);
      lastRef.current = { x, y };
      if (!revealRef.current && percentCleared() > 0.6) {
        revealRef.current = true;
        setTimeout(() => onReveal?.(), 200);
      }
    }
    function end() {
      scratching = false;
      lastRef.current = null;
    }

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);

    canvas.addEventListener("touchstart", start, { passive: true });
    canvas.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousedown", start);
      canvas.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      canvas.removeEventListener("touchstart", start);
      canvas.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
    };
  }, [onReveal, t]);

  return (
    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full rounded-xl"/>
  );
}

// ---- 进度条组件（首次访问动画） ----
function ProgressBar({ percent, animate }) {
  const [w, setW] = useState(animate ? 0 : percent);
  useEffect(() => {
    if (!animate) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setW(percent), reduce ? 0 : 20);
    return () => clearTimeout(t);
  }, [animate, percent]);
  return (
    <div className="mt-2 h-2 rounded bg-slate-100 overflow-hidden">
      <div className="h-2 bg-emerald-500 transition-all duration-1000 ease-out" style={{ width: `${w}%` }} />
    </div>
  );
}

// ---- UI：付款（发票/小票）动画 ----
function ReceiptAnimation({ show, t }) {
  return (
    <div className={`pointer-events-none fixed inset-0 z-50 flex items-center justify-center transition ${show ? "opacity-100" : "opacity-0"}`}>
      {show && (<div className="bg-black/30 absolute inset-0" />)}
      {show && (
        <div className="relative z-10 w-[320px] max-w-[80vw]">
          <div className="overflow-hidden rounded-2xl shadow-xl bg-white">
            <div className="p-4 flex items-center gap-3 border-b">
              <div className="w-8 h-8"><ZetaLogoImg className="w-8 h-8 rounded" /></div>
              <div className="font-semibold">{t.receiptTitle}</div>
            </div>
            <div className="p-4 text-sm text-slate-600 space-y-2 animate-[scroll_1.4s_ease-in-out_infinite] [mask-image:linear-gradient(to_bottom,transparent,black_10%,black_90%,transparent)] h-40">
              <div>{t.receiptItem}</div>
              <div>{t.receiptOrder(Math.floor(Math.random()*999999))}</div>
              <div>{t.receiptPaid}</div>
              <div>{t.receiptTime()}</div>
              <div>{t.receiptPrinting}</div>
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes scroll{0%{transform:translateY(10px)}50%{transform:translateY(-10px)}100%{transform:translateY(10px)}}`}</style>
    </div>
  );
}

// ---- 主页面 ----
export default function App() {
  const [inventory, setInventory] = useState(loadInventory());
  const [stage, setStage] = useState("idle"); // idle → paying → scratching → revealed
  const [prize, setPrize] = useState({ key: "none", value: 0 });
  const [lang] = useState("zh"); // 语言切换已移除，默认中文
  const [firstVisit, setFirstVisit] = useState(() => !localStorage.getItem(LS_FIRST_VISIT));

  useEffect(() => {
    if (firstVisit) localStorage.setItem(LS_FIRST_VISIT, "1");
  }, [firstVisit]);

  const t = I18N[lang];

  function payAndStart() {
    setStage("paying");
    setTimeout(() => {
      const prizeKey = drawPrize(inventory);
      const meta = BASE_WEIGHTS.find((w) => w.key === prizeKey) || { value: 0 };
      const extra = prizeKey === "merch" ? { label: inventory.merch.label } : {};
      setPrize({ key: prizeKey, value: meta.value, ...extra });
      setStage("scratching");
    }, 1000);
  }

  function instantStart() {
    const prizeKey = drawPrize(inventory);
    const meta = BASE_WEIGHTS.find((w) => w.key === prizeKey) || { value: 0 };
    const extra = prizeKey === "merch" ? { label: inventory.merch.label } : {};
    setPrize({ key: prizeKey, value: meta.value, ...extra });
    setStage("scratching");
  }

  function onRevealed() {
    setStage("revealed");
    setInventory((prev) => consumeInventory(prev, prize.key));
  }

  function reset() {
    instantStart();
  }

  // 展示列表：两行三列（按 value 升序 + 周边最后）
  const numericKeys = ["zeropointtwo","one","ten","hundred","thousand"]; 
  const supplyInfo = numericKeys
    .sort((a,b)=> (DEFAULT_INVENTORY[a].value||0) - (DEFAULT_INVENTORY[b].value||0))
    .map(key=>({key}));
  supplyInfo.push({key:"merch"});

  function labelFor(key) {
    switch (key) {
      case "zeropointtwo": return "0.2 ZETA * 5000";
      case "one": return "1 ZETA * 1000";
      case "ten": return "10 ZETA * 100";
      case "hundred": return "100 ZETA * 10";
      case "thousand": return "1000 ZETA * 1";
      case "merch": return I18N[lang].merchLabel;
      default: return key;
    }
  }

  // ---- 运行时测试（不会抛错，仅 console 断言）----
  useEffect(() => {
    function runTests() {
      try {
        const keys = new Set(["none", "zeropointtwo", "one", "ten", "hundred", "twohundred", "fivehundred", "thousand", "merch"]);
        // 权重键合法
        BASE_WEIGHTS.forEach(w => console.assert(keys.has(w.key), `BASE_WEIGHTS key exists: ${w.key}`));
        // 权重和接近 100（允许浮点误差）
        const total = BASE_WEIGHTS.reduce((s,w)=>s+w.weight,0);
        console.assert(Math.abs(total - 100) < 0.001, `weights sum ~ 100, got ${total}`);
        // 降级链关键键存在
        console.assert(["thousand","zeropointtwo"].every(k=>keys.has(k)), "chain keys exist");
        // 抽奖结果键必须合法
        for (let i = 0; i < 20; i++) {
          const k = drawPrize(loadInventory());
          console.assert(keys.has(k), `drawPrize legal key: ${k}`);
        }
        // 展示顺序与库存定义（含 thousand / merch）
        console.assert(Array.isArray(supplyInfo) && supplyInfo.length === 6, "supplyInfo length 6");
        const expectedOrder = ["zeropointtwo","one","ten","hundred","thousand","merch"];
        console.assert(expectedOrder.every((k,i)=>supplyInfo[i].key===k), "grid sorted ascending by value with merch last");
        // 标签不包含“剩余”
        console.assert(!labelFor("one").includes("剩余"), "labels should not contain 剩余");
        // 消费保护（不会减到负数）
        const testInv = { ...DEFAULT_INVENTORY, one: { ...DEFAULT_INVENTORY.one, left: 0 } };
        const consumed = consumeInventory(testInv, "one");
        console.assert(consumed.one.left === 0, "consumeInventory should not go negative");
        console.log("[Zeta Gluck] sanity tests passed");
      } catch (e) {
        console.warn("[Zeta Gluck] sanity tests encountered an issue", e);
      }
    }
    runTests();
  }, [lang]);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-screen-sm p-4 sm:p-6">
        {/* 顶部导航 */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8"><ZetaLogoImg className="w-8 h-8 rounded" /></div>
            <div className="font-semibold">Zeta Gluck</div>
          </div>
        </header>

        {/* ===== 主要内容：抽卡/刮奖（上方） ===== */}
        <section className="rounded-2xl border bg-gradient-to-b from-emerald-50 to-white p-4 sm:p-6 shadow-sm mb-6 ring-1 ring-emerald-100/50">
          <div className="mb-4">
            <div className="text-[11px] tracking-widest text-emerald-700/80 font-semibold">{t.primaryLabel}</div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900">{t.headline}</h2>
            <p className="text-slate-600 text-sm">{t.desc}</p>
          </div>

          {stage === "idle" && (
            <div className="flex flex-col items-center">
              <button onClick={payAndStart} className="px-5 py-3 rounded-2xl bg-emerald-600 text-white font-semibold shadow hover:bg-emerald-700 active:translate-y-px">{t.draw}</button>
            </div>
          )}

          {stage === "scratching" && (
            <div className="relative mx-auto w-full max-w-[360px]">
              <GiftCard prize={prize} t={t} />
              <div className="absolute inset-0">
                <ScratchCanvas onReveal={onRevealed} t={t} />
              </div>
            </div>
          )}

          {stage === "revealed" && (
            <div className="flex flex-col items-center gap-4">
              <GiftCard prize={prize} t={t} />
              <button onClick={reset} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800">{t.tryAgain}</button>
            </div>
          )}
        </section>

        {/* ===== 次要信息：奖池与库存（下方，两行三列） ===== */}
        <section className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm">
          <div>
            <div className="text-[11px] tracking-widest text-slate-500 font-semibold">{t.secondaryLabel}</div>
            <h3 className="text-lg font-semibold text-slate-800">{t.secondaryTitle}</h3>
            <p className="text-xs text-slate-500 mt-1">{t.secondaryNote}</p>
          </div>

          <div className="mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {supplyInfo.map((s) => {
                const left = inventory[s.key].left;
                const max = inventory[s.key].max;
                const percent = Math.max(0, Math.min(100, Math.round((left / max) * 100)));
                const animate = firstVisit && left === max; // 首访且满仓 → 动画
                return (
                  <div key={s.key} className="rounded-xl border p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs text-slate-500">{labelFor(s.key)}</div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{percent}%</span>
                    </div>
                    <div className="text-lg font-semibold">{left} / {max}</div>
                    <ProgressBar percent={percent} animate={animate} />
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <ReceiptAnimation show={stage === "paying"} t={t} />

      {/* 移动端适配：容器宽度已限制，UI 组件均为流式布局与相对尺寸 */}
    </div>
  );
}
