// ==UserScript==
// @name         Intimações em Página Única
// @namespace    projudi-intimacao-page.user.js
// @version      2.7
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

  const ROOT_ID = 'pj-fab-root';
  const MENU_ID = 'pj-fab-menu';
  const FAB_ID = 'pj-fab-main';

  const BTN_ALL_ID = 'pj-unificar-todas-btn';
  const BTN_10_ID = 'pj-unificar-10-btn';
  const BTN_CUSTOM_ID = 'pj-unificar-custom-btn';
  const BTN_CSV_ID = 'pj-exportar-csv-btn';
  const BTN_PDF_ID = 'pj-exportar-pdf-btn';

  const UI = {
    menuWidth: 230,
    btnHeight: 30,
    gap: 6,
    brand: '#2b69aa',
    brandHover: '#245a92'
  };

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init);
  else init();

  function init() {
    const ifr = document.getElementById(IFRAME_ID) || document.querySelector(`iframe[name="${IFRAME_NAME}"]`);
    if (!ifr) return;
    ifr.addEventListener('load', () => inject(ifr));
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
      document.getElementById(ROOT_ID)?.remove();
      return;
    }

    ensureFontAwesome(document);
    mountUI(ifr);
  }

  function ensureFontAwesome(doc) {
    if (doc.getElementById('pj-fa-cdn')) return;
    const link = doc.createElement('link');
    link.id = 'pj-fa-cdn';
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';
    doc.head.appendChild(link);
  }

  function mountUI(ifr) {
    document.getElementById(ROOT_ID)?.remove();

    const root = document.createElement('div');
    root.id = ROOT_ID;
    Object.assign(root.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: `${UI.gap}px`
    });

    const menu = document.createElement('div');
    menu.id = MENU_ID;
    Object.assign(menu.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: `${UI.gap}px`,
      width: `${UI.menuWidth}px`,
      opacity: '0',
      transform: 'translateY(8px)',
      pointerEvents: 'none',
      transition: 'opacity .16s ease, transform .16s ease'
    });

    const btnAll = createActionButton(BTN_ALL_ID, 'Carregar todas');
    btnAll.addEventListener('click', () => unifyInsideIframe(ifr, btnAll));

    const btn10 = createActionButton(BTN_10_ID, 'Carregar 10 páginas');
    btn10.addEventListener('click', () => unifyInsideIframe(ifr, btn10, 10));

    const btnCustom = createActionButton(BTN_CUSTOM_ID, 'Carregar N páginas');
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

    const btnCsv = createActionButton(BTN_CSV_ID, 'Exportar CSV');
    btnCsv.addEventListener('click', () => exportCSV(ifr));

    const btnPdf = createActionButton(BTN_PDF_ID, 'Exportar PDF');
    btnPdf.addEventListener('click', () => exportPDF(ifr));

    menu.append(btnAll, btn10, btnCustom, btnCsv, btnPdf);

    const fab = document.createElement('button');
    fab.id = FAB_ID;
    fab.type = 'button';
    fab.innerHTML = '<i class="fa-solid fa-plus"></i>';
    fab.setAttribute('aria-label', 'Abrir opções');
    Object.assign(fab.style, {
      width: '42px',
      height: '42px',
      borderRadius: '50%',
      border: `1px solid ${UI.brand}`,
      background: UI.brand,
      color: '#fff',
      cursor: 'pointer',
      fontSize: '16px',
      boxShadow: '0 4px 10px rgba(0,0,0,.18)',
      transition: 'transform .16s ease, background .16s ease'
    });

    fab.addEventListener('mouseenter', () => {
      fab.style.background = UI.brandHover;
      fab.style.transform = 'translateY(-1px)';
    });

    fab.addEventListener('mouseleave', () => {
      fab.style.background = UI.brand;
      fab.style.transform = 'translateY(0)';
    });

    let isOpen = false;
    const setOpen = (open) => {
      isOpen = open;
      if (isOpen) {
        menu.style.opacity = '1';
        menu.style.transform = 'translateY(0)';
        menu.style.pointerEvents = 'auto';
        fab.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      } else {
        menu.style.opacity = '0';
        menu.style.transform = 'translateY(8px)';
        menu.style.pointerEvents = 'none';
        fab.innerHTML = '<i class="fa-solid fa-plus"></i>';
      }
    };

    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!isOpen);
    });

    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) setOpen(false);
    });

    root.append(menu, fab);
    document.body.appendChild(root);
  }

  function createActionButton(id, label) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.textContent = label;

    Object.assign(btn.style, {
      width: `${UI.menuWidth}px`,
      height: `${UI.btnHeight}px`,
      padding: '0 10px',
      background: UI.brand,
      color: '#fff',
      border: `1px solid ${UI.brand}`,
      borderRadius: '3px',
      fontWeight: '600',
      cursor: 'pointer',
      fontSize: '13px',
      textAlign: 'center',
      boxShadow: '0 2px 6px rgba(0,0,0,.12)',
      transition: 'transform .12s ease, background .12s ease',
      whiteSpace: 'nowrap'
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.background = UI.brandHover;
      btn.style.transform = 'translateY(-1px)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.background = UI.brand;
      btn.style.transform = 'translateY(0)';
    });

    return btn;
  }

  function showToast(msg) {
    const t = document.createElement('div');
    Object.assign(t.style, {
      position: 'fixed',
      right: '16px',
      bottom: '72px',
      background: UI.brand,
      color: '#fff',
      padding: '9px 12px',
      borderRadius: '4px',
      border: `1px solid ${UI.brand}`,
      boxShadow: '0 3px 10px rgba(0,0,0,.2)',
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
      setTimeout(() => t.remove(), 250);
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
        setMsg('Nada para carregar');
        return;
      }

      for (let p = 2; p <= toPage; p++) {
        setMsg(`Página ${p}/${toPage}...`);
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
        setMsg(`Concluído (${totalRows} linhas)`);
      } else {
        setMsg(`${toPage} páginas (${totalRows} linhas)`);
      }
    } catch (err) {
      console.error('[Projudi – Unificar Intimações] Erro:', err);
      btn.textContent = 'Erro';
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }, 1800);
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
      if (s > scoreBest) {
        scoreBest = s;
        best = t;
      }
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
      try {
        w.buscaDados(idx, pageSize);
      } catch {}
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
      const h = () => {
        target.removeEventListener(evt, h);
        res();
      };
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
    try {
      return typeof win?.[name] === 'function';
    } catch {
      return false;
    }
  }
})();