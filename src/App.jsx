import React, { useEffect, useRef, useState } from "react";
import { WagmiProvider, createConfig, http, useAccount, useConnect, useDisconnect, useConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain, formatUnits, decodeEventLog, keccak256, toBytes } from "viem";
import { readEntropyFee, participateAndDraw, randomBytes32, onDrawCompleted, codeStringToHash, isLotteryCodeValid, getRemainingDraws, getMaxDrawsPerDay, getInventoryStatus, ZetaGachaStakingAbi } from "./lib/contract";
import AlertModal from "./components/AlertModal";

// Zeta Gluck – React JSX module (converted from Gluck2.HTML)
// Usage: import App from './Gluck2'; then render <App /> in your React app.
// Note: Tailwind must be configured in your build (no CDN). Remove/adjust classes if not using Tailwind.

// ---- Local storage helpers ----
const LS_KEY = "zeta_scratch_inventory_v4";
const LS_FIRST_VISIT = "zeta_first_visit_done_v1";

const DEFAULT_INVENTORY = {
  zeropointtwo: { max: 5000, left: 5000, value: 0.2 },
  one: { max: 1000, left: 1000, value: 1 },
  ten: { max: 100, left: 100, value: 10 },
  hundred: { max: 10, left: 10, value: 100 },
  twohundred: { max: 5, left: 5, value: 200 },
  fivehundred: { max: 2, left: 2, value: 500 },
  thousand: { max: 1, left: 1, value: 1000 },
};

function loadInventory() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_INVENTORY };
    const parsed = JSON.parse(raw);
    return {
      zeropointtwo: { ...DEFAULT_INVENTORY.zeropointtwo, ...(parsed.zeropointtwo || {}) },
      one: { ...DEFAULT_INVENTORY.one, ...(parsed.one || {}) },
      ten: { ...DEFAULT_INVENTORY.ten, ...(parsed.ten || {}) },
      hundred: { ...DEFAULT_INVENTORY.hundred, ...(parsed.hundred || {}) },
      twohundred: { ...DEFAULT_INVENTORY.twohundred, ...(parsed.twohundred || {}) },
      fivehundred: { ...DEFAULT_INVENTORY.fivehundred, ...(parsed.fivehundred || {}) },
      thousand: { ...DEFAULT_INVENTORY.thousand, ...(parsed.thousand || {}) },
    };
  } catch (e) {
    return { ...DEFAULT_INVENTORY };
  }

}

function saveInventory(inv) {
  localStorage.setItem(LS_KEY, JSON.stringify(inv));
}

// ---- wagmi / viem 配置（与 Gluck-S1.jsx 保持一致的思路）----

const zetaAthens = defineChain({
  id: 7001,
  name: "ZetaChain Athens Testnet",
  nativeCurrency: { name: "ZETA", symbol: "ZETA", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://zetachain-athens-evm.blockpi.network/v1/rpc/public"] },
    public: { http: ["https://zetachain-athens-evm.blockpi.network/v1/rpc/public"] },
  },
  blockExplorers: {
    default: { name: "ZetaScan", url: "https://athens.explorer.zetachain.com" },
  },
});

const zetaMainnet = defineChain({
  id: 7000,
  name: "ZetaChain Mainnet",
  nativeCurrency: { name: "ZETA", symbol: "ZETA", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://zetachain-evm.blockpi.network/v1/rpc/public"] },
    public: { http: ["https://zetachain-evm.blockpi.network/v1/rpc/public"] },
  },
  blockExplorers: { default: { name: "ZetaScan", url: "https://explorer.zetachain.com" } },
});

const wagmiConfig = createConfig({
  chains: [zetaMainnet],
  connectors: [injected()],
  transports: { [zetaMainnet.id]: http(zetaMainnet.rpcUrls.default.http[0]) },
});

// ---- Weights / drawing ----
const BASE_WEIGHTS = [
  { key: "thousand", weight: 0.005, unlimited: false, value: 1000 },
  { key: "hundred", weight: 0.05, unlimited: false, value: 100 },
  { key: "ten", weight: 0.5, unlimited: false, value: 10 },
  { key: "one", weight: 5, unlimited: false, value: 1 },
  { key: "zeropointtwo", weight: 50, unlimited: false, value: 0.2 },
  { key: "none", weight: 44.445, unlimited: true, value: 0 },
  { key: "fivehundred", weight: 0, unlimited: false, value: 500 },
  { key: "twohundred", weight: 0, unlimited: false, value: 200 },
];

function weightedPick(weights) {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  const r = Math.random() * total;
  let acc = 0;
  for (const w of weights) {
    acc += w.weight;
    if (r <= acc) return w.key;
  }
  return weights[weights.length - 1].key;
}

function demotePrize(key, inv) {
  const chain = ["thousand", "fivehundred", "twohundred", "hundred", "ten", "one", "zeropointtwo", "none"];
  let idx = chain.indexOf(key);
  if (idx === -1) return "none";
  while (idx < chain.length) {
    const k = chain[idx];
    if (k === "none") return k;
    if (inv[k] && inv[k].left > 0) return k;
    idx++;
  }
  return "none";
}

function drawPrize(inv) {
  const dynamicWeights = BASE_WEIGHTS.map((w) => {
    if (w.unlimited) return w;
    const has = inv[w.key]?.left > 0;
    return has ? w : { ...w, weight: 0 };
  }).filter((w) => w.weight > 0 || w.unlimited);
  const picked = weightedPick(dynamicWeights);
  return demotePrize(picked, inv);
}

function consumeInventory(inv, key) {
  const copy = JSON.parse(JSON.stringify(inv));
  if (["zeropointtwo", "one", "ten", "hundred", "twohundred", "fivehundred", "thousand"].includes(key) && copy[key].left > 0) {
    copy[key].left -= 1;
  }
  saveInventory(copy);
  return copy;
}

// ---- i18n ----
const I18N = {
  zh: {
    primaryLabel: "今日手气如何？",
    headline: "Gluck一下",
    desc: "每地址每天10次免费机会，23:59 UTC +8重置",
    draw: "试试手气",
    remainingToday: "该地址今日剩余：10/10",
    walletNotice: "未检测到钱包（MetaMask 等）— 仍可试玩，但无法自动切换网络。",
    secondaryLabel: "奖品库存",
    secondaryTitle: "剩余奖品库存",
    secondaryNote: "更多奖品正在路上",
    giftFrom: "来自",
    checkWin: "查看你中奖了吗👀",
    congrats: (title) => `🎉 恭喜获得 ${title}!`,
    sorry: "🙌 谢谢参与，祝你下次好运！",
    scratchHint: "用手指/鼠标刮开",
    tryAgain: "再来一张",
    receiptTitle: "Zeta Gluck Season 2",
    receiptItem: "Gluck正在为您选择上上签",
    receiptOrder: (n) => `· 订单号：ZETA-${n}`,
    receiptPaid: "· 状态：等待签名",
    receiptTime: () => `· 时间：${new Date().toLocaleString()}`,
    receiptPrinting: "· 正在出票…",
    merchLabel: "ZETA 限量周边 * 10",
    language: "语言",
    shareJoy: "分享喜悦",
    // Alert Modal
    alertDefault: "提示",
    alertConfirm: "确定",
    // Luck Modal
    luckModalTitle: "输入来自KOL的好运符",
    luckModalDesc: "请输入8位随机字母或数字",
    luckModalPlaceholder: "输入8位好运符",
    luckModalCharCount: (count) => `${count}/8 位`,
    luckModalCancel: "取消",
    luckModalConfirm: "确认",
    luckModalValidating: "验证中...",
    // Wallet & Network
    connectWallet: "连接钱包",
    disconnect: "断开连接",
    switchToZeta: "请切换到 Zeta Mainnet",
    // Gift Card
    boostUsed: "Boost已使用",
    thankYouParticipation: "谢谢参与",
    followTwitter: "关注推特 @ZetaChain_CH 好运翻倍",
    // Main Section
    supportThanks: "感谢您的支持🙏",
    boostActive: "好运boost中🍀",
    confirmCodeFirst: "先确认抽奖码",
    luckBoost: "好运翻倍",
    generating: "生成中...",
    // Inventory
    loadingInventory: "正在读取链上库存…",
    // Alert Messages
    walletNotDetected: "未检测到浏览器钱包",
    missingContractAddress: "缺少 REACT_APP_CONTRACT_ADDRESS",
    dailyLimitReached: "今日抽奖次数已用完",
    queryRemainingFailed: "查询剩余次数失败，请稍后重试",
    transactionFailed: "交易失败或已取消",
    missingLotteryAddress: "缺少 REACT_APP_LOTTERY_CODE_ADDRESS",
    enter8DigitCode: "请输入8位抽奖码",
    codeInvalidOrUsed: "抽奖码无效或已被使用",
    codeValidationFailed: "校验邀请码失败，请稍后重试",
    networkSlowOrDelay: "网络较慢或事件延迟，若页面未跳转，请稍后点击再试。",
    generateShareFailed: "生成分享图片失败，请重试",
    installMetamask: "请安装 MetaMask 或其他 Web3 钱包",
    networkSwitched: (chainName) => `成功切换到 ${chainName}`,
    networkNotAdded: (chainName) => `网络 ${chainName} 尚未添加，正在尝试添加...`,
    networkAddSuccess: (chainName) => `网络 ${chainName} 添加成功！`,
    networkAddRejected: "用户拒绝添加网络或操作失败",
    networkSwitchFailed: "切换网络失败，请检查您的钱包设置",
    // Share Image
    shareImageSubtitle: "好运就在Gluck，S2赛季等你来",
    shareImageScan: "扫码参与 Gluck",
  },
  en: {
    primaryLabel: "How's your luck today?",
    headline: "Gluck it",
    desc: "10 free plays per address. Resets at 23:59 UTC+8",
    draw: "Try luck",
    remainingToday: "This address remaining today: 10/10",
    walletNotice: "No wallet detected (MetaMask etc.) — You can still play, but network switching is disabled.",
    secondaryLabel: "Prize inventory",
    secondaryTitle: "Remaining prize inventory",
    secondaryNote: "More prizes are on the way",
    giftFrom: "A gift from",
    checkWin: "See if you won 👀",
    congrats: (title) => `🎉 Congrats! You got ${title}!`,
    sorry: "🙌 Thanks for playing — better luck next time!",
    scratchHint: "Scratch with finger/mouse",
    tryAgain: "Try again",
    receiptTitle: "Zeta Gluck Season 2",
    receiptItem: "Gluck is selecting your lucky card",
    receiptOrder: (n) => `· Order: ZETA-${n}`,
    receiptPaid: "· Status: Paid",
    receiptTime: () => `· Time: ${new Date().toLocaleString()}`,
    receiptPrinting: "· Printing…",
    merchLabel: "ZETA limited merch * 10",
    language: "Language",
    shareJoy: "Share Joy",
    // Alert Modal
    alertDefault: "Notice",
    alertConfirm: "OK",
    // Luck Modal
    luckModalTitle: "Enter Lucky Code from KOL",
    luckModalDesc: "Please enter 8-digit alphanumeric code",
    luckModalPlaceholder: "Enter 8-digit code",
    luckModalCharCount: (count) => `${count}/8 chars`,
    luckModalCancel: "Cancel",
    luckModalConfirm: "Confirm",
    luckModalValidating: "Validating...",
    // Wallet & Network
    connectWallet: "Connect Wallet",
    disconnect: "Disconnect",
    switchToZeta: "Please switch to Zeta Mainnet",
    // Gift Card
    boostUsed: "Boost Used",
    thankYouParticipation: "Better luck next time",
    followTwitter: "Follow @ZetaChain_CH for double luck",
    // Main Section
    supportThanks: "Thank you for your support🙏",
    boostActive: "Lucky boost active🍀",
    confirmCodeFirst: "Confirm code first",
    luckBoost: "Lucky Boost",
    generating: "Generating...",
    // Inventory
    loadingInventory: "Loading on-chain inventory…",
    // Alert Messages
    walletNotDetected: "Browser wallet not detected",
    missingContractAddress: "Missing REACT_APP_CONTRACT_ADDRESS",
    dailyLimitReached: "Daily draw limit reached",
    queryRemainingFailed: "Failed to query remaining draws, please try again later",
    transactionFailed: "Transaction failed or cancelled",
    missingLotteryAddress: "Missing REACT_APP_LOTTERY_CODE_ADDRESS",
    enter8DigitCode: "Please enter 8-digit lottery code",
    codeInvalidOrUsed: "Lottery code invalid or already used",
    codeValidationFailed: "Failed to validate invitation code, please try again later",
    networkSlowOrDelay: "Network slow or event delayed, if page doesn't redirect, please try again later.",
    generateShareFailed: "Failed to generate share image, please retry",
    installMetamask: "Please install MetaMask or other Web3 wallet",
    networkSwitched: (chainName) => `Successfully switched to ${chainName}`,
    networkNotAdded: (chainName) => `Network ${chainName} not added yet, trying to add...`,
    networkAddSuccess: (chainName) => `Network ${chainName} added successfully!`,
    networkAddRejected: "User rejected adding network or operation failed",
    networkSwitchFailed: "Failed to switch network, please check your wallet settings",
    // Share Image
    shareImageSubtitle: "Good luck at Gluck, S2 awaits you",
    shareImageScan: "Scan to join Gluck",
  },
  ko: {
    primaryLabel: "오늘의 운세를 확인해보세요",
    headline: "Gluck 해보기",
    desc: "주소당 하루 10회 무료 기회, 23:59 UTC+8에 리셋",
    draw: "운 시험해보기",
    remainingToday: "이 주소 오늘 남은 횟수: 10/10",
    walletNotice: "지갑이 감지되지 않음 (MetaMask 등) — 여전히 플레이 가능하지만 네트워크 전환이 비활성화됩니다.",
    secondaryLabel: "상품 재고",
    secondaryTitle: "남은 상품 재고",
    secondaryNote: "더 많은 상품이 오고 있습니다",
    giftFrom: "선물",
    checkWin: "당첨되었는지 확인하세요 👀",
    congrats: (title) => `🎉 축하합니다! ${title}을(를) 획득했습니다!`,
    sorry: "🙌 참여해주셔서 감사합니다 — 다음에 더 좋은 운이 있기를!",
    scratchHint: "손가락/마우스로 긁어보세요",
    tryAgain: "다시 시도",
    receiptTitle: "Zeta Gluck Season 2",
    receiptItem: "Gluck이 당신의 행운 카드를 선택 중입니다",
    receiptOrder: (n) => `· 주문번호: ZETA-${n}`,
    receiptPaid: "· 상태: 서명 대기 중",
    receiptTime: () => `· 시간: ${new Date().toLocaleString()}`,
    receiptPrinting: "· 출력 중…",
    merchLabel: "ZETA 한정 굿즈 * 10",
    language: "언어",
    shareJoy: "운세 공유",
    // Alert Modal
    alertDefault: "알림",
    alertConfirm: "확인",
    // Luck Modal
    luckModalTitle: "KOL 추천 코드를 입력하세요",
    luckModalDesc: "8자리 영문자 또는 숫자를 입력해주세요",
    luckModalPlaceholder: "8자리 행운 코드를 입력하세요",
    luckModalCharCount: (count) => `${count}/8 자`,
    luckModalCancel: "취소",
    luckModalConfirm: "확인",
    luckModalValidating: "확인 중...",
    // Wallet & Network
    connectWallet: "지갑 연결",
    disconnect: "연결 해제",
    switchToZeta: "Zeta 메인넷으로 전환",
    // Gift Card
    boostUsed: "부스트 사용됨",
    thankYouParticipation: "다음에 더 좋은 운이",
    followTwitter: "@ZetaChain_CH 팔로우하고 행운 두 배",
    // Main Section
    supportThanks: "지원해 주셔서 감사합니다🙏",
    boostActive: "행운 부스트 활성화🍀",
    confirmCodeFirst: "먼저 코드 확인",
    luckBoost: "더 큰 행운!",
    generating: "생성 중...",
    // Inventory
    loadingInventory: "온체인 재고 읽는 중…",
    // Alert Messages
    walletNotDetected: "브라우저 지갑이 감지되지 않음",
    missingContractAddress: "REACT_APP_CONTRACT_ADDRESS 누락",
    dailyLimitReached: "오늘 추첨 횟수가 모두 소진되었습니다",
    queryRemainingFailed: "남은 횟수 조회 실패, 나중에 다시 시도하세요",
    transactionFailed: "거래 실패 또는 취소됨",
    missingLotteryAddress: "REACT_APP_LOTTERY_CODE_ADDRESS 누락",
    enter8DigitCode: "8자리 추첨 코드를 입력하세요",
    codeInvalidOrUsed: "추첨 코드가 유효하지 않거나 이미 사용되었습니다",
    codeValidationFailed: "초대 코드 확인 실패, 나중에 다시 시도하세요",
    networkSlowOrDelay: "네트워크가 느리거나 이벤트 지연, 페이지가 전환되지 않으면 나중에 다시 시도하세요.",
    generateShareFailed: "공유 이미지 생성 실패, 다시 시도하세요",
    installMetamask: "MetaMask 또는 기타 Web3 지갑을 설치하세요",
    networkSwitched: (chainName) => `${chainName}(으)로 성공적으로 전환했습니다`,
    networkNotAdded: (chainName) => `네트워크 ${chainName}이(가) 아직 추가되지 않았습니다. 추가 시도 중...`,
    networkAddSuccess: (chainName) => `네트워크 ${chainName} 추가 성공!`,
    networkAddRejected: "사용자가 네트워크 추가를 거부했거나 작업 실패",
    networkSwitchFailed: "네트워크 전환 실패, 지갑 설정을 확인하세요",
    // Share Image
    shareImageSubtitle: "Gluck에서 행운을, S2 시즌이 기다립니다",
    shareImageScan: "스캔하여 Gluck 참여",
  },
};

// ---- Scratch canvas ----
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

    function noise(ctx2, w, h) {
      const img = ctx2.createImageData(w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = 200 + Math.random() * 40;
        img.data[i] = n;
        img.data[i + 1] = n;
        img.data[i + 2] = n;
        img.data[i + 3] = 255;
      }
      ctx2.putImageData(img, 0, 0);
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
      ctx.globalCompositeOperation = "destination-out";
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
        setTimeout(() => onReveal && onReveal(), 200);
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

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full rounded-xl" />;
}

// ---- Typing effect ----
function TypewriterText({ texts, lang }) {
  const [currentTextIndex, setCurrentTextIndex] = useState(0);
  const [currentText, setCurrentText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    const currentLangTexts = texts[lang] || texts.zh;
    const currentFullText = currentLangTexts[currentTextIndex];
    if (!currentFullText) return;
    const timeout = setTimeout(() => {
      if (!isDeleting) {
        if (charIndex < currentFullText.length) {
          setCurrentText(currentFullText.substring(0, charIndex + 1));
          setCharIndex(charIndex + 1);
        } else {
          setTimeout(() => setIsDeleting(true), 2000);
        }
      } else {
        if (charIndex > 0) {
          setCurrentText(currentFullText.substring(0, charIndex - 1));
          setCharIndex(charIndex - 1);
        } else {
          setIsDeleting(false);
          setCurrentTextIndex((prev) => (prev + 1) % currentLangTexts.length);
        }
      }
    }, isDeleting ? 100 : 150);
    return () => clearTimeout(timeout);
  }, [charIndex, isDeleting, texts, lang, currentTextIndex]);

  useEffect(() => {
    setCurrentText("");
    setCharIndex(0);
    setIsDeleting(false);
    setCurrentTextIndex(0);
  }, [lang]);

  return (
    <span>
      {currentText}
      <span className="animate-pulse">|</span>
    </span>
  );
}

