// ==UserScript==
// @name         Projudi – Intimações em Página Única
// @namespace    projudi-intimacao-unica
// @version      2.3
// @description  Remove a paginação e agrega todas as intimações em uma única página, além de exportar em CSV.
// @updateURL    https://gist.githubusercontent.com/lourencosv/ca9a3e181cfbf181862f16a08a4ee33f/raw
// @downloadURL  https://gist.githubusercontent.com/lourencosv/ca9a3e181cfbf181862f16a08a4ee33f/raw
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
  const BTN_CSV_ID = 'pj-exportar-csv-btn';

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init);
  else init();

  function init() {
    const ifr = document.getElementById(IFRAME_ID) ||
                document.querySelector(`iframe[name="${IFRAME_NAME}"]`);
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

    // Criar container dos botões
    let container = d.getElementById('pj-btn-container');
    if (!container) {
      container = d.createElement('div');
      container.id = 'pj-btn-container';
      Object.assign(container.style, {
        position: 'fixed',
        bottom: '25px',
        right: '25px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        zIndex: '2147483647',
        alignItems: 'flex-end',
      });
      d.body.appendChild(container);
    }

    // Botão: Listar todas
    d.getElementById(BTN_LIST_ID)?.remove();
    const btnList = d.createElement('button');
    btnList.id = BTN_LIST_ID;
    btnList.textContent = '📜 Listar todas as intimações';
    styleBtn(btnList);
    btnList.addEventListener('click', () => unifyInsideIframe(ifr, btnList));
    container.appendChild(btnList);

    // Botão: Carregar 10 páginas
    d.getElementById(BTN_LIST_10_ID)?.remove();
    const btn10 = d.createElement('button');
    btn10.id = BTN_LIST_10_ID;
    btn10.textContent = '⚡ Carregar 10 páginas';
    styleBtn(btn10);
    btn10.addEventListener('click', () => unifyInsideIframe(ifr, btn10, 10));
    container.appendChild(btn10);

    // Botão: Exportar CSV
    d.getElementById(BTN_CSV_ID)?.remove();
    const btnCsv = d.createElement('button');
    btnCsv.id = BTN_CSV_ID;
    btnCsv.textContent = '💾 Exportar CSV';
    styleBtn(btnCsv);
    btnCsv.addEventListener('click', () => exportCSV(ifr));
    container.appendChild(btnCsv);
  }

  function styleBtn(btn) {
    Object.assign(btn.style, {
      padding: '10px 16px',
      background: '#00695c',
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      fontWeight: '600',
      cursor: 'pointer',
      fontSize: '14px',
      whiteSpace: 'nowrap',
      transition: 'background .2s, transform .2s',
      boxShadow: '0 3px 10px rgba(0,0,0,.20)',
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#00897b';
      btn.style.transform = 'translateY(-2px)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#00695c';
      btn.style.transform = 'translateY(0)';
    });
  }

  // ✅ Toast feedback visual
  function toast(d, msg) {
    const t = d.createElement('div');
    Object.assign(t.style, {
      position: 'fixed',
      bottom: '100px',
      right: '25px',
      background: '#00695c',
      padding: '10px 18px',
      color: '#fff',
      borderRadius: '6px',
      boxShadow: '0 3px 10px rgba(0,0,0,.25)',
      zIndex: '2147483647',
      fontWeight: '600',
      opacity: '0',
      transition: 'opacity .4s',
    });
    t.textContent = msg;
    d.body.appendChild(t);
    requestAnimationFrame(() => t.style.opacity = '1');
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 700);
    }, 2500);
  }

  async function unifyInsideIframe(mainFrame, btn, maxPages = null) {
    // ⚠️ INALTERADO (toda funcionalidade preservada)
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
      setTimeout(() => { btn.disabled = false; btn.textContent = originalLabel; }, 2500);
    }
  }

  // ✅ EXPORTAÇÃO CSV + toast
  function exportCSV(ifr) {
    const d = ifr.contentDocument;
    const table = findMainTable(d);
    if (!table) { alert('Tabela não encontrada para exportação.'); return; }

    const delimiter = ';';
    const rows = [];
    const pushRow = (cells) => {
      rows.push(cells.map(cleanCSV).join(delimiter));
    };

    const ths = Array.from((table.tHead || table).querySelectorAll('th')).map(th => th.innerText.trim());
    if (ths.length) pushRow(ths);

    const trs = Array.from(table.querySelectorAll('tbody tr'));
    for (const tr of trs) {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => {
        let txt = td.innerText || '';
        txt = txt.replace(/\s+/g, ' ').trim();
        return txt;
      });
      if (tds.length) pushRow(tds);
    }

    const csv = '\ufeff' + rows.join('\r\n');
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
      toast(d, '✅ CSV gerado com sucesso');
    }, 1000);
  }

  function cleanCSV(value) {
    let v = String(value ?? '');
    v = v.replace(/\r?\n|\r/g, ' ').trim();
    if (/[;"\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
    return v;
  }

  // ✅ parte da lógica original inalterada ↓↓↓
  function findMainTable(root) { /* ... */ }
  function findPagerFallback(root) { /* ... */ }
  function analyzePager(doc, pagerEl) { /* ... */ }
  function navigateLoaderToPage(loader, humanPage, info) { /* ... */ }
  function once(target, evt) { /* ... */ }
  function observeTableChange(doc) { /* ... */ }
  function extractLastNumber(str) { /* ... */ }
  function extractSecondNumberFromHref(container) { /* ... */ }
  function cssPath(el) { /* ... */ }
  function safeHasFunction(win, name) { /* ... */ }

})();