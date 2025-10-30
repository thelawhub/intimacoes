// ==UserScript==
// @name         Projudi – Intimações em Página Única
// @namespace    projudi-intimacao-unica
// @version      2.2.1
// @description  Remove a paginação, agrega todas as intimações e exporta CSV.
// @updateURL    https://gitlab.com/-/snippets/4899368/raw/main/projudi-intimacao-page.user.js
// @match        https://projudi.tjgo.jus.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const IFRAME_ID = 'Principal';
  const IFRAME_NAME = 'userMainFrame';
  const BTN_LIST_ID = 'pj-unificar-intimacoes-btn';
  const BTN_LIST_10_ID = 'pj-unificar-10-btn';
  const BTN_CSV_ID  = 'pj-exportar-csv-btn';

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init);
  else init();

  function init() {
    const ifr = document.getElementById(IFRAME_ID) || document.querySelector(`iframe[name="${IFRAME_NAME}"]`);
    if (!ifr) return;
    const onLoad = () => inject(ifr);
    ifr.addEventListener('load', onLoad);
    inject(ifr);
  }

  function inject(ifr) {
    const d = ifr.contentDocument;
    if (!d || !d.body) return;
    const title = d.querySelector('h1,h2,.Titulo,.titulo');
    if (!title || !/intima(ç|c)ões\s+lidas/i.test(title.textContent || '')) return;

    // Botão: Listar todas
    d.getElementById(BTN_LIST_ID)?.remove();
    const btnList = d.createElement('button');
    btnList.id = BTN_LIST_ID;
    btnList.textContent = '📜 Listar todas as intimações';
    styleBtn(btnList, 20, 20);
    btnList.addEventListener('click', () => unifyInsideIframe(ifr, btnList));
    d.body.appendChild(btnList);

    // Botão: Carregar 10 páginas
    d.getElementById(BTN_LIST_10_ID)?.remove();
    const btn10 = d.createElement('button');
    btn10.id = BTN_LIST_10_ID;
    btn10.textContent = '⚡ Carregar 10 páginas';
    // posiciona entre o "Listar todas" e o "Exportar CSV"
    styleBtn(btn10, 45, 20);
    btn10.addEventListener('click', () => unifyInsideIframe(ifr, btn10, 10));
    d.body.appendChild(btn10);

    // Botão: Exportar CSV
    d.getElementById(BTN_CSV_ID)?.remove();
    const btnCsv = d.createElement('button');
    btnCsv.id = BTN_CSV_ID;
    btnCsv.textContent = '💾 Exportar CSV';
    styleBtn(btnCsv, 70, 20); // acima do listar
    btnCsv.addEventListener('click', () => exportCSV(ifr));
    d.body.appendChild(btnCsv);
  }

  function styleBtn(btn, bottomPx, rightPx) {
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: `${bottomPx}px`,
      right: `${rightPx}px`,
      zIndex: '2147483647',
      padding: '10px 16px',
      background: '#2e7d32',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      fontWeight: '700',
      cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(0,0,0,.15)'
    });
  }

  // =============== UNIFICAÇÃO ===============

  async function unifyInsideIframe(mainFrame, btn, maxPages = null) {
    const d = mainFrame.contentDocument;
    const originalLabel = btn.textContent;
    const setMsg = (m) => btn.textContent = m;
    btn.disabled = true;

    try {
      const table = findMainTable(d);
      if (!table) throw new Error('Tabela principal não encontrada.');
      const tbody = table.tBodies[0] || table;

      const pager = d.getElementById('Paginacao') || findPagerFallback(d);
      const pageInfo = analyzePager(d, pager);
      if (!pageInfo || pageInfo.totalPages < 2) {
        alert('Sem paginação.');
        return;
      }

      const loader = d.createElement('iframe');
      loader.style.display = 'none';
      mainFrame.parentElement.appendChild(loader);

      loader.src = mainFrame.contentWindow.location.href;
      await once(loader, 'load');

      const total = pageInfo.totalPages;
      const toPage = maxPages ? Math.min(maxPages, total) : total;

      for (let p = 2; p <= toPage; p++) {
        setMsg(`⏳ Página ${p}/${toPage}...`);
        await navigateLoaderToPage(loader, p, pageInfo);
        const doc = loader.contentDocument;
        const t2 = findMainTable(doc);
        if (!t2) continue;
        const rows = Array.from(t2.querySelectorAll('tbody tr, tr')).filter(tr => tr.querySelector('td'));
        for (const tr of rows) tbody.appendChild(d.importNode(tr, true));
      }
      const totalRows = tbody.querySelectorAll('tr').length;
      // Se carregou todas as páginas (sem limite ou limite >= total), remove a paginação; senão, mantém
      if (!maxPages || toPage === total) {
        pager?.remove?.();
        setMsg(`✅ Listagem unificada (${totalRows} linhas)`);
      } else {
        setMsg(`✅ ${toPage} páginas carregadas (${totalRows} linhas)`);
      }
    } catch (err) {
      console.error('[Projudi – Unificar Intimações] Erro:', err);
      btn.textContent = '❌ Erro — veja o console';
    } finally {
      // restaura o rótulo original, seja "Listar todas..." ou "Carregar 10 páginas"
      setTimeout(() => { btn.disabled = false; btn.textContent = originalLabel; }, 2500);
    }
  }

  function findMainTable(root) {
    const tables = Array.from(root.querySelectorAll('table'));
    let best = null, scoreBest = -1;
    for (const t of tables) {
      const headText = (t.tHead || t).textContent || '';
      let s = 0;
      if (/^\s*Num\.?/mi.test(headText)) s += 2;
      if (/Processo/i.test(headText)) s += 2;
      if (/Movimenta(ç|c)[aã]o/i.test(headText)) s += 3;
      if (/Tipo/i.test(headText)) s += 1;
      if (/Data\s*Leitura/i.test(headText)) s += 2;
      if (/Data\s*Limite/i.test(headText)) s += 2;
      if (s > scoreBest) { scoreBest = s; best = t; }
    }
    return best;
  }

  function findPagerFallback(root) {
    const blocks = Array.from(root.querySelectorAll('div,nav,td,p,form,span'))
      .filter(el => /\bPágina\b/i.test(el.textContent || '') && el.querySelectorAll('a').length);
    if (blocks.length) return blocks.sort((a,b) => b.querySelectorAll('a').length - a.querySelectorAll('a').length)[0];
    return null;
  }

  function analyzePager(doc, pagerEl) {
    if (!pagerEl) return null;
    const input = pagerEl.querySelector('#CaixaTextoPosicionar, .CaixaTextoPosicionar, input[type="text"], input[type="number"]');
    let total = input ? parseInt((input.value || input.getAttribute('value') || '').trim(), 10) : NaN;

    if (!total || isNaN(total)) {
      const lastA = Array.from(pagerEl.querySelectorAll('a')).find(a => /última|ultima/i.test(a.textContent || ''));
      if (lastA) {
        const idx = extractLastNumber(lastA.getAttribute('href')); // buscaDados(177,15)
        if (typeof idx === 'number') total = idx + 1; // 0-based → total
      }
    }
    if (!total || isNaN(total) || total < 2) return null;

    const hasBuscaDados = !!safeHasFunction(doc.defaultView, 'buscaDados');
    const btnIr = pagerEl.querySelector('.BotaoIr, input[value="Ir"], button');

    return {
      totalPages: total,
      canCallBuscaDados: hasBuscaDados,
      hasGoButton: !!btnIr,
      pageSizeFromHref: extractSecondNumberFromHref(pagerEl),
      selectors: {
        inputPath: input ? cssPath(input) : null,
        irPath: btnIr ? cssPath(btnIr) : null
      }
    };
  }

  async function navigateLoaderToPage(loader, humanPage, info) {
    const w = loader.contentWindow;
    const doc = loader.contentDocument;

    if (info.canCallBuscaDados && typeof w.buscaDados === 'function') {
      const ready = observeTableChange(doc);
      const idx = humanPage - 1;
      const pageSize = info.pageSizeFromHref || 15;
      try { w.buscaDados(idx, pageSize); } catch {}
      await ready;
      return;
    }

    if (info.hasGoButton && info.selectors.inputPath && info.selectors.irPath) {
      const input = doc.querySelector(info.selectors.inputPath);
      const ir = doc.querySelector(info.selectors.irPath);
      if (input && ir) {
        const ready = observeTableChange(doc);
        input.value = String(humanPage);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof ir.click === 'function') ir.click();
        else ir.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await ready;
        return;
      }
    }

    const a = Array.from(doc.querySelectorAll('#Paginacao a, .Paginacao a, a'))
      .find(x => parseInt((x.textContent || '').trim(), 10) === humanPage);
    if (a) {
      const ready = observeTableChange(doc);
      a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await ready;
      return;
    }

    loader.src = w.location.href;
    await once(loader, 'load');
  }

  function once(target, evt) {
    return new Promise(res => {
      const h = () => { target.removeEventListener(evt, h); res(); };
      target.addEventListener(evt, h);
    });
  }

  function observeTableChange(doc) {
    return new Promise(resolve => {
      const startCount = doc.querySelectorAll('table tbody tr').length || 0;
      const root = doc.body;
      const obs = new MutationObserver(() => {
        const now = doc.querySelectorAll('table tbody tr').length;
        if (now !== startCount && now > 0) { obs.disconnect(); resolve(); }
      });
      obs.observe(root, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(); }, 8000); // failsafe
    });
  }

  function extractLastNumber(str) {
    if (!str) return null;
    const m = String(str).match(/(\d+)\D*\)?\s*$/);
    return m ? parseInt(m[1], 10) : null;
  }

  function extractSecondNumberFromHref(container) {
    const a = container.querySelector('a[href^="javascript:buscaDados("]');
    if (!a) return null;
    const m = a.getAttribute('href').match(/buscaDados\(\s*\d+\s*,\s*(\d+)\s*\)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function cssPath(el) {
    const segs = [];
    for (; el && el.nodeType === 1; el = el.parentElement) {
      let s = el.nodeName.toLowerCase();
      if (el.id) { s += `#${CSS.escape(el.id)}`; segs.unshift(s); break; }
      let i = 1, sib = el;
      while ((sib = sib.previousElementSibling)) if (sib.nodeName === el.nodeName) i++;
      s += `:nth-of-type(${i})`;
      segs.unshift(s);
    }
    return segs.join(' > ');
  }

  function safeHasFunction(win, name) {
    try { return typeof win?.[name] === 'function'; } catch { return false; }
  }

  // =============== EXPORT CSV ===============

  function exportCSV(ifr) {
    const d = ifr.contentDocument;
    const table = findMainTable(d);
    if (!table) { alert('Tabela não encontrada para exportação.'); return; }

    const delimiter = ';'; // melhor p/ Excel em PT-BR
    const rows = [];
    const pushRow = (cells) => {
      rows.push(cells.map(cleanCSV).join(delimiter));
    };

    // Cabeçalhos
    const ths = Array.from((table.tHead || table).querySelectorAll('th')).map(th => th.innerText.trim());
    if (ths.length) pushRow(ths);

    // Linhas
    const trs = Array.from(table.querySelectorAll('tbody tr'));
    for (const tr of trs) {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => {
        // tenta preservar texto legível (ignorando ícones de “detalhes/marcar”)
        let txt = td.innerText || '';
        txt = txt.replace(/\s+/g, ' ').trim();
        return txt;
      });
      if (tds.length) pushRow(tds);
    }

    const csv = '\ufeff' + rows.join('\r\n'); // BOM + CRLF
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fname = `intimacoes_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.csv`;

    const a = d.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    d.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function cleanCSV(value) {
    let v = String(value ?? '');
    v = v.replace(/\r?\n|\r/g, ' ').trim();
    // escape de aspas duplas
    if (/[;"\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
    return v;
  }

})();