// ---- ProgressBar ----
function ProgressBar({ percent, animate }) {
  const [w, setW] = useState(animate ? 0 : percent);
  useEffect(() => {
    if (!animate) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => setW(percent), reduce ? 0 : 20);
    return () => clearTimeout(t);
  }, [animate, percent]);
  return (
    <div className="mt-2 h-2 rounded bg-slate-100 overflow-hidden">
      <div className="h-2 bg-emerald-500 transition-all duration-1000 ease-out" style={{ width: `${w}%` }} />
    </div>
  );
}

// ---- BannerAnimation ----
function BannerAnimation() {
  const [messages, setMessages] = useState([]);
  useEffect(() => {
    const prizes = [0.2, 1, 10];
    const initialMessages = Array.from({ length: 5 }, () => {
      const address = `0x${Math.random().toString(16).substr(2, 3)}...${Math.random().toString(16).substr(2, 3)}`;
      const prize = prizes[Math.floor(Math.random() * prizes.length)];
      return { id: Date.now() + Math.random() + Math.random(), text: `${address} won ${prize} ZETA` };
    });
    setMessages(initialMessages);
    const interval = setInterval(() => {
      const address = `0x${Math.random().toString(16).substr(2, 3)}...${Math.random().toString(16).substr(2, 3)}`;
      const prize = prizes[Math.floor(Math.random() * prizes.length)];
      setMessages((prev) => [...prev.slice(-4), { id: Date.now() + Math.random(), text: `${address} won ${prize} ZETA` }]);
    }, 3000);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="relative overflow-hidden bg-gradient-to-r from-emerald-50 to-emerald-100 border-b border-emerald-200 py-2">
      <div className="flex animate-[scroll-banner_20s_linear_infinite] whitespace-nowrap">
        {messages.map((m) => (
          <div key={m.id} className="inline-flex items-center mx-12 text-sm text-emerald-700 font-medium">
            <span className="mr-2">🎉</span>
            {m.text}
          </div>
        ))}
        {messages.map((m) => (
          <div key={`r1-${m.id}`} className="inline-flex items-center mx-12 text-sm text-emerald-700 font-medium">
            <span className="mr-2">🎉</span>
            {m.text}
          </div>
        ))}
        {messages.map((m) => (
          <div key={`r2-${m.id}`} className="inline-flex items-center mx-12 text-sm text-emerald-700 font-medium">
            <span className="mr-2">🎉</span>
            {m.text}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes scroll-banner { 0% { transform: translateX(100%);} 100% { transform: translateX(-100%);} }
      `}</style>
    </div>
  );
}

// ---- ConfettiAnimation ----
function ConfettiAnimation({ show }) {
  const [particles, setParticles] = useState([]);
  useEffect(() => {
    if (!show) return;
    const colors = ["#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];
    const newParticles = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: Math.random() * window.innerWidth,
      y: -10,
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 3 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 8 + 4,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 10,
    }));
    setParticles(newParticles);
    const interval = setInterval(() => {
      setParticles((prev) => prev.map((p) => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, rotation: p.rotation + p.rotationSpeed, vy: p.vy + 0.1 })).filter((p) => p.y < window.innerHeight + 50));
    }, 16);
    const timeout = setTimeout(() => { clearInterval(interval); setParticles([]); }, 2000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [show]);
  if (!show || particles.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {particles.map((p) => (
        <div key={p.id} className="absolute w-2 h-2 rounded-sm" style={{ left: p.x, top: p.y, backgroundColor: p.color, transform: `rotate(${p.rotation}deg)`, width: p.size, height: p.size }} />
      ))}
    </div>
  );
}

// ---- Share image ----
async function generateShareImage(prize, t) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 800; canvas.height = 1000;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#f0fdf4"); gradient.addColorStop(1, "#ecfdf5");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#065f46"; ctx.font = "bold 48px system-ui, -apple-system, Segoe UI, Roboto"; ctx.textAlign = "center";
  ctx.fillText("Zeta Gluck Season 2", canvas.width / 2, 120);
  const prizeText = prize.label || (prize.value > 0 ? `${prize.value} ZETA` : t.thankYouParticipation);
  const congratsText = prize.value > 0 ? t.congrats(prizeText) : t.thankYouParticipation;
  ctx.fillStyle = "#047857"; ctx.font = "bold 36px system-ui, -apple-system, Segoe UI, Roboto"; 
  ctx.fillText(congratsText.substring(0, 20), canvas.width / 2, 220);
  ctx.fillStyle = "#059669"; ctx.font = "bold 42px system-ui, -apple-system, Segoe UI, Roboto"; ctx.fillText(prizeText, canvas.width / 2, 300);
  ctx.fillStyle = "#374151"; ctx.font = "bold 28px system-ui, -apple-system, Segoe UI, Roboto"; 
  ctx.fillText(t.shareImageSubtitle || "Good luck at Gluck, S2 awaits you", canvas.width / 2, 400);
  try {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent('https://zeta-gluck.vercel.app/')}`;
    const qrImg = new Image(); qrImg.crossOrigin = 'anonymous';
    return new Promise((resolve) => {
      qrImg.onload = () => {
        ctx.drawImage(qrImg, canvas.width / 2 - 100, 500, 200, 200);
        ctx.fillStyle = '#6b7280'; ctx.font = '20px system-ui, -apple-system, Segoe UI, Roboto'; 
        ctx.fillText(t.shareImageScan || 'Scan to join Gluck', canvas.width / 2, 750);
        ctx.fillStyle = '#10b981'; ctx.font = 'bold 24px system-ui, -apple-system, Segoe UI, Roboto'; ctx.fillText('ZetaChain', canvas.width / 2, 850);
        resolve(canvas.toDataURL('image/png'));
      };
      qrImg.onerror = () => {
        ctx.fillStyle = '#065f46'; ctx.fillRect(canvas.width / 2 - 100, 500, 200, 200);
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 16px system-ui, -apple-system, Segoe UI, Roboto';
        ctx.fillText('QR Code', canvas.width / 2, 580); ctx.fillText('zeta-gluck.vercel.app', canvas.width / 2, 610);
        ctx.fillStyle = '#6b7280'; ctx.font = '20px system-ui, -apple-system, Segoe UI, Roboto'; 
        ctx.fillText(t.shareImageScan || 'Scan to join Gluck', canvas.width / 2, 750);
        ctx.fillStyle = '#10b981'; ctx.font = 'bold 24px system-ui, -apple-system, Segoe UI, Roboto'; ctx.fillText('ZetaChain', canvas.width / 2, 850);
        resolve(canvas.toDataURL('image/png'));
      };
      qrImg.src = qrUrl;
    });
  } catch (e) {
    console.error('[generateShareImage] Failed:', e);
    return canvas.toDataURL('image/png');
  }
}

// ---- Receipt animation (simplified) ----
function ReceiptAnimation({ show, t }) {
  return (
    <div className={`pointer-events-none fixed inset-0 z-50 flex items-center justify-center transition ${show ? 'opacity-100' : 'opacity-0'}`}>
      {show && <div className="bg-black/30 absolute inset-0" />}
      {show && (
        <div className="relative z-10 w-[320px] max-w-[80vw]">
          <div className="overflow-hidden rounded-2xl shadow-xl bg-white">
            <div className="p-4 text-center border-b">
              <div className="font-semibold text-lg">{t.receiptTitle}</div>
            </div>
            <div className="p-6 text-center">
              <div className="text-slate-600 text-lg font-medium">{t.receiptItem}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Luck code modal ----
function LuckModal({ show, onClose, onConfirm, luckCode, t }) {
  const [inputCode, setInputCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);

  const handleSubmit = () => {
    if (inputCode.length === 8) {
      setIsValidating(true);
      setTimeout(() => {
        luckCode.current=inputCode;
        setIsValidating(false);
        onConfirm();
        onClose();
        setInputCode("");
      }, 1000);
    }
  };
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="bg-black/50 absolute inset-0" onClick={onClose} />
      <div className="relative z-10 w-[400px] max-w-[90vw] bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-6">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">🍀</div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">{t.luckModalTitle}</h3>
            <p className="text-sm text-slate-600">{t.luckModalDesc}</p>
          </div>
          <div className="mb-4">
            <input type="text" value={inputCode} onChange={(e) => setInputCode(e.target.value.toUpperCase())} placeholder={t.luckModalPlaceholder} maxLength={8} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-center text-lg font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500" />
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-slate-500">{t.luckModalCharCount(inputCode.length)}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={()=>{onClose();setInputCode("")}} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors">{t.luckModalCancel}</button>
            <button onClick={handleSubmit} disabled={inputCode.length !== 8 || isValidating} className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl font-medium disabled:opacity-50">{isValidating ? t.luckModalValidating : t.luckModalConfirm}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- GiftCard ----
function GiftCard({ prize, t, isRevealed = false, isLuckMode = false }) {
  const title = prize.label || (prize.value > 0 ? `${prize.value} ZETA` : t.thankYouParticipation);
  return (
    <div className="w-full">
      <div className={`mx-auto w-full max-w-[360px] rounded-2xl border p-4 shadow-sm transition-all duration-500 ${isRevealed ? 'border-gray-300 bg-gray-100' : 'border-slate-200 bg-white'}`}>
        <div className={`flex items-center justify-center text-sm ${isRevealed ? 'text-gray-500' : 'text-slate-500'}`}>
          <span>{t.giftFrom}</span>
        </div>
        <div className={`text-center text-2xl font-semibold mb-3 ${isRevealed ? 'text-gray-600' : 'text-slate-900'}`}>ZetaChain</div>
        <div className={`text-center mb-4 ${isRevealed ? 'text-gray-500' : (isLuckMode ? 'text-purple-600' : 'text-emerald-600')}`}>{isLuckMode ? t.boostUsed : t.checkWin}</div>
        <div className={`rounded-xl border-2 p-4 ${isRevealed ? 'border-gray-300 bg-gray-50' : 'border-slate-200 bg-white'}`}>
          <div className="mx-auto max-w-[320px]">
            <div className={`rounded-xl border p-4 min-h-[220px] flex flex-col items-center justify-center ${isRevealed ? 'border-gray-300 bg-gray-100' : 'border-slate-200 bg-white'}`}>
              <div className={`text-center text-3xl font-extrabold my-2 ${isRevealed ? 'text-gray-600' : 'text-slate-900'}`}>{title}</div>
              <div className={`text-center text-sm font-medium mt-2 ${isRevealed ? 'text-gray-500' : 'text-emerald-700'}`}>ZetaChain</div>
            </div>
          </div>
        </div>
        <div className={`mt-4 rounded-xl p-3 text-center ${isRevealed ? 'bg-gray-200 text-gray-600' : 'bg-emerald-50 text-emerald-700'}`}>
          <a href="https://x.com/ZetaChain_CH" target="_blank" rel="noopener noreferrer" className="hover:underline">{t.followTwitter}</a>
        </div>
      </div>
    </div>
  );
}

// ---- App ----
function MainApp() {
  const [inventory, setInventory] = useState(loadInventory());
  const [stage, setStage] = useState("idle"); // idle → paying → scratching → revealed
  const [prize, setPrize] = useState({ key: "none", value: 0 });
  const [lang, setLang] = useState("zh");
  const [firstVisit, setFirstVisit] = useState(() => !localStorage.getItem(LS_FIRST_VISIT));
  const [showConfetti, setShowConfetti] = useState(false);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [isLuckMode, setIsLuckMode] = useState(false);
  const [showLuckModal, setShowLuckModal] = useState(false);
  const luckCode=useRef("");
  const [luckCodeUsed, setLuckCodeUsed] = useState(false);
  const [remainingDrawsToday, setRemainingDrawsToday] = useState(null);
  const [maxDrawsPerDay, setMaxDrawsPerDay] = useState(null);
  const [chainInv, setChainInv] = useState(null); // { amounts, probabilities, maxSupplies, remaining, unlimited }
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMsg, setAlertMsg] = useState("");
  const [alertTitle, setAlertTitle] = useState("");
  const triggerAlert = (message, title) => {
    setAlertTitle(title || t.alertDefault);
    setAlertMsg(message);
    setAlertOpen(true);
  };

  // 钱包（wagmi hooks）
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const config = useConfig();

  // useEffect(()=>{
  //   console.log("幸运",luckCode.current)
  // },[luckCode.current])

  // useEffect(()=>{
  //   console.log("幸运模式?",isLuckMode)
  // },[isLuckMode])

  // 实时获取当前地址剩余抽奖次数与上限
  useEffect(() => {
    const contractAddress = process.env.REACT_APP_CONTRACT_ADDRESS;
    if (!config || !address || !contractAddress) { setRemainingDrawsToday(null); return; }
    (async () => {
      try {
        const [remaining, max] = await Promise.all([
          getRemainingDraws({ config, contractAddress, userAddress: address }),
          getMaxDrawsPerDay({ config, contractAddress })
        ]);
        setRemainingDrawsToday(Number(remaining));
        setMaxDrawsPerDay(Number(max));
        } catch (e) {
        console.warn('[getRemainingDraws] failed', e);
        setRemainingDrawsToday(null);
      }
    })();
  }, [config, address]);  // 读取链上库存信息
  async function fetchInventory() {
    try {
      const contractAddress = process.env.REACT_APP_CONTRACT_ADDRESS;
      if (!contractAddress) return;
      const res = await getInventoryStatus({ config, contractAddress });
      setChainInv({
        amounts: res[0],
        probabilities: res[1],
        maxSupplies: res[2],
        remaining: res[3],
        unlimited: res[4],
      });
    } catch (e) {
      console.warn('[inventory] failed to fetch on-chain inventory', e);
    }
  }

  // 页面加载时读取一次
  useEffect(() => { fetchInventory(); }, []);

  // 基于链上返回构建展示条目（按 0.5/1/10/100/1000/merch 顺序）
  function formatZetaAmount(wei) {
    try { return formatUnits(wei, 18); } catch { return '0'; }
  }
  // 根据合约经济模型展示 tier 1..5（0 为未中奖，6-9 已移除）
  const importantTierIndices = [1, 2, 3, 4, 5];
  const displayTiers = chainInv && chainInv.amounts
    ? importantTierIndices
        .map((i) => ({
          index: i,
          amountWei: chainInv.amounts[i],
          amountLabel: `${formatZetaAmount(chainInv.amounts[i])} ZETA`,
          max: Number(chainInv.maxSupplies[i]) || 0,
          left: Number(chainInv.remaining[i]) || 0,
        }))
        .filter((t) => t.max > 0) // 过滤掉已移除的奖项
    : null;

  function shortAddr(addr) {
    if (!addr) return "";
    return addr.slice(0, 6) + "..." + addr.slice(-4);
  }

  async function onConnectWallet() {
    const preferred = connectors.find((c) => c.id === "injected") || connectors[0];
    if (!preferred) { triggerAlert(t.walletNotDetected); return; }
    await connectAsync({ connector: preferred });
  }

  useEffect(() => { if (firstVisit) localStorage.setItem(LS_FIRST_VISIT, "1"); }, [firstVisit]);
  const t = I18N[lang];

  // 通用：发起上链抽奖（封装事件监听与交易）
  async function startOnChainDraw(contractAddress, codeHash) {
    // 临时事件监听：等待本地址的 DrawCompleted 后再进入刮奖
    let resolved = false;
    let timeoutId;
    const unwatch = onDrawCompleted({
      config,
      contractAddress,
      listener: (logs) => {
        for (const log of logs) {
          const player = (log.args?.player || '').toLowerCase?.();
          if (!player || !address) continue;
          if (player !== address.toLowerCase()) continue;
          const amount = log.args?.amount ?? 0n;
          const amountZeta = parseFloat(formatUnits(amount, 18));
          const p = amountZeta > 0 ? { key: 'onchain', value: amountZeta } : { key: 'none', value: 0 };
          resolved = true;
          clearTimeout?.(timeoutId);
          setPrize(p);
          setStage('scratching');
          // 成功回调后刷新剩余次数与链上库存
          (async ()=>{
            try {
              const r = await getRemainingDraws({ config, contractAddress, userAddress: address });
              setRemainingDrawsToday(Number(r));
              void fetchInventory();
            } catch {}
          })();
          try { unwatch?.(); } catch {}
          break;
        }
      }
    });

    const fee = await readEntropyFee({ config, contractAddress });
    const userRandomNumber = randomBytes32();
    const receipt = await participateAndDraw({ config, contractAddress, userRandomNumber, codeHash, value: fee });

    // 兜底：若在一定时间内未收到事件，尝试从本次交易回执中解码 DrawCompleted
    timeoutId = setTimeout(() => {
      if (resolved) return;
      try {
        const topic0 = keccak256(toBytes('DrawCompleted(address,uint8,uint256,bytes32)'));
        const targetLogs = (receipt?.logs || []).filter((l) =>
          (l?.address?.toLowerCase?.() === contractAddress.toLowerCase()) && Array.isArray(l?.topics) && l.topics[0] === topic0
        );
        for (const l of targetLogs) {
          try {
            const decoded = decodeEventLog({ abi: ZetaGachaStakingAbi, data: l.data, topics: l.topics });
            if (decoded?.eventName !== 'DrawCompleted') continue;
            const player = (decoded?.args?.player || '').toLowerCase?.();
            if (!player || !address || player !== address.toLowerCase()) continue;
            const amount = decoded?.args?.amount ?? 0n;
            const amountZeta = parseFloat(formatUnits(amount, 18));
            const p = amountZeta > 0 ? { key: 'onchain', value: amountZeta } : { key: 'none', value: 0 };
            resolved = true;
            setPrize(p);
            setStage('scratching');
            (async ()=>{
              try {
                const r = await getRemainingDraws({ config, contractAddress, userAddress: address });
                setRemainingDrawsToday(Number(r));
                void fetchInventory();
              } catch {}
            })();
            try { unwatch?.(); } catch {}
            break;
          } catch {}
        }
        if (!resolved) {
          setStage('idle');
          triggerAlert(t.networkSlowOrDelay);
        }
      } catch (e) {
        console.warn('[fallback] decode receipt logs failed', e);
        setStage('idle');
        triggerAlert(t.networkSlowOrDelay);
      }
    }, 20000); // 20s 超时兜底
  }

  // 普通抽奖：不使用邀请码
  async function payAndStartNormal() {
    try {
      // 连接钱包（如未连接）
      if (!isConnected) {
        const preferred = connectors.find((c) => c.id === "injected") || connectors[0];
        if (!preferred) { triggerAlert(t.walletNotDetected); return; }
        await connectAsync({ connector: preferred });
      }

      const contractAddress = process.env.REACT_APP_CONTRACT_ADDRESS;
      if (!contractAddress) { triggerAlert(t.missingContractAddress); return; }

      // 检查当前地址剩余抽奖次数
      try {
        const remaining = await getRemainingDraws({ config, contractAddress, userAddress: address });
        if ((remaining ?? 0) === 0) {
          triggerAlert(t.dailyLimitReached);
          return;
        }
      } catch (e) {
        console.error('[payAndStartNormal] Query remaining draws failed:', e);
        triggerAlert(t.queryRemainingFailed);
        return;
      }
      setStage('paying');
      const zeroCode = '0x0000000000000000000000000000000000000000000000000000000000000000';
      await startOnChainDraw(contractAddress, zeroCode);
      // 后续由事件回调推进到刮奖阶段
    } catch (e) {
      console.error('participateAndDraw failed', e);
      triggerAlert(e?.shortMessage || e?.message || t.transactionFailed);
      setStage('idle');
    }
  }

  // 好运翻倍抽奖：使用邀请码
  async function payAndStartBoosted() {
    try {
      // 连接钱包（如未连接）
      if (!isConnected) {
        const preferred = connectors.find((c) => c.id === "injected") || connectors[0];
        if (!preferred) { triggerAlert(t.walletNotDetected); return; }
        await connectAsync({ connector: preferred });
      }

      const contractAddress = process.env.REACT_APP_CONTRACT_ADDRESS;
      if (!contractAddress) { triggerAlert(t.missingContractAddress); return; }

      // 检查当前地址剩余抽奖次数
      try {
        const remaining = await getRemainingDraws({ config, contractAddress, userAddress: address });
        if ((remaining ?? 0) === 0) {
          triggerAlert(t.dailyLimitReached);
          return;
        }
      } catch (e) {
        console.error('[payAndStartBoosted] Query remaining draws failed:', e);
        triggerAlert(t.queryRemainingFailed);
        return;
      }

      // 邀请码校验（存在且未使用）
      const raw = luckCode.current?.trim();
      if (!raw) { triggerAlert(t.enter8DigitCode); return; }
      const managerAddress = process.env.REACT_APP_LOTTERY_CODE_ADDRESS;
      if (!managerAddress) { triggerAlert(t.missingLotteryAddress); return; }
      const codeHash = codeStringToHash(raw);
      try {
        const valid = await isLotteryCodeValid({ config, managerAddress, codeHash });
        console.log('[payAndStartBoosted] Code validation:', valid, raw, codeHash);
        if (!valid) { 
          triggerAlert(t.codeInvalidOrUsed);
          luckCode.current = '';
          setIsLuckMode(false);
          return; }
      } catch (e) { console.error('[payAndStartBoosted] Code validation failed:', e); triggerAlert(t.codeValidationFailed); return; }

      setStage('paying');
      await startOnChainDraw(contractAddress, codeHash);
      // 后续由事件回调推进到刮奖阶段
    } catch (e) {
      console.error('participateAndDraw boosted failed', e);
      triggerAlert(e?.shortMessage || e?.message || t.transactionFailed);
      setStage('idle');
    }
  }

  function onRevealed() {
    console.log('[onRevealed] Prize revealed:', prize);
    setStage("revealed");
    setInventory((prev) => consumeInventory(prev, prize.key));
    if (prize.value > 0 || prize.label) { setShowConfetti(true); setTimeout(() => setShowConfetti(false), 2000); }
    // 若本次使用了邀请码，则在揭晓后消费掉：清空并退出 boost
    if (luckCodeUsed) {
      luckCode.current="";
      setIsLuckMode(false);
    }
    setLuckCodeUsed(false);
  }

  function reset() {
    // 单次邀请码：使用后清空并退出 boost 模式
    if (luckCodeUsed) {
      luckCode.current="";
      setLuckCodeUsed(false);
      setIsLuckMode(false);
    }
    // 直接再次上链抽一次（普通）
    payAndStartNormal();
  }

  async function handleShare() {
    setIsGeneratingShare(true);
    try {
      const imageDataURL = await generateShareImage(prize, t);
      const link = document.createElement('a');
      link.download = `zeta-gluck-${prize.value > 0 ? prize.value : 'participation'}-${Date.now()}.png`;
      link.href = imageDataURL; document.body.appendChild(link); link.click(); document.body.removeChild(link);
    } catch (e) { console.error('[handleShare] Generate share image failed:', e); triggerAlert(t.generateShareFailed); }
    finally { setIsGeneratingShare(false); }
  }

  function handleLuckConfirm() {
    setIsLuckMode(true);
    setLuckCodeUsed(true);
    setShowLuckModal(false);
    payAndStartBoosted();
  }

  // Zeta Mainnet 网络配置
  const zetaMainnetConfig = {
    chainId: '0x1b58', // 7000 in hex
    chainName: 'ZetaChain Mainnet',
    nativeCurrency: {
      name: 'ZETA',
      symbol: 'ZETA',
      decimals: 18,
    },
    rpcUrls: ['https://zetachain-evm.blockpi.network/v1/rpc/public'],
    blockExplorerUrls: ['https://explorer.zetachain.com'],
  };

  async function addAndSwitchNetwork(networkConfig) {
    if (typeof window.ethereum === 'undefined') {
      triggerAlert(t.installMetamask);
      return;
    }
  
    // 1. 尝试直接切换网络
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: networkConfig.chainId }],
      });
      triggerAlert(t.networkSwitched(networkConfig.chainName));
  
    } catch (switchError) {
      // 检查错误代码，4902 表示网络未添加
      if (switchError.code === 4902) {
        console.log(t.networkNotAdded(networkConfig.chainName));
        
        // 2. 尝试添加网络
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [networkConfig],
          });
          
          triggerAlert(t.networkAddSuccess(networkConfig.chainName));
          
          // 可选：添加成功后再次尝试切换
          await window.ethereum.request({
               method: 'wallet_switchEthereumChain',
               params: [{ chainId: networkConfig.chainId }],
          });
  
        } catch (addError) {
          console.error('[addAndSwitchNetwork] Add network failed or user rejected:', addError);
          triggerAlert(t.networkAddRejected);
        }
      } else {
        console.error('[addAndSwitchNetwork] Switch network failed:', switchError);
        triggerAlert(t.networkSwitchFailed);
      }
    }
  }

  // 切换到 Zeta Mainnet
  async function switchToZetaMainnet() {
    await addAndSwitchNetwork(zetaMainnetConfig);
  }
  


  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-screen-sm p-4 sm:p-6">
        <header className="flex items-center justify-between mb-6">
          <div className="flex-1" />
          <div className="text-2xl font-bold text-center bg-gradient-to-r from-emerald-600 to-emerald-800 bg-clip-text text-transparent">Zeta Gluck Season 2</div>
          <div className="flex-1 flex justify-end gap-2">
            <button className="px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-100 border border-emerald-300 rounded-lg">ZetaChain</button>
            <select value={lang} onChange={(e) => setLang(e.target.value)} className="appearance-none bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <option value="zh">中文简体</option>
              <option value="en">English</option>
              <option value="ko">한국어</option>
            </select>
          </div>
        </header>

        {/* 钱包地址与连接/断开（位于标题下方） */}
        <div className="-mt-4 mb-2 flex items-center justify-center gap-2">
          {isConnected ? (
            <>
              <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-mono" title={address}>{shortAddr(address)}</span>
              <button onClick={switchToZetaMainnet} className="text-[11px] px-2 py-0.5 rounded border border-purple-300 text-purple-700 hover:bg-purple-50">{t.switchToZeta}</button>
              <button onClick={() => disconnect()} className="text-[11px] px-2 py-0.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50">{t.disconnect}</button>
            </>
          ) : (
            <button onClick={onConnectWallet} className="text-[11px] px-2 py-0.5 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50">{t.connectWallet}</button>
          )}
        </div>

        <section className={`rounded-3xl border-2 p-6 sm:p-8 shadow-lg mb-6 relative overflow-hidden ${isLuckMode ? 'bg-gradient-to-br from-purple-50 via-white to-purple-50 ring-2 ring-purple-100/60' : 'bg-gradient-to-br from-emerald-50 via-white to-emerald-50 ring-2 ring-emerald-100/60'}`}>
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
          <div className="mb-6 text-center relative z-10">
            <div className={`text-[12px] tracking-widest font-bold uppercase mb-2 ${isLuckMode ? 'text-purple-700/90' : 'text-emerald-700/90'}`}>{isLuckMode ? t.supportThanks : t.primaryLabel}</div>
            <h2 className={`text-2xl sm:text-3xl font-bold mb-3 ${isLuckMode ? 'text-purple-800' : 'text-slate-900'}`}>
              {isLuckMode ? t.boostActive : (
                <TypewriterText texts={{ zh: ["Gluck一下", "好运满满"], en: ["Gluck it", "Good luck"], ko: ["Gluck 해보기", "행운 가득"] }} lang={lang} />
              )}
            </h2>
            <p className="text-slate-600 text-sm mb-4">{t.desc}</p>
          </div>

          {stage === 'idle' && (
            <div className="flex flex-col items-center gap-4 relative z-10">
              <button onClick={() => (isLuckMode ? payAndStartBoosted() : payAndStartNormal())} disabled={isLuckMode && !luckCodeUsed} className={`px-8 py-4 rounded-2xl font-bold text-lg shadow-lg transition-all ${isLuckMode && !luckCodeUsed ? 'bg-gray-400 text-gray-600 cursor-not-allowed' : 'bg-gradient-to-r from-emerald-600 to-emerald-700 text-white'}`}>{isLuckMode ? (luckCodeUsed ? t.draw : t.confirmCodeFirst) : t.draw}</button>
              <div className="inline-flex items-center gap-2 bg-emerald-100 text-emerald-800 px-4 py-2 rounded-full text-sm font-semibold">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                {(() => {
                  const r = remainingDrawsToday;
                  const m = maxDrawsPerDay;
                  const zh = `该地址今日剩余：${r ?? '-'}${m != null ? `/${m}` : ''}`;
                  const en = `This address remaining today: ${r ?? '-'}${m != null ? `/${m}` : ''}`;
                  const ko = `이 주소 오늘 남은 횟수: ${r ?? '-'}${m != null ? `/${m}` : ''}`;
                  if (lang === 'zh') return zh;
                  if (lang === 'ko') return ko;
                  return en;
                })()}
              </div>
            </div>
          )}

          {stage === 'scratching' && (
            <div className="relative mx-auto w-full max-w-[360px]">
              <GiftCard prize={prize} t={t} isLuckMode={isLuckMode} />
              <div className="absolute inset-0">
                <ScratchCanvas onReveal={onRevealed} t={t} />
              </div>
            </div>
          )}

          {stage === 'revealed' && (
            <div className="flex flex-col items-center gap-6">
              <GiftCard prize={prize} t={t} isRevealed={true} isLuckMode={isLuckMode} />
              <div className="flex gap-4">
                <button onClick={handleShare} disabled={isGeneratingShare} className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-sm font-semibold disabled:opacity-50">{isGeneratingShare ? t.generating : t.shareJoy}</button>
                <button onClick={reset} className="px-6 py-3 rounded-xl bg-gradient-to-r from-slate-700 to-slate-800 text-white text-sm font-semibold">{t.tryAgain}</button>
                <button onClick={() => { if (isLuckMode) { setIsLuckMode(false); setLuckCodeUsed(false);  } else { setShowLuckModal(true); } }} className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-700 text-white text-sm font-semibold">{t.luckBoost}</button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-3xl border-2 bg-gradient-to-br from-slate-50 via-white to-slate-50 shadow-lg ring-2 ring-slate-100/60 overflow-hidden">
          <BannerAnimation />
          <div className="p-6 sm:p-8">
            <div className="mb-6">
              <div className="text-[12px] tracking-widest text-slate-600 font-bold uppercase mb-2">{t.secondaryLabel}</div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">{t.secondaryTitle}</h3>
              <p className="text-sm text-slate-600">{t.secondaryNote}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {displayTiers ? (
                displayTiers.map((t1) => {
                  const rawPercent = t1.max > 0 ? (t1.left / t1.max) * 100 : 0;
                  const percent = Math.max(0, Math.min(100, Math.round(rawPercent)));
                  const animate = firstVisit && t1.left === t1.max;
                  const isLowStock = percent < 20; const isOutOfStock = percent === 0;
                  return (
                    <div key={`tier-${t1.index}`} className={`rounded-2xl border-2 p-4 transition-all duration-300 ${isOutOfStock ? 'border-red-200 bg-red-50' : isLowStock ? 'border-orange-200 bg-orange-50' : 'border-emerald-200 bg-white'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className={`text-xs font-semibold ${isOutOfStock ? 'text-red-600' : isLowStock ? 'text-orange-600' : 'text-slate-600'}`}>{`${t1.amountLabel} * ${t1.max}`}</div>
                        <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${isOutOfStock ? 'bg-red-100 text-red-700' : isLowStock ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}>{rawPercent.toFixed(3)}%</span>
                      </div>
                      <div className={`text-lg font-bold mb-2 ${isOutOfStock ? 'text-red-600' : isLowStock ? 'text-orange-600' : 'text-slate-800'}`}>{t1.left} / {t1.max}</div>
                      <ProgressBar percent={percent} animate={animate} />
                    </div>
                  );
                })
              ) : (
                <div className="text-sm text-slate-500">{t.loadingInventory}</div>
              )}
            </div>
          </div>
        </section>
      </div>

      <ReceiptAnimation show={stage === 'paying'} t={t} />
      <ConfettiAnimation show={showConfetti} />
      <LuckModal show={showLuckModal} onClose={() => setShowLuckModal(false)} onConfirm={handleLuckConfirm} luckCode={luckCode} t={t} />
      <AlertModal show={alertOpen} title={alertTitle || t.alertDefault} message={alertMsg} onClose={() => setAlertOpen(false)} t={t} />

      <style>{`
        @keyframes shimmer { 0% { transform: translateX(-100%);} 100% { transform: translateX(100%);} }
        @keyframes boost-glow { 0%, 100% { opacity: 1; text-shadow: 0 0 10px rgba(147, 51, 234, 0.5);} 50% { opacity: 0.8; text-shadow: 0 0 20px rgba(147, 51, 234, 0.8);} }
        .boost-glow { animation: boost-glow 1.5s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <MainApp />
    </WagmiProvider>
  );
}
