import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * ZetaChain Scratch Card – single-file React app
 *
 * 需求覆盖：
 * - 5 款卡面：Zeta 超人、Zeta Thank You、Zeta Pizza、Zeta 航母、ZetaBook
 * - Zeta Thank You = 谢谢参与（无奖励）
 * - 奖励与概率（含有限库存档）：
 *   无奖励 50%（无限）
 *   1 ZETA 40%（无限）
 *   10 ZETA 9.5%（最多 200 张）
 *   100 ZETA 0.4%（最多 10 张，按 5000 总预算调整）
 *   1000 ZETA 0.1%（最多 2 张，按 5000 总预算调整）
 * - 总预算 5000 → 分配为：10Z*200 + 100Z*10 + 1000Z*2 = 5000
 * - 付款后展示“小票/发票”动画，然后进入刮卡
 * - 刮奖效果拟真（Canvas 遮罩），刮开 >60% 自动揭晓
 * - 页面以白色为主，移动端适配
 * - 10Z 的“最大供应 200 张”在主页展示；其余库存也可展示
 *
 * ⚠️ 说明：库存这里用 localStorage 模拟（无后端时仅作 demo）。
 * 线上需把库存与抽奖逻辑放到后端，保证并发与可审计性。
 */

// ---- 工具：本地持久化 ----
const LS_KEY = "zeta_scratch_inventory_v1";

const DEFAULT_INVENTORY = {
  ten: { max: 200, left: 200, value: 10 },
  hundred: { max: 10, left: 10, value: 100 },
  thousand: { max: 2, left: 2, value: 1000 },
};

function loadInventory() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_INVENTORY };
    const parsed = JSON.parse(raw);
    // 容错：兼容老版或缺字段
    return {
      ten: { ...DEFAULT_INVENTORY.ten, ...(parsed.ten || {}) },
      hundred: { ...DEFAULT_INVENTORY.hundred, ...(parsed.hundred || {}) },
      thousand: { ...DEFAULT_INVENTORY.thousand, ...(parsed.thousand || {}) },
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
 * 权重（在有限库存仍有货时生效）。
 * 若抽到的档位没库存，则自动降级为下一档（1000→100→10→1→无）。
 */
const BASE_WEIGHTS = [
  { key: "none", weight: 50, unlimited: true, value: 0 },
  { key: "one", weight: 40, unlimited: true, value: 1 },
  { key: "ten", weight: 9.5, unlimited: false, value: 10 },
  { key: "hundred", weight: 0.4, unlimited: false, value: 100 },
  { key: "thousand", weight: 0.1, unlimited: false, value: 1000 },
];

function weightedPick(weights) {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  const r = Math.random() * total;
  let acc = 0;
  for (const w of weights) {
    acc += w.weight;
    if (r <= acc) return w.key;
  }
  return weights[0].key; // fallback
}

function demotePrize(key, inv) {
  // 从高到低的降级链
  const chain = ["thousand", "hundred", "ten", "one", "none"];
  let idx = chain.indexOf(key);
  if (idx === -1) return "none";
  while (idx < chain.length) {
    const k = chain[idx];
    if (k === "none" || k === "one") return k; // 无限档，直接使用
    if (inv[k].left > 0) return k;
    idx++;
  }
  return "one"; // 最后兜底
}

function drawPrize(inv) {
  // 只在有限库存仍有货时，将其纳入权重；否则按降级规则
  const dynamicWeights = BASE_WEIGHTS.map((w) => {
    if (w.unlimited) return w;
    const has = inv[w.key].left > 0;
    return has ? w : { ...w, weight: 0 };
  }).filter((w) => w.weight > 0 || w.unlimited);

  const picked = weightedPick(dynamicWeights);
  const actual = demotePrize(picked, inv);
  return actual;
}

function consumeInventory(inv, key) {
  const copy = JSON.parse(JSON.stringify(inv));
  if (["ten", "hundred", "thousand"].includes(key) && copy[key].left > 0) {
    copy[key].left -= 1;
  }
  saveInventory(copy);
  return copy;
}

// ---- UI：五款卡面的 SVG（透明背景，统一风格）----
const ZetaLogo = (props) => (
  <svg viewBox="0 0 120 120" aria-hidden className={props.className}>
    <circle cx="60" cy="60" r="58" fill="#0c503d" />
    <path d="M30 35h60l-40 50h40v10H30l40-50H30z" fill="white" />
  </svg>
);

const CardArt = {
  superman: () => (
    <svg viewBox="0 0 320 220" className="w-full h-auto">
      <rect width="320" height="220" fill="transparent" />
      <g transform="translate(0,5)">
        <rect x="110" y="20" width="100" height="100" rx="10" fill="#0c503d" />
        <path d="M120 30h80l-54 68h54v12h-80l54-68h-54z" fill="#fff" />
        <circle cx="160" cy="170" r="40" fill="#1e293b" />
        <rect x="140" y="140" width="40" height="25" rx="4" fill="#ef4444" />
        <rect x="110" y="160" width="100" height="10" fill="#1e293b" />
      </g>
      <text x="160" y="210" textAnchor="middle" fontSize="16" fill="#0c503d">ZETA SUPERMAN</text>
    </svg>
  ),
  thankyou: () => (
    <svg viewBox="0 0 320 220" className="w-full h-auto">
      <rect width="320" height="220" fill="transparent" />
      <ZetaLogo className="w-[120px] h-[120px] mx-auto" />
      <text x="160" y="200" textAnchor="middle" fontSize="20" fill="#0c503d">THANK YOU</text>
    </svg>
  ),
  pizza: () => (
    <svg viewBox="0 0 320 220" className="w-full h-auto">
      <defs>
        <radialGradient id="cheese" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#ffe38e"/>
          <stop offset="100%" stopColor="#f7c948"/>
        </radialGradient>
      </defs>
      <circle cx="160" cy="110" r="80" fill="#d97706" />
      <circle cx="160" cy="110" r="70" fill="url(#cheese)" />
      {[...Array(8)].map((_,i)=> (
        <circle key={i} cx={160+60*Math.cos((i/8)*2*Math.PI)} cy={110+60*Math.sin((i/8)*2*Math.PI)} r="8" fill="#991b1b" />
      ))}
      <g transform="translate(115,65) scale(0.8)">
        <ZetaLogo className="w-[120px] h-[120px]" />
      </g>
      <text x="160" y="205" textAnchor="middle" fontSize="16" fill="#0c503d">ZETA PIZZA</text>
    </svg>
  ),
  carrier: () => (
    <svg viewBox="0 0 320 220" className="w-full h-auto">
      <rect width="320" height="220" fill="transparent" />
      <path d="M40 150h240l-20 20H80z" fill="#0c503d" />
      <rect x="110" y="100" width="60" height="30" fill="#0c503d" />
      <rect x="140" y="70" width="30" height="40" fill="#0c503d" />
      <circle cx="155" cy="85" r="10" fill="#0c503d" />
      <g transform="translate(195,95) scale(0.5)">
        <ZetaLogo className="w-[120px] h-[120px]" />
      </g>
      <text x="160" y="205" textAnchor="middle" fontSize="16" fill="#0c503d">ZETA CARRIER</text>
    </svg>
  ),
  book: () => (
    <svg viewBox="0 0 320 220" className="w-full h-auto">
      <rect x="70" y="40" width="180" height="140" rx="12" fill="#0c503d" />
      <rect x="95" y="60" width="130" height="100" rx="8" fill="#0b3f31" />
      <g transform="translate(115,70) scale(0.6)">
        <ZetaLogo className="w-[120px] h-[120px]" />
      </g>
      <text x="160" y="205" textAnchor="middle" fontSize="16" fill="#0c503d">ZETABOOK</text>
    </svg>
  ),
};

// ---- UI：GiftCard 展示 ----
function GiftCard({ variant, prize }) {
  const Art = useMemo(() => {
    switch (variant) {
      case "superman":
        return CardArt.superman;
      case "pizza":
        return CardArt.pizza;
      case "carrier":
        return CardArt.carrier;
      case "book":
        return CardArt.book;
      case "thankyou":
      default:
        return CardArt.thankyou;
    }
  }, [variant]);

  const title = prize.value > 0 ? `${prize.value} ZETA` : "谢谢参与";

  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-[360px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-center text-slate-500 text-sm">A gift from</div>
        <div className="text-center text-2xl font-semibold mb-3">A fren</div>
        <div className="text-center text-emerald-600 mb-4">Scratch below to reveal your gift!</div>

        <div className="rounded-xl border-2 border-slate-200 p-4">
          <div className="mx-auto max-w-[320px]">
            <div className="rounded-xl border border-slate-200 bg-white p-2">
              <div className="text-center font-medium text-slate-800 mt-2">A gift card for a real fren.</div>
              <div className="text-center text-3xl font-extrabold my-2">{title}</div>
              <Art />
              <div className="text-center text-sm text-emerald-700 font-medium mt-2">ZetaChain</div>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-emerald-50 text-emerald-700 p-3 text-center">
          {prize.value > 0 ? `🎉 You got ${prize.value} ZETA!` : "🙌 谢谢参与，祝你下次好运！"}
        </div>
      </div>
    </div>
  );
}

// ---- UI：ScratchCanvas ----
function ScratchCanvas({ onReveal }) {
  const canvasRef = useRef(null);
  const revealRef = useRef(false);

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
      // 背景银灰色并加噪点
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, "#e6e6e6");
      grad.addColorStop(1, "#c9c9c9");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
      noise(ctx, width, height);
      // 文案
      ctx.fillStyle = "#6b7280";
      ctx.font = "bold 14px system-ui, -apple-system, Segoe UI, Roboto";
      ctx.textAlign = "center";
      ctx.fillText("用手指/鼠标刮开", width / 2, height / 2);
      ctx.globalCompositeOperation = "destination-out"; // 擦除模式
    }

    resize();
    window.addEventListener("resize", resize);

    let scratching = false;
    const radius = 18;

    function scratch(x, y) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
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
      if (navigator.vibrate) navigator.vibrate(5);
      const { x, y } = pointerPos(e);
      scratch(x, y);
    }
    function move(e) {
      if (!scratching) return;
      const { x, y } = pointerPos(e);
      scratch(x, y);
      if (!revealRef.current && percentCleared() > 0.6) {
        revealRef.current = true;
        setTimeout(() => onReveal?.(), 300);
      }
    }
    function end() {
      scratching = false;
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
  }, [onReveal]);

  return (
    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full rounded-xl"/>
  );
}

