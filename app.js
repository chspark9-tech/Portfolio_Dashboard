<<<<<<< HEAD
/* ================================================================
   Portfolio Dashboard - app.js (v5: Tabs & Enhanced Debugging)
   ================================================================ */

let rawData = {};
let currentWorkbook = null;
let charts = {};
let holdingsData = [];
let sortCol = null;
let sortDir = 1;
let usdKrw = 1400;
let selectedDivAccounts = new Set();
let currentWorkbookName = "";

// ─── Firebase Initialize ───
const firebaseConfig = {
  projectId: "portfolio-dashboard-9bd7d",
  appId: "1:632004937412:web:1505c9030b948f8717eb91",
  storageBucket: "portfolio-dashboard-9bd7d.firebasestorage.app",
  apiKey: "AIzaSyASluluTOFka6JdZmNTarYVSsVYeXE1mYA",
  authDomain: "portfolio-dashboard-9bd7d.firebaseapp.com",
  messagingSenderId: "632004937412",
  measurementId: "G-3Y7HE5X408"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();
// ─── Firebase Auth UI ───
function initAuthUI() {
  const container = document.getElementById('authContainer');
  if (!container) return;

  const btn = document.createElement('button');
  btn.textContent = 'Google 로그인';
  btn.className = 'btn-login';
  btn.onclick = () => {
    firebase.auth().signInWithPopup(provider)
      .then((result) => {
        const user = result.user;
        console.log('로그인 성공:', user);
        renderUserUI(user);
      })
      .catch((error) => {
        console.error('로그인 오류:', error);
        alert('로그인에 실패했습니다. 콘솔을 확인하세요.');
      });
  };
  container.appendChild(btn);
}

function renderUserUI(user) {
  const container = document.getElementById('authContainer');
  container.innerHTML = `
    <span class="user-name">${user.displayName}</span>
    <button class="btn-logout" onclick="firebase.auth().signOut()">로그아웃</button>
  `;
}

// Listen auth state changes
firebase.auth().onAuthStateChanged((user) => {
  if (user) {
    renderUserUI(user);
  } else {
    initAuthUI();
  }
});

let currentUser = null;

// ─── 오래된 입금내역 팝업: 업로드 시 1회만 표시, 선택값 저장 ───
let earlyDepositDecisionMade = false;  // 파일 로드 후 한 번만 물어봄
let includeEarlyDeposit = false;       // 사용자가 선택한 값 (예=true, 아니오=false)

// ─── 동기화 실패 종목의 수기 현재가 저장 { ticker: price } ───
let manualPrices = {};

// ─── 전역 실행 취소(Undo) 스택 ───
let undoStack = [];

function saveState() {
  if (undoStack.length >= 50) undoStack.shift();
  undoStack.push({
    holdingsData: JSON.parse(JSON.stringify(holdingsData)),
    manualPrices: JSON.parse(JSON.stringify(manualPrices)),
    goalData1: JSON.parse(localStorage.getItem('goalData1') || '[]'),
    goalData2: JSON.parse(localStorage.getItem('goalData2') || '[]'),
    dividendManualData: JSON.parse(localStorage.getItem('dividendManualData') || '{}')
  });
}

function undo() {
  if (undoStack.length === 0) return;
  const state = undoStack.pop();
  
  holdingsData = state.holdingsData;
  manualPrices = state.manualPrices;
  localStorage.setItem('goalData1', JSON.stringify(state.goalData1));
  localStorage.setItem('goalData2', JSON.stringify(state.goalData2));
  localStorage.setItem('dividendManualData', JSON.stringify(state.dividendManualData));
  
  recalculate();
  initGoalTables();
  renderDividendTab();
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'z') {
    // 입력 중인 셀이 있을 경우, 브라우저 기본 Undo 작동 후 전역 상태는 업데이트하지 않음 (충돌 방지)
    // 문서 활성 요소가 contenteditable이면 브라우저 자체에 맡김
    if (document.activeElement && document.activeElement.getAttribute('contenteditable') === 'true') {
      return; 
    }
    e.preventDefault();
    undo();
  }
});

// 모든 수동 입력 시작 시(focusin) 상태 저장
document.addEventListener('focusin', (e) => {
  if (e.target && e.target.getAttribute('contenteditable') === 'true') {
    saveState();
  }
});

const ACCOUNT_COLORS = {};
const COLOR_PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316', '#14b8a6', '#64748b'];
const ACCOUNT_SHEETS = {};
for (let i = 1; i <= 10; i++) ACCOUNT_SHEETS[`계좌내역${i}`] = "";

// ─── Formatting ───
function fmt(n) { return (n == null || isNaN(n)) ? '0' : Math.round(n).toLocaleString('ko-KR'); }
function fmtPrice(n, curr) {
  if (n == null || isNaN(n)) return '0';
  return curr === '$' ? n.toFixed(2) : Math.round(n).toLocaleString('ko-KR');
}
function fmtPct(n) { return (n == null || isNaN(n)) ? '0.00%' : (n * 100).toFixed(2) + '%'; }
function pctClass(n) { return n >= 0 ? 'positive' : 'negative'; }
function parseNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[,₩원$%\s]/g, '');
  return parseFloat(s) || 0;
}
function parseDate(v) {
  if (v instanceof Date) return v;
  if (!v) return new Date(NaN);
  let s = String(v).trim();
  // 숫자만 있는 경우 (YYYYMMDD)
  if (/^\d{8}$/.test(s)) return new Date(`${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}`);
  // YY/MM/ 또는 YY/MM/DD 형식 대응
  let match = s.match(/^(\d{2,4})[\/\.\-](\d{1,2})([\/\.\-](\d{1,2}))?[\/\.\-]?$/);
  if (match) {
    let yr = match[1], mo = match[2], dy = match[4] || '01';
    if (yr.length === 2) yr = (parseInt(yr) > 50 ? '19' : '20') + yr;
    return new Date(`${yr}-${mo.padStart(2, '0')}-${dy.padStart(2, '0')}`);
  }
  return new Date(s);
}
function getAccountColor(acc) {
  if (!ACCOUNT_COLORS[acc]) {
    const idx = Object.keys(ACCOUNT_COLORS).length;
    ACCOUNT_COLORS[acc] = COLOR_PALETTE[idx % COLOR_PALETTE.length];
  }
  return ACCOUNT_COLORS[acc];
}

// ─── Custom Modal ───
function showModal(title, message) {
  const modal = document.getElementById('customModal');
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMessage').textContent = message;
  document.getElementById('modalConfirm').textContent = '확인';
  document.getElementById('modalCancel').style.display = 'none';
  modal.classList.add('active');

  const close = () => modal.classList.remove('active');
  document.getElementById('modalClose').onclick = close;
  document.getElementById('modalConfirm').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
}

// 예/아니오 선택이 필요한 확인 모달
function showConfirmModal(title, message, onYes, onNo) {
  const modal = document.getElementById('customModal');
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMessage').textContent = message;

  const confirmBtn = document.getElementById('modalConfirm');
  const cancelBtn = document.getElementById('modalCancel');
  confirmBtn.textContent = '예';
  cancelBtn.style.display = 'inline-block';
  cancelBtn.textContent = '아니오';
  modal.classList.add('active');

  const close = () => {
    modal.classList.remove('active');
    cancelBtn.style.display = 'none';
    confirmBtn.textContent = '확인';
  };

  document.getElementById('modalClose').onclick = () => { close(); if (onNo) onNo(); };
  confirmBtn.onclick = () => { close(); if (onYes) onYes(); };
  cancelBtn.onclick = () => { close(); if (onNo) onNo(); };
  modal.onclick = (e) => { if (e.target === modal) { close(); if (onNo) onNo(); } };
}

// ─── Tab Navigation ───
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const tabId = btn.dataset.tab;
    document.getElementById(tabId).classList.add('active');

    if (tabId === 'tabAllocation') renderCharts();
    if (tabId === 'tabDividends') renderDividendTab();
    if (tabId === 'tabReturns') renderCumulativeTab(); // ID 수정: tabMonthly -> tabReturns

    // Resize charts if needed
    Object.values(charts).forEach(chart => chart.resize());
  };
});

// ─── Recalculate ───
function recalculate() {
  const accountTotals = {};
  holdingsData.forEach(h => {
    const isUs = h.country === '미국';
    h.costKrw = h.qty * (isUs ? h.avgPrice * usdKrw : h.avgPrice);
    h.valueKrw = h.qty * (isUs ? h.curPrice * usdKrw : h.curPrice);
    h.returnPct = h.costKrw > 0 ? (h.valueKrw - h.costKrw) / h.costKrw : 0;
    if (!accountTotals[h.account]) accountTotals[h.account] = 0;
    accountTotals[h.account] += h.valueKrw;
  });
  holdingsData.forEach(h => { h.weight = accountTotals[h.account] > 0 ? h.valueKrw / accountTotals[h.account] : 0; });
  renderKPI(holdingsData);
  renderCharts();
  renderTable();
  renderDividendTab(); // 추가: 환율 변동 시 배당 탭 갱신
  renderCumulativeTab(); // 추가: 환율 변동 시 누적수익률 탭 갱신
}

// ─── Real-time Sync (Enhanced Debugging) ───
async function syncPrices() {
  if (Object.keys(manualPrices).length > 0) {
    showConfirmModal(
      '⚠️ 수동 변경 현재가 안내',
      '수동으로 변경하신 현재가 기록이 있습니다.\n시세 동기화를 진행하여 모든 종목의 현재가를\n최신 데이터로 덮어씌우시겠습니까?\n\n(예: 수동 값 무시하고 전체 최신화\n아니오: 수동 변경값은 유지)',
      () => { manualPrices = {}; doSyncPrices(false); },
      () => { doSyncPrices(true); }
    );
  } else {
    doSyncPrices(false);
  }
}

async function doSyncPrices(keepManual = false) {
  const btn = document.getElementById('btnSync');
  const icon = btn.querySelector('.icon');
  btn.disabled = true; icon.classList.add('spinning');

  let logs = [];
  const log = (msg) => { console.log(msg); logs.push(msg); };
  const LOCAL_SERVER = "http://127.0.0.1:5000";

  try {
    log("▶ [로컬 서버] 환율 정보 요청 중...");
    try {
      const exRes = await fetch(`${LOCAL_SERVER}/exchange`);
      if (!exRes.ok) throw new Error("로컬 서버 응답 없음");
      const exData = await exRes.json();
      usdKrw = exData.chart.result[0].meta.regularMarketPrice || usdKrw;
      log(`✓ 환율 업데이트 성공: ${usdKrw.toFixed(2)}원`);
    } catch (e) {
      log("⚠️ 로컬 서버(sync_server.py) 연결 실패. 수동 입력을 시도합니다.");
      const manual = prompt("로컬 서버가 실행 중인지 확인해주세요.\n수동으로 환율을 입력하시겠습니까?", usdKrw);
      if (manual) usdKrw = parseNum(manual);
    }

    // 야후 파이낸스 표준 형식(영문, 숫자, 점, 대시, 등호)만 허용하며 통화 코드 등 제외
    const validTickerRegex = /^[A-Za-z0-9\.\-=^]+$/;
    const tickers = [...new Set(holdingsData
      .map(h => {
        let t = h.ticker.trim().toUpperCase();
        if (h.country === '한국') {
          // 한국 종목은 숫자로만 구성되어 있으면 .KS를 붙임
          const digitsOnly = t.replace(/[^0-9]/g, '');
          if (digitsOnly.length >= 5 && digitsOnly === t) {
            return digitsOnly.padStart(6, '0') + '.KS';
          }
        }
        return t;
      })
      .filter(t => {
        // 주식이 아닌 명백한 키워드(현금 등)만 제외하고, USD(반도체 ETF)는 허용합니다.
        const isBlocked = ["현금", "CASH", "KRW", "금", "GOLD"].includes(t) || t === "";
        const isValid = validTickerRegex.test(t) && t.length >= 2 && !isBlocked;
        if (!isValid) log(`ℹ️ 시세 조회 제외: ${t}`);
        return isValid;
      })
    )];

    if (tickers.length === 0) throw new Error("조회 가능한 표준 티커가 없습니다. (예: AAPL, 005930)");

    log(`▶ [로컬 서버] 종목 시세 조회 중... (${tickers.length}개 종목)`);
    const quoteRes = await fetch(`${LOCAL_SERVER}/sync?symbols=${tickers.join(',')}`);
    const quoteData = await quoteRes.json();

    if (!quoteRes.ok) {
      const detail = quoteData.error || "알 수 없는 오류";
      throw new Error(`시세 서버 응답 오류: ${detail}\n(종목 코드에 한글이 포함되어 있는지 확인하세요)`);
    }

    if (!quoteData.quoteResponse || !quoteData.quoteResponse.result) throw new Error("API 응답 형식 오류 (데이터가 없습니다)");

    // 동기화 적용 전 상태 저장
    saveState();

    const quotes = quoteData.quoteResponse.result;
    const priceMap = {};
    quotes.forEach(q => { priceMap[q.symbol] = q.regularMarketPrice; });

    let updatedCount = 0;
    let failedNames = [];

    holdingsData.forEach(h => {
      let t = h.ticker.trim().toUpperCase();
      if (h.country === '한국') {
        const digitsOnly = t.replace(/[^0-9]/g, '');
        if (digitsOnly.length >= 5 && digitsOnly === t) {
          t = digitsOnly.padStart(6, '0') + '.KS';
        }
      }

      if (priceMap[t]) {
        // keepManual이 true고 수동입력값이 있다면 업데이트 스킵
        if (keepManual && manualPrices[h.ticker] != null) {
          h.curPrice = manualPrices[h.ticker];
        } else {
          h.curPrice = priceMap[t];
          h.syncFailed = false;
        }
        updatedCount++;
      } else {
        // 주식이 아닌 명백한 키워드 제외 후 실패 목록 기록
        if (!["현금", "CASH", "KRW", "금", "GOLD"].includes(t) && t.length > 0) {
          h.syncFailed = true;
          // 수기 입력값이 있으면 유지
          if (manualPrices[h.ticker] != null) {
            h.curPrice = manualPrices[h.ticker];
          }
          failedNames.push(h.name);
        }
      }
    });

    log(`✓ 총 ${updatedCount}개 종목 업데이트 완료`);
    if (failedNames.length > 0) {
      log(`❌ 업데이트 실패 (${failedNames.length}개): ${failedNames.join(', ')}`);
      log(`   (위 종목들의 티커 형식을 확인해 주세요)`);
    }

    recalculate();
    let failMsg = failedNames.length > 0 ? `\n\n[실패 종목 리스트]\n${failedNames.join('\n')}` : "";
    showModal("동기화 완료", `환율: ${usdKrw.toFixed(2)}원\n성공: ${updatedCount}개\n실패: ${failedNames.length}개${failMsg}`);
  } catch (err) {
    log(`❌ 에러: ${err.message}`);
    showModal("동기화 실패", `[원인]\n${err.message}\n\n[조치사항]\n1. sync_server.py가 실행 중인지 확인\n2. 터미널에서 pip install flask flask-cors requests 실행 여부 확인`);
  } finally {
    btn.disabled = false; icon.classList.remove('spinning');
  }
}

// ─── File Handling ───
document.getElementById('btnSync').addEventListener('click', syncPrices);
const btnExport = document.getElementById('btnExport');
if (btnExport) btnExport.addEventListener('click', exportWorkbook);

const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone') || document.getElementById('uploadArea');

if (dropZone) {
  // label 태그인 경우 자체 동작하므로 클릭 강제는 불필요할 수 있지만 보수적으로 남겨둠
  // dropZone.addEventListener('click', () => fileInput.click());
  
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--accent-1)';
    dropZone.style.background = 'rgba(99, 102, 241, 0.08)';
  });
  
  dropZone.addEventListener('dragleave', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--glass-border)';
    dropZone.style.background = 'var(--glass)';
  });
  
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--glass-border)';
    dropZone.style.background = 'var(--glass)';
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      handleFile(e.dataTransfer.files[0]);
    }
  });
}

fileInput.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });

function handleFile(file) {
  currentWorkbookName = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
    parseWorkbook(wb);
  };
  reader.readAsArrayBuffer(file);
}

function parseWorkbook(wb) {
  rawData = {};
  currentWorkbook = wb;
  // 파일 새로 로드 시 상태 초기화
  earlyDepositDecisionMade = false;
  includeEarlyDeposit = false;
  manualPrices = {};
  wb.SheetNames.forEach(name => { rawData[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true }); });

  const idx = rawData['0.인덱스'];
  if (idx) {
    let gd1 = [];
    let gd2 = [];
    for (let r = 1; r < idx.length; r++) {
      if (!idx[r]) continue;
      if (ACCOUNT_SHEETS.hasOwnProperty(idx[r][0])) ACCOUNT_SHEETS[idx[r][0]] = idx[r][1];
      
      // Check-in: 목표비중 읽어오기 (D, E, F, G 열)
      if (idx[r][3] || idx[r][4]) gd1.push({ asset: String(idx[r][3]||''), weight: String(idx[r][4]||'') });
      if (idx[r][5] || idx[r][6]) gd2.push({ asset: String(idx[r][5]||''), weight: String(idx[r][6]||'') });
    }
    if (gd1.length > 0) localStorage.setItem('goalData1', JSON.stringify(gd1));
    if (gd2.length > 0) localStorage.setItem('goalData2', JSON.stringify(gd2));
    if (gd1.length > 0 || gd2.length > 0) initGoalTables();
  }

  const sheet = rawData['종목현황'];
  holdingsData = [];
  if (sheet) {
    let startRow = 1;
    if (sheet[0] && sheet[0].includes('계좌내역')) startRow = 4;

    for (let r = startRow; r < sheet.length; r++) {
      const row = sheet[r];
      if (!row) continue;
      const isNew = startRow === 1;
      
      let tempCat = isNew ? row[2] : row[3];
      let tempTick = isNew ? row[3] : row[4];
      let tempName = isNew ? row[4] : row[5];
      
      let cleanCat = String(tempCat || '').trim();
      let cleanTick = String(tempTick || '').trim().toUpperCase();
      let cleanName = String(tempName || '').trim();
      
      if (!cleanTick && cleanCat !== '현금' && cleanCat !== '금' && cleanName !== '현금' && cleanName !== '금') continue;

      let country, account, category, ticker, name, qty, avgPrice, curPrice;
      if (isNew) {
        country = row[0]; account = row[1]; category = row[2]; ticker = String(row[3] || ''); name = row[4];
        qty = parseNum(row[5]); avgPrice = country === '미국' ? parseNum(row[7]) : parseNum(row[6]);
        curPrice = manualPrices[ticker] != null ? manualPrices[ticker] : avgPrice;
      } else {
        country = row[1]; account = row[2]; category = row[3]; ticker = String(row[4] || ''); name = row[5];
        qty = parseNum(row[6]); avgPrice = country === '미국' ? parseNum(row[8]) : parseNum(row[7]);
        let parsedCurPrice = country === '미국' ? parseNum(row[10]) : parseNum(row[9]);
        curPrice = manualPrices[ticker] != null ? manualPrices[ticker] : parsedCurPrice;
      }

      // 현금 자산 예외 처리 (수량은 기입하고 평단가/현재가가 0이나 빈칸일 때 1로 보정)
      const isCash = cleanCat === '현금' || cleanName === '현금' || ['CASH', 'KRW', 'USD'].includes(cleanTick);
      if (isCash) {
        if (avgPrice === 0) avgPrice = 1;
        if (curPrice === 0) curPrice = 1;
      }

      holdingsData.push({ country, account, category, ticker, name, qty, avgPrice, curPrice, _rowIndex: r });
    }
  }
  recalculate();
  renderDividendTab();
  renderCumulativeTab();
  
  // 파일 트리 저장 (서버 저장은 수동 버튼으로만 수행)
}

