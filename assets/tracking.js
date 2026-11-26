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
 * 세 가지 세션 구분은 append-only(보낸 이벤트를 고치지 않음) 방식입니다.
 *   예시만 본 세션(①)  = calc_session_preset 세션 수 − calc_session_preset_modified 세션 수
 *   예시 뒤 수정(②)    = calc_session_preset_modified 세션 수
 *   직접 입력(③)       = calc_session_custom 세션 수
 *   ①+②+③             = calc_complete 세션 수
 *   '예시 → 2.5초 안에 수정'처럼 첫 집계 시점에 이미 수정된 세션은 calc_session_preset 을
 *   보내지 않고 곧바로 calc_session_preset_modified 만 보내므로 위 뺄셈이 어긋나지 않습니다.
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
    sendOnce('complete', 'calc_complete', { calculator_name: name, page_path: path });
    if (mode === 'preset') {
      sendOnce('preset', 'calc_session_preset', {
        calculator_name: name, page_path: path, completion_mode: mode
      });
    } else if (mode === 'preset_modified') {
      sendOnce('preset_modified', 'calc_session_preset_modified', {
        calculator_name: name, page_path: path, completion_mode: mode, from_mode: 'preset'
      });
    } else {
      sendOnce('custom', 'calc_session_custom', {
        calculator_name: name, page_path: path, completion_mode: mode
      });
    }
  }

  function scheduleComplete() {
    if (timer && typeof W.clearTimeout === 'function') W.clearTimeout(timer);
    else if (timer) clearTimeout(timer);
    timer = setTimeout(settle, SETTLE_MS);
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
      sawPreset = true;
      origin = 'preset';
      scheduleComplete();
      return;
    }

    /* 2) 결과 요약·링크 복사 */
    var copy = closestOf(t, '[id$="-copy"]');
    if (copy) {
      send('copy_result', { calculator_name: calcName() });
      return;
    }

    /* 3) 예시로 채우기 — 값을 채우고 계산이 다시 그려진다 */
    if (closestOf(t, '[id$="-example"]')) {
      sawPreset = true;
      origin = 'preset';
      scheduleComplete();
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

    /* 5) 하단 연관 도구 카드 */
    var link = closestOf(t, '.next-tools a');
    if (link) {
      send('related_click', {
        from_page: here(),
        to_page: pageOf(link.getAttribute('href') || link.href)
      });
    }
  }, false);
})();