// ---- UI：付款（发票/小票）动画 ----
function ReceiptAnimation({ show }) {
  return (
    <div className={`pointer-events-none fixed inset-0 z-50 flex items-center justify-center transition ${show ? "opacity-100" : "opacity-0"}`}>
      {show && (
        <div className="bg-black/30 absolute inset-0" />
      )}
      {show && (
        <div className="relative z-10 w-[320px] max-w-[80vw]">
          <div className="overflow-hidden rounded-2xl shadow-xl bg-white">
            <div className="p-4 flex items-center gap-3 border-b">
              <div className="w-8 h-8"><ZetaLogo /></div>
              <div className="font-semibold">ZetaChain 收据</div>
            </div>
            <div className="p-4 text-sm text-slate-600 space-y-2 animate-[scroll_1.4s_ease-in-out_infinite] [mask-image:linear-gradient(to_bottom,transparent,black_10%,black_90%,transparent)] h-40">
              <div>· 商品：刮刮卡（五选一）</div>
              <div>· 订单号：ZETA-{Math.floor(Math.random()*999999)}</div>
              <div>· 状态：已付款</div>
              <div>· 时间：{new Date().toLocaleString()}</div>
              <div>· 正在出票…</div>
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
  const [variant, setVariant] = useState("superman");

  // 卡面五选一
  function rollVariant() {
    const all = ["superman", "thankyou", "pizza", "carrier", "book"];
    return all[Math.floor(Math.random() * all.length)];
  }

  // 模拟“支付”
  function payAndStart() {
    setStage("paying");
    setTimeout(() => {
      // 选择卡面与奖项
      const prizeKey = drawPrize(inventory);
      const found = BASE_WEIGHTS.find((w) => w.key === prizeKey);
      const v = rollVariant();
      setVariant(v === "thankyou" && found.value > 0 ? rollVariant() : v); // 避免中奖却是 thankyou 卡面
      setPrize({ key: prizeKey, value: found.value });
      setStage("scratching");
    }, 1400);
  }

  function onRevealed() {
    setStage("revealed");
    setInventory((prev) => consumeInventory(prev, prize.key));
  }

  function reset() {
    setStage("idle");
  }

  const supplyInfo = [
    { label: "10 ZETA", key: "ten" },
    { label: "100 ZETA", key: "hundred" },
    { label: "1000 ZETA", key: "thousand" },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-screen-sm p-4 sm:p-6">
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8"><ZetaLogo /></div>
            <div className="font-semibold">ZetaChain 刮刮卡</div>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem(LS_KEY);
              setInventory(loadInventory());
            }}
            className="text-xs text-slate-500 hover:text-slate-700"
            title="重置本地库存（仅演示）"
          >重置库存</button>
        </header>

        <div className="rounded-2xl border bg-white p-4 sm:p-6 shadow-sm mb-6">
          <div className="text-sm text-slate-600 mb-3">奖池与库存（演示用，本地持久化）</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {supplyInfo.map((s) => (
              <div key={s.key} className="rounded-xl border p-3">
                <div className="text-xs text-slate-500">{s.label}</div>
                <div className="text-lg font-semibold">{inventory[s.key].left} / {inventory[s.key].max}</div>
                {s.key === "ten" && (
                  <div className="text-xs text-emerald-700 mt-1">主页面展示：最大供应 200 张</div>
                )}
              </div>
            ))}
          </div>
          <div className="text-xs text-slate-500 mt-3">概率：无奖 50%｜1 ZETA 40%｜10 ZETA 9.5%｜100 ZETA 0.4%｜1000 ZETA 0.1%（有限档位售罄将自动降级）</div>
        </div>

        <div className="rounded-2xl border bg-white p-4 sm:p-6 shadow-sm">
          {stage === "idle" && (
            <div className="flex flex-col items-center">
              <div className="text-center text-lg font-semibold mb-2">选择卡面：随机五选一</div>
              <div className="text-center text-slate-600 text-sm mb-4">付款后自动出票，进入刮奖</div>
              <button onClick={payAndStart} className="px-5 py-3 rounded-2xl bg-emerald-600 text-white font-semibold shadow hover:bg-emerald-700 active:translate-y-px">使用 ZETA 付款并抽卡</button>
            </div>
          )}

          {stage === "scratching" && (
            <div className="relative mx-auto w-full max-w-[360px]">
              <GiftCard variant={variant} prize={prize} />
              <div className="absolute inset-0">
                <ScratchCanvas onReveal={onRevealed} />
              </div>
            </div>
          )}

          {stage === "revealed" && (
            <div className="flex flex-col items-center gap-4">
              <GiftCard variant={variant} prize={prize} />
              <button onClick={reset} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800">再来一张</button>
            </div>
          )}
        </div>
      </div>

      <ReceiptAnimation show={stage === "paying"} />

      {/* 移动端适配：容器宽度已限制，UI 组件均为流式布局与相对尺寸 */}
    </div>
  );
}