// ─── Rendering Functions (KPI, Table, Charts) ───
function renderKPI(data) {
  let v = 0, c = 0;
  data.forEach(h => { v += h.valueKrw; c += h.costKrw; });
  document.getElementById('kpiTotalValue').textContent = fmt(v) + '원';
  document.getElementById('kpiTotalCost').textContent = fmt(c) + '원';
  document.getElementById('kpiTotalProfit').textContent = (v - c >= 0 ? '+' : '') + fmt(v - c) + '원';
  document.getElementById('kpiTotalProfit').className = 'kpi-value ' + pctClass(v - c);
  const r = c > 0 ? (v - c) / c : 0;
  document.getElementById('kpiTotalReturn').textContent = (r >= 0 ? '+' : '') + fmtPct(r);
  document.getElementById('kpiTotalReturn').className = 'kpi-value ' + pctClass(r);
  document.getElementById('kpiUsdKrw').textContent = usdKrw.toFixed(2);
}

function renderTable() {
  const fa = document.getElementById('filterAccount').value;
  const fc = document.getElementById('filterCountry').value;
  const search = document.getElementById('filterSearch').value.toLowerCase();

  // 필터 드롭다운 항상 최신 상태로 갱신 (수동 종목 추가 시에도 반영)
  const accs = [...new Set(holdingsData.map(h => h.account))].filter(Boolean);
  const cnts = [...new Set(holdingsData.map(h => h.country))].filter(Boolean);
  const selAcc = document.getElementById('filterAccount');
  const selCtry = document.getElementById('filterCountry');
  const prevAcc = selAcc.value;
  const prevCtry = selCtry.value;
  selAcc.innerHTML = '<option value="">전체 계좌</option>' + accs.map(a => `<option value="${a}">${a}</option>`).join('');
  selCtry.innerHTML = '<option value="">전체 국가</option>' + cnts.map(c => `<option value="${c}">${c}</option>`).join('');
  selAcc.value = prevAcc;
  selCtry.value = prevCtry;

  let filtered = holdingsData.filter(h => {
    if (h.qty === 0) return false;
    if (fa && h.account !== fa) return false;
    if (fc && h.country !== fc) return false;
    if (search && !h.name.toLowerCase().includes(search) && !h.ticker.toLowerCase().includes(search)) return false;
    return true;
  });

  filtered.sort((a, b) => a.account.localeCompare(b.account) || b.weight - a.weight);

  const tbody = document.getElementById('holdingsBody');
  
  const manualRowHtml = `
    <tr class="manual-add-row" id="manualAddRow" style="display:none; background: rgba(255,255,255,0.05);">
      <td></td>
      <td contenteditable="true" id="manAcc" placeholder="계좌입력"></td>
      <td contenteditable="true" id="manCtry" placeholder="국가(한국/미국)"></td>
      <td contenteditable="true" id="manCat" placeholder="분류"></td>
      <td contenteditable="true" id="manTick" placeholder="티커"></td>
      <td contenteditable="true" id="manName" placeholder="종목명"></td>
      <td contenteditable="true" id="manQty" placeholder="수량" style="text-align:right"></td>
      <td contenteditable="true" id="manAvg" placeholder="평단가" style="text-align:right"></td>
      <td contenteditable="true" id="manCur" placeholder="현재가" style="text-align:right"></td>
      <td colspan="4" style="text-align:center;">
        <button class="btn-sync" onclick="addManualHolding()" style="padding: 4px 12px; font-size:12px;">+ 추가완료</button>
      </td>
    </tr>
  `;

  tbody.innerHTML = manualRowHtml + filtered.map((h, i) => {
    const color = getAccountColor(h.account);
    const curr = h.country === '미국' ? '$' : '₩';
    // 수기 입력 현재가 시인성 확보
    const isManualPrice = manualPrices[h.ticker] != null && manualPrices[h.ticker] === h.curPrice;
    const bgStyle = isManualPrice ? 'background: rgba(255,255,255,0.25);' : '';
    const curPriceCell = `<td contenteditable="true" class="edit-curprice" style="text-align:right; border-bottom: 1px dashed #94a3b8; ${bgStyle}" title="현재가 수기 입력 가능">${fmtPrice(h.curPrice, curr)} ✏️</td>`;
    return `
      <tr data-index="${holdingsData.indexOf(h)}">
        <td><button class="btn-text" onclick="deleteHolding(${holdingsData.indexOf(h)})" style="padding:0; font-size:12px; min-width:auto;" title="이 종목 삭제">➖</button></td>
        <td><span class="acc-tag" style="background:${color}">${h.account}</span></td>
        <td><span class="badge ${h.country === '미국' ? 'badge-us' : 'badge-kr'}">${h.country}</span></td>
        <td>${h.category}</td>
        <td style="color:var(--accent-1);font-weight:600">${h.ticker}</td>
        <td>${h.name}</td>
        <td contenteditable="true" class="edit-qty" style="text-align:right">${h.qty}</td>
        <td contenteditable="true" class="edit-price" style="text-align:right">${fmtPrice(h.avgPrice, curr)}</td>
        ${curPriceCell}
        <td style="text-align:right">${fmt(h.costKrw)}</td>
        <td style="text-align:right">${fmt(h.valueKrw)}</td>
        <td style="text-align:right" class="${pctClass(h.returnPct)}">${fmtPct(h.returnPct)}</td>
        <td style="text-align:right">
          ${fmtPct(h.weight)}
          <div class="weight-bar"><div class="weight-bar-fill" style="width:${h.weight * 100}%; background:${color}"></div></div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('td[contenteditable="true"]').forEach(cell => {
    cell.onblur = () => {
      const tr = cell.closest('tr');
      if (tr.id === 'manualAddRow') return; // 수동 추가 행 입력 중 초기화 방지
      
      const idx = tr.dataset.index;
      const val = parseNum(cell.innerText);
      if (cell.classList.contains('edit-qty')) holdingsData[idx].qty = val;
      else if (cell.classList.contains('edit-price')) holdingsData[idx].avgPrice = val;
      else if (cell.classList.contains('edit-curprice')) {
        holdingsData[idx].curPrice = val;
        if (holdingsData[idx].ticker) manualPrices[holdingsData[idx].ticker] = val; // 수기 입력값 저장
      }
      recalculate();
    };
    cell.onkeydown = e => { 
      if (e.key === 'Enter') { 
        e.preventDefault(); 
        if (cell.closest('tr').id === 'manualAddRow') {
          addManualHolding(); // 엔터 치면 바로 추가
        } else {
          cell.blur(); 
        }
      } 
    };
  });
}

window.toggleManualRow = function() {
  const row = document.getElementById('manualAddRow');
  if (row) {
    if (row.style.display === 'none') {
      row.style.display = 'table-row';
      setTimeout(() => document.getElementById('manAcc').focus(), 10);
    } else {
      row.style.display = 'none';
    }
  }
};

document.addEventListener('click', (e) => {
  const row = document.getElementById('manualAddRow');
  if (row && row.style.display !== 'none') {
    // 버튼을 클릭했거나 row 내부를 클릭했으면 무시
    if (!row.contains(e.target) && !e.target.closest('button[onclick="toggleManualRow()"]')) {
      row.style.display = 'none';
    }
  }
});

window.deleteHolding = function(idx) {
  showConfirmModal(
    '⚠️ 종목 삭제',
    '해당 종목을 포트폴리오에서 삭제하시겠습니까?',
    () => {
      saveState();
      holdingsData.splice(idx, 1);
      recalculate();
    },
    null
  );
};

window.addManualHolding = function() {
  saveState();
  const acc = document.getElementById('manAcc').innerText.trim() || '수동계좌';
  const ctry = document.getElementById('manCtry').innerText.trim() || '한국';
  const cat = document.getElementById('manCat').innerText.trim() || '기타';
  const tick = document.getElementById('manTick').innerText.trim() || '';
  const name = document.getElementById('manName').innerText.trim() || '수동종목';
  const qty = parseNum(document.getElementById('manQty').innerText);
  const avg = parseNum(document.getElementById('manAvg').innerText);
  const cur = parseNum(document.getElementById('manCur').innerText) || avg;
  
  if (qty === 0 || avg === 0) {
    alert('수량과 평단가를 올바르게 입력해주세요.');
    return;
  }
  
  holdingsData.push({
    country: ctry, account: acc, category: cat, ticker: tick, name: name,
    qty: qty, avgPrice: avg, curPrice: cur, _rowIndex: null
  });
  
  if (tick) manualPrices[tick] = cur;
  recalculate();
};

let selectedSum1 = new Set();
let selectedSum2 = new Set();
let allocationGroupBy = 'name';

function initGlobalToggle() {
  const container = document.getElementById('globalToggle');
  if (!container) return;
  container.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      allocationGroupBy = btn.dataset.val;
      renderCharts();
    };
  });
}

function renderAccountSelectors() {
  const accs = [...new Set(holdingsData.map(h => h.account))].filter(Boolean);
  const container1 = document.getElementById('checkList1');
  const container2 = document.getElementById('checkList2');

  if (selectedSum1.size === 0 && selectedSum2.size === 0) {
    accs.forEach(a => { selectedSum1.add(a); selectedSum2.add(a); });
  }

  const genHtml = (selectedSet) => accs.map(acc => `
    <label class="account-check-item">
      <input type="checkbox" value="${acc}" ${selectedSet.has(acc) ? 'checked' : ''}>
      ${acc}
    </label>
  `).join('');

  container1.innerHTML = genHtml(selectedSum1);
  container2.innerHTML = genHtml(selectedSum2);

  [container1, container2].forEach((cont, i) => {
    const targetSet = i === 0 ? selectedSum1 : selectedSum2;
    cont.querySelectorAll('input').forEach(chk => {
      chk.onchange = () => {
        if (chk.checked) targetSet.add(chk.value);
        else targetSet.delete(chk.value);
        renderCharts();
      };
    });
  });
}

// ─── Chart.js 커스텀 Callout 플러그인 (선과 레이블 직접 그리기) ───
const calloutPlugin = {
  id: 'calloutPlugin',
  afterDraw: (chart) => {
    const { ctx, data } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta.data[0] || meta.hidden) return;

    const centerX = meta.data[0].x;
    const centerY = meta.data[0].y;
    const total = data.datasets[0].data.reduce((a, b) => a + b, 0);

    ctx.save();
    meta.data.forEach((datapoint, i) => {
      const val = data.datasets[0].data[i];
      if (!val || (val / total) < 0.01) return;

      const { x, y } = datapoint.tooltipPosition();
      const angle = Math.atan2(y - centerY, x - centerX);

      // 차트 크기에 따라 선 길이 동적 조절 (큰 차트는 더 길게, 요청에 따라 전체 길이 2/3로 축소)
      const baseLen = chart.width > 350 ? 43 : 23;
      // 인덱스가 홀수/짝수인지에 따라 길이를 다르게 하여 텍스트 겹침 방지
      const lineLen = i % 2 === 0 ? baseLen : baseLen * 1.6;
      const endX = x + Math.cos(angle) * lineLen;
      const endY = y + Math.sin(angle) * lineLen;

      // 선 그리기
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 텍스트 정보
      const label = data.labels[i];
      const pct = ((val / total) * 100).toFixed(1) + '%';

      const fontSize = chart.width > 350 ? 12 : 10;
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = endX > centerX ? 'left' : 'right';
      ctx.textBaseline = 'middle';

      const textX = endX + (endX > centerX ? 8 : -8);
      ctx.fillText(label, textX, endY - 7);
      ctx.font = `${fontSize - 1}px sans-serif`;
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(pct, textX, endY + 7);
    });
    ctx.restore();
  }
};

function renderCharts() {
  renderAccountSelectors();
  initGlobalToggle();

  // 시인성 극대화: 모든 차트 텍스트 흰색 설정
  Chart.defaults.color = '#ffffff';
  Chart.defaults.font.family = "'Pretendard', sans-serif";

  const renderGenericChart = (canvasId, dataItems, chartKey, isSmall = false) => {
    const dataMap = {};
    let totalVal = 0;
    let totalCost = 0;

    dataItems.forEach(h => {
      const key = h[allocationGroupBy] || '기타';
      dataMap[key] = (dataMap[key] || 0) + h.valueKrw;
      totalVal += h.valueKrw;
      totalCost += h.costKrw;
    });

    const profit = totalVal - totalCost;
    const retPct = totalCost > 0 ? (profit / totalCost) : 0;
    const labels = Object.keys(dataMap).sort((a, b) => dataMap[b] - dataMap[a]);

    if (charts[chartKey]) charts[chartKey].destroy();
    const ctx = document.getElementById(canvasId).getContext('2d');

    // 1. 요약 정보 렌더링
    if (!isSmall) {
      const statsId = chartKey === 'sum1' ? 'statsSum1' : 'statsSum2';
      const statsEl = document.getElementById(statsId);
      if (statsEl) {
        statsEl.innerHTML = `
          <div class="stat-item">
            <span class="stat-label">총 평가금액</span>
            <span class="stat-value">${fmt(totalVal)}원</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">총 매수금액</span>
            <span class="stat-value" style="color:#94a3b8">${fmt(totalCost)}원</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">수익률</span>
            <span class="stat-value ${pctClass(retPct)}">${(retPct >= 0 ? '+' : '') + fmtPct(retPct)}</span>
          </div>
        `;
      }
    }

    // 2. 차트 렌더링
    charts[chartKey] = new Chart(ctx, {
      type: isSmall ? 'pie' : 'doughnut',
      plugins: [calloutPlugin],
      data: {
        labels: labels,
        datasets: [{
          data: labels.map(l => dataMap[l]),
          backgroundColor: COLOR_PALETTE,
          borderWidth: 2,
          borderColor: '#1e293b'
        }]
      },
      options: {
        radius: isSmall ? '120%' : '90%', // 소형 차트는 1.2배 확대, 메인 차트는 0.9배 축소
        cutout: isSmall ? '0%' : '60%',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: isSmall ? 35 : 80 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${fmt(ctx.raw)}원 (${((ctx.raw / totalVal) * 100).toFixed(1)}%)`
            }
          }
        }
      }
    });
  };

  renderGenericChart('chartSum1', holdingsData.filter(h => selectedSum1.has(h.account)), 'sum1');
  renderGenericChart('chartSum2', holdingsData.filter(h => selectedSum2.has(h.account)), 'sum2');

  const grid = document.getElementById('allAccountsGrid');
  grid.innerHTML = '';
  const accounts = [...new Set(holdingsData.map(h => h.account))].filter(Boolean);

  accounts.forEach((acc, idx) => {
    const accData = holdingsData.filter(h => h.account === acc);
    const box = document.createElement('div');
    box.className = 'small-chart-box';
    const chartId = `smallChart_${idx}`;

    // 소형 차트용 요약 정보 계산
    const sVal = accData.reduce((a, b) => a + b.valueKrw, 0);
    const sCost = accData.reduce((a, b) => a + b.costKrw, 0);
    const sPct = sCost > 0 ? (sVal - sCost) / sCost : 0;

    box.innerHTML = `
      <h4>${acc}</h4>
      <div class="small-chart-wrap"><canvas id="${chartId}"></canvas></div>
      <div class="chart-summary-stats" style="margin-top: 12px; padding: 12px;">
        <div class="stat-item"><span class="stat-label">평가액</span><span class="stat-value" style="font-size:13px;">${fmt(sVal)}원</span></div>
        <div class="stat-item"><span class="stat-label">매수금액</span><span class="stat-value" style="font-size:13px;">${fmt(sCost)}원</span></div>
        <div class="stat-item"><span class="stat-label">수익률</span><span class="stat-value ${pctClass(sPct)}" style="font-size:13px;">${fmtPct(sPct)}</span></div>
      </div>
    `;
    grid.appendChild(box);
    renderGenericChart(chartId, accData, `small_${idx}`, true);
  });
}


// ─── Dividend Analysis Logic ───
function renderDividendTab() {
  const sheet = rawData['배당내역'];

  // 계좌 목록 추출: 종목현황 + 배당내역 모두 포함
  const hAccs = holdingsData.map(h => h.account);
  const dAccs = sheet ? sheet.slice(1).map(r => String(r[1] || '').trim()) : [];
  const accs = [...new Set([...hAccs, ...dAccs])].filter(Boolean);

  const sidebar = document.getElementById('divAccountCheckList');

  if (selectedDivAccounts.size === 0) accs.forEach(a => selectedDivAccounts.add(a));

  if (sidebar) {
    sidebar.innerHTML = accs.map(acc => `
      <label class="account-check-item">
        <input type="checkbox" value="${acc}" ${selectedDivAccounts.has(acc) ? 'checked' : ''}> ${acc}
      </label>
    `).join('');
    sidebar.querySelectorAll('input').forEach(chk => {
      chk.onchange = () => {
        if (chk.checked) selectedDivAccounts.add(chk.value);
        else selectedDivAccounts.delete(chk.value);
        renderDividendTab();
      };
    });
  }

  const tableWrap = document.getElementById('divTableWrap');
  if (!sheet || sheet.length < 2) {
    if (tableWrap) tableWrap.innerHTML = '<div class="placeholder">\'배당내역\' 시트를 찾을 수 없습니다.</div>';
    return;
  }

  const matrix = {};
  // 가이드 행(row 1) 스킵: 첫 번째 데이터 행의 날짜가 파싱 불가능하면 건너뜀
  let divStartRow = 1;
  if (sheet[1] && isNaN(parseDate(sheet[1][0]))) divStartRow = 2;
  for (let r = divStartRow; r < sheet.length; r++) {
    const row = sheet[r];
    if (!row || !row[0]) continue;

    // 1. 날짜 파싱 (유연하게 처리)
    let date = parseDate(row[0]);
    if (isNaN(date)) continue;

    // 2. 계좌 필터링
    const acc = String(row[1] || '').trim();
    if (!selectedDivAccounts.has(acc)) continue;

    const yr = date.getFullYear();
    const mo = date.getMonth() + 1;

    // 3. 금액 파싱 (이미지 구조 반영: 4번 원화, 5번 외화)
    let krwAmt = parseNum(row[4]) || 0;
    let usdAmt = parseNum(row[5]) || 0;

    // 원화 합계 = 원화배당금 + (외화배당금 * 실시간 환율)
    let amt = krwAmt + (usdAmt * usdKrw);

    if (amt > 0) {
      if (!matrix[yr]) matrix[yr] = {};
      matrix[yr][mo] = (matrix[yr][mo] || 0) + amt;
    }
  }

  const years = Object.keys(matrix).sort((a, b) => a - b); // 차트 순서: 과거 -> 현재
  if (years.length === 0) {
    if (tableWrap) tableWrap.innerHTML = '<div class="placeholder">데이터가 없습니다.</div>';
    return;
  }

  // 테이블 매트릭스 생성
  let tableHtml = `<table class="dividend-matrix">
    <thead>
      <tr>
        <th>연도</th>
        ${Array.from({ length: 12 }, (_, i) => `<th>${i + 1}월</th>`).join('')}
        <th>연배당금</th>
        <th>월평균</th>
      </tr>
    </thead>
    <tbody>`;

  const manualDiv = JSON.parse(localStorage.getItem('dividendManualData') || '{}');

  const reverseYears = [...years].sort((a, b) => b - a); // 테이블 순서: 최신순
  reverseYears.forEach(yr => {
    let yrTotal = 0;
    let monthsHtml = '';
    for (let m = 1; m <= 12; m++) {
      const key = `${yr}-${m}`;
      let val = matrix[yr][m] || 0;
      let isManual = false;
      if (manualDiv[key] !== undefined) {
        val = manualDiv[key];
        isManual = true;
      }
      matrix[yr][m] = val; // 차트에도 반영되도록 매트릭스 업데이트
      yrTotal += val;
      const bgStyle = isManual ? 'background: rgba(255,255,255,0.25);' : '';
      monthsHtml += `<td contenteditable="true" data-key="${key}" data-orig="${matrix[yr][m] || 0}" class="edit-div" style="text-align:right; border-bottom:1px dashed #94a3b8; ${bgStyle}">${val > 0 ? fmt(val) : '0'}</td>`;
    }
    tableHtml += `<tr>
      <td class="year-col">${yr}</td>
      ${monthsHtml}
      <td class="total-col">₩${fmt(yrTotal)}</td>
      <td>₩${fmt(yrTotal / 12)}</td>
    </tr>`;
  });
  tableHtml += '</tbody></table>';
  
  if (tableWrap) {
    tableWrap.innerHTML = tableHtml;
    tableWrap.querySelectorAll('.edit-div').forEach(cell => {
      cell.onblur = () => {
        const key = cell.dataset.key;
        let valText = cell.innerText.trim();
        const origVal = parseFloat(cell.dataset.orig);
        const parsedVal = parseNum(valText);
        
        const md = JSON.parse(localStorage.getItem('dividendManualData') || '{}');
        
        // 원본과 동일하게 돌아왔거나 비웠으면 저장 해제
        if (valText === '' || valText === '-' || parsedVal === origVal) {
          delete md[key];
        } else {
          md[key] = parsedVal;
        }
        localStorage.setItem('dividendManualData', JSON.stringify(md));
        renderDividendTab();
      };
      cell.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); cell.blur(); } };
    });
  }

  // 그룹형 막대 차트 렌더링
  if (charts.dividend) charts.dividend.destroy();
  const datasets = years.map((yr, idx) => ({
    label: yr + '년',
    data: Array.from({ length: 12 }, (_, i) => matrix[yr][i + 1] || 0),
    backgroundColor: COLOR_PALETTE[idx % COLOR_PALETTE.length],
    borderRadius: 4
  }));

  charts.dividend = new Chart(document.getElementById('chartDividend'), {
    type: 'bar',
    data: { labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { color: '#fff' } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label} ${ctx.label}: ₩${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
        y: { ticks: { color: '#94a3b8', callback: v => fmt(v) } }
      }
    }
  });
}

// ─── State for Cumulative Tab ───
let selectedCum1Accounts = new Set();
let selectedCum2Accounts = new Set();

function renderCumulativeTab() {
  // 1. 계좌 목록 추출 (데이터가 있는 계좌만 포함)
  const accs = Object.entries(ACCOUNT_SHEETS)
    .filter(([id, name]) => name !== '' && rawData[id] && rawData[id].length > 1)
    .map(([id, name]) => ({ id, name }));

  if (selectedCum1Accounts.size === 0 && accs.length > 0) accs.forEach(a => selectedCum1Accounts.add(a.name));
  if (selectedCum2Accounts.size === 0 && accs.length > 0) accs.forEach(a => selectedCum2Accounts.add(a.name));

  // Render Checklists
  const renderList = (containerId, selectedSet, btnId) => {
    const el = document.getElementById(containerId);
    if (!el) return;

    // 전체선택 버튼 핸들러
    const btnAll = document.getElementById(btnId);
    if (btnAll) {
      btnAll.onclick = () => {
        if (selectedSet.size === accs.length) selectedSet.clear();
        else accs.forEach(a => selectedSet.add(a.name));
        renderCumulativeTab();
      };
      btnAll.textContent = selectedSet.size === accs.length ? '전체해제' : '전체선택';
    }

    el.innerHTML = accs.map(a => `
      <label class="account-check-item">
        <input type="checkbox" value="${a.name}" ${selectedSet.has(a.name) ? 'checked' : ''}> ${a.name}
      </label>
    `).join('');
    el.querySelectorAll('input').forEach(chk => {
      chk.onchange = () => {
        if (chk.checked) selectedSet.add(chk.value); else selectedSet.delete(chk.value);
        renderCumulativeTab();
      };
    });
  };
  renderList('cumSum1Checklist', selectedCum1Accounts, 'btnAllCum1');
  renderList('cumSum2Checklist', selectedCum2Accounts, 'btnAllCum2');

  // 1. 입금 내역 미리 집계 (계좌별/월별) — 외부 선언은 earlyDeposit 탐지용으로만 사용
  const depSheet = rawData['입금내역'];
  console.log("▶ [누적수익률] 입금내역 시트 로드:", depSheet ? `${depSheet.length}행` : "없음");

  // ── 계좌별 계좌내역 시작 날짜 파악 ──
  const accountStartDate = {}; // { accountName: Date }
  accs.forEach(a => {
    const sheet = rawData[a.id];
    if (!sheet) return;
    for (let r = 1; r < sheet.length; r++) {
      const row = sheet[r];
      if (!row || !row[0]) continue;
      const d = parseDate(row[0]);
      if (!isNaN(d)) { accountStartDate[a.name] = d; break; } // 첫 유효 날짜
    }
  });

  // ── 계좌내역 시작일보다 오래된 입금내역이 있는 계좌 탐지 ──
  const earlyDepositAccounts = []; // 오래된 입금내역이 있는 계좌명 목록
  if (depSheet) {
    const earlyMap = {}; // { accountName: true }
    for (let r = 1; r < depSheet.length; r++) {
      const row = depSheet[r];
      if (!row || !row[0] || !row[2]) continue;
      const date = parseDate(row[0]);
      if (isNaN(date)) continue;
      const acc = String(row[1] || '').trim();
      if (accountStartDate[acc] && date < accountStartDate[acc] && !earlyMap[acc]) {
        earlyMap[acc] = true;
        earlyDepositAccounts.push(acc);
      }
    }
  }

  // ── 실제 차트 렌더링 함수 (includeEarly: 오래된 입금액 포함 여부) ──
  const buildAndRender = (includeEarly) => {
    // depositMap 초기화
    const depositMap = {};
    if (depSheet) {
      for (let r = 1; r < depSheet.length; r++) {
        const row = depSheet[r];
        if (!row || !row[0] || !row[2]) continue;
        const date = parseDate(row[0]);
        if (isNaN(date)) continue;
        const acc = String(row[1] || '').trim();

        // includeEarly=false 이면 계좌내역 시작일보다 오래된 항목 스킵
        if (!includeEarly && accountStartDate[acc] && date < accountStartDate[acc]) continue;

        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!depositMap[acc]) depositMap[acc] = {};
        depositMap[acc][monthKey] = (depositMap[acc][monthKey] || 0) + parseNum(row[2]);
      }
    }

    // 2. 계좌별 데이터 구성 (입금액 누적 계산)
    const allData = {}; // { accountName: [ {date, deposit, balance}, ... ] }
    console.log("▶ [누적수익률] 대상 계좌:", accs.map(a => a.name));

    accs.forEach(a => {
      const sheet = rawData[a.id];
      if (!sheet) {
        console.warn(`[누적수익률] ${a.id} (${a.name}) 시트를 찾을 수 없습니다.`);
        return;
      }
      const data = [];

      for (let r = 1; r < sheet.length; r++) {
        const row = sheet[r];
        if (!row || !row[0]) continue;
        const date = parseDate(row[0]);
        if (isNaN(date)) continue;

        const historyYM = date.getFullYear() * 12 + date.getMonth();
        let cumulativeDeposit = 0;

        if (depositMap[a.name]) {
          Object.entries(depositMap[a.name]).forEach(([monthKey, amount]) => {
            const [yr, mo] = monthKey.split('-').map(Number);
            const depositYM = yr * 12 + (mo - 1);
            if (depositYM <= historyYM) {
              cumulativeDeposit += amount;
            }
          });
        }

        data.push({
          date: date.toISOString().split('T')[0],
          deposit: cumulativeDeposit,
          balance: parseNum(row[1])
        });
      }
      allData[a.name] = data;
      console.log(`✓ [누적수익률] ${a.name}: ${data.length}개 월간 데이터 구성 완료`);
    });

    // Helper to aggregate multiple accounts
    const aggregate = (selectedNames) => {
      const combined = {}; // { date: {deposit, balance} }
      selectedNames.forEach(name => {
        const data = allData[name] || [];
        data.forEach(d => {
          if (!combined[d.date]) combined[d.date] = { deposit: 0, balance: 0 };
          combined[d.date].deposit += d.deposit;
          combined[d.date].balance += d.balance;
        });
      });
      return Object.entries(combined).sort((a, b) => a[0].localeCompare(b[0])).map(([date, vals]) => ({ date, ...vals }));
    };

    const drawChart = (canvasId, chartKey, data) => {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      if (charts[chartKey]) charts[chartKey].destroy();

      charts[chartKey] = new Chart(canvas, {
        type: 'line',
        data: {
          labels: data.map(d => d.date),
          datasets: [
            {
              label: '입금액',
              data: data.map(d => d.deposit),
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              fill: true,
              tension: 0.3,
              pointRadius: 0
            },
            {
              label: '평가액',
              data: data.map(d => d.balance),
              borderColor: '#f87171',
              backgroundColor: 'rgba(248, 113, 113, 0.1)',
              fill: true,
              tension: 0.3,
              pointRadius: 0
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'top',
              onClick: () => {}, // 범례 클릭 비활성화
              labels: { color: '#94a3b8', boxWidth: 12 }
            },
            tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ₩${fmt(ctx.raw)}` } }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                color: '#64748b',
                maxRotation: 45,
                minRotation: 45,
                autoSkip: true,
                maxTicksLimit: 12
              }
            },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', callback: v => '₩' + fmt(v) } }
          }
        }
      });
    };

    // 0. 누적수익률 요약 통계 렌더링
    const renderCumStats = (statsId, data) => {
      const el = document.getElementById(statsId);
      if (!el || data.length === 0) return;
      const lastDeposit = data[data.length - 1].deposit;
      const lastBalance = data[data.length - 1].balance;
      const profit = lastBalance - lastDeposit;
      const retPct = lastDeposit > 0 ? profit / lastDeposit : 0;
      el.innerHTML = `
        <div class="stat-item"><span class="stat-label">총 입금액</span><span class="stat-value">${fmt(lastDeposit)}원</span></div>
        <div class="stat-item"><span class="stat-label">현재 평가액</span><span class="stat-value">${fmt(lastBalance)}원</span></div>
        <div class="stat-item"><span class="stat-label">수익률</span><span class="stat-value ${pctClass(retPct)}">${(retPct >= 0 ? '+' : '') + fmtPct(retPct)}</span></div>
      `;
    };

    // 1. Sum Charts
    const cumData1 = aggregate(selectedCum1Accounts);
    const cumData2 = aggregate(selectedCum2Accounts);
    drawChart('chartCumSum1', 'cumSum1', cumData1);
    drawChart('chartCumSum2', 'cumSum2', cumData2);
    renderCumStats('statsCumSum1', cumData1);
    renderCumStats('statsCumSum2', cumData2);

    // 2. Individual Grid
    const grid = document.getElementById('divCumAccountGrid');
    if (grid) {
      grid.innerHTML = accs.map(a => `
        <div class="small-chart-box">
          <div style="font-size:12px; color:#fff; margin-bottom:10px; font-weight:600;">${a.name}</div>
          <div style="height:180px;"><canvas id="chartCumIdx_${a.id}"></canvas></div>
        </div>
      `).join('');
      accs.forEach(a => {
        const canvasId = `chartCumIdx_${a.id}`;
        const chartKey = `cumIdx_${a.id}`;
        drawChart(canvasId, chartKey, allData[a.name] || []);
      });
    }
  }; // ── buildAndRender 끝 ──

  // ── 오래된 입금내역 감지 시 팝업 표시 (업로드 시 1회만) ──
  if (earlyDepositAccounts.length > 0 && !earlyDepositDecisionMade) {
    const accList = earlyDepositAccounts.join(', ');
    showConfirmModal(
      '⚠️ 오래된 입금내역 감지',
      `계좌내역보다 오래된 입금내역이 있습니다.\n해당 계좌: ${accList}\n\n입금내역을 모두 합칠까요?\n(예: 이전 입금액 포함하여 차트 생성\n아니오: 계좌내역 시작일 이후만 반영)`,
      () => { earlyDepositDecisionMade = true; includeEarlyDeposit = true; buildAndRender(true); },
      () => { earlyDepositDecisionMade = true; includeEarlyDeposit = false; buildAndRender(false); }
    );
  } else {
    // 이미 결정했거나 오래된 입금내역 없음 → 저장된 선택값으로 바로 렌더링
    buildAndRender(includeEarlyDeposit);
  }
} // ── renderCumulativeTab 끝 ──

document.getElementById('filterAccount').onchange = renderTable;
document.getElementById('filterCountry').onchange = renderTable;
document.getElementById('filterSearch').oninput = renderTable;

function exportWorkbook() {
  if (!currentWorkbook) {
    showModal("알림", "내보낼 데이터가 없습니다. 먼저 파일을 로드해주세요.");
    return;
  }

  // 1. holdingsData의 최신 변경사항을 원본 워크북 시트에 직접 반영 (서식 보존을 위해)
  const statusSheet = currentWorkbook.Sheets['종목현황'];
  if (statusSheet && holdingsData.length > 0) {
    let startRow = 1;
    // 헤더 체크 (A1 셀 내용 확인)
    const a1 = statusSheet['A1'] ? statusSheet['A1'].v : "";
    if (a1 && String(a1).includes('계좌내역')) startRow = 4;

    holdingsData.forEach((h) => {
      const r = h._rowIndex;
      if (r != null) {
        // 컬럼 인덱스 결정
        let qtyCol, priceCol;
        if (startRow === 1) { // 새 형식 (8열: A~H, 현재가 컬럼 없음)
          qtyCol = 5; priceCol = (h.country === '미국' ? 7 : 6);
          // 새 형식 템플릿에는 현재가 열이 없으므로 내보내기 시 기록하지 않음
        } else { // 구형 형식
          qtyCol = 6; priceCol = (h.country === '미국' ? 8 : 7);
          // 현재가도 업데이트 (미국주식인 경우)
          if (h.country === '미국') {
            const curPriceRef = XLSX.utils.encode_cell({ r: r, c: 10 });
            if (!statusSheet[curPriceRef]) statusSheet[curPriceRef] = { t: 'n' };
            statusSheet[curPriceRef].v = h.curPrice;
          } else {
            const curPriceRef = XLSX.utils.encode_cell({ r: r, c: 9 });
            if (!statusSheet[curPriceRef]) statusSheet[curPriceRef] = { t: 'n' };
            statusSheet[curPriceRef].v = h.curPrice;
          }
        }

        const qtyRef = XLSX.utils.encode_cell({ r: r, c: qtyCol });
        const prcRef = XLSX.utils.encode_cell({ r: r, c: priceCol });

        if (!statusSheet[qtyRef]) statusSheet[qtyRef] = { t: 'n' };
        statusSheet[qtyRef].v = h.qty;

        if (!statusSheet[prcRef]) statusSheet[prcRef] = { t: 'n' };
        statusSheet[prcRef].v = h.avgPrice;
      }
    });
  }

  // 1.5. 목표비중을 0.인덱스 시트 D~G 열에 기록 (Check-out)
  const idxSheet = currentWorkbook.Sheets['0.인덱스'];
  if (idxSheet) {
    XLSX.utils.sheet_add_aoa(idxSheet, [['계좌합1 자산군', '비중(%)', '계좌합2 자산군', '비중(%)']], {origin: 'D1'});
    
    const gd1 = JSON.parse(localStorage.getItem('goalData1') || '[]');
    const gd2 = JSON.parse(localStorage.getItem('goalData2') || '[]');
    
    const maxLen = Math.max(gd1.length, gd2.length);
    const dataToWrite = [];
    for (let i = 0; i < maxLen; i++) {
      const d1 = gd1[i] || { asset: '', weight: '' };
      const d2 = gd2[i] || { asset: '', weight: '' };
      dataToWrite.push([d1.asset, d1.weight, d2.asset, d2.weight]);
    }
    if (dataToWrite.length > 0) {
      XLSX.utils.sheet_add_aoa(idxSheet, dataToWrite, {origin: 'D2'});
    }
  }

  // 2. 컬럼 너비 재조정 (선택 사항, 원본에 이미 있으면 생략 가능하나 안전을 위해 적용)
  currentWorkbook.SheetNames.forEach(name => {
    const ws = currentWorkbook.Sheets[name];
    const data = rawData[name];
    if (data && data.length > 0) {
      const colWidths = data[0].map((_, colIndex) => {
        let maxLen = 10;
        data.forEach(row => {
          const val = row[colIndex];
          if (val != null) {
            const sVal = String(val);
            const len = sVal.split('').reduce((acc, char) => acc + (char.charCodeAt(0) > 128 ? 2 : 1), 0);
            if (len > maxLen) maxLen = len;
          }
        });
        return { wch: Math.min(maxLen + 2, 50) };
      });
      ws['!cols'] = colWidths;
    }
  });

  // 3. 수정된 워크북 다운로드
  XLSX.writeFile(currentWorkbook, "Portfolio_Checkout.xlsx");
}

// ─── 목표 비중 표 (Goal Allocation Table) 로직 ───
function initGoalTables() {
  for (let i = 1; i <= 2; i++) {
    const tbody = document.querySelector(`#goalTable${i} tbody`);
    if (!tbody) continue;
    
    // 로컬 스토리지에서 데이터 불러오기
    let savedData = JSON.parse(localStorage.getItem(`goalData${i}`) || '[]');
    
    // 데이터가 없으면 기본 5행 빈 데이터 생성
    if (savedData.length === 0) {
      for (let j = 0; j < 5; j++) {
        savedData.push({ asset: '', weight: '' });
      }
    }
    
    renderGoalTable(i, savedData);
  }
}

function renderGoalTable(tableIndex, data) {
  const tbody = document.querySelector(`#goalTable${tableIndex} tbody`);
  if (!tbody) return;
  
  tbody.innerHTML = data.map((row, idx) => `
    <tr data-index="${idx}">
      <td contenteditable="true" class="edit-asset" placeholder="자산군 입력">${row.asset || ''}</td>
      <td contenteditable="true" class="edit-weight" style="text-align:right;" placeholder="비중(%)">${row.weight || ''}</td>
    </tr>
  `).join('');
  
  // 이벤트 리스너: 입력 시 로컬 스토리지 자동 저장
  tbody.querySelectorAll('td[contenteditable="true"]').forEach(cell => {
    cell.onblur = () => saveGoalTable(tableIndex);
    cell.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); cell.blur(); } };
  });
}

function addGoalRow(tableIndex) {
  const tbody = document.querySelector(`#goalTable${tableIndex} tbody`);
  if (!tbody) return;
  
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td contenteditable="true" class="edit-asset" placeholder="자산군 입력"></td>
    <td contenteditable="true" class="edit-weight" style="text-align:right;" placeholder="비중(%)"></td>
  `;
  
  tr.querySelectorAll('td[contenteditable="true"]').forEach(cell => {
    cell.onblur = () => saveGoalTable(tableIndex);
    cell.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); cell.blur(); } };
  });
  
  tbody.appendChild(tr);
  saveGoalTable(tableIndex);
}

function saveGoalTable(tableIndex) {
  const tbody = document.querySelector(`#goalTable${tableIndex} tbody`);
  if (!tbody) return;
  
  const data = [];
  tbody.querySelectorAll('tr').forEach(tr => {
    const asset = tr.querySelector('.edit-asset').innerText.trim();
    const weight = tr.querySelector('.edit-weight').innerText.trim();
    data.push({ asset, weight });
  });
  
  localStorage.setItem(`goalData${tableIndex}`, JSON.stringify(data));
}

// ─── 초기화 및 서버 연동 ───
const LOCAL_SERVER = "http://127.0.0.1:5000";

document.addEventListener('DOMContentLoaded', () => {
  if (typeof initGoalTables === 'function') initGoalTables();
  loadSavedList(); // 서버에서 저장된 파일 목록 불러오기

  // Gold Sync Notice 닫기 상태 복원
  if (localStorage.getItem('goldNoticeDismissed') === 'true') {
    const notice = document.getElementById('goldSyncNotice');
    if (notice) notice.style.display = 'none';
  }

  // 사이드바 상태 복원
  if (localStorage.getItem('sidebarCollapsed') === 'true') {
    const sidebar = document.querySelector('.sidebar');
    const btn = document.getElementById('btnSidebarToggle');
    if (sidebar) sidebar.classList.add('collapsed');
    if (btn) {
      btn.innerHTML = '▶';
      btn.setAttribute('title', '사이드바 열기');
    }
  }
});

// ─── Portfolio File Management (Server-side) ───
let currentLoadedName = null;

// 1. 서버에서 저장된 파일 목록 가져오기
async function loadSavedList() {
  const listContainer = document.getElementById('savedPortfoliosList');
  if (!listContainer) return;

  try {
    let files = [];
    if (currentUser) {
      // Firebase Firestore에서 목록 가져오기
      const snapshot = await db.collection('users').doc(currentUser.uid).collection('portfolios')
        .get();
      snapshot.forEach(doc => {
        files.push(doc.id);
      });
      // 타임스탬프 기준으로 정렬 (Firestore 복원)
      // (단순 정렬용 필드를 payload에 넣었으므로, client-side에서 정렬하거나 doc 데이터를 활용하여 정렬할 수 있습니다)
      const fileData = [];
      snapshot.forEach(doc => {
        fileData.push({ id: doc.id, timestamp: doc.data().timestamp || "" });
      });
      fileData.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      files = fileData.map(f => f.id);
    } else {
      // 로컬 플라스크 서버에서 목록 가져오기
      const res = await fetch(`${LOCAL_SERVER}/list`);
      const data = await res.json();
      if (data.success) {
        files = data.files || [];
      }
    }

    if (files.length === 0) {
      listContainer.innerHTML = '<div class="placeholder" style="min-height:50px; font-size:11px; color:#64748b;">저장된 파일이 없습니다.</div>';
      return;
    }

    listContainer.innerHTML = files.map(name => `
      <div class="tree-item ${name === currentLoadedName ? 'active' : ''}" onclick="loadPortfolioData('${name}')">
        <span class="file-icon">📄</span>
        <div class="file-info">
          <span class="file-name" title="${name}">${name}</span>
        </div>
        <button class="btn-delete-small" onclick="event.stopPropagation(); deletePortfolioData('${name}')" title="삭제">×</button>
      </div>
    `).join('');
  } catch (err) {
    console.error("파일 목록 로드 실패:", err);
    listContainer.innerHTML = `<div class="placeholder" style="color:#ef4444;">목록 로드 실패: ${err.message}</div>`;
  }
}

// 2. 포트폴리오 저장 기능
window.saveCurrentPortfolio = function() {
  if (!holdingsData || holdingsData.length === 0) {
    showModal("저장 불가", "저장할 데이터가 없습니다. 먼저 파일을 업로드해주세요.");
    return;
  }

  const modal = document.getElementById('saveNameModal');
  const input = document.getElementById('saveNameInput');
  const confirmBtn = document.getElementById('saveModalConfirm');
  const cancelBtn = document.getElementById('saveModalCancel');
  const closeBtn = document.getElementById('saveModalClose');

  if (!modal || !input) return;

  // 기본 이름 설정 (날짜_시간)
  const now = new Date();
  const dateStr = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0');
  const timeStr = String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0');
  input.value = currentLoadedName || (currentWorkbookName ? currentWorkbookName.split('.')[0] : `포트폴리오_${dateStr}_${timeStr}`);

  // 모달 열기
  modal.style.display = 'flex';
  modal.style.opacity = '1';
  modal.style.pointerEvents = 'auto';
  modal.classList.add('active');
  setTimeout(() => input.focus(), 100);

  const closeModal = () => {
    modal.classList.remove('active');
    modal.style.opacity = '0';
    modal.style.pointerEvents = 'none';
    setTimeout(() => { modal.style.display = 'none'; }, 200);
  };

  const doSave = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }

    const payload = {
      name: name,
      data: {
        // 기본 데이터
        holdingsData,
        manualPrices,
        usdKrw,
        rawData,
        currentWorkbookName,
        
        // 계좌 매핑 및 색상 상태
        ACCOUNT_SHEETS,
        ACCOUNT_COLORS,
        
        // 체크박스 및 선택 상태 (Set -> Array 변환 필요)
        selectedDivAccounts: [...selectedDivAccounts],
        selectedSum1: [...selectedSum1],
        selectedSum2: [...selectedSum2],
        selectedCum1Accounts: [...selectedCum1Accounts],
        selectedCum2Accounts: [...selectedCum2Accounts],
        
        // 설정 및 플래그
        earlyDepositDecisionMade,
        includeEarlyDeposit,
        allocationGroupBy,
        
        // 로컬 스토리지 데이터 (목표 비중 등)
        goalData1: JSON.parse(localStorage.getItem('goalData1') || '[]'),
        goalData2: JSON.parse(localStorage.getItem('goalData2') || '[]'),
        dividendManualData: JSON.parse(localStorage.getItem('dividendManualData') || '{}'),
        
        timestamp: new Date().toISOString()
      }
    };

    try {
      if (currentUser) {
        // Firebase Firestore에 저장
        await db.collection('users').doc(currentUser.uid).collection('portfolios').doc(name).set(payload.data);
        closeModal();
        currentLoadedName = name;
        loadSavedList();
      } else {
        // 로컬 플라스크 서버에 저장
        const res = await fetch(`${LOCAL_SERVER}/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const resData = await res.json();
        if (!resData.success) throw new Error(resData.error);
        closeModal();
        currentLoadedName = resData.name;
        loadSavedList();
      }
      
      // 저장 성공 피드백
      const btn = document.getElementById('btnSavePortfolio');
      const origText = btn.innerHTML;
      btn.innerHTML = "✅ 저장 완료";
      setTimeout(() => { btn.innerHTML = origText; }, 2000);
      
    } catch (err) {
      alert("저장 실패: " + err.message);
    }
  };

  confirmBtn.onclick = doSave;
  cancelBtn.onclick = closeModal;
  closeBtn.onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  input.onkeydown = (e) => { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') closeModal(); };
};

// 3. 포트폴리오 상태 복원 헬퍼
function restorePortfolioState(p, name) {
  // 1. 기본 데이터 복구
  holdingsData = p.holdingsData || [];
  manualPrices = p.manualPrices || {};
  usdKrw = p.usdKrw || 1400;
  rawData = p.rawData || {};
  currentWorkbookName = p.currentWorkbookName || "";
  
  // 2. 계좌 매핑 및 색상 복구
  if (p.ACCOUNT_SHEETS) Object.assign(ACCOUNT_SHEETS, p.ACCOUNT_SHEETS);
  if (p.ACCOUNT_COLORS) Object.assign(ACCOUNT_COLORS, p.ACCOUNT_COLORS);
  
  // 3. 체크박스 및 선택 상태 복구 (Array -> Set 변환)
  selectedDivAccounts = new Set(p.selectedDivAccounts || []);
  selectedSum1 = new Set(p.selectedSum1 || []);
  selectedSum2 = new Set(p.selectedSum2 || []);
  selectedCum1Accounts = new Set(p.selectedCum1Accounts || []);
  selectedCum2Accounts = new Set(p.selectedCum2Accounts || []);
  
  // 3. 설정 및 플래그 복구
  earlyDepositDecisionMade = p.earlyDepositDecisionMade || false;
  includeEarlyDeposit = p.includeEarlyDeposit || false;
  allocationGroupBy = p.allocationGroupBy || 'name';
  
  // 4. 로컬 스토리지 데이터 복구
  if (p.goalData1) localStorage.setItem('goalData1', JSON.stringify(p.goalData1));
  if (p.goalData2) localStorage.setItem('goalData2', JSON.stringify(p.goalData2));
  if (p.dividendManualData) localStorage.setItem('dividendManualData', JSON.stringify(p.dividendManualData));

  currentLoadedName = name;
  
  // 5. UI 및 차트 갱신
  recalculate();
  if (typeof initGoalTables === 'function') initGoalTables();
  
  // 탭별 렌더링 명시적 호출
  renderAccountSelectors();
  renderCharts();
  renderDividendTab();
  renderCumulativeTab();
  
  loadSavedList();
}

// 3.5. 서버/Firestore에서 포트폴리오 불러오기 디스패처
window.loadPortfolioData = async function(name) {
  if (currentUser) {
    // Firebase Firestore에서 불러오기
    try {
      const doc = await db.collection('users').doc(currentUser.uid).collection('portfolios').doc(name).get();
      if (!doc.exists) throw new Error("포트폴리오가 존재하지 않습니다.");
      
      restorePortfolioState(doc.data(), name);
      showModal("로드 완료", `[${name}] 포트폴리오를 성공적으로 불러왔습니다.`);
    } catch (err) {
      console.error("Firestore 로드 실패:", err);
      alert("로드 실패: " + err.message);
    }
  } else {
    // 로컬 서버에서 불러오기
    await loadPortfolioFromServer(name);
  }
};

window.loadPortfolioFromServer = async function(name) {
  try {
    const res = await fetch(`${LOCAL_SERVER}/load/${name}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    restorePortfolioState(data.data, name);
    showModal("로드 완료", `[${name}] 포트폴리오를 성공적으로 불러왔습니다.`);
  } catch (err) {
    console.error("로드 실패:", err);
    alert("로드 실패: " + err.message);
  }
};

// 4. 서버/Firestore에서 파일 삭제 디스패처
window.deletePortfolioData = async function(name) {
  if (!confirm(`'${name}' 포트폴리오를 영구 삭제하시겠습니까?`)) return;

  if (currentUser) {
    // Firebase Firestore에서 삭제
    try {
      await db.collection('users').doc(currentUser.uid).collection('portfolios').doc(name).delete();
      if (currentLoadedName === name) currentLoadedName = null;
      loadSavedList();
    } catch (err) {
      console.error("Firestore 삭제 실패:", err);
      alert("삭제 실패: " + err.message);
    }
  } else {
    await deletePortfolioFromServer(name);
  }
};

window.deletePortfolioFromServer = async function(name) {
  try {
    const res = await fetch(`${LOCAL_SERVER}/delete/${name}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    
    if (currentLoadedName === name) currentLoadedName = null;
    loadSavedList();
  } catch (err) {
    alert("삭제 실패: " + err.message);
  }
};

// ─── Gold Sync Notice Dismissal ───
window.dismissGoldNotice = function() {
  const notice = document.getElementById('goldSyncNotice');
  if (notice) {
    notice.style.opacity = '0';
    notice.style.transform = 'translateY(20px)';
    notice.style.transition = 'all 0.3s ease';
    setTimeout(() => {
      notice.style.display = 'none';
    }, 300);
    localStorage.setItem('goldNoticeDismissed', 'true');
  }
};

// ─── Sidebar Collapsible Logic ───
window.toggleSidebar = function() {
  const sidebar = document.querySelector('.sidebar');
  const btn = document.getElementById('btnSidebarToggle');
  
  if (!sidebar) return;
  
  sidebar.classList.toggle('collapsed');
  const isCollapsed = sidebar.classList.contains('collapsed');
  
  if (btn) {
    btn.innerHTML = isCollapsed ? '▶' : '◀';
    btn.setAttribute('title', isCollapsed ? '사이드바 열기' : '사이드바 접기');
  }
  
  // Save state in localStorage
  localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
  
  // Resize charts to fit new width
  // Trigger it immediately and after transition durations
  triggerChartResize();
  setTimeout(triggerChartResize, 100);
  setTimeout(triggerChartResize, 200);
  setTimeout(triggerChartResize, 300);
};

function triggerChartResize() {
  Object.values(charts).forEach(chart => {
    if (chart && typeof chart.resize === 'function') {
      chart.resize();
    }
  });
}

// ─── Google Auth - Login, Logout & Auth State Listener ───
window.loginWithGoogle = async function() {
  try {
    await auth.signInWithPopup(provider);
  } catch (err) {
    console.error("Login failed:", err);
    alert("로그인 실패: " + err.message);
  }
};

window.logout = async function() {
  try {
    await auth.signOut();
    currentLoadedName = null;
    holdingsData = [];
    recalculate();
    showModal("로그아웃 완료", "성공적으로 로그아웃되었습니다.");
  } catch (err) {
    console.error("Logout failed:", err);
    alert("로그아웃 실패: " + err.message);
  }
};

auth.onAuthStateChanged(async (user) => {
  const authContainer = document.getElementById('authContainer');
  if (!authContainer) return;
  
  if (user) {
    currentUser = user;
    authContainer.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <img src="${user.photoURL || ''}" referrerpolicy="no-referrer" style="width:32px; height:32px; border-radius:50%; border:1px solid rgba(255,255,255,0.2);">
        <span style="font-size:12px; color:var(--text-primary); font-weight:600; max-width:80px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${user.displayName || '사용자'}">${user.displayName || '사용자'}</span>
        <button class="btn-export" onclick="logout()" style="background:linear-gradient(135deg, #ef4444, #dc2626); padding: 6px 12px; font-size:11px; min-width:auto; border-radius:8px;">로그아웃</button>
      </div>
    `;
    // Load from Firestore
    await loadSavedList();
  } else {
    currentUser = null;
    authContainer.innerHTML = `
      <button class="btn-sync" onclick="loginWithGoogle()" style="background:linear-gradient(135deg, #4285F4, #357AE8); border-radius:12px; padding: 10px 14px;">
        <span class="icon">🔑</span> 구글 로그인
      </button>
    `;
    // Load local list
    await loadSavedList();
  }
});


=======
/* ================================================================
   Portfolio Dashboard - app.js (v5: Tabs & Enhanced Debugging)
   ================================================================ */

let rawData = {};
let currentWorkbook = null;
let charts = {};
let holdingsData = [];
let sortCol = null;
let sortDir = 1;
let usdKrw = 1400;
let selectedDivAccounts = new Set();
let currentWorkbookName = "";

// ─── Firebase Initialize ───
const firebaseConfig = {
  projectId: "portfolio-dashboard-9bd7d",
  appId: "1:632004937412:web:1505c9030b948f8717eb91",
  storageBucket: "portfolio-dashboard-9bd7d.firebasestorage.app",
  apiKey: "AIzaSyASluluTOFka6JdZmNTarYVSsVYeXE1mYA",
  authDomain: "portfolio-dashboard-9bd7d.firebaseapp.com",
  messagingSenderId: "632004937412",
  measurementId: "G-3Y7HE5X408"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();

let currentUser = null;

// ─── 오래된 입금내역 팝업: 업로드 시 1회만 표시, 선택값 저장 ───
let earlyDepositDecisionMade = false;  // 파일 로드 후 한 번만 물어봄
let includeEarlyDeposit = false;       // 사용자가 선택한 값 (예=true, 아니오=false)

// ─── 동기화 실패 종목의 수기 현재가 저장 { ticker: price } ───
let manualPrices = {};

// ─── 전역 실행 취소(Undo) 스택 ───
let undoStack = [];

function saveState() {
  if (undoStack.length >= 50) undoStack.shift();
  undoStack.push({
    holdingsData: JSON.parse(JSON.stringify(holdingsData)),
    manualPrices: JSON.parse(JSON.stringify(manualPrices)),
    goalData1: JSON.parse(localStorage.getItem('goalData1') || '[]'),
    goalData2: JSON.parse(localStorage.getItem('goalData2') || '[]'),
    dividendManualData: JSON.parse(localStorage.getItem('dividendManualData') || '{}')
  });
}

function undo() {
  if (undoStack.length === 0) return;
  const state = undoStack.pop();
  
  holdingsData = state.holdingsData;
  manualPrices = state.manualPrices;
  localStorage.setItem('goalData1', JSON.stringify(state.goalData1));
  localStorage.setItem('goalData2', JSON.stringify(state.goalData2));
  localStorage.setItem('dividendManualData', JSON.stringify(state.dividendManualData));
  
  recalculate();
  initGoalTables();
  renderDividendTab();
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'z') {
    // 입력 중인 셀이 있을 경우, 브라우저 기본 Undo 작동 후 전역 상태는 업데이트하지 않음 (충돌 방지)
    // 문서 활성 요소가 contenteditable이면 브라우저 자체에 맡김
    if (document.activeElement && document.activeElement.getAttribute('contenteditable') === 'true') {
      return; 
    }
    e.preventDefault();
    undo();
  }
});

// 모든 수동 입력 시작 시(focusin) 상태 저장
document.addEventListener('focusin', (e) => {
  if (e.target && e.target.getAttribute('contenteditable') === 'true') {
    saveState();
  }
});

const ACCOUNT_COLORS = {};
const COLOR_PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316', '#14b8a6', '#64748b'];
const ACCOUNT_SHEETS = {};
for (let i = 1; i <= 10; i++) ACCOUNT_SHEETS[`계좌내역${i}`] = "";

// ─── Formatting ───
function fmt(n) { return (n == null || isNaN(n)) ? '0' : Math.round(n).toLocaleString('ko-KR'); }
function fmtPrice(n, curr) {
  if (n == null || isNaN(n)) return '0';
  return curr === '$' ? n.toFixed(2) : Math.round(n).toLocaleString('ko-KR');
}
function fmtPct(n) { return (n == null || isNaN(n)) ? '0.00%' : (n * 100).toFixed(2) + '%'; }
function pctClass(n) { return n >= 0 ? 'positive' : 'negative'; }
function parseNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[,₩원$%\s]/g, '');
  return parseFloat(s) || 0;
}
function parseDate(v) {
  if (v instanceof Date) return v;
  if (!v) return new Date(NaN);
  let s = String(v).trim();
  // 숫자만 있는 경우 (YYYYMMDD)
  if (/^\d{8}$/.test(s)) return new Date(`${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}`);
  // YY/MM/ 또는 YY/MM/DD 형식 대응
  let match = s.match(/^(\d{2,4})[\/\.\-](\d{1,2})([\/\.\-](\d{1,2}))?[\/\.\-]?$/);
  if (match) {
    let yr = match[1], mo = match[2], dy = match[4] || '01';
    if (yr.length === 2) yr = (parseInt(yr) > 50 ? '19' : '20') + yr;
    return new Date(`${yr}-${mo.padStart(2, '0')}-${dy.padStart(2, '0')}`);
  }
  return new Date(s);
}
function getAccountColor(acc) {
  if (!ACCOUNT_COLORS[acc]) {
    const idx = Object.keys(ACCOUNT_COLORS).length;
    ACCOUNT_COLORS[acc] = COLOR_PALETTE[idx % COLOR_PALETTE.length];
  }
  return ACCOUNT_COLORS[acc];
}

// ─── Custom Modal ───
function showModal(title, message) {
  const modal = document.getElementById('customModal');
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMessage').textContent = message;
  document.getElementById('modalConfirm').textContent = '확인';
  document.getElementById('modalCancel').style.display = 'none';
  modal.classList.add('active');

  const close = () => modal.classList.remove('active');
  document.getElementById('modalClose').onclick = close;
  document.getElementById('modalConfirm').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
}

// 예/아니오 선택이 필요한 확인 모달
function showConfirmModal(title, message, onYes, onNo) {
  const modal = document.getElementById('customModal');
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMessage').textContent = message;

  const confirmBtn = document.getElementById('modalConfirm');
  const cancelBtn = document.getElementById('modalCancel');
  confirmBtn.textContent = '예';
  cancelBtn.style.display = 'inline-block';
  cancelBtn.textContent = '아니오';
  modal.classList.add('active');

  const close = () => {
    modal.classList.remove('active');
    cancelBtn.style.display = 'none';
    confirmBtn.textContent = '확인';
  };

  document.getElementById('modalClose').onclick = () => { close(); if (onNo) onNo(); };
  confirmBtn.onclick = () => { close(); if (onYes) onYes(); };
  cancelBtn.onclick = () => { close(); if (onNo) onNo(); };
  modal.onclick = (e) => { if (e.target === modal) { close(); if (onNo) onNo(); } };
}

// ─── Tab Navigation ───
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const tabId = btn.dataset.tab;
    document.getElementById(tabId).classList.add('active');

    if (tabId === 'tabAllocation') renderCharts();
    if (tabId === 'tabDividends') renderDividendTab();
    if (tabId === 'tabReturns') renderCumulativeTab(); // ID 수정: tabMonthly -> tabReturns

    // Resize charts if needed
    Object.values(charts).forEach(chart => chart.resize());
  };
});

// ─── Recalculate ───
function recalculate() {
  const accountTotals = {};
  holdingsData.forEach(h => {
    const isUs = h.country === '미국';
    h.costKrw = h.qty * (isUs ? h.avgPrice * usdKrw : h.avgPrice);
    h.valueKrw = h.qty * (isUs ? h.curPrice * usdKrw : h.curPrice);
    h.returnPct = h.costKrw > 0 ? (h.valueKrw - h.costKrw) / h.costKrw : 0;
    if (!accountTotals[h.account]) accountTotals[h.account] = 0;
    accountTotals[h.account] += h.valueKrw;
  });
  holdingsData.forEach(h => { h.weight = accountTotals[h.account] > 0 ? h.valueKrw / accountTotals[h.account] : 0; });
  renderKPI(holdingsData);
  renderCharts();
  renderTable();
  renderDividendTab(); // 추가: 환율 변동 시 배당 탭 갱신
  renderCumulativeTab(); // 추가: 환율 변동 시 누적수익률 탭 갱신
}

// ─── Real-time Sync (Enhanced Debugging) ───
async function syncPrices() {
  if (Object.keys(manualPrices).length > 0) {
    showConfirmModal(
      '⚠️ 수동 변경 현재가 안내',
      '수동으로 변경하신 현재가 기록이 있습니다.\n시세 동기화를 진행하여 모든 종목의 현재가를\n최신 데이터로 덮어씌우시겠습니까?\n\n(예: 수동 값 무시하고 전체 최신화\n아니오: 수동 변경값은 유지)',
      () => { manualPrices = {}; doSyncPrices(false); },
      () => { doSyncPrices(true); }
    );
  } else {
    doSyncPrices(false);
  }
}

async function doSyncPrices(keepManual = false) {
  const btn = document.getElementById('btnSync');
  const icon = btn.querySelector('.icon');
  btn.disabled = true; icon.classList.add('spinning');

  let logs = [];
  const log = (msg) => { console.log(msg); logs.push(msg); };
  const SYNC_API = import.meta.env.VITE_SYNC_API || "https://portfolio-dashboard-data.netlify.app/api";

  try {
    log("▶ [로컬 서버] 환율 정보 요청 중...");
    try {
      const exRes = await fetch(`${SYNC_API}/exchange`);
      if (!exRes.ok) throw new Error("로컬 서버 응답 없음");
      const exData = await exRes.json();
      usdKrw = exData.chart.result[0].meta.regularMarketPrice || usdKrw;
      log(`✓ 환율 업데이트 성공: ${usdKrw.toFixed(2)}원`);
    } catch (e) {
      log("⚠️ 로컬 서버(sync_server.py) 연결 실패. 수동 입력을 시도합니다.");
      const manual = prompt("로컬 서버가 실행 중인지 확인해주세요.\n수동으로 환율을 입력하시겠습니까?", usdKrw);
      if (manual) usdKrw = parseNum(manual);
    }

    // 야후 파이낸스 표준 형식(영문, 숫자, 점, 대시, 등호)만 허용하며 통화 코드 등 제외
    const validTickerRegex = /^[A-Za-z0-9\.\-=^]+$/;
    const tickers = [...new Set(holdingsData
      .map(h => {
        let t = h.ticker.trim().toUpperCase();
        if (h.country === '한국') {
          // 한국 종목은 숫자로만 구성되어 있으면 .KS를 붙임
          const digitsOnly = t.replace(/[^0-9]/g, '');
          if (digitsOnly.length >= 5 && digitsOnly === t) {
            return digitsOnly.padStart(6, '0') + '.KS';
          }
        }
        return t;
      })
      .filter(t => {
        // 주식이 아닌 명백한 키워드(현금 등)만 제외하고, USD(반도체 ETF)는 허용합니다.
        const isBlocked = ["현금", "CASH", "KRW", "금", "GOLD"].includes(t) || t === "";
        const isValid = validTickerRegex.test(t) && t.length >= 2 && !isBlocked;
        if (!isValid) log(`ℹ️ 시세 조회 제외: ${t}`);
        return isValid;
      })
    )];

    if (tickers.length === 0) throw new Error("조회 가능한 표준 티커가 없습니다. (예: AAPL, 005930)");

    log(`▶ [로컬 서버] 종목 시세 조회 중... (${tickers.length}개 종목)`);
    const quoteRes = await fetch(`${SYNC_API}/sync?symbols=${tickers.join(',')}`);
    const quoteData = await quoteRes.json();

    if (!quoteRes.ok) {
      const detail = quoteData.error || "알 수 없는 오류";
      throw new Error(`시세 서버 응답 오류: ${detail}\n(종목 코드에 한글이 포함되어 있는지 확인하세요)`);
    }

    if (!quoteData.quoteResponse || !quoteData.quoteResponse.result) throw new Error("API 응답 형식 오류 (데이터가 없습니다)");

    // 동기화 적용 전 상태 저장
    saveState();

    const quotes = quoteData.quoteResponse.result;
    const priceMap = {};
    quotes.forEach(q => { priceMap[q.symbol] = q.regularMarketPrice; });

    let updatedCount = 0;
    let failedNames = [];

    holdingsData.forEach(h => {
      let t = h.ticker.trim().toUpperCase();
      if (h.country === '한국') {
        const digitsOnly = t.replace(/[^0-9]/g, '');
        if (digitsOnly.length >= 5 && digitsOnly === t) {
          t = digitsOnly.padStart(6, '0') + '.KS';
        }
      }

      if (priceMap[t]) {
        // keepManual이 true고 수동입력값이 있다면 업데이트 스킵
        if (keepManual && manualPrices[h.ticker] != null) {
          h.curPrice = manualPrices[h.ticker];
        } else {
          h.curPrice = priceMap[t];
          h.syncFailed = false;
        }
        updatedCount++;
      } else {
        // 주식이 아닌 명백한 키워드 제외 후 실패 목록 기록
        if (!["현금", "CASH", "KRW", "금", "GOLD"].includes(t) && t.length > 0) {
          h.syncFailed = true;
          // 수기 입력값이 있으면 유지
          if (manualPrices[h.ticker] != null) {
            h.curPrice = manualPrices[h.ticker];
          }
          failedNames.push(h.name);
        }
      }
    });

    log(`✓ 총 ${updatedCount}개 종목 업데이트 완료`);
    if (failedNames.length > 0) {
      log(`❌ 업데이트 실패 (${failedNames.length}개): ${failedNames.join(', ')}`);
      log(`   (위 종목들의 티커 형식을 확인해 주세요)`);
    }

    recalculate();
    let failMsg = failedNames.length > 0 ? `\n\n[실패 종목 리스트]\n${failedNames.join('\n')}` : "";
    showModal("동기화 완료", `환율: ${usdKrw.toFixed(2)}원\n성공: ${updatedCount}개\n실패: ${failedNames.length}개${failMsg}`);
  } catch (err) {
    log(`❌ 에러: ${err.message}`);
    showModal("동기화 실패", `[원인]\n${err.message}\n\n[조치사항]\n1. sync_server.py가 실행 중인지 확인\n2. 터미널에서 pip install flask flask-cors requests 실행 여부 확인`);
  } finally {
    btn.disabled = false; icon.classList.remove('spinning');
  }
}

// ─── File Handling ───
document.getElementById('btnSync').addEventListener('click', syncPrices);
const btnExport = document.getElementById('btnExport');
if (btnExport) btnExport.addEventListener('click', exportWorkbook);

const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone') || document.getElementById('uploadArea');

if (dropZone) {
  // label 태그인 경우 자체 동작하므로 클릭 강제는 불필요할 수 있지만 보수적으로 남겨둠
  // dropZone.addEventListener('click', () => fileInput.click());
  
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--accent-1)';
    dropZone.style.background = 'rgba(99, 102, 241, 0.08)';
  });
  
  dropZone.addEventListener('dragleave', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--glass-border)';
    dropZone.style.background = 'var(--glass)';
  });
  
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--glass-border)';
    dropZone.style.background = 'var(--glass)';
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      handleFile(e.dataTransfer.files[0]);
    }
  });
}

fileInput.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });

function handleFile(file) {
  currentWorkbookName = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
    parseWorkbook(wb);
  };
  reader.readAsArrayBuffer(file);
}

function parseWorkbook(wb) {
  rawData = {};
  currentWorkbook = wb;
  // 파일 새로 로드 시 상태 초기화
  earlyDepositDecisionMade = false;
  includeEarlyDeposit = false;
  manualPrices = {};
  wb.SheetNames.forEach(name => { rawData[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true }); });

  const idx = rawData['0.인덱스'];
  if (idx) {
    let gd1 = [];
    let gd2 = [];
    for (let r = 1; r < idx.length; r++) {
      if (!idx[r]) continue;
      if (ACCOUNT_SHEETS.hasOwnProperty(idx[r][0])) ACCOUNT_SHEETS[idx[r][0]] = idx[r][1];
      
      // Check-in: 목표비중 읽어오기 (D, E, F, G 열)
      if (idx[r][3] || idx[r][4]) gd1.push({ asset: String(idx[r][3]||''), weight: String(idx[r][4]||'') });
      if (idx[r][5] || idx[r][6]) gd2.push({ asset: String(idx[r][5]||''), weight: String(idx[r][6]||'') });
    }
    if (gd1.length > 0) localStorage.setItem('goalData1', JSON.stringify(gd1));
    if (gd2.length > 0) localStorage.setItem('goalData2', JSON.stringify(gd2));
    if (gd1.length > 0 || gd2.length > 0) initGoalTables();
  }

  const sheet = rawData['종목현황'];
  holdingsData = [];
  if (sheet) {
    let startRow = 1;
    if (sheet[0] && sheet[0].includes('계좌내역')) startRow = 4;

    for (let r = startRow; r < sheet.length; r++) {
      const row = sheet[r];
      if (!row) continue;
      const isNew = startRow === 1;
      
      let tempCat = isNew ? row[2] : row[3];
      let tempTick = isNew ? row[3] : row[4];
      let tempName = isNew ? row[4] : row[5];
      
      let cleanCat = String(tempCat || '').trim();
      let cleanTick = String(tempTick || '').trim().toUpperCase();
      let cleanName = String(tempName || '').trim();
      
      if (!cleanTick && cleanCat !== '현금' && cleanCat !== '금' && cleanName !== '현금' && cleanName !== '금') continue;

      let country, account, category, ticker, name, qty, avgPrice, curPrice;
      if (isNew) {
        country = row[0]; account = row[1]; category = row[2]; ticker = String(row[3] || ''); name = row[4];
        qty = parseNum(row[5]); avgPrice = country === '미국' ? parseNum(row[7]) : parseNum(row[6]);
        curPrice = manualPrices[ticker] != null ? manualPrices[ticker] : avgPrice;
      } else {
        country = row[1]; account = row[2]; category = row[3]; ticker = String(row[4] || ''); name = row[5];
        qty = parseNum(row[6]); avgPrice = country === '미국' ? parseNum(row[8]) : parseNum(row[7]);
        let parsedCurPrice = country === '미국' ? parseNum(row[10]) : parseNum(row[9]);
        curPrice = manualPrices[ticker] != null ? manualPrices[ticker] : parsedCurPrice;
      }

      // 현금 자산 예외 처리 (수량은 기입하고 평단가/현재가가 0이나 빈칸일 때 1로 보정)
      const isCash = cleanCat === '현금' || cleanName === '현금' || ['CASH', 'KRW', 'USD'].includes(cleanTick);
      if (isCash) {
        if (avgPrice === 0) avgPrice = 1;
        if (curPrice === 0) curPrice = 1;
      }

      holdingsData.push({ country, account, category, ticker, name, qty, avgPrice, curPrice, _rowIndex: r });
    }
  }
  recalculate();
  renderDividendTab();
  renderCumulativeTab();
  
  // 파일 트리 저장 (서버 저장은 수동 버튼으로만 수행)
}

// ─── Rendering Functions (KPI, Table, Charts) ───
function renderKPI(data) {
  let v = 0, c = 0;
  data.forEach(h => { v += h.valueKrw; c += h.costKrw; });
  document.getElementById('kpiTotalValue').textContent = fmt(v) + '원';
  document.getElementById('kpiTotalCost').textContent = fmt(c) + '원';
  document.getElementById('kpiTotalProfit').textContent = (v - c >= 0 ? '+' : '') + fmt(v - c) + '원';
  document.getElementById('kpiTotalProfit').className = 'kpi-value ' + pctClass(v - c);
  const r = c > 0 ? (v - c) / c : 0;
  document.getElementById('kpiTotalReturn').textContent = (r >= 0 ? '+' : '') + fmtPct(r);
  document.getElementById('kpiTotalReturn').className = 'kpi-value ' + pctClass(r);
  document.getElementById('kpiUsdKrw').textContent = usdKrw.toFixed(2);
}

function renderTable() {
  const fa = document.getElementById('filterAccount').value;
  const fc = document.getElementById('filterCountry').value;
  const search = document.getElementById('filterSearch').value.toLowerCase();

  // 필터 드롭다운 항상 최신 상태로 갱신 (수동 종목 추가 시에도 반영)
  const accs = [...new Set(holdingsData.map(h => h.account))].filter(Boolean);
  const cnts = [...new Set(holdingsData.map(h => h.country))].filter(Boolean);
  const selAcc = document.getElementById('filterAccount');
  const selCtry = document.getElementById('filterCountry');
  const prevAcc = selAcc.value;
  const prevCtry = selCtry.value;
  selAcc.innerHTML = '<option value="">전체 계좌</option>' + accs.map(a => `<option value="${a}">${a}</option>`).join('');
  selCtry.innerHTML = '<option value="">전체 국가</option>' + cnts.map(c => `<option value="${c}">${c}</option>`).join('');
  selAcc.value = prevAcc;
  selCtry.value = prevCtry;

  let filtered = holdingsData.filter(h => {
    if (h.qty === 0) return false;
    if (fa && h.account !== fa) return false;
    if (fc && h.country !== fc) return false;
    if (search && !h.name.toLowerCase().includes(search) && !h.ticker.toLowerCase().includes(search)) return false;
    return true;
  });

  filtered.sort((a, b) => a.account.localeCompare(b.account) || b.weight - a.weight);

  const tbody = document.getElementById('holdingsBody');
  
  const manualRowHtml = `
    <tr class="manual-add-row" id="manualAddRow" style="display:none; background: rgba(255,255,255,0.05);">
      <td></td>
      <td contenteditable="true" id="manAcc" placeholder="계좌입력"></td>
      <td contenteditable="true" id="manCtry" placeholder="국가(한국/미국)"></td>
      <td contenteditable="true" id="manCat" placeholder="분류"></td>
      <td contenteditable="true" id="manTick" placeholder="티커"></td>
      <td contenteditable="true" id="manName" placeholder="종목명"></td>
      <td contenteditable="true" id="manQty" placeholder="수량" style="text-align:right"></td>
      <td contenteditable="true" id="manAvg" placeholder="평단가" style="text-align:right"></td>
      <td contenteditable="true" id="manCur" placeholder="현재가" style="text-align:right"></td>
      <td colspan="4" style="text-align:center;">
        <button class="btn-sync" onclick="addManualHolding()" style="padding: 4px 12px; font-size:12px;">+ 추가완료</button>
      </td>
    </tr>
  `;

  tbody.innerHTML = manualRowHtml + filtered.map((h, i) => {
    const color = getAccountColor(h.account);
    const curr = h.country === '미국' ? '$' : '₩';
    // 수기 입력 현재가 시인성 확보
    const isManualPrice = manualPrices[h.ticker] != null && manualPrices[h.ticker] === h.curPrice;
    const bgStyle = isManualPrice ? 'background: rgba(255,255,255,0.25);' : '';
    const curPriceCell = `<td contenteditable="true" class="edit-curprice" style="text-align:right; border-bottom: 1px dashed #94a3b8; ${bgStyle}" title="현재가 수기 입력 가능">${fmtPrice(h.curPrice, curr)} ✏️</td>`;
    return `
      <tr data-index="${holdingsData.indexOf(h)}">
        <td><button class="btn-text" onclick="deleteHolding(${holdingsData.indexOf(h)})" style="padding:0; font-size:12px; min-width:auto;" title="이 종목 삭제">➖</button></td>
        <td><span class="acc-tag" style="background:${color}">${h.account}</span></td>
        <td><span class="badge ${h.country === '미국' ? 'badge-us' : 'badge-kr'}">${h.country}</span></td>
        <td>${h.category}</td>
        <td style="color:var(--accent-1);font-weight:600">${h.ticker}</td>
        <td>${h.name}</td>
        <td contenteditable="true" class="edit-qty" style="text-align:right">${h.qty}</td>
        <td contenteditable="true" class="edit-price" style="text-align:right">${fmtPrice(h.avgPrice, curr)}</td>
        ${curPriceCell}
        <td style="text-align:right">${fmt(h.costKrw)}</td>
        <td style="text-align:right">${fmt(h.valueKrw)}</td>
        <td style="text-align:right" class="${pctClass(h.returnPct)}">${fmtPct(h.returnPct)}</td>
        <td style="text-align:right">
          ${fmtPct(h.weight)}
          <div class="weight-bar"><div class="weight-bar-fill" style="width:${h.weight * 100}%; background:${color}"></div></div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('td[contenteditable="true"]').forEach(cell => {
    cell.onblur = () => {
      const tr = cell.closest('tr');
      if (tr.id === 'manualAddRow') return; // 수동 추가 행 입력 중 초기화 방지
      
      const idx = tr.dataset.index;
      const val = parseNum(cell.innerText);
      if (cell.classList.contains('edit-qty')) holdingsData[idx].qty = val;
      else if (cell.classList.contains('edit-price')) holdingsData[idx].avgPrice = val;
      else if (cell.classList.contains('edit-curprice')) {
        holdingsData[idx].curPrice = val;
        if (holdingsData[idx].ticker) manualPrices[holdingsData[idx].ticker] = val; // 수기 입력값 저장
      }
      recalculate();
    };
    cell.onkeydown = e => { 
      if (e.key === 'Enter') { 
        e.preventDefault(); 
        if (cell.closest('tr').id === 'manualAddRow') {
          addManualHolding(); // 엔터 치면 바로 추가
        } else {
          cell.blur(); 
        }
      } 
    };
  });
}

window.toggleManualRow = function() {
  const row = document.getElementById('manualAddRow');
  if (row) {
    if (row.style.display === 'none') {
      row.style.display = 'table-row';
      setTimeout(() => document.getElementById('manAcc').focus(), 10);
    } else {
      row.style.display = 'none';
    }
  }
};

document.addEventListener('click', (e) => {
  const row = document.getElementById('manualAddRow');
  if (row && row.style.display !== 'none') {
    // 버튼을 클릭했거나 row 내부를 클릭했으면 무시
    if (!row.contains(e.target) && !e.target.closest('button[onclick="toggleManualRow()"]')) {
      row.style.display = 'none';
    }
  }
});

window.deleteHolding = function(idx) {
  showConfirmModal(
    '⚠️ 종목 삭제',
    '해당 종목을 포트폴리오에서 삭제하시겠습니까?',
    () => {
      saveState();
      holdingsData.splice(idx, 1);
      recalculate();
    },
    null
  );
};

window.addManualHolding = function() {
  saveState();
  const acc = document.getElementById('manAcc').innerText.trim() || '수동계좌';
  const ctry = document.getElementById('manCtry').innerText.trim() || '한국';
  const cat = document.getElementById('manCat').innerText.trim() || '기타';
  const tick = document.getElementById('manTick').innerText.trim() || '';
  const name = document.getElementById('manName').innerText.trim() || '수동종목';
  const qty = parseNum(document.getElementById('manQty').innerText);
  const avg = parseNum(document.getElementById('manAvg').innerText);
  const cur = parseNum(document.getElementById('manCur').innerText) || avg;
  
  if (qty === 0 || avg === 0) {
    alert('수량과 평단가를 올바르게 입력해주세요.');
    return;
  }
  
  holdingsData.push({
    country: ctry, account: acc, category: cat, ticker: tick, name: name,
    qty: qty, avgPrice: avg, curPrice: cur, _rowIndex: null
  });
  
  if (tick) manualPrices[tick] = cur;
  recalculate();
};

let selectedSum1 = new Set();
let selectedSum2 = new Set();
let allocationGroupBy = 'name';

function initGlobalToggle() {
  const container = document.getElementById('globalToggle');
  if (!container) return;
  container.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      allocationGroupBy = btn.dataset.val;
      renderCharts();
    };
  });
}

function renderAccountSelectors() {
  const accs = [...new Set(holdingsData.map(h => h.account))].filter(Boolean);
  const container1 = document.getElementById('checkList1');
  const container2 = document.getElementById('checkList2');

  if (selectedSum1.size === 0 && selectedSum2.size === 0) {
    accs.forEach(a => { selectedSum1.add(a); selectedSum2.add(a); });
  }

  const genHtml = (selectedSet) => accs.map(acc => `
    <label class="account-check-item">
      <input type="checkbox" value="${acc}" ${selectedSet.has(acc) ? 'checked' : ''}>
      ${acc}
    </label>
  `).join('');

  container1.innerHTML = genHtml(selectedSum1);
  container2.innerHTML = genHtml(selectedSum2);

  [container1, container2].forEach((cont, i) => {
    const targetSet = i === 0 ? selectedSum1 : selectedSum2;
    cont.querySelectorAll('input').forEach(chk => {
      chk.onchange = () => {
        if (chk.checked) targetSet.add(chk.value);
        else targetSet.delete(chk.value);
        renderCharts();
      };
    });
  });
}

// ─── Chart.js 커스텀 Callout 플러그인 (선과 레이블 직접 그리기) ───
const calloutPlugin = {
  id: 'calloutPlugin',
  afterDraw: (chart) => {
    const { ctx, data } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta.data[0] || meta.hidden) return;

    const centerX = meta.data[0].x;
    const centerY = meta.data[0].y;
    const total = data.datasets[0].data.reduce((a, b) => a + b, 0);

    ctx.save();
    meta.data.forEach((datapoint, i) => {
      const val = data.datasets[0].data[i];
      if (!val || (val / total) < 0.01) return;

      const { x, y } = datapoint.tooltipPosition();
      const angle = Math.atan2(y - centerY, x - centerX);

      // 차트 크기에 따라 선 길이 동적 조절 (큰 차트는 더 길게, 요청에 따라 전체 길이 2/3로 축소)
      const baseLen = chart.width > 350 ? 43 : 23;
      // 인덱스가 홀수/짝수인지에 따라 길이를 다르게 하여 텍스트 겹침 방지
      const lineLen = i % 2 === 0 ? baseLen : baseLen * 1.6;
      const endX = x + Math.cos(angle) * lineLen;
      const endY = y + Math.sin(angle) * lineLen;

      // 선 그리기
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 텍스트 정보
      const label = data.labels[i];
      const pct = ((val / total) * 100).toFixed(1) + '%';

      const fontSize = chart.width > 350 ? 12 : 10;
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = endX > centerX ? 'left' : 'right';
      ctx.textBaseline = 'middle';

      const textX = endX + (endX > centerX ? 8 : -8);
      ctx.fillText(label, textX, endY - 7);
      ctx.font = `${fontSize - 1}px sans-serif`;
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(pct, textX, endY + 7);
    });
    ctx.restore();
  }
};

function renderCharts() {
  renderAccountSelectors();
  initGlobalToggle();

  // 시인성 극대화: 모든 차트 텍스트 흰색 설정
  Chart.defaults.color = '#ffffff';
  Chart.defaults.font.family = "'Pretendard', sans-serif";

  const renderGenericChart = (canvasId, dataItems, chartKey, isSmall = false) => {
    const dataMap = {};
    let totalVal = 0;
    let totalCost = 0;

    dataItems.forEach(h => {
      const key = h[allocationGroupBy] || '기타';
      dataMap[key] = (dataMap[key] || 0) + h.valueKrw;
      totalVal += h.valueKrw;
      totalCost += h.costKrw;
    });

    const profit = totalVal - totalCost;
    const retPct = totalCost > 0 ? (profit / totalCost) : 0;
    const labels = Object.keys(dataMap).sort((a, b) => dataMap[b] - dataMap[a]);

    if (charts[chartKey]) charts[chartKey].destroy();
    const ctx = document.getElementById(canvasId).getContext('2d');

    // 1. 요약 정보 렌더링
    if (!isSmall) {
      const statsId = chartKey === 'sum1' ? 'statsSum1' : 'statsSum2';
      const statsEl = document.getElementById(statsId);
      if (statsEl) {
        statsEl.innerHTML = `
          <div class="stat-item">
            <span class="stat-label">총 평가금액</span>
            <span class="stat-value">${fmt(totalVal)}원</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">총 매수금액</span>
            <span class="stat-value" style="color:#94a3b8">${fmt(totalCost)}원</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">수익률</span>
            <span class="stat-value ${pctClass(retPct)}">${(retPct >= 0 ? '+' : '') + fmtPct(retPct)}</span>
          </div>
        `;
      }
    }

    // 2. 차트 렌더링
    charts[chartKey] = new Chart(ctx, {
      type: isSmall ? 'pie' : 'doughnut',
      plugins: [calloutPlugin],
      data: {
        labels: labels,
        datasets: [{
          data: labels.map(l => dataMap[l]),
          backgroundColor: COLOR_PALETTE,
          borderWidth: 2,
          borderColor: '#1e293b'
        }]
      },
      options: {
        radius: isSmall ? '120%' : '90%', // 소형 차트는 1.2배 확대, 메인 차트는 0.9배 축소
        cutout: isSmall ? '0%' : '60%',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: isSmall ? 35 : 80 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${fmt(ctx.raw)}원 (${((ctx.raw / totalVal) * 100).toFixed(1)}%)`
            }
          }
        }
      }
    });
  };

  renderGenericChart('chartSum1', holdingsData.filter(h => selectedSum1.has(h.account)), 'sum1');
  renderGenericChart('chartSum2', holdingsData.filter(h => selectedSum2.has(h.account)), 'sum2');

  const grid = document.getElementById('allAccountsGrid');
  grid.innerHTML = '';
  const accounts = [...new Set(holdingsData.map(h => h.account))].filter(Boolean);

  accounts.forEach((acc, idx) => {
    const accData = holdingsData.filter(h => h.account === acc);
    const box = document.createElement('div');
    box.className = 'small-chart-box';
    const chartId = `smallChart_${idx}`;

    // 소형 차트용 요약 정보 계산
    const sVal = accData.reduce((a, b) => a + b.valueKrw, 0);
    const sCost = accData.reduce((a, b) => a + b.costKrw, 0);
    const sPct = sCost > 0 ? (sVal - sCost) / sCost : 0;

    box.innerHTML = `
      <h4>${acc}</h4>
      <div class="small-chart-wrap"><canvas id="${chartId}"></canvas></div>
      <div class="chart-summary-stats" style="margin-top: 12px; padding: 12px;">
        <div class="stat-item"><span class="stat-label">평가액</span><span class="stat-value" style="font-size:13px;">${fmt(sVal)}원</span></div>
        <div class="stat-item"><span class="stat-label">매수금액</span><span class="stat-value" style="font-size:13px;">${fmt(sCost)}원</span></div>
        <div class="stat-item"><span class="stat-label">수익률</span><span class="stat-value ${pctClass(sPct)}" style="font-size:13px;">${fmtPct(sPct)}</span></div>
      </div>
    `;
    grid.appendChild(box);
    renderGenericChart(chartId, accData, `small_${idx}`, true);
  });
}


