import requests
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
from urllib.parse import quote
import concurrent.futures
import os
import json

app = Flask(__name__)
CORS(app)

SAVED_DIR = "saved_portfolios"
if not os.path.exists(SAVED_DIR):
    os.makedirs(SAVED_DIR)

@app.route('/save', methods=['POST'])
def save_portfolio():
    try:
        data = request.json
        name = data.get('name')
        content = data.get('data')
        if not name or not content:
            return jsonify({"success": False, "error": "Name and data are required"}), 400
        
        # 보안을 위해 파일명 정제 (단순화)
        safe_name = "".join([c for c in name if c.isalnum() or c in (' ', '-', '_')]).strip()
        if not safe_name:
            safe_name = "unnamed_portfolio"
            
        file_path = os.path.join(SAVED_DIR, f"{safe_name}.json")
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(content, f, ensure_ascii=False, indent=2)
            
        return jsonify({"success": True, "name": safe_name})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/list', methods=['GET'])
def list_portfolios():
    try:
        files = [f.replace('.json', '') for f in os.listdir(SAVED_DIR) if f.endswith('.json')]
        # 최신 저장 파일이 위로 오게 정렬 (파일 수정 시간 기준)
        files.sort(key=lambda x: os.path.getmtime(os.path.join(SAVED_DIR, f"{x}.json")), reverse=True)
        return jsonify({"success": True, "files": files})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/load/<name>', methods=['GET'])
def load_portfolio(name):
    try:
        file_path = os.path.join(SAVED_DIR, f"{name}.json")
        if not os.path.exists(file_path):
            return jsonify({"success": False, "error": "File not found"}), 404
            
        with open(file_path, 'r', encoding='utf-8') as f:
            content = json.load(f)
            
        return jsonify({"success": True, "data": content})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/delete/<name>', methods=['DELETE'])
def delete_portfolio(name):
    try:
        file_path = os.path.join(SAVED_DIR, f"{name}.json")
        if os.path.exists(file_path):
            os.remove(file_path)
            return jsonify({"success": True})
        return jsonify({"success": False, "error": "File not found"}), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# 야후 파이낸스용 헤더
YAHOO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com/'
}

# 네이버 증권용 헤더 (Referer가 네이버여야 차단 안됨)
NAVER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.naver.com/'
}

def try_fetch(symbol):
    """야후 파이낸스로 시세 조회"""
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol)}?interval=1m&range=1d"
        response = requests.get(url, headers=YAHOO_HEADERS, timeout=5)
        if response.status_code == 200:
            data = response.json()
            meta = data['chart']['result'][0]['meta']
            return {
                "symbol": symbol,
                "regularMarketPrice": meta.get('regularMarketPrice') or meta.get('chartPreviousClose')
            }
    except:
        pass
    return None

def clean_naver_code(symbol):
    """
    네이버용 종목코드 정제
    순서: .KS/.KQ 접미사 제거 → 알파벳+숫자만 추출 → 순수숫자면 6자리 패딩
    (isalnum 전에 접미사 제거해야 '005930KS' 같은 버그 방지)
    """
    code = symbol.upper().replace('.KS', '').replace('.KQ', '')
    code = "".join(c for c in code if c.isalnum())
    if len(code) < 5:
        return None
    if code.isdigit():
        code = code.zfill(6)
    return code

def try_naver_realtime(code, symbol):
    """
    네이버 실시간 polling API - 장중에만 동작
    장외시간에는 areas가 빈 배열로 와서 None 반환
    """
    try:
        api_url = f"https://polling.finance.naver.com/api/realtime/get?itemCode={code}"
        res = requests.get(api_url, headers=NAVER_HEADERS, timeout=3)
        if res.status_code == 200:
            data = res.json()
            if data.get('resultCode') == 'success' and data['result'].get('areas'):
                price_data = data['result']['areas'][0]['datas'][0]
                price = float(price_data['nv'])
                print(f"[네이버 실시간] {symbol} ({code}): {price}")
                return {"symbol": symbol, "regularMarketPrice": price}
    except:
        pass
    return None

def try_naver_basic(code, symbol):
    """
    네이버 증권 기본 시세 페이지 - 장외시간에도 전일종가 제공
    실시간 polling 실패 시 백업으로 사용
    """
    try:
        api_url = f"https://finance.naver.com/item/main.naver?code={code}"
        res = requests.get(api_url, headers=NAVER_HEADERS, timeout=5)
        if res.status_code == 200:
            # 현재가(또는 전일종가) 파싱
            match = re.search(
                r'<p[^>]*class="no_today"[^>]*>.*?<span[^>]*class="blind"[^>]*>([\d,]+)</span>',
                res.text, re.DOTALL
            )
            if match:
                price = float(match.group(1).replace(',', ''))
                print(f"[네이버 기본] {symbol} ({code}): {price}")
                return {"symbol": symbol, "regularMarketPrice": price}
    except:
        pass
    return None

def try_naver_fetch(symbol):
    """
    네이버 증권 시세 조회 (2단계)
    1차: 실시간 polling API (장중)
    2차: 기본 시세 페이지 (장외시간 전일종가 백업)
    """
    code = clean_naver_code(symbol)
    if not code:
        return None

    result = try_naver_realtime(code, symbol)
    if result:
        return result

    result = try_naver_basic(code, symbol)
    if result:
        return result

    print(f"[네이버 실패] {symbol} ({code}): 실시간/기본 모두 실패")
    return None

def try_naver_metal(symbol):
    """네이버 금 시세 M04020000 파싱"""
    if symbol != "M04020000":
        return None
    try:
        url = "https://m.stock.naver.com/marketindex/metals/M04020000"
        res = requests.get(url, headers=NAVER_HEADERS, timeout=5)
        if res.status_code == 200:
            match = re.search(r'"closePrice"\s*:\s*"([\d,.]+)"', res.text)
            if match:
                price = float(match.group(1).replace(',', ''))
                print(f"[네이버 금 시세] {symbol}: {price}")
                return {"symbol": symbol, "regularMarketPrice": price}
    except:
        pass
    return None


def get_single_price(symbol):
    if symbol == "M04020000":
        res = try_naver_metal(symbol)
        if res: return res
        
    # 1. 야후 파이낸스 먼저 시도
    res = try_fetch(symbol)
    if res and res.get('regularMarketPrice'):
        return res

    # 2. 한국 종목 판별
    #    - .KS/.KQ 접미사 있음
    #    - 순수 숫자 코드
    #    - 혼합 6자리 코드 (앞 4자리가 숫자: 0131V0 패턴)
    clean = symbol.replace('.KS', '').replace('.KQ', '')
    is_korean = (
        '.KS' in symbol or
        '.KQ' in symbol or
        symbol.isdigit() or
        (len(clean) == 6 and clean[:4].isdigit())
    )

    if is_korean:
        res = try_naver_fetch(symbol)
        if res:
            return res

    # 3. 코스피 실패 시 코스닥으로 재시도
    if symbol.endswith('.KS'):
        alt_symbol = symbol.replace('.KS', '.KQ')
        res = try_fetch(alt_symbol)
        if res:
            res["symbol"] = symbol
            return res

    return None

@app.route('/sync', methods=['GET'])
def sync():
    symbols_str = request.args.get('symbols')
    if not symbols_str:
        return jsonify({"error": "No symbols provided"}), 400

    symbols = symbols_str.split(',')
    results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        future_to_symbol = {executor.submit(get_single_price, s): s for s in symbols}
        for future in concurrent.futures.as_completed(future_to_symbol):
            res = future.result()
            if res:
                results.append(res)
            else:
                print(f"[최종 실패] {future_to_symbol[future]}")

    return jsonify({"quoteResponse": {"result": results}})

@app.route('/exchange', methods=['GET'])
def exchange():
    try:
        url = "https://query1.finance.yahoo.com/v8/finance/chart/USDKRW=X?interval=1m&range=1d"
        response = requests.get(url, headers=YAHOO_HEADERS, timeout=5)
        if response.status_code == 200:
            return jsonify(response.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"error": "Failed to fetch exchange rate"}), 500

if __name__ == '__main__':
    print("========================================")
    print("Portfolio Sync Server (v7: Naver Dual API) is running!")
    print("조회 순서: 야후 → 네이버 실시간 → 네이버 기본시세")
    print("혼합코드 ETF(0131V0 등) 및 장외시간 지원")
    print("========================================")
    app.run(port=5000)
