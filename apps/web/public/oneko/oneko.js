// oneko.js: https://github.com/adryd325/oneko.js
//
// optional data attributes:
// data-cat: sprite gif path
// data-nap-style: tooltip|ring|halo|pixel|moon|ticks|random|off
// data-nap-seconds: 3 to 300
// data-nap-edge: px from window edge

(function oneko() {
  const isReducedMotion =
    window.matchMedia(`(prefers-reduced-motion: reduce)`) === true ||
    window.matchMedia(`(prefers-reduced-motion: reduce)`).matches === true;

  const curScript = document.currentScript;

  if (isReducedMotion) return;
  if (document.getElementById('oneko')) return;

  const ds = (curScript && curScript.dataset) || {};

  // localStorage throws when site data is blocked
  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* nothing to do */ }
  }

  const NAP_STYLES = ['tooltip', 'ring', 'halo', 'pixel', 'moon', 'ticks'];
  let napStyleCfg = (ds.napStyle || 'ticks').trim().toLowerCase();
  if (
    napStyleCfg !== 'random' &&
    napStyleCfg !== 'off' &&
    NAP_STYLES.indexOf(napStyleCfg) === -1
  ) {
    napStyleCfg = 'ticks';
  }
  const napsEnabled = napStyleCfg !== 'off';
  const napSeconds = Math.min(300, Math.max(3, parseInt(ds.napSeconds || '30', 10) || 30));
  const napDurationMs = napSeconds * 1000;
  const napHintMargin = 220;
  const napEdgeMargin = Math.min(
    napHintMargin - 24,
    Math.max(24, parseInt(ds.napEdge || '64', 10) || 64)
  );
  const RING_C = 188.5;

  let napUntil = 0;
  let napFrame = 0;
  let mode = 'ticks';

  const nekoEl = document.createElement('div');

  let savedPos = null;
  try {
    const parsed = JSON.parse(readStore('oneko-pos') || 'null');
    if (parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) savedPos = parsed;
  } catch (e) { /* malformed */ }
  let nekoPosX = Math.min(Math.max(16, savedPos ? savedPos.x : 32), window.innerWidth - 16);
  let nekoPosY = Math.min(Math.max(16, savedPos ? savedPos.y : 32), window.innerHeight - 16);

  let mousePosX = nekoPosX;
  let mousePosY = nekoPosY;

  let frameCount = 0;
  let idleTime = 0;
  let idleAnimation = null;
  let idleAnimationFrame = 0;
  let isDragging = false;
  let dragMoved = false;

  nekoEl.innerHTML =
    '<span id="cat-bubble" hidden><span class="oneko-nb-count">30s</span></span>' +
    '<span id="nk-ring" hidden><svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="30" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2.5"></circle><circle id="nk-ring-arc" cx="42" cy="42" r="30" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="188.5" stroke-dashoffset="0" transform="rotate(-90 42 42)"></circle></svg><b id="nk-ring-secs">30s</b></span>' +
    '<span id="nk-px" hidden><span class="px-tail1"></span><span class="px-tail2"></span><span class="px-z">Zz</span><span class="px-bar"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></span></span>' +
    '<span id="nk-moon" hidden><svg width="128" height="76" viewBox="0 0 128 76" aria-hidden="true"><path d="M 14 66 A 50 50 0 0 1 114 66" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="1" stroke-dasharray="2 5"></path><circle class="nk-star" cx="36" cy="28" r="1.3"></circle><circle class="nk-star s2" cx="64" cy="13" r="1.6"></circle><circle class="nk-star s3" cx="94" cy="30" r="1.2"></circle><g id="nk-moon-g"><circle r="7" fill="#e5e5eb"></circle><circle r="7" fill="#0a0a0a" cx="4.5" cy="-3"></circle></g></svg></span>' +
    '<span id="nk-ticks" hidden><svg width="96" height="96" viewBox="0 0 96 96" id="nk-ticks-svg" aria-hidden="true"></svg></span>';

  const bubble = nekoEl.querySelector('#cat-bubble');
  const bubbleCount = nekoEl.querySelector('.oneko-nb-count');
  const ringEl = nekoEl.querySelector('#nk-ring');
  const ringArc = nekoEl.querySelector('#nk-ring-arc');
  const ringSecs = nekoEl.querySelector('#nk-ring-secs');
  const pxEl = nekoEl.querySelector('#nk-px');
  const pxBlocks = nekoEl.querySelectorAll('.px-bar span');
  const moonEl = nekoEl.querySelector('#nk-moon');
  const moonG = nekoEl.querySelector('#nk-moon-g');
  const ticksEl = nekoEl.querySelector('#nk-ticks');
  const ticksSvg = nekoEl.querySelector('#nk-ticks-svg');
  const tickLines = [];
  let haloEl = null;
  let barMsg = null;

  const nekoSpeed = 10;
  const spriteSets = {
    idle: [[-3, -3]],
    alert: [[-7, -3]],
    scratchSelf: [
      [-5, 0],
      [-6, 0],
      [-7, 0],
    ],
    scratchWallN: [
      [0, 0],
      [0, -1],
    ],
    scratchWallS: [
      [-7, -1],
      [-6, -2],
    ],
    scratchWallE: [
      [-2, -2],
      [-2, -3],
    ],
    scratchWallW: [
      [-4, 0],
      [-4, -1],
    ],
    tired: [[-3, -2]],
    sleeping: [
      [-2, 0],
      [-2, -1],
    ],
    N: [
      [-1, -2],
      [-1, -3],
    ],
    NE: [
      [0, -2],
      [0, -3],
    ],
    E: [
      [-3, 0],
      [-3, -1],
    ],
    SE: [
      [-5, -1],
      [-5, -2],
    ],
    S: [
      [-6, -3],
      [-7, -2],
    ],
    SW: [
      [-5, -3],
      [-6, -1],
    ],
    W: [
      [-4, -2],
      [-4, -3],
    ],
    NW: [
      [-1, 0],
      [-1, -1],
    ],
  };

  function distToEdge() {
    return Math.min(
      nekoPosX,
      nekoPosY,
      window.innerWidth - nekoPosX,
      window.innerHeight - nekoPosY
    );
  }

  function isNearEdge() {
    return distToEdge() < napEdgeMargin;
  }

  function isHidden() {
    return nekoEl.style.display === 'none';
  }

  function hideAllIndicators() {
    bubble.hidden = true;
    ringEl.hidden = true;
    pxEl.hidden = true;
    moonEl.hidden = true;
    ticksEl.hidden = true;
    if (haloEl) haloEl.hidden = true;
  }

  function showIndicator() {
    hideAllIndicators();
    if (!napUntil) return;
    if (mode === 'tooltip') bubble.hidden = false;
    if (mode === 'ring') ringEl.hidden = false;
    if (mode === 'pixel') pxEl.hidden = false;
    if (mode === 'moon') moonEl.hidden = false;
    if (mode === 'ticks') ticksEl.hidden = false;
    if (mode === 'halo' && haloEl) {
      haloEl.style.left = nekoPosX + 'px';
      haloEl.style.top = nekoPosY + 'px';
      haloEl.hidden = false;
    }
  }

  function updateIndicator(remaining) {
    const f = Math.max(0, remaining / napDurationMs);
    const secs = Math.ceil(remaining / 1000) + 's';
    bubbleCount.textContent = secs;
    bubble.style.setProperty('--nb-p', (f * 100).toFixed(1) + '%');
    ringArc.setAttribute('stroke-dashoffset', (RING_C * (1 - f)).toFixed(1));
    ringSecs.textContent = secs;
    if (haloEl) haloEl.style.opacity = (0.35 + 0.65 * f).toFixed(2);
    const on = Math.round(f * 10);
    for (let i = 0; i < 10; i++) pxBlocks[i].className = i < on ? 'on' : '';
    const ma = (1 - f) * Math.PI;
    moonG.setAttribute('transform', 'translate(' + (64 - Math.cos(ma) * 50).toFixed(1) + ',' + (66 - Math.sin(ma) * 50).toFixed(1) + ')');
    const tOn = Math.ceil(f * 30);
    for (let i = 0; i < 30; i++) tickLines[i].style.opacity = i < tOn ? '1' : '.14';
  }

  function maybeStartNap() {
    if (!napsEnabled || !isNearEdge()) return;
    mode = napStyleCfg === 'random'
      ? NAP_STYLES[Math.floor(Math.random() * NAP_STYLES.length)]
      : napStyleCfg;
    napUntil = Date.now() + napDurationMs;
    napFrame = 0;
    nekoEl.classList.toggle('nk-flip', nekoPosY < 96);
    const halfW = 72;
    let shift = 0;
    if (nekoPosX < halfW) shift = halfW - nekoPosX;
    else if (nekoPosX > window.innerWidth - halfW) shift = window.innerWidth - halfW - nekoPosX;
    nekoEl.style.setProperty('--nk-shift', shift.toFixed(0) + 'px');
    nekoEl.style.setProperty('--nk-drop', Math.max(0, 88 - nekoPosY).toFixed(0) + 'px');
    updateIndicator(napDurationMs);
    showIndicator();
  }

  function wakeUp() {
    napUntil = 0;
    napFrame = 0;
    nekoEl.classList.remove('nk-flip');
    nekoEl.style.setProperty('--nk-shift', '0px');
    nekoEl.style.setProperty('--nk-drop', '0px');
    hideAllIndicators();
    document.querySelectorAll('.oneko-zz').forEach((z) => z.remove());
  }

  function spawnZ() {
    const z = document.createElement('span');
    z.className = 'oneko-zz';
    z.textContent = 'z';
    z.style.left = (nekoPosX + 10) + 'px';
    z.style.top = (nekoPosY - 30) + 'px';
    document.body.appendChild(z);
    setTimeout(() => z.remove(), 1600);
  }

  function updateZoneUI() {
    const near = napsEnabled && isDragging && distToEdge() < napHintMargin;
    const ready = napsEnabled && isDragging && isNearEdge();
    document.body.classList.toggle('oneko-in-zone', near);
    document.body.classList.toggle('oneko-bar-ready', ready);
    if (near && barMsg) {
      barMsg.textContent = ready
        ? "let go — I'll nap right here"
        : 'keep going — drop me at the edge';
    }
  }

  function setDragUI(on) {
    document.body.classList.toggle('oneko-dragging', on && napsEnabled);
    if (!on) {
      document.body.classList.remove('oneko-in-zone');
      document.body.classList.remove('oneko-bar-ready');
    }
  }

  function installFeatureUI() {
    const style = document.createElement('style');
    style.textContent = `
      #oneko [hidden],#nk-halo[hidden]{display:none!important}
      #oneko span,#oneko svg,#oneko b{pointer-events:none}
      .oneko-blur{position:fixed;inset:0;opacity:0;visibility:hidden;transition:opacity .3s ease,visibility .3s;pointer-events:none;z-index:2147483000}
      .oneko-blur-1{backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);-webkit-mask-image:radial-gradient(ellipse at center,transparent 52%,#000 76%);mask-image:radial-gradient(ellipse at center,transparent 52%,#000 76%)}
      .oneko-blur-2{backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);-webkit-mask-image:radial-gradient(ellipse at center,transparent 62%,#000 86%);mask-image:radial-gradient(ellipse at center,transparent 62%,#000 86%)}
      .oneko-blur-3{backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);background:rgba(255,255,255,0.04);-webkit-mask-image:radial-gradient(ellipse at center,transparent 72%,#000 96%);mask-image:radial-gradient(ellipse at center,transparent 72%,#000 96%)}
      body.oneko-dragging .oneko-blur{opacity:1;visibility:visible}
      .oneko-bar{position:fixed;bottom:calc(20px + env(safe-area-inset-bottom));left:50%;display:flex;align-items:center;gap:10px;opacity:0;visibility:hidden;transform:translate(-50%,16px) scale(.95);transition:opacity .35s cubic-bezier(.34,1.56,.64,1),transform .35s cubic-bezier(.34,1.56,.64,1),visibility .35s;background:rgba(23,23,23,.72);backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);border:1px solid rgba(255,255,255,.12);box-shadow:0 12px 32px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.08);color:#e5e5e5;border-radius:999px;padding:9px 10px 9px 16px;font:500 13px/1 system-ui,-apple-system,sans-serif;pointer-events:none;z-index:2147483100;white-space:nowrap;max-width:94vw}
      body.oneko-in-zone .oneko-bar{opacity:1;visibility:visible;transform:translate(-50%,0) scale(1)}
      body.oneko-bar-ready .oneko-bar{border-color:rgba(52,211,153,.45)}
      body.oneko-bar-ready .oneko-bar-chip{color:#34d399;border-color:rgba(52,211,153,.35)}
      .oneko-bar-cat{font:500 12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#34d399}
      .oneko-bar-chip{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.06);border-radius:999px;padding:4px 10px;font-size:11.5px;color:#a3a3a3;font-variant-numeric:tabular-nums}
      #cat-bubble{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(calc(-50% + var(--nk-shift,0px)));display:flex;align-items:center;background:rgba(23,23,23,.72);backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);box-shadow:0 8px 24px rgba(0,0,0,.4),inset 0 0 0 1px rgba(255,255,255,.07);border-radius:999px;padding:2px 7px 3px;white-space:nowrap;animation:oneko-pop .3s cubic-bezier(.34,1.56,.64,1)}
      #cat-bubble::before{content:'';position:absolute;inset:0;border-radius:999px;padding:1.25px;background:conic-gradient(from 0deg,#34d399 var(--nb-p,100%),rgba(255,255,255,.10) 0);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;pointer-events:none}
      #oneko.nk-flip #cat-bubble{bottom:auto;top:calc(100% + 6px);animation-name:oneko-pop-d}
      .oneko-nb-count{font:500 11px/1.2 system-ui,-apple-system,sans-serif;color:#f4f4f5;font-variant-numeric:tabular-nums}
      #nk-ring{position:absolute;left:50%;top:50%;width:84px;height:84px;margin:-42px 0 0 -42px;animation:nk-scale .3s cubic-bezier(.34,1.56,.64,1)}
      #nk-ring-arc{transition:stroke-dashoffset .15s linear}
      #nk-ring-secs{position:absolute;top:calc(100% - 8px);left:50%;transform:translateX(-50%);font:500 12px system-ui,-apple-system,sans-serif;color:#a3a3a3;font-variant-numeric:tabular-nums;opacity:0;transition:opacity .2s}
      #oneko:hover #nk-ring-secs{opacity:1}
      #nk-halo{position:fixed;z-index:2147483640;pointer-events:none;width:0;height:0;transition:opacity .3s}
      #nk-halo b{position:absolute;left:0;top:0;width:150px;height:150px;margin:-75px 0 0 -75px;border-radius:50%;background:radial-gradient(circle,rgba(52,211,153,.30),rgba(52,211,153,0) 68%);animation:nk-breath 3s ease-in-out infinite}
      #nk-px{position:absolute;bottom:calc(100% + 16px);left:50%;transform:translateX(calc(-50% + var(--nk-shift,0px)));display:flex;align-items:center;gap:7px;background:#18181b;border:2px solid #52525b;padding:6px 9px;white-space:nowrap;animation:oneko-pop .3s cubic-bezier(.34,1.56,.64,1)}
      .px-tail1{position:absolute;bottom:-8px;left:50%;margin-left:-10px;width:6px;height:6px;background:#52525b;transform:translateX(calc(0px - var(--nk-shift,0px)))}
      .px-tail2{position:absolute;bottom:-14px;left:50%;margin-left:-4px;width:4px;height:4px;background:#52525b;transform:translateX(calc(0px - var(--nk-shift,0px)))}
      #oneko.nk-flip #nk-px{bottom:auto;top:calc(100% + 16px);animation-name:oneko-pop-d}
      #oneko.nk-flip .px-tail1{bottom:auto;top:-8px}
      #oneko.nk-flip .px-tail2{bottom:auto;top:-14px}
      .px-z{font:500 11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#34d399}
      .px-bar{display:flex;gap:2px}
      .px-bar span{width:5px;height:9px;background:#3f3f46}
      .px-bar span.on{background:#34d399}
      #nk-moon{position:absolute;bottom:calc(100% - 10px);left:50%;transform:translateX(calc(-50% + var(--nk-shift,0px))) translateY(var(--nk-drop,0px));animation:nk-moonpop .3s cubic-bezier(.34,1.56,.64,1)}
      .nk-star{fill:rgba(255,255,255,.75);animation:nk-twinkle 2.2s ease-in-out infinite}
      .nk-star.s2{animation-delay:.7s}
      .nk-star.s3{animation-delay:1.3s}
      #nk-ticks{position:absolute;left:50%;top:50%;width:96px;height:96px;margin:-48px 0 0 -48px;animation:nk-scale .3s cubic-bezier(.34,1.56,.64,1)}
      #nk-ticks line{stroke:#34d399;stroke-width:2;stroke-linecap:round;transition:opacity .3s}
      .oneko-zz{position:fixed;z-index:2147483200;font:500 15px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#a3a3a3;pointer-events:none;animation:oneko-zrise 1.6s ease-out forwards}
      /* light theme: the indicators are drawn for a dark page */
      /* first-of-type keeps this on the track, not the arc */
      html:not(.dark) #nk-ring circle:first-of-type{stroke:rgba(17,17,22,.16)}
      html:not(.dark) #nk-ring-arc,html:not(.dark) #nk-ticks line{stroke:#059669}
      html:not(.dark) #nk-moon path{stroke:rgba(17,17,22,.16)}
      html:not(.dark) .nk-star{fill:rgba(17,17,22,.5)}
      html:not(.dark) #nk-moon-g circle:first-child{fill:#3f3f46}
      html:not(.dark) #nk-moon-g circle:last-child{fill:#fff}
      html:not(.dark) #nk-ring-secs,html:not(.dark) .oneko-zz{color:#52525b}
      html:not(.dark) #nk-halo b{background:radial-gradient(circle,rgba(5,150,105,.28),rgba(5,150,105,0) 68%)}
      @keyframes oneko-pop{from{opacity:0;transform:translateX(calc(-50% + var(--nk-shift,0px))) translateY(5px) scale(.85)}to{opacity:1;transform:translateX(calc(-50% + var(--nk-shift,0px))) translateY(0) scale(1)}}
      @keyframes oneko-pop-d{from{opacity:0;transform:translateX(calc(-50% + var(--nk-shift,0px))) translateY(-5px) scale(.85)}to{opacity:1;transform:translateX(calc(-50% + var(--nk-shift,0px))) translateY(0) scale(1)}}
      @keyframes nk-scale{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}
      @keyframes nk-moonpop{from{opacity:0;transform:translateX(calc(-50% + var(--nk-shift,0px))) translateY(var(--nk-drop,0px)) scale(.9)}to{opacity:1;transform:translateX(calc(-50% + var(--nk-shift,0px))) translateY(var(--nk-drop,0px)) scale(1)}}
      @keyframes nk-breath{0%,100%{transform:scale(1)}50%{transform:scale(1.22)}}
      @keyframes nk-twinkle{0%,100%{opacity:.25}50%{opacity:.9}}
      @keyframes oneko-zrise{from{opacity:.95;transform:translate(0,0)}to{opacity:0;transform:translate(16px,-36px)}}
    `;
    document.head.appendChild(style);

    [1, 2, 3].forEach(function (layer) {
      const el = document.createElement('div');
      el.className = 'oneko-blur oneko-blur-' + layer;
      document.body.appendChild(el);
    });

    const bar = document.createElement('div');
    bar.className = 'oneko-bar';
    bar.innerHTML =
      '<span class="oneko-bar-cat">=^..^=</span>' +
      '<span class="oneko-bar-msg">let go — I\'ll nap right here</span>' +
      '<span class="oneko-bar-chip">' + napSeconds + 's</span>';
    document.body.appendChild(bar);
    barMsg = bar.querySelector('.oneko-bar-msg');

    haloEl = document.createElement('div');
    haloEl.id = 'nk-halo';
    haloEl.hidden = true;
    haloEl.innerHTML = '<b></b>';
    document.body.appendChild(haloEl);

    for (let i = 0; i < 30; i++) {
      const ta = (i / 30) * Math.PI * 2 - Math.PI / 2;
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', (48 + Math.cos(ta) * 38).toFixed(1));
      l.setAttribute('y1', (48 + Math.sin(ta) * 38).toFixed(1));
      l.setAttribute('x2', (48 + Math.cos(ta) * 44).toFixed(1));
      l.setAttribute('y2', (48 + Math.sin(ta) * 44).toFixed(1));
      ticksSvg.appendChild(l);
      tickLines.push(l);
    }
  }

  function init() {
    nekoEl.id = 'oneko';
    nekoEl.ariaHidden = true;
    nekoEl.style.width = '32px';
    nekoEl.style.height = '32px';
    nekoEl.style.position = 'fixed';
    nekoEl.style.pointerEvents = 'auto';
    nekoEl.style.imageRendering = 'pixelated';
    nekoEl.style.left = `${nekoPosX - 16}px`;
    nekoEl.style.top = `${nekoPosY - 16}px`;
    nekoEl.style.zIndex = 2147483647;
    nekoEl.style.touchAction = 'none';

    let nekoFile = './oneko.gif';
    if (curScript && curScript.dataset.cat) {
      nekoFile = curScript.dataset.cat;
    }
    nekoEl.style.backgroundImage = `url(${nekoFile})`;

    document.body.appendChild(nekoEl);

    installFeatureUI();

    document.addEventListener('mousemove', function (event) {
      mousePosX = event.clientX;
      mousePosY = event.clientY;
    });

    nekoEl.style.cursor = 'grab';
    nekoEl.addEventListener('mousedown', function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      isDragging = true;
      dragMoved = false;
      wakeUp();
      nekoEl.style.cursor = 'grabbing';
      setDragUI(true);
      updateZoneUI();
    });

    function endDrag(startNap) {
      if (!isDragging) return;
      isDragging = false;
      nekoEl.style.cursor = 'grab';
      setDragUI(false);
      if (startNap && dragMoved) maybeStartNap();
    }

    document.addEventListener('mousemove', function (event) {
      if (!isDragging) return;
      // a mouseup outside the window never reaches us
      if (event.buttons === 0) {
        endDrag(true);
        return;
      }
      dragMoved = true;
      nekoPosX = event.clientX;
      nekoPosY = event.clientY;
      nekoEl.style.left = `${nekoPosX - 16}px`;
      nekoEl.style.top = `${nekoPosY - 16}px`;
      savePos();
      updateZoneUI();
    });

    document.addEventListener('mouseup', function () { endDrag(true); });
    window.addEventListener('blur', function () { endDrag(false); });

    nekoEl.addEventListener('touchstart', function (event) {
      event.preventDefault();
      isDragging = true;
      dragMoved = false;
      wakeUp();
      setDragUI(true);
      const touch = event.touches[0];
      nekoPosX = touch.clientX;
      nekoPosY = touch.clientY;
      updateZoneUI();
    }, { passive: false });

    document.addEventListener('touchmove', function (event) {
      if (isDragging) {
        dragMoved = true;
        const touch = event.touches[0];
        nekoPosX = touch.clientX;
        nekoPosY = touch.clientY;
        nekoEl.style.left = `${nekoPosX - 16}px`;
        nekoEl.style.top = `${nekoPosY - 16}px`;
        savePos();
        updateZoneUI();
      }
    }, { passive: true });

    document.addEventListener('touchend', function () { endDrag(true); });
    document.addEventListener('touchcancel', function () { endDrag(false); });

    window.requestAnimationFrame(onAnimationFrame);
  }

  let lastFrameTimestamp;

  function onAnimationFrame(timestamp) {
    // Stops execution if the neko element is removed from DOM
    if (!nekoEl.isConnected) {
      return;
    }
    if (!lastFrameTimestamp) {
      lastFrameTimestamp = timestamp;
    }
    if (timestamp - lastFrameTimestamp > 100) {
      lastFrameTimestamp = timestamp;
      frame();
    }
    window.requestAnimationFrame(onAnimationFrame);
  }

  function setSprite(name, frame) {
    const sprite = spriteSets[name][frame % spriteSets[name].length];
    nekoEl.style.backgroundPosition = `${sprite[0] * 32}px ${sprite[1] * 32}px`;
  }

  function resetIdleAnimation() {
    idleAnimation = null;
    idleAnimationFrame = 0;
  }

  function idle() {
    idleTime += 1;

    // every ~ 20 seconds
    if (
      idleTime > 10 &&
      Math.floor(Math.random() * 200) == 0 &&
      idleAnimation == null
    ) {
      let avalibleIdleAnimations = ['sleeping', 'scratchSelf'];
      if (nekoPosX < 32) {
        avalibleIdleAnimations.push('scratchWallW');
      }
      if (nekoPosY < 32) {
        avalibleIdleAnimations.push('scratchWallN');
      }
      if (nekoPosX > window.innerWidth - 32) {
        avalibleIdleAnimations.push('scratchWallE');
      }
      if (nekoPosY > window.innerHeight - 32) {
        avalibleIdleAnimations.push('scratchWallS');
      }
      idleAnimation =
        avalibleIdleAnimations[
          Math.floor(Math.random() * avalibleIdleAnimations.length)
        ];
    }

    switch (idleAnimation) {
      case 'sleeping':
        if (idleAnimationFrame < 8) {
          setSprite('tired', 0);
          break;
        }
        setSprite('sleeping', Math.floor(idleAnimationFrame / 4));
        if (idleAnimationFrame > 192) {
          resetIdleAnimation();
        }
        break;
      case 'scratchWallN':
      case 'scratchWallS':
      case 'scratchWallE':
      case 'scratchWallW':
      case 'scratchSelf':
        setSprite(idleAnimation, idleAnimationFrame);
        if (idleAnimationFrame > 9) {
          resetIdleAnimation();
        }
        break;
      default:
        setSprite('idle', 0);
        return;
    }
    idleAnimationFrame += 1;
  }

  function frame() {
    if (isHidden()) {
      if (napUntil) wakeUp();
      return;
    }

    if (isDragging) {
      setSprite('alert', 0);
      return;
    }

    if (napUntil) {
      const remaining = napUntil - Date.now();
      if (remaining > 0) {
        napFrame += 1;
        if (napFrame < 8) {
          setSprite('tired', 0);
        } else {
          setSprite('sleeping', Math.floor(napFrame / 4));
        }
        updateIndicator(remaining);
        if (napFrame === 2 || napFrame % 14 === 0) spawnZ();
        return;
      }
      wakeUp();
      idleTime = 4;
      setSprite('alert', 0);
      return;
    }

    frameCount += 1;
    const diffX = nekoPosX - mousePosX;
    const diffY = nekoPosY - mousePosY;
    const distance = Math.sqrt(diffX ** 2 + diffY ** 2);

    if (distance < nekoSpeed || distance < 48) {
      idle();
      return;
    }

    idleAnimation = null;
    idleAnimationFrame = 0;

    if (idleTime > 1) {
      setSprite('alert', 0);
      // count down after being alerted before moving
      idleTime = Math.min(idleTime, 7);
      idleTime -= 1;
      return;
    }

    let direction;
    direction = diffY / distance > 0.5 ? 'N' : '';
    direction += diffY / distance < -0.5 ? 'S' : '';
    direction += diffX / distance > 0.5 ? 'W' : '';
    direction += diffX / distance < -0.5 ? 'E' : '';
    setSprite(direction, frameCount);

    nekoPosX -= (diffX / distance) * nekoSpeed;
    nekoPosY -= (diffY / distance) * nekoSpeed;

    nekoPosX = Math.min(Math.max(16, nekoPosX), window.innerWidth - 16);
    nekoPosY = Math.min(Math.max(16, nekoPosY), window.innerHeight - 16);

    nekoEl.style.left = `${nekoPosX - 16}px`;
    nekoEl.style.top = `${nekoPosY - 16}px`;
    savePos();
  }

  function savePos() {
    writeStore('oneko-pos', JSON.stringify({ x: nekoPosX, y: nekoPosY }));
  }

  init();
})();