// ─── Dividend Analysis Logic ───
function renderDividendTab() {
  const sheet = rawData['배당내역'];

  // 계좌 목록 추출: 종목현황 + 배당내역 모두 포함
  const hAccs = holdingsData.map(h => h.account);
  const dAccs = sheet ? sheet.slice(1).map(r => String(r[1] || '').trim()) : [];
  const accs = [...new Set([...hAccs, ...dAccs])].filter(Boolean);

  const sidebar = document.getElementById('divAccountCheckList');

  if (selectedDivAccounts.size === 0) accs.forEach(a => selectedDivAccounts.add(a));

  if (sidebar) {
    sidebar.innerHTML = accs.map(acc => `
      <label class="account-check-item">
        <input type="checkbox" value="${acc}" ${selectedDivAccounts.has(acc) ? 'checked' : ''}> ${acc}
      </label>
    `).join('');
    sidebar.querySelectorAll('input').forEach(chk => {
      chk.onchange = () => {
        if (chk.checked) selectedDivAccounts.add(chk.value);
        else selectedDivAccounts.delete(chk.value);
        renderDividendTab();
      };
    });
  }

  const tableWrap = document.getElementById('divTableWrap');
  if (!sheet || sheet.length < 2) {
    if (tableWrap) tableWrap.innerHTML = '<div class="placeholder">\'배당내역\' 시트를 찾을 수 없습니다.</div>';
    return;
  }

  const matrix = {};
  // 가이드 행(row 1) 스킵: 첫 번째 데이터 행의 날짜가 파싱 불가능하면 건너뜀
  let divStartRow = 1;
  if (sheet[1] && isNaN(parseDate(sheet[1][0]))) divStartRow = 2;
  for (let r = divStartRow; r < sheet.length; r++) {
    const row = sheet[r];
    if (!row || !row[0]) continue;

    // 1. 날짜 파싱 (유연하게 처리)
    let date = parseDate(row[0]);
    if (isNaN(date)) continue;

    // 2. 계좌 필터링
    const acc = String(row[1] || '').trim();
    if (!selectedDivAccounts.has(acc)) continue;

    const yr = date.getFullYear();
    const mo = date.getMonth() + 1;

    // 3. 금액 파싱 (이미지 구조 반영: 4번 원화, 5번 외화)
    let krwAmt = parseNum(row[4]) || 0;
    let usdAmt = parseNum(row[5]) || 0;

    // 원화 합계 = 원화배당금 + (외화배당금 * 실시간 환율)
    let amt = krwAmt + (usdAmt * usdKrw);

    if (amt > 0) {
      if (!matrix[yr]) matrix[yr] = {};
      matrix[yr][mo] = (matrix[yr][mo] || 0) + amt;
    }
  }

  const years = Object.keys(matrix).sort((a, b) => a - b); // 차트 순서: 과거 -> 현재
  if (years.length === 0) {
    if (tableWrap) tableWrap.innerHTML = '<div class="placeholder">데이터가 없습니다.</div>';
    return;
  }

  // 테이블 매트릭스 생성
  let tableHtml = `<table class="dividend-matrix">
    <thead>
      <tr>
        <th>연도</th>
        ${Array.from({ length: 12 }, (_, i) => `<th>${i + 1}월</th>`).join('')}
        <th>연배당금</th>
        <th>월평균</th>
      </tr>
    </thead>
    <tbody>`;

  const manualDiv = JSON.parse(localStorage.getItem('dividendManualData') || '{}');

  const reverseYears = [...years].sort((a, b) => b - a); // 테이블 순서: 최신순
  reverseYears.forEach(yr => {
    let yrTotal = 0;
    let monthsHtml = '';
    for (let m = 1; m <= 12; m++) {
      const key = `${yr}-${m}`;
      let val = matrix[yr][m] || 0;
      let isManual = false;
      if (manualDiv[key] !== undefined) {
        val = manualDiv[key];
        isManual = true;
      }
      matrix[yr][m] = val; // 차트에도 반영되도록 매트릭스 업데이트
      yrTotal += val;
      const bgStyle = isManual ? 'background: rgba(255,255,255,0.25);' : '';
      monthsHtml += `<td contenteditable="true" data-key="${key}" data-orig="${matrix[yr][m] || 0}" class="edit-div" style="text-align:right; border-bottom:1px dashed #94a3b8; ${bgStyle}">${val > 0 ? fmt(val) : '0'}</td>`;
    }
    tableHtml += `<tr>
      <td class="year-col">${yr}</td>
      ${monthsHtml}
      <td class="total-col">₩${fmt(yrTotal)}</td>
      <td>₩${fmt(yrTotal / 12)}</td>
    </tr>`;
  });
  tableHtml += '</tbody></table>';
  
  if (tableWrap) {
    tableWrap.innerHTML = tableHtml;
    tableWrap.querySelectorAll('.edit-div').forEach(cell => {
      cell.onblur = () => {
        const key = cell.dataset.key;
        let valText = cell.innerText.trim();
        const origVal = parseFloat(cell.dataset.orig);
        const parsedVal = parseNum(valText);
        
        const md = JSON.parse(localStorage.getItem('dividendManualData') || '{}');
        
        // 원본과 동일하게 돌아왔거나 비웠으면 저장 해제
        if (valText === '' || valText === '-' || parsedVal === origVal) {
          delete md[key];
        } else {
          md[key] = parsedVal;
        }
        localStorage.setItem('dividendManualData', JSON.stringify(md));
        renderDividendTab();
      };
      cell.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); cell.blur(); } };
    });
  }

  // 그룹형 막대 차트 렌더링
  if (charts.dividend) charts.dividend.destroy();
  const datasets = years.map((yr, idx) => ({
    label: yr + '년',
    data: Array.from({ length: 12 }, (_, i) => matrix[yr][i + 1] || 0),
    backgroundColor: COLOR_PALETTE[idx % COLOR_PALETTE.length],
    borderRadius: 4
  }));

  charts.dividend = new Chart(document.getElementById('chartDividend'), {
    type: 'bar',
    data: { labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { color: '#fff' } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label} ${ctx.label}: ₩${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
        y: { ticks: { color: '#94a3b8', callback: v => fmt(v) } }
      }
    }
  });
}

// ─── State for Cumulative Tab ───
let selectedCum1Accounts = new Set();
let selectedCum2Accounts = new Set();

function renderCumulativeTab() {
  // 1. 계좌 목록 추출 (데이터가 있는 계좌만 포함)
  const accs = Object.entries(ACCOUNT_SHEETS)
    .filter(([id, name]) => name !== '' && rawData[id] && rawData[id].length > 1)
    .map(([id, name]) => ({ id, name }));

  if (selectedCum1Accounts.size === 0 && accs.length > 0) accs.forEach(a => selectedCum1Accounts.add(a.name));
  if (selectedCum2Accounts.size === 0 && accs.length > 0) accs.forEach(a => selectedCum2Accounts.add(a.name));

  // Render Checklists
  const renderList = (containerId, selectedSet, btnId) => {
    const el = document.getElementById(containerId);
    if (!el) return;

    // 전체선택 버튼 핸들러
    const btnAll = document.getElementById(btnId);
    if (btnAll) {
      btnAll.onclick = () => {
        if (selectedSet.size === accs.length) selectedSet.clear();
        else accs.forEach(a => selectedSet.add(a.name));
        renderCumulativeTab();
      };
      btnAll.textContent = selectedSet.size === accs.length ? '전체해제' : '전체선택';
    }

    el.innerHTML = accs.map(a => `
      <label class="account-check-item">
        <input type="checkbox" value="${a.name}" ${selectedSet.has(a.name) ? 'checked' : ''}> ${a.name}
      </label>
    `).join('');
    el.querySelectorAll('input').forEach(chk => {
      chk.onchange = () => {
        if (chk.checked) selectedSet.add(chk.value); else selectedSet.delete(chk.value);
        renderCumulativeTab();
      };
    });
  };
  renderList('cumSum1Checklist', selectedCum1Accounts, 'btnAllCum1');
  renderList('cumSum2Checklist', selectedCum2Accounts, 'btnAllCum2');

  // 1. 입금 내역 미리 집계 (계좌별/월별) — 외부 선언은 earlyDeposit 탐지용으로만 사용
  const depSheet = rawData['입금내역'];
  console.log("▶ [누적수익률] 입금내역 시트 로드:", depSheet ? `${depSheet.length}행` : "없음");

  // ── 계좌별 계좌내역 시작 날짜 파악 ──
  const accountStartDate = {}; // { accountName: Date }
  accs.forEach(a => {
    const sheet = rawData[a.id];
    if (!sheet) return;
    for (let r = 1; r < sheet.length; r++) {
      const row = sheet[r];
      if (!row || !row[0]) continue;
      const d = parseDate(row[0]);
      if (!isNaN(d)) { accountStartDate[a.name] = d; break; } // 첫 유효 날짜
    }
  });

  // ── 계좌내역 시작일보다 오래된 입금내역이 있는 계좌 탐지 ──
  const earlyDepositAccounts = []; // 오래된 입금내역이 있는 계좌명 목록
  if (depSheet) {
    const earlyMap = {}; // { accountName: true }
    for (let r = 1; r < depSheet.length; r++) {
      const row = depSheet[r];
      if (!row || !row[0] || !row[2]) continue;
      const date = parseDate(row[0]);
      if (isNaN(date)) continue;
      const acc = String(row[1] || '').trim();
      if (accountStartDate[acc] && date < accountStartDate[acc] && !earlyMap[acc]) {
        earlyMap[acc] = true;
        earlyDepositAccounts.push(acc);
      }
    }
  }

  // ── 실제 차트 렌더링 함수 (includeEarly: 오래된 입금액 포함 여부) ──
  const buildAndRender = (includeEarly) => {
    // depositMap 초기화
    const depositMap = {};
    if (depSheet) {
      for (let r = 1; r < depSheet.length; r++) {
        const row = depSheet[r];
        if (!row || !row[0] || !row[2]) continue;
        const date = parseDate(row[0]);
        if (isNaN(date)) continue;
        const acc = String(row[1] || '').trim();

        // includeEarly=false 이면 계좌내역 시작일보다 오래된 항목 스킵
        if (!includeEarly && accountStartDate[acc] && date < accountStartDate[acc]) continue;

        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!depositMap[acc]) depositMap[acc] = {};
        depositMap[acc][monthKey] = (depositMap[acc][monthKey] || 0) + parseNum(row[2]);
      }
    }

    // 2. 계좌별 데이터 구성 (입금액 누적 계산)
    const allData = {}; // { accountName: [ {date, deposit, balance}, ... ] }
    console.log("▶ [누적수익률] 대상 계좌:", accs.map(a => a.name));

    accs.forEach(a => {
      const sheet = rawData[a.id];
      if (!sheet) {
        console.warn(`[누적수익률] ${a.id} (${a.name}) 시트를 찾을 수 없습니다.`);
        return;
      }
      const data = [];

      for (let r = 1; r < sheet.length; r++) {
        const row = sheet[r];
        if (!row || !row[0]) continue;
        const date = parseDate(row[0]);
        if (isNaN(date)) continue;

        const historyYM = date.getFullYear() * 12 + date.getMonth();
        let cumulativeDeposit = 0;

        if (depositMap[a.name]) {
          Object.entries(depositMap[a.name]).forEach(([monthKey, amount]) => {
            const [yr, mo] = monthKey.split('-').map(Number);
            const depositYM = yr * 12 + (mo - 1);
            if (depositYM <= historyYM) {
              cumulativeDeposit += amount;
            }
          });
        }

        data.push({
          date: date.toISOString().split('T')[0],
          deposit: cumulativeDeposit,
          balance: parseNum(row[1])
        });
      }
      allData[a.name] = data;
      console.log(`✓ [누적수익률] ${a.name}: ${data.length}개 월간 데이터 구성 완료`);
    });

    // Helper to aggregate multiple accounts
    const aggregate = (selectedNames) => {
      const combined = {}; // { date: {deposit, balance} }
      selectedNames.forEach(name => {
        const data = allData[name] || [];
        data.forEach(d => {
          if (!combined[d.date]) combined[d.date] = { deposit: 0, balance: 0 };
          combined[d.date].deposit += d.deposit;
          combined[d.date].balance += d.balance;
        });
      });
      return Object.entries(combined).sort((a, b) => a[0].localeCompare(b[0])).map(([date, vals]) => ({ date, ...vals }));
    };

    const drawChart = (canvasId, chartKey, data) => {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      if (charts[chartKey]) charts[chartKey].destroy();

      charts[chartKey] = new Chart(canvas, {
        type: 'line',
        data: {
          labels: data.map(d => d.date),
          datasets: [
            {
              label: '입금액',
              data: data.map(d => d.deposit),
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              fill: true,
              tension: 0.3,
              pointRadius: 0
            },
            {
              label: '평가액',
              data: data.map(d => d.balance),
              borderColor: '#f87171',
              backgroundColor: 'rgba(248, 113, 113, 0.1)',
              fill: true,
              tension: 0.3,
              pointRadius: 0
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'top',
              onClick: () => {}, // 범례 클릭 비활성화
              labels: { color: '#94a3b8', boxWidth: 12 }
            },
            tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ₩${fmt(ctx.raw)}` } }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                color: '#64748b',
                maxRotation: 45,
                minRotation: 45,
                autoSkip: true,
                maxTicksLimit: 12
              }
            },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', callback: v => '₩' + fmt(v) } }
          }
        }
      });
    };

    // 0. 누적수익률 요약 통계 렌더링
    const renderCumStats = (statsId, data) => {
      const el = document.getElementById(statsId);
      if (!el || data.length === 0) return;
      const lastDeposit = data[data.length - 1].deposit;
      const lastBalance = data[data.length - 1].balance;
      const profit = lastBalance - lastDeposit;
      const retPct = lastDeposit > 0 ? profit / lastDeposit : 0;
      el.innerHTML = `
        <div class="stat-item"><span class="stat-label">총 입금액</span><span class="stat-value">${fmt(lastDeposit)}원</span></div>
        <div class="stat-item"><span class="stat-label">현재 평가액</span><span class="stat-value">${fmt(lastBalance)}원</span></div>
        <div class="stat-item"><span class="stat-label">수익률</span><span class="stat-value ${pctClass(retPct)}">${(retPct >= 0 ? '+' : '') + fmtPct(retPct)}</span></div>
      `;
    };

    // 1. Sum Charts
    const cumData1 = aggregate(selectedCum1Accounts);
    const cumData2 = aggregate(selectedCum2Accounts);
    drawChart('chartCumSum1', 'cumSum1', cumData1);
    drawChart('chartCumSum2', 'cumSum2', cumData2);
    renderCumStats('statsCumSum1', cumData1);
    renderCumStats('statsCumSum2', cumData2);

    // 2. Individual Grid
    const grid = document.getElementById('divCumAccountGrid');
    if (grid) {
      grid.innerHTML = accs.map(a => `
        <div class="small-chart-box">
          <div style="font-size:12px; color:#fff; margin-bottom:10px; font-weight:600;">${a.name}</div>
          <div style="height:180px;"><canvas id="chartCumIdx_${a.id}"></canvas></div>
        </div>
      `).join('');
      accs.forEach(a => {
        const canvasId = `chartCumIdx_${a.id}`;
        const chartKey = `cumIdx_${a.id}`;
        drawChart(canvasId, chartKey, allData[a.name] || []);
      });
    }
  }; // ── buildAndRender 끝 ──

  // ── 오래된 입금내역 감지 시 팝업 표시 (업로드 시 1회만) ──
  if (earlyDepositAccounts.length > 0 && !earlyDepositDecisionMade) {
    const accList = earlyDepositAccounts.join(', ');
    showConfirmModal(
      '⚠️ 오래된 입금내역 감지',
      `계좌내역보다 오래된 입금내역이 있습니다.\n해당 계좌: ${accList}\n\n입금내역을 모두 합칠까요?\n(예: 이전 입금액 포함하여 차트 생성\n아니오: 계좌내역 시작일 이후만 반영)`,
      () => { earlyDepositDecisionMade = true; includeEarlyDeposit = true; buildAndRender(true); },
      () => { earlyDepositDecisionMade = true; includeEarlyDeposit = false; buildAndRender(false); }
    );
  } else {
    // 이미 결정했거나 오래된 입금내역 없음 → 저장된 선택값으로 바로 렌더링
    buildAndRender(includeEarlyDeposit);
  }
} // ── renderCumulativeTab 끝 ──

document.getElementById('filterAccount').onchange = renderTable;
document.getElementById('filterCountry').onchange = renderTable;
document.getElementById('filterSearch').oninput = renderTable;

function exportWorkbook() {
  if (!currentWorkbook) {
    showModal("알림", "내보낼 데이터가 없습니다. 먼저 파일을 로드해주세요.");
    return;
  }

  // 1. holdingsData의 최신 변경사항을 원본 워크북 시트에 직접 반영 (서식 보존을 위해)
  const statusSheet = currentWorkbook.Sheets['종목현황'];
  if (statusSheet && holdingsData.length > 0) {
    let startRow = 1;
    // 헤더 체크 (A1 셀 내용 확인)
    const a1 = statusSheet['A1'] ? statusSheet['A1'].v : "";
    if (a1 && String(a1).includes('계좌내역')) startRow = 4;

    holdingsData.forEach((h) => {
      const r = h._rowIndex;
      if (r != null) {
        // 컬럼 인덱스 결정
        let qtyCol, priceCol;
        if (startRow === 1) { // 새 형식 (8열: A~H, 현재가 컬럼 없음)
          qtyCol = 5; priceCol = (h.country === '미국' ? 7 : 6);
          // 새 형식 템플릿에는 현재가 열이 없으므로 내보내기 시 기록하지 않음
        } else { // 구형 형식
          qtyCol = 6; priceCol = (h.country === '미국' ? 8 : 7);
          // 현재가도 업데이트 (미국주식인 경우)
          if (h.country === '미국') {
            const curPriceRef = XLSX.utils.encode_cell({ r: r, c: 10 });
            if (!statusSheet[curPriceRef]) statusSheet[curPriceRef] = { t: 'n' };
            statusSheet[curPriceRef].v = h.curPrice;
          } else {
            const curPriceRef = XLSX.utils.encode_cell({ r: r, c: 9 });
            if (!statusSheet[curPriceRef]) statusSheet[curPriceRef] = { t: 'n' };
            statusSheet[curPriceRef].v = h.curPrice;
          }
        }

        const qtyRef = XLSX.utils.encode_cell({ r: r, c: qtyCol });
        const prcRef = XLSX.utils.encode_cell({ r: r, c: priceCol });

        if (!statusSheet[qtyRef]) statusSheet[qtyRef] = { t: 'n' };
        statusSheet[qtyRef].v = h.qty;

        if (!statusSheet[prcRef]) statusSheet[prcRef] = { t: 'n' };
        statusSheet[prcRef].v = h.avgPrice;
      }
    });
  }

  // 1.5. 목표비중을 0.인덱스 시트 D~G 열에 기록 (Check-out)
  const idxSheet = currentWorkbook.Sheets['0.인덱스'];
  if (idxSheet) {
    XLSX.utils.sheet_add_aoa(idxSheet, [['계좌합1 자산군', '비중(%)', '계좌합2 자산군', '비중(%)']], {origin: 'D1'});
    
    const gd1 = JSON.parse(localStorage.getItem('goalData1') || '[]');
    const gd2 = JSON.parse(localStorage.getItem('goalData2') || '[]');
    
    const maxLen = Math.max(gd1.length, gd2.length);
    const dataToWrite = [];
    for (let i = 0; i < maxLen; i++) {
      const d1 = gd1[i] || { asset: '', weight: '' };
      const d2 = gd2[i] || { asset: '', weight: '' };
      dataToWrite.push([d1.asset, d1.weight, d2.asset, d2.weight]);
    }
    if (dataToWrite.length > 0) {
      XLSX.utils.sheet_add_aoa(idxSheet, dataToWrite, {origin: 'D2'});
    }
  }

  // 2. 컬럼 너비 재조정 (선택 사항, 원본에 이미 있으면 생략 가능하나 안전을 위해 적용)
  currentWorkbook.SheetNames.forEach(name => {
    const ws = currentWorkbook.Sheets[name];
    const data = rawData[name];
    if (data && data.length > 0) {
      const colWidths = data[0].map((_, colIndex) => {
        let maxLen = 10;
        data.forEach(row => {
          const val = row[colIndex];
          if (val != null) {
            const sVal = String(val);
            const len = sVal.split('').reduce((acc, char) => acc + (char.charCodeAt(0) > 128 ? 2 : 1), 0);
            if (len > maxLen) maxLen = len;
          }
        });
        return { wch: Math.min(maxLen + 2, 50) };
      });
      ws['!cols'] = colWidths;
    }
  });

  // 3. 수정된 워크북 다운로드
  XLSX.writeFile(currentWorkbook, "Portfolio_Checkout.xlsx");
}

// ─── 목표 비중 표 (Goal Allocation Table) 로직 ───
function initGoalTables() {
  for (let i = 1; i <= 2; i++) {
    const tbody = document.querySelector(`#goalTable${i} tbody`);
    if (!tbody) continue;
    
    // 로컬 스토리지에서 데이터 불러오기
    let savedData = JSON.parse(localStorage.getItem(`goalData${i}`) || '[]');
    
    // 데이터가 없으면 기본 5행 빈 데이터 생성
    if (savedData.length === 0) {
      for (let j = 0; j < 5; j++) {
        savedData.push({ asset: '', weight: '' });
      }
    }
    
    renderGoalTable(i, savedData);
  }
}

function renderGoalTable(tableIndex, data) {
  const tbody = document.querySelector(`#goalTable${tableIndex} tbody`);
  if (!tbody) return;
  
  tbody.innerHTML = data.map((row, idx) => `
    <tr data-index="${idx}">
      <td contenteditable="true" class="edit-asset" placeholder="자산군 입력">${row.asset || ''}</td>
      <td contenteditable="true" class="edit-weight" style="text-align:right;" placeholder="비중(%)">${row.weight || ''}</td>
    </tr>
  `).join('');
  
  // 이벤트 리스너: 입력 시 로컬 스토리지 자동 저장
  tbody.querySelectorAll('td[contenteditable="true"]').forEach(cell => {
    cell.onblur = () => saveGoalTable(tableIndex);
    cell.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); cell.blur(); } };
  });
}

function addGoalRow(tableIndex) {
  const tbody = document.querySelector(`#goalTable${tableIndex} tbody`);
  if (!tbody) return;
  
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td contenteditable="true" class="edit-asset" placeholder="자산군 입력"></td>
    <td contenteditable="true" class="edit-weight" style="text-align:right;" placeholder="비중(%)"></td>
  `;
  
  tr.querySelectorAll('td[contenteditable="true"]').forEach(cell => {
    cell.onblur = () => saveGoalTable(tableIndex);
    cell.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); cell.blur(); } };
  });
  
  tbody.appendChild(tr);
  saveGoalTable(tableIndex);
}

function saveGoalTable(tableIndex) {
  const tbody = document.querySelector(`#goalTable${tableIndex} tbody`);
  if (!tbody) return;
  
  const data = [];
  tbody.querySelectorAll('tr').forEach(tr => {
    const asset = tr.querySelector('.edit-asset').innerText.trim();
    const weight = tr.querySelector('.edit-weight').innerText.trim();
    data.push({ asset, weight });
  });
  
  localStorage.setItem(`goalData${tableIndex}`, JSON.stringify(data));
}

// ─── 초기화 및 서버 연동 ───
const LOCAL_SERVER = "http://127.0.0.1:5000";

document.addEventListener('DOMContentLoaded', () => {
  if (typeof initGoalTables === 'function') initGoalTables();
  loadSavedList(); // 서버에서 저장된 파일 목록 불러오기

  // Gold Sync Notice 닫기 상태 복원
  if (localStorage.getItem('goldNoticeDismissed') === 'true') {
    const notice = document.getElementById('goldSyncNotice');
    if (notice) notice.style.display = 'none';
  }

  // 사이드바 상태 복원
  if (localStorage.getItem('sidebarCollapsed') === 'true') {
    const sidebar = document.querySelector('.sidebar');
    const btn = document.getElementById('btnSidebarToggle');
    if (sidebar) sidebar.classList.add('collapsed');
    if (btn) {
      btn.innerHTML = '▶';
      btn.setAttribute('title', '사이드바 열기');
    }
  }
});

// ─── Portfolio File Management (Server-side) ───
let currentLoadedName = null;

// 1. 서버에서 저장된 파일 목록 가져오기
async function loadSavedList() {
  const listContainer = document.getElementById('savedPortfoliosList');
  if (!listContainer) return;

  try {
    let files = [];
    if (currentUser) {
      // Firebase Firestore에서 목록 가져오기
      const snapshot = await db.collection('users').doc(currentUser.uid).collection('portfolios')
        .get();
      snapshot.forEach(doc => {
        files.push(doc.id);
      });
      // 타임스탬프 기준으로 정렬 (Firestore 복원)
      // (단순 정렬용 필드를 payload에 넣었으므로, client-side에서 정렬하거나 doc 데이터를 활용하여 정렬할 수 있습니다)
      const fileData = [];
      snapshot.forEach(doc => {
        fileData.push({ id: doc.id, timestamp: doc.data().timestamp || "" });
      });
      fileData.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      files = fileData.map(f => f.id);
    } else {
      // 로컬 플라스크 서버에서 목록 가져오기
      const res = await fetch(`${LOCAL_SERVER}/list`);
      const data = await res.json();
      if (data.success) {
        files = data.files || [];
      }
    }

    if (files.length === 0) {
      listContainer.innerHTML = '<div class="placeholder" style="min-height:50px; font-size:11px; color:#64748b;">저장된 파일이 없습니다.</div>';
      return;
    }

    listContainer.innerHTML = files.map(name => `
      <div class="tree-item ${name === currentLoadedName ? 'active' : ''}" onclick="loadPortfolioData('${name}')">
        <span class="file-icon">📄</span>
        <div class="file-info">
          <span class="file-name" title="${name}">${name}</span>
        </div>
        <button class="btn-delete-small" onclick="event.stopPropagation(); deletePortfolioData('${name}')" title="삭제">×</button>
      </div>
    `).join('');
  } catch (err) {
    console.error("파일 목록 로드 실패:", err);
    listContainer.innerHTML = `<div class="placeholder" style="color:#ef4444;">목록 로드 실패: ${err.message}</div>`;
  }
}

// 2. 포트폴리오 저장 기능
window.saveCurrentPortfolio = function() {
  if (!holdingsData || holdingsData.length === 0) {
    showModal("저장 불가", "저장할 데이터가 없습니다. 먼저 파일을 업로드해주세요.");
    return;
  }

  const modal = document.getElementById('saveNameModal');
  const input = document.getElementById('saveNameInput');
  const confirmBtn = document.getElementById('saveModalConfirm');
  const cancelBtn = document.getElementById('saveModalCancel');
  const closeBtn = document.getElementById('saveModalClose');

  if (!modal || !input) return;

  // 기본 이름 설정 (날짜_시간)
  const now = new Date();
  const dateStr = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0');
  const timeStr = String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0');
  input.value = currentLoadedName || (currentWorkbookName ? currentWorkbookName.split('.')[0] : `포트폴리오_${dateStr}_${timeStr}`);

  // 모달 열기
  modal.style.display = 'flex';
  modal.style.opacity = '1';
  modal.style.pointerEvents = 'auto';
  modal.classList.add('active');
  setTimeout(() => input.focus(), 100);

  const closeModal = () => {
    modal.classList.remove('active');
    modal.style.opacity = '0';
    modal.style.pointerEvents = 'none';
    setTimeout(() => { modal.style.display = 'none'; }, 200);
  };

  const doSave = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }

    const payload = {
      name: name,
      data: {
        // 기본 데이터
        holdingsData,
        manualPrices,
        usdKrw,
        rawData,
        currentWorkbookName,
        
        // 계좌 매핑 및 색상 상태
        ACCOUNT_SHEETS,
        ACCOUNT_COLORS,
        
        // 체크박스 및 선택 상태 (Set -> Array 변환 필요)
        selectedDivAccounts: [...selectedDivAccounts],
        selectedSum1: [...selectedSum1],
        selectedSum2: [...selectedSum2],
        selectedCum1Accounts: [...selectedCum1Accounts],
        selectedCum2Accounts: [...selectedCum2Accounts],
        
        // 설정 및 플래그
        earlyDepositDecisionMade,
        includeEarlyDeposit,
        allocationGroupBy,
        
        // 로컬 스토리지 데이터 (목표 비중 등)
        goalData1: JSON.parse(localStorage.getItem('goalData1') || '[]'),
        goalData2: JSON.parse(localStorage.getItem('goalData2') || '[]'),
        dividendManualData: JSON.parse(localStorage.getItem('dividendManualData') || '{}'),
        
        timestamp: new Date().toISOString()
      }
    };

    try {
      if (currentUser) {
        // Firebase Firestore에 저장
        await db.collection('users').doc(currentUser.uid).collection('portfolios').doc(name).set(payload.data);
        closeModal();
        currentLoadedName = name;
        loadSavedList();
      } else {
        // 로컬 플라스크 서버에 저장
        const res = await fetch(`${LOCAL_SERVER}/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const resData = await res.json();
        if (!resData.success) throw new Error(resData.error);
        closeModal();
        currentLoadedName = resData.name;
        loadSavedList();
      }
      
      // 저장 성공 피드백
      const btn = document.getElementById('btnSavePortfolio');
      const origText = btn.innerHTML;
      btn.innerHTML = "✅ 저장 완료";
      setTimeout(() => { btn.innerHTML = origText; }, 2000);
      
    } catch (err) {
      alert("저장 실패: " + err.message);
    }
  };

  confirmBtn.onclick = doSave;
  cancelBtn.onclick = closeModal;
  closeBtn.onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  input.onkeydown = (e) => { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') closeModal(); };
};

// 3. 포트폴리오 상태 복원 헬퍼
function restorePortfolioState(p, name) {
  // 1. 기본 데이터 복구
  holdingsData = p.holdingsData || [];
  manualPrices = p.manualPrices || {};
  usdKrw = p.usdKrw || 1400;
  rawData = p.rawData || {};
  currentWorkbookName = p.currentWorkbookName || "";
  
  // 2. 계좌 매핑 및 색상 복구
  if (p.ACCOUNT_SHEETS) Object.assign(ACCOUNT_SHEETS, p.ACCOUNT_SHEETS);
  if (p.ACCOUNT_COLORS) Object.assign(ACCOUNT_COLORS, p.ACCOUNT_COLORS);
  
  // 3. 체크박스 및 선택 상태 복구 (Array -> Set 변환)
  selectedDivAccounts = new Set(p.selectedDivAccounts || []);
  selectedSum1 = new Set(p.selectedSum1 || []);
  selectedSum2 = new Set(p.selectedSum2 || []);
  selectedCum1Accounts = new Set(p.selectedCum1Accounts || []);
  selectedCum2Accounts = new Set(p.selectedCum2Accounts || []);
  
  // 3. 설정 및 플래그 복구
  earlyDepositDecisionMade = p.earlyDepositDecisionMade || false;
  includeEarlyDeposit = p.includeEarlyDeposit || false;
  allocationGroupBy = p.allocationGroupBy || 'name';
  
  // 4. 로컬 스토리지 데이터 복구
  if (p.goalData1) localStorage.setItem('goalData1', JSON.stringify(p.goalData1));
  if (p.goalData2) localStorage.setItem('goalData2', JSON.stringify(p.goalData2));
  if (p.dividendManualData) localStorage.setItem('dividendManualData', JSON.stringify(p.dividendManualData));

  currentLoadedName = name;
  
  // 5. UI 및 차트 갱신
  recalculate();
  if (typeof initGoalTables === 'function') initGoalTables();
  
  // 탭별 렌더링 명시적 호출
  renderAccountSelectors();
  renderCharts();
  renderDividendTab();
  renderCumulativeTab();
  
  loadSavedList();
}

// 3.5. 서버/Firestore에서 포트폴리오 불러오기 디스패처
window.loadPortfolioData = async function(name) {
  if (currentUser) {
    // Firebase Firestore에서 불러오기
    try {
      const doc = await db.collection('users').doc(currentUser.uid).collection('portfolios').doc(name).get();
      if (!doc.exists) throw new Error("포트폴리오가 존재하지 않습니다.");
      
      restorePortfolioState(doc.data(), name);
      showModal("로드 완료", `[${name}] 포트폴리오를 성공적으로 불러왔습니다.`);
    } catch (err) {
      console.error("Firestore 로드 실패:", err);
      alert("로드 실패: " + err.message);
    }
  } else {
    // 로컬 서버에서 불러오기
    await loadPortfolioFromServer(name);
  }
};

window.loadPortfolioFromServer = async function(name) {
  try {
    const res = await fetch(`${LOCAL_SERVER}/load/${name}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    restorePortfolioState(data.data, name);
    showModal("로드 완료", `[${name}] 포트폴리오를 성공적으로 불러왔습니다.`);
  } catch (err) {
    console.error("로드 실패:", err);
    alert("로드 실패: " + err.message);
  }
};

// 4. 서버/Firestore에서 파일 삭제 디스패처
window.deletePortfolioData = async function(name) {
  if (!confirm(`'${name}' 포트폴리오를 영구 삭제하시겠습니까?`)) return;

  if (currentUser) {
    // Firebase Firestore에서 삭제
    try {
      await db.collection('users').doc(currentUser.uid).collection('portfolios').doc(name).delete();
      if (currentLoadedName === name) currentLoadedName = null;
      loadSavedList();
    } catch (err) {
      console.error("Firestore 삭제 실패:", err);
      alert("삭제 실패: " + err.message);
    }
  } else {
    await deletePortfolioFromServer(name);
  }
};

window.deletePortfolioFromServer = async function(name) {
  try {
    const res = await fetch(`${LOCAL_SERVER}/delete/${name}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    
    if (currentLoadedName === name) currentLoadedName = null;
    loadSavedList();
  } catch (err) {
    alert("삭제 실패: " + err.message);
  }
};

// ─── Gold Sync Notice Dismissal ───
window.dismissGoldNotice = function() {
  const notice = document.getElementById('goldSyncNotice');
  if (notice) {
    notice.style.opacity = '0';
    notice.style.transform = 'translateY(20px)';
    notice.style.transition = 'all 0.3s ease';
    setTimeout(() => {
      notice.style.display = 'none';
    }, 300);
    localStorage.setItem('goldNoticeDismissed', 'true');
  }
};

// ─── Sidebar Collapsible Logic ───
window.toggleSidebar = function() {
  const sidebar = document.querySelector('.sidebar');
  const btn = document.getElementById('btnSidebarToggle');
  
  if (!sidebar) return;
  
  sidebar.classList.toggle('collapsed');
  const isCollapsed = sidebar.classList.contains('collapsed');
  
  if (btn) {
    btn.innerHTML = isCollapsed ? '▶' : '◀';
    btn.setAttribute('title', isCollapsed ? '사이드바 열기' : '사이드바 접기');
  }
  
  // Save state in localStorage
  localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
  
  // Resize charts to fit new width
  // Trigger it immediately and after transition durations
  triggerChartResize();
  setTimeout(triggerChartResize, 100);
  setTimeout(triggerChartResize, 200);
  setTimeout(triggerChartResize, 300);
};

function triggerChartResize() {
  Object.values(charts).forEach(chart => {
    if (chart && typeof chart.resize === 'function') {
      chart.resize();
    }
  });
}

// ─── Google Auth - Login, Logout & Auth State Listener ───
window.loginWithGoogle = async function() {
  try {
    await auth.signInWithPopup(provider);
  } catch (err) {
    console.error("Login failed:", err);
    alert("로그인 실패: " + err.message);
  }
};

window.logout = async function() {
  try {
    await auth.signOut();
    currentLoadedName = null;
    holdingsData = [];
    recalculate();
    showModal("로그아웃 완료", "성공적으로 로그아웃되었습니다.");
  } catch (err) {
    console.error("Logout failed:", err);
    alert("로그아웃 실패: " + err.message);
  }
};

auth.onAuthStateChanged(async (user) => {
  const authContainer = document.getElementById('authContainer');
  if (!authContainer) return;
  
  if (user) {
    currentUser = user;
    authContainer.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <img src="${user.photoURL || ''}" referrerpolicy="no-referrer" style="width:32px; height:32px; border-radius:50%; border:1px solid rgba(255,255,255,0.2);">
        <span style="font-size:12px; color:var(--text-primary); font-weight:600; max-width:80px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${user.displayName || '사용자'}">${user.displayName || '사용자'}</span>
        <button class="btn-export" onclick="logout()" style="background:linear-gradient(135deg, #ef4444, #dc2626); padding: 6px 12px; font-size:11px; min-width:auto; border-radius:8px;">로그아웃</button>
      </div>
    `;
    // Load from Firestore
    await loadSavedList();
  } else {
    currentUser = null;
    authContainer.innerHTML = `
      <button class="btn-sync" onclick="loginWithGoogle()" style="background:linear-gradient(135deg, #4285F4, #357AE8); border-radius:12px; padding: 10px 14px;">
        <span class="icon">🔑</span> 구글 로그인
      </button>
    `;
    // Load local list
    await loadSavedList();
  }
});


>>>>>>> master
