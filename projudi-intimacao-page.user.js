// ==UserScript==
// @name         Intimações em Página Única
// @namespace    projudi-intimacao-page.user.js
// @version      2.6
// @icon         https://img.icons8.com/ios-filled/100/scales--v1.png
// @description  Remove a paginação e agrega intimações em uma única página, com exportação CSV/PDF.
// @author       louencosv (GPT)
// @license      CC BY-NC 4.0
// @updateURL    https://gist.githubusercontent.com/lourencosv/ca9a3e181cfbf181862f16a08a4ee33f/raw/projudi-intimacao-page.user.js
// @downloadURL  https://gist.githubusercontent.com/lourencosv/ca9a3e181cfbf181862f16a08a4ee33f/raw/projudi-intimacao-page.user.js
// @match        *://projudi.tjgo.jus.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const IFRAME_ID = 'Principal';
  const IFRAME_NAME = 'userMainFrame';

  const BTN_CONTAINER_ID = 'pj-btn-container';
  const BTN_ALL_ID = 'pj-unificar-todas-btn';
  const BTN_10_ID = 'pj-unificar-10-btn';
  const BTN_CUSTOM_ID = 'pj-unificar-custom-btn';
  const BTN_CSV_ID = 'pj-exportar-csv-btn';
  const BTN_PDF_ID = 'pj-exportar-pdf-btn';

  const UI = {
    width: 140,
    height: 30,
    gap: 6,
    fontSize: 12
  };

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init);
  else init();

  function init() {
    const ifr = document.getElementById(IFRAME_ID) || document.querySelector(`iframe[name="${IFRAME_NAME}"]`);
    if (!ifr) return;
    const onLoad = () => inject(ifr);
    ifr.addEventListener('load', onLoad);
    window.addEventListener('resize', () => positionPanel(ifr));
    inject(ifr);
  }

  function inject(ifr) {
    const d = ifr.contentDocument;
    if (!d || !d.body) return;

    const titleEl = d.querySelector('h1,h2,.Titulo,.titulo');
    const titleText = (titleEl?.textContent || '').trim();
    const url = ifr.contentWindow?.location?.href || '';
    const isIntimacaoPage =
      /intima(ç|c)(a|ã)o|intima(ç|c)ões/i.test(titleText) ||
      /intimac/i.test(url);

    if (!isIntimacaoPage) {
      document.getElementById(BTN_CONTAINER_ID)?.remove();
      return;
    }

    document.getElementById(BTN_CONTAINER_ID)?.remove();

    const container = document.createElement('div');
    container.id = BTN_CONTAINER_ID;
    Object.assign(container.style, {
      position: 'fixed',
      bottom: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: `${UI.gap}px`,
      zIndex: '2147483647',
      width: `${UI.width}px`
    });

    const btnAll = createButton(document, BTN_ALL_ID, 'Carregar tudo');
    btnAll.addEventListener('click', () => unifyInsideIframe(ifr, btnAll));

    const btn10 = createButton(document, BTN_10_ID, 'Carregar 10');
    btn10.addEventListener('click', () => unifyInsideIframe(ifr, btn10, 10));

    const btnCustom = createButton(document, BTN_CUSTOM_ID, 'Carregar N');
    btnCustom.addEventListener('click', () => {
      const raw = prompt('Quantas páginas deseja carregar?', '20');
      if (raw === null) return;
      const n = parseInt(String(raw).trim(), 10);
      if (!Number.isFinite(n) || n < 1) {
        alert('Informe um número inteiro maior que 0.');
        return;
      }
      unifyInsideIframe(ifr, btnCustom, n);
    });

    const btnCsv = createButton(document, BTN_CSV_ID, 'Exportar CSV');
    btnCsv.addEventListener('click', () => exportCSV(ifr));

    const btnPdf = createButton(document, BTN_PDF_ID, 'Exportar PDF');
    btnPdf.addEventListener('click', () => exportPDF(ifr));

    container.append(btnAll, btn10, btnCustom, btnCsv, btnPdf);
    document.body.appendChild(container);
    positionPanel(ifr);
  }

  function positionPanel(ifr) {
    const panel = document.getElementById(BTN_CONTAINER_ID);
    if (!panel || !ifr) return;

    const rect = ifr.getBoundingClientRect();
    const margin = 12;
    const panelWidth = UI.width;
    const spaceRight = window.innerWidth - rect.right;
    const spaceLeft = rect.left;

    panel.style.left = '';
    panel.style.right = '';

    if (spaceRight >= panelWidth + margin) {
      panel.style.right = `${Math.max(margin, spaceRight - 2)}px`;
    } else if (spaceLeft >= panelWidth + margin) {
      panel.style.left = `${Math.max(margin, rect.left - panelWidth - margin)}px`;
    } else {
      panel.style.right = `${margin}px`;
    }
  }

  function createButton(d, id, label) {
    const btn = d.createElement('button');
    btn.id = id;
    btn.textContent = label;
    Object.assign(btn.style, {
      width: `${UI.width}px`,
      height: `${UI.height}px`,
      padding: '0 8px',
      background: '#1f5fa8',
      color: '#fff',
      border: 'none',
      outline: 'none',
      borderRadius: '7px',
      fontWeight: '700',
      cursor: 'pointer',
      fontSize: `${UI.fontSize}px`,
      textAlign: 'center',
      boxShadow: '0 2px 7px rgba(0,0,0,.15)',
      transition: 'transform .12s ease, background .12s ease, box-shadow .12s ease',
      whiteSpace: 'nowrap'
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#2d73c4';
      btn.style.transform = 'translateY(-1px)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#1f5fa8';
      btn.style.transform = 'translateY(0)';
    });

    btn.addEventListener('focus', () => {
      btn.style.boxShadow = '0 0 0 2px rgba(45,115,196,.45), 0 2px 7px rgba(0,0,0,.15)';
    });

    btn.addEventListener('blur', () => {
      btn.style.boxShadow = '0 2px 7px rgba(0,0,0,.15)';
    });

    return btn;
  }

  function showToast(msg) {
    const t = document.createElement('div');
    Object.assign(t.style, {
      position: 'fixed',
      bottom: '180px',
      right: '12px',
      background: '#1f5fa8',
      padding: '8px 12px',
      color: '#fff',
      borderRadius: '6px',
      boxShadow: '0 3px 10px rgba(0,0,0,.25)',
      zIndex: '2147483647',
      fontWeight: '600',
      fontSize: '12px',
      opacity: '0',
      transition: 'opacity .25s'
    });
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => (t.style.opacity = '1'));
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 300);
    }, 1800);
  }

  async function unifyInsideIframe(mainFrame, btn, maxPages = null) {
    const d = mainFrame.contentDocument;
    const originalLabel = btn.textContent;
    const setMsg = (m) => (btn.textContent = m);
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

      if (toPage <= 1) {
        setMsg('Nada p/ carregar');
        return;
      }

      for (let p = 2; p <= toPage; p++) {
        setMsg(`${p}/${toPage}...`);
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
        setMsg(`Ok (${totalRows})`);
      } else {
        setMsg(`Ok ${toPage}p`);
      }
    } catch (err) {
      console.error('[Projudi – Unificar Intimações] Erro:', err);
      btn.textContent = 'Erro';
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }, 1400);
    }
  }

  function exportCSV(ifr) {
    const d = ifr.contentDocument;
    const table = findMainTable(d);
    if (!table) {
      alert('Tabela não encontrada para exportação.');
      return;
    }

    const delimiter = ';';
    const rows = [];
    const pushRow = (cells) => rows.push(cells.map(cleanCSV).join(delimiter));

    const ths = Array.from((table.tHead || table).querySelectorAll('th')).map(th => th.innerText.trim());
    if (ths.length) pushRow(ths);

    const trs = Array.from(table.querySelectorAll('tbody tr'));
    for (const tr of trs) {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || '').replace(/\s+/g, ' ').trim());
      if (tds.length) pushRow(tds);
    }

    const csv = '\ufeff' + rows.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fname = `intimacoes_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.csv`;

    const a = d.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    d.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
      showToast('CSV gerado');
    }, 700);
  }

  function exportPDF(ifr) {
    const d = ifr.contentDocument;
    const table = findMainTable(d);
    if (!table) {
      alert('Tabela não encontrada para exportação.');
      return;
    }

    const printWin = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=800');
    if (!printWin) {
      alert('Bloqueador de pop-up ativo. Permita pop-up para gerar PDF.');
      return;
    }

    const dateStr = new Date().toLocaleString('pt-BR');

    printWin.document.open();
    printWin.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Intimações</title><style>body{font-family:Arial,sans-serif;margin:20px;color:#111}h1{font-size:18px;margin:0 0 8px}.meta{font-size:12px;margin-bottom:12px;color:#444}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #bbb;padding:6px;vertical-align:top}th{background:#f3f3f3}@media print{body{margin:10mm}}</style></head><body><h1>Intimações</h1><div class="meta">Gerado em: ${dateStr}</div>${table.outerHTML}</body></html>`);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => printWin.print(), 250);

    showToast('Impressão PDF aberta');
  }

  function cleanCSV(value) {
    let v = String(value ?? '');
    v = v.replace(/\r?\n|\r/g, ' ').trim();
    if (/[;"\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
    return v;
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
    if (blocks.length) return blocks.sort((a, b) => b.querySelectorAll('a').length - a.querySelectorAll('a').length)[0];
    return null;
  }

  function analyzePager(doc, pagerEl) {
    if (!pagerEl) return null;
    const input = pagerEl.querySelector('#CaixaTextoPosicionar, .CaixaTextoPosicionar, input[type="text"], input[type="number"]');
    let total = input ? parseInt((input.value || input.getAttribute('value') || '').trim(), 10) : NaN;

    if (!total || isNaN(total)) {
      const lastA = Array.from(pagerEl.querySelectorAll('a')).find(a => /última|ultima/i.test(a.textContent || ''));
      if (lastA) {
        const idx = extractLastNumber(lastA.getAttribute('href'));
        if (typeof idx === 'number') total = idx + 1;
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
        if (now !== startCount && now > 0) {
          obs.disconnect();
          resolve();
        }
      });
      obs.observe(root, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        resolve();
      }, 8000);
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
      if (el.id) {
        s += `#${CSS.escape(el.id)}`;
        segs.unshift(s);
        break;
      }
      let i = 1;
      let sib = el;
      while ((sib = sib.previousElementSibling)) if (sib.nodeName === el.nodeName) i++;
      s += `:nth-of-type(${i})`;
      segs.unshift(s);
    }
    return segs.join(' > ');
  }

  function safeHasFunction(win, name) {
    try { return typeof win?.[name] === 'function'; } catch { return false; }
  }
})();