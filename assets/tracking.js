/* 킷랩(KitLab) — GA4 익명 행동 이벤트
 *
 * 보내는 것: 이벤트 이름, 계산기 이름(페이지 파일명), 페이지 경로, 프리셋 버튼 글자,
 *            결과를 본 경로(예시만 / 예시 뒤 수정 / 직접 입력).
 * 보내지 않는 것: 연봉·대출액·보증금 등 사용자가 입력한 숫자와 그 밖의 개인정보.
 *   입력 요소의 value 는 읽지 않습니다. 결과가 유효하게 그려졌는지는 결과 배너의
 *   클래스(is-empty / mc-v-empty)로만 확인합니다.
 * gtag 가 없으면(스크립트 차단·미설치) 조용히 아무 것도 하지 않습니다.
 *
 * 이벤트
 *   calc_complete          calculator_name, page_path
 *       결과가 유효하게 표시된 '완료 세션' 하나에 한 번. 계산기마다 세션(30분)당 1건.
 *       마지막 상호작용 2.5초 뒤(입력 도중 오발사 방지) 보내고, 같은 계산기에서 다시
 *       계산해도 세션 안에서는 다시 보내지 않습니다(페이지 로드 직후에는 보내지 않음).
 *       ※ 2026-11-26 이전에는 1.2초 디바운스·10초 쿨다운으로 '계산 횟수'가 집계되어
 *         한 세션에 여러 건이 쌓였습니다. 지금은 '세션 수'로 셉니다.
 *   calc_session_preset          calculator_name, page_path, completion_mode='preset'
 *       인기 조건 프리셋(button[data-uk-preset])·'예시로 채우기'([id$="-example"])만으로
 *       결과를 본 세션. 계산기마다 세션당 1건.
 *   calc_session_preset_modified calculator_name, page_path,
 *                                completion_mode='preset_modified', from_mode='preset'
 *       예시를 불러온 뒤 숫자를 직접 바꿔 결과를 본 세션. 세션당 1건.
 *   calc_session_custom          calculator_name, page_path, completion_mode='custom'
 *       처음부터 직접 입력해 결과를 본 세션. 세션당 1건.
 *   copy_result            calculator_name            '결과 요약·링크 복사' 클릭
 *   preset_click           calculator_name, preset_label   인기 조건 프리셋 클릭
 *   related_click          from_page, to_page          하단 .next-tools 연관 도구 카드 클릭
 *   report_interest_click  page                        수요 측정 버튼([data-uk-interest]) 클릭, 방문당 1회
 *
 * 엣지케이스 처리(2026-11-26 추가)
 *   - 한 칸만 넣어 결과가 아직 없을 때 예시를 누르면, 그 미완성 입력 흔적을 지우고 ①(예시)로
 *     셉니다. '직접 입력'은 사용자의 입력으로 첫 유효 결과가 확정될 때만 인정합니다.
 *   - 결과를 2.5초 안에 복사하거나 다른 도구로 이동하거나 페이지를 떠나면(window 의
 *     pagehide·document 의 visibilitychange) 대기 중인 타이머를 기다리지 않고 그 자리에서
 *     완료를 확정합니다.
 *   - 같은 탭에서 새로고침한 뒤 직접 입력을 마치면, 앞서 보낸 모드가 'preset'이면
 *     'preset_modified'(②)로 통합합니다. 이미 ③으로 확정된 세션은 다시 세지 않습니다.
 *     (그래서 ①·②·③의 세션 합계가 calc_complete 와 어긋나지 않습니다)
 *
 * 세 가지 세션 구분은 append-only(보낸 이벤트를 고치지 않음) 방식입니다.
 * 한 세션은 아래 우선순위로 '한 모드에만' 배타적으로 들어갑니다(GA4 리포트 집계 기준).
 *   ② 예시 뒤 수정 = calc_session_preset_modified 가 있는 세션
 *   ③ 직접 입력   = ②가 아닌 세션 중 calc_session_custom 이 있는 세션
 *   ① 예시만     = ②·③이 아닌 세션 중 calc_session_preset 이 있는 세션
 *   ①+②+③       = calc_complete 가 있는 세션 수
 *   뺄셈(전체 preset 세션에서 preset_modified 세션을 빼는 방식)으로 세지 않는 이유: '예시 → 2.5초 안에 수정'
 *   세션은 calc_session_preset 을 보내지 않아 ①이 음수가 되고, 같은 탭에서 앞서 ①을 보낸
 *   세션이 새로고침 뒤 ②로 올라가면 ①·②가 같은 세션에 겹칩니다. 그래서 세션을 먼저 묶고
 *   위 순서로 한 번만 분류합니다.
 */
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : null;
  var D = typeof document !== 'undefined' ? document : null;
  if (!W || !D || typeof D.addEventListener !== 'function') return;

  /* 입력이 끝났다고 보는 조용한 시간. 1.2초는 '40000'처럼 잠깐 쉬며 치는 숫자를
     도중에 완료로 잡을 수 있어 2.5초로 늘렸습니다. */
  var SETTLE_MS = 2500;
  /* GA4 기본 세션 제한시간(30분). 같은 탭에서 30분 안에 다시 계산해도 세션당 1건이고,
     30분이 지난 뒤 다시 찾아오면 새 세션으로 다시 셉니다. */
  var SESSION_MS = 30 * 60 * 1000;

  /* sessionStorage 를 못 쓰는 환경(사생활 보호 모드 등)에서는 페이지 안에서만 기억합니다. */
  var MEM = {};

  function gtagReady() {
    return typeof gtag === 'function';
  }

  function send(name, params) {
    if (!gtagReady()) return false;
    try {
      W.gtag('event', name, params || {});
      return true;
    } catch (e) {
      return false;
    }
  }

  /* '/jeonse-vs-wolse.html' → 'jeonse-vs-wolse' */
  function calcName() {
    var p = (W.location && W.location.pathname) || '/';
    var file = p.replace(/\?.*$/, '').replace(/^.*\//, '').replace(/\.html?$/i, '');
    return file || 'index';
  }

  /* 상대·절대 주소를 사이트 경로(/xxx.html)로 맞춘다. 해시·쿼리는 버린다. */
  function pageOf(href) {
    var url = String(href == null ? '' : href);
    url = url.replace(/^[a-z]+:\/\/[^/]*/i, '');
    url = url.replace(/^\.\//, '');
    if (url.charAt(0) !== '/') url = '/' + url;
    return url.split('#')[0].split('?')[0];
  }

  function here() {
    return pageOf((W.location && W.location.pathname) || '/');
  }

  function matches(node, selector) {
    var fn = node && (node.matches || node.msMatchesSelector || node.webkitMatchesSelector);
    return fn ? fn.call(node, selector) : false;
  }

  /* 이벤트가 발생한 노드에서 selector 에 맞는 가장 가까운 조상(자기 포함)을 찾는다. */
  function closestOf(node, selector) {
    while (node && node !== D) {
      if (node.nodeType === 1 && matches(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function tagNameOf(node) {
    return String((node && node.tagName) || '').toUpperCase();
  }

  /* 결과 배너가 "유효한 결과"를 보여 주는 상태인지. 값은 읽지 않는다. */
  function resultShown() {
    var v = D.querySelector ? D.querySelector('[id$="-verdict"]') : null;
    if (!v) return false;
    var cls = ' ' + String(v.className || '') + ' ';
    if (/ is-empty /.test(cls) || / mc-v-empty /.test(cls)) return false;
    var text = String(v.textContent == null ? v.innerHTML : v.textContent).replace(/\s+/g, '');
    return text.length > 0;
  }

  function now() {
    return new Date().getTime();
  }

  function sget(key) {
    try {
      if (W.sessionStorage) {
        var v = W.sessionStorage.getItem(key);
        if (v !== null && v !== undefined) return String(v);
      }
    } catch (e) { /* 저장소 차단 — 메모리로 폴백 */ }
    return Object.prototype.hasOwnProperty.call(MEM, key) ? MEM[key] : null;
  }

  function sset(key, value) {
    MEM[key] = String(value);
    try {
      if (W.sessionStorage) W.sessionStorage.setItem(key, String(value));
    } catch (e) { /* 저장소 차단 — 메모리에만 남긴다 */ }
  }

  /* 같은 세션(30분) 안에 이미 보냈는지 */
  function sentInSession(bucket) {
    var v = sget('uk_calc_' + bucket + ':' + calcName());
    if (v === null) return false;
    var t = parseFloat(v);
    if (!isFinite(t)) return true;
    return now() - t < SESSION_MS;
  }

  /* 계산기 × 종류마다 세션당 1건만 보낸다. 실제 전송에 성공했을 때만 기록한다. */
  function sendOnce(bucket, name, params) {
    if (sentInSession(bucket)) return false;
    if (!send(name, params)) return false;
    sset('uk_calc_' + bucket + ':' + calcName(), String(now()));
    return true;
  }

  /* 같은 세션(30분) 안에 이미 확정한 완료 모드('preset'|'preset_modified'|'custom').
     새로고침해도 남아, 모드 기록이 모순(①+②+③ ≠ calc_complete)되지 않게 한다. */
  function priorMode() {
    var v = sget('uk_calc_mode:' + calcName());
    if (v === null) return null;
    var cut = String(v).lastIndexOf('|');
    var mode = cut >= 0 ? String(v).slice(0, cut) : String(v);
    var t = parseFloat(cut >= 0 ? String(v).slice(cut + 1) : '');
    if (!isFinite(t) || now() - t >= SESSION_MS) return null;
    return mode || null;
  }

  function recordMode(mode) {
    sset('uk_calc_mode:' + calcName(), mode + '|' + now());
  }

  /* ── 세션 모드 상태 ─────────────────────────────────────────────
     origin      : 마지막으로 결과를 움직인 입력의 출처('preset' | 'input' | null)
     sawPreset   : 이 페이지에서 프리셋·예시를 한 번이라도 불렀는지
     inputFirst  : 프리셋을 부르기 전에 직접 입력이 있었는지(있으면 '직접 입력' 세션)
     modified    : 예시를 부른 뒤 사용자가 직접 숫자를 바꿨는지(되돌리지 않음)
     ──────────────────────────────────────────────────────────── */
  var timer = null;
  var origin = null;
  var sawPreset = false;
  var inputFirst = false;
  var modified = false;

  function completionMode() {
    var fromExample = sawPreset && !inputFirst;
    if (!fromExample) return 'custom';
    return modified ? 'preset_modified' : 'preset';
  }

  function settle() {
    timer = null;
    /* 입력도 프리셋도 없이 페이지 스크립트가 그린 결과는 완료로 세지 않는다. */
    if (origin === null) return;
    if (!resultShown()) return;
    var name = calcName();
    var path = here();
    var mode = completionMode();
    var prior = priorMode();
    /* 이 세션의 완료 모드는 한 번만 정해진다. 새로고침으로 페이지가 새로 뜬 뒤
       직접 입력을 마쳐도, 앞서 ①이었으면 ②(예시를 본 뒤 조정)로 통합하고
       ③·②로 이미 확정된 세션은 다시 세지 않는다. */
    if (prior === 'custom') mode = null;
    else if (prior === 'preset_modified') mode = 'preset_modified';
    else if (prior === 'preset' && mode === 'custom') mode = 'preset_modified';
    sendOnce('complete', 'calc_complete', { calculator_name: name, page_path: path });
    if (mode === null) return;
    if (mode === 'preset') {
      if (sendOnce('preset', 'calc_session_preset', {
        calculator_name: name, page_path: path, completion_mode: mode
      })) recordMode('preset');
    } else if (mode === 'preset_modified') {
      if (sendOnce('preset_modified', 'calc_session_preset_modified', {
        calculator_name: name, page_path: path, completion_mode: mode, from_mode: 'preset'
      })) recordMode('preset_modified');
    } else {
      if (sendOnce('custom', 'calc_session_custom', {
        calculator_name: name, page_path: path, completion_mode: mode
      })) recordMode('custom');
    }
  }

  function scheduleComplete() {
    if (timer && typeof W.clearTimeout === 'function') W.clearTimeout(timer);
    else if (timer) clearTimeout(timer);
    timer = setTimeout(settle, SETTLE_MS);
  }

  /* 대기 중인 완료를 지금 확정한다. 복사·타 도구 이동·페이지 이탈처럼 2.5초를 기다릴 수
     없는 동작에서 부른다. gtag 는 GA4 로 keepalive 요청이라 페이지를 떠난 뒤에도 전송을
     마저 시도한다(별도 sendBeacon 을 쓰면 client_id 가 갈라져 새 세션으로 잡힐 수 있다). */
  function flushPending() {
    if (!timer) return;
    if (!resultShown()) return;
    if (typeof W.clearTimeout === 'function') W.clearTimeout(timer);
    else clearTimeout(timer);
    settle();
  }

  /* 프리셋·예시를 부르면 완료 모드의 출처를 'preset'으로 되돌린다.
     이때 아직 유효한 결과가 없었다면(= 한 칸만 넣은 미완성 입력) 그 흔적을 지운다.
     처음 유효한 결과가 예시로 나온 세션을 '직접 입력'으로 잘못 세지 않기 위해서다. */
  function startPreset() {
    if (!resultShown()) {
      inputFirst = false;
      modified = false;
    }
    sawPreset = true;
    origin = 'preset';
    scheduleComplete();
  }

  function isInput(node) {
    return /^(INPUT|SELECT|TEXTAREA)$/.test(tagNameOf(node));
  }

  /* 프리셋·예시 스크립트가 값을 채우며 dispatchEvent 한 input/change 는 사용자 입력이 아니다.
     (사용자가 실제로 조작한 이벤트는 isTrusted === true) */
  function programmatic(ev) {
    return !!ev && ev.isTrusted === false;
  }

  function onParamChange(e) {
    if (!isInput(e.target)) return;
    if (programmatic(e)) {
      /* 값은 이미 바뀌었고 결과도 다시 그려진다 — 집계 시점만 다시 잡는다. */
      scheduleComplete();
      return;
    }
    origin = 'input';
    if (sawPreset) modified = true;
    else inputFirst = true;
    scheduleComplete();
  }

  D.addEventListener('input', onParamChange, false);
  D.addEventListener('change', onParamChange, false);

  /* 캡처 단계에서 받는다 — 페이지가 값을 채우고 결과를 다시 그리기 전의 상태를 보려면
     버튼 자신의 클릭 처리보다 먼저 실행돼야 한다(프리셋 클릭 전 결과 유무 판정). */
  D.addEventListener('click', function (e) {
    var t = e.target;
    if (!t) return;

    /* 1) 인기 조건 프리셋 — 예시를 불러온 것으로 센다 */
    var chip = closestOf(t, 'button[data-uk-preset]');
    if (chip) {
      send('preset_click', {
        calculator_name: calcName(),
        preset_label: String(chip.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
      });
      startPreset();
      return;
    }

    /* 2) 결과 요약·링크 복사 — 복사하면 대기를 끝내고 지금 확정한다 */
    var copy = closestOf(t, '[id$="-copy"]');
    if (copy) {
      flushPending();
      send('copy_result', { calculator_name: calcName() });
      return;
    }

    /* 3) 예시로 채우기 — 값을 채우고 계산이 다시 그려진다 */
    if (closestOf(t, '[id$="-example"]')) {
      startPreset();
      return;
    }

    /* 4) 유료 수요 측정 버튼 — 방문당 1회만 집계(안내 문구 표시는 페이지 스크립트가 맡는다) */
    var interest = closestOf(t, '[data-uk-interest]');
    if (interest) {
      if (interest.getAttribute('data-uk-interest-sent') === '1') return;
      var page = interest.getAttribute('data-uk-interest') || calcName();
      if (send('report_interest_click', { page: page })) {
        interest.setAttribute('data-uk-interest-sent', '1');
      }
      return;
    }

    /* 5) 하단 연관 도구 카드 — 다른 도구로 떠나기 전에 완료를 확정한다 */
    var link = closestOf(t, '.next-tools a');
    if (link) {
      flushPending();
      send('related_click', {
        from_page: here(),
        to_page: pageOf(link.getAttribute('href') || link.href)
      });
    }
  }, true);

  /* 페이지를 떠나는 순간에도 결과가 유효하면 완료를 확정한다.
     pagehide 는 document 가 아니라 window 이벤트라 window 에 직접 건다(캡처·버블링 없음).
     visibilitychange 는 document 이벤트이므로 그대로 document 에 둔다. */
  if (typeof W.addEventListener === 'function') W.addEventListener('pagehide', flushPending, false);
  D.addEventListener('visibilitychange', function () {
    if (D.visibilityState === 'hidden' || D.hidden === true) flushPending();
  }, false);
})();
