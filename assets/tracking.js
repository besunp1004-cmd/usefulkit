/* 킷랩(KitLab) — GA4 익명 행동 이벤트
 *
 * 보내는 것: 이벤트 이름, 계산기 이름(페이지 파일명), 페이지 경로, 프리셋 버튼 글자.
 * 보내지 않는 것: 연봉·대출액·보증금 등 사용자가 입력한 숫자와 그 밖의 개인정보.
 *   입력 요소의 value 는 읽지 않습니다. 결과가 유효하게 그려졌는지는 결과 배너의
 *   클래스(is-empty / mc-v-empty)로만 확인합니다.
 * gtag 가 없으면(스크립트 차단·미설치) 조용히 아무 것도 하지 않습니다.
 *
 * 이벤트
 *   calc_complete          calculator_name, page_path
 *       사용자가 입력을 바꾸거나 '예시로 채우기'·프리셋을 눌러 결과가 유효하게 표시될 때.
 *       타이핑 중 연속 발사를 막으려고 마지막 상호작용 1.2초 뒤에 한 번만 보내고,
 *       같은 계산기에서 10초 안에 또 계산해도 한 번으로 묶습니다(페이지 로드 직후에는 보내지 않음).
 *   copy_result            calculator_name            '결과 요약·링크 복사' 클릭
 *   preset_click           calculator_name, preset_label   인기 조건 프리셋 클릭
 *   related_click          from_page, to_page          하단 .next-tools 연관 도구 카드 클릭
 *   report_interest_click  page                        수요 측정 버튼([data-uk-interest]) 클릭, 방문당 1회
 */
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : null;
  var D = typeof document !== 'undefined' ? document : null;
  if (!W || !D || typeof D.addEventListener !== 'function') return;

  var DEBOUNCE_MS = 1200;
  var COOLDOWN_MS = 10000;

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

  var timer = null;
  var lastFire = 0;

  function scheduleComplete() {
    if (timer) {
      if (typeof W.clearTimeout === 'function') W.clearTimeout(timer);
      else clearTimeout(timer);
    }
    timer = setTimeout(function () {
      timer = null;
      if (!resultShown()) return;
      var now = new Date().getTime();
      if (now - lastFire < COOLDOWN_MS) return;
      lastFire = now;
      send('calc_complete', { calculator_name: calcName(), page_path: here() });
    }, DEBOUNCE_MS);
  }

  function isInput(node) {
    return /^(INPUT|SELECT|TEXTAREA)$/.test(tagNameOf(node));
  }

  D.addEventListener('input', function (e) {
    if (isInput(e.target)) scheduleComplete();
  }, false);

  D.addEventListener('change', function (e) {
    if (isInput(e.target)) scheduleComplete();
  }, false);

  D.addEventListener('click', function (e) {
    var t = e.target;
    if (!t) return;

    /* 1) 인기 조건 프리셋 */
    var chip = closestOf(t, 'button[data-uk-preset]');
    if (chip) {
      send('preset_click', {
        calculator_name: calcName(),
        preset_label: String(chip.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
      });
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
