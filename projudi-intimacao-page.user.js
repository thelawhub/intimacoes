// ==UserScript==
// @name         Intimações
// @namespace    projudi-intimacao-page.user.js
// @version      3.1
// @icon         https://img.icons8.com/ios-filled/100/scales--v1.png
// @description  Remove a paginação, agrega intimações em uma única página, exporta CSV/PDF e permite marcar intimações com triagem local.
// @author       louencosv (GPT)
// @license      CC BY-NC 4.0
// @updateURL    https://gist.githubusercontent.com/lourencosv/ca9a3e181cfbf181862f16a08a4ee33f/raw/projudi-intimacao-page.user.js
// @downloadURL  https://gist.githubusercontent.com/lourencosv/ca9a3e181cfbf181862f16a08a4ee33f/raw/projudi-intimacao-page.user.js
// @match        *://projudi.tjgo.jus.br/*
// @match        *://projudi-teste.tjgo.jus.br/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// ==/UserScript==

(() => {
  'use strict';

  const IFRAME_ID = 'Principal';
  const IFRAME_NAME = 'userMainFrame';

  const ROOT_ID = 'pj-intimacoes-root';
  const PANEL_ID = 'pj-intimacoes-panel';
  const FAB_ID = 'pj-intimacoes-fab';

  const BTN_ALL_ID = 'pj-unificar-todas-btn';
  const BTN_10_ID = 'pj-unificar-10-btn';
  const BTN_CUSTOM_ID = 'pj-unificar-custom-btn';
  const BTN_CSV_ID = 'pj-exportar-csv-btn';
  const BTN_PDF_ID = 'pj-exportar-pdf-btn';
  const JSPDF_CDN = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
  const AUTOTABLE_CDN = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js';
  const LOG_PREFIX = '[Intimações]';

  const UI = {
    brand: '#2b69aa',
    brandHover: '#245a92',
    panelBg: '#ffffff',
    panelBorder: '#d5dde8',
    textStrong: '#173a61',
    textMuted: '#5f6f83',
    fabSize: 38,
    panelWidth: 260
  };

  let outsideClickHandler = null;
  let keydownHandler = null;
  let pdfLibPromise = null;
  let mountedFrame = null;

  function logWarn(message, meta) {
    if (meta === undefined) {
      console.warn(LOG_PREFIX, message);
      return;
    }
    console.warn(LOG_PREFIX, message, meta);
  }

  function logError(message, error) {
    console.error(LOG_PREFIX, message, error);
  }

  function safeRun(label, task, fallbackValue) {
    try {
      return task();
    } catch (error) {
      logError(label, error);
      return fallbackValue;
    }
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init);
  else init();

  function init() {
    const ifr = document.getElementById(IFRAME_ID) || document.querySelector(`iframe[name="${IFRAME_NAME}"]`);
    if (!ifr) return;
    ifr.addEventListener('load', () => inject(ifr), { passive: true });
    inject(ifr);
  }

  function inject(ifr) {
    const d = safeRun('Falha ao acessar o iframe principal.', () => ifr.contentDocument, null);
    if (!d || !d.body) return;

    const titleEl = d.querySelector('h1,h2,.Titulo,.titulo');
    const titleText = (titleEl?.textContent || '').trim();
    const url = ifr.contentWindow?.location?.href || '';
    const isIntimacaoPage =
      /intima(ç|c)(a|ã)o|intima(ç|c)ões/i.test(titleText) ||
      /intimac/i.test(url);

    if (!isIntimacaoPage) {
      teardownUI();
      return;
    }

    if (mountedFrame === ifr && document.getElementById(ROOT_ID)) return;
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

  function teardownUI() {
    document.getElementById(ROOT_ID)?.remove();
    mountedFrame = null;
    if (outsideClickHandler) {
      document.removeEventListener('click', outsideClickHandler, true);
      outsideClickHandler = null;
    }
    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler, true);
      keydownHandler = null;
    }
  }

  function mountUI(ifr) {
    teardownUI();
    mountedFrame = ifr;

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
      gap: '6px',
      fontFamily: 'Arial, sans-serif'
    });

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      width: `${UI.panelWidth}px`,
      background: UI.panelBg,
      border: `1px solid ${UI.panelBorder}`,
      borderRadius: '10px',
      boxShadow: '0 10px 28px rgba(12,33,56,.22)',
      overflow: 'hidden',
      opacity: '0',
      transform: 'translateY(8px) scale(.98)',
      pointerEvents: 'none',
      transition: 'opacity .15s ease, transform .15s ease'
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      background: 'linear-gradient(180deg, #2f72b8 0%, #2b69aa 100%)',
      color: '#fff',
      padding: '9px 10px',
      fontSize: '12px',
      fontWeight: '700',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-start'
    });
    header.innerHTML = '<span><i class="fa-solid fa-scale-balanced" style="margin-right:6px;"></i>Ações de Intimações</span>';

    const content = document.createElement('div');
    Object.assign(content.style, {
      padding: '6px',
      display: 'grid',
      gap: '4px',
      background: '#f7f9fc'
    });

    const btnAll = createActionButton(BTN_ALL_ID, 'fa-layer-group', 'Carregar todas as páginas');
    btnAll.addEventListener('click', () => unifyInsideIframe(ifr, btnAll));

    const btn10 = createActionButton(BTN_10_ID, 'fa-bolt', 'Carregar 10 páginas');
    btn10.addEventListener('click', () => unifyInsideIframe(ifr, btn10, 10));

    const btnCustom = createActionButton(BTN_CUSTOM_ID, 'fa-hashtag', 'Carregar X páginas');
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

    const divider = document.createElement('div');
    Object.assign(divider.style, {
      height: '1px',
      background: '#dde5f0',
      margin: '1px 0'
    });

    const btnCsv = createActionButton(BTN_CSV_ID, 'fa-file-csv', 'Exportar CSV');
    btnCsv.addEventListener('click', () => exportCSV(ifr));

    const btnPdf = createActionButton(BTN_PDF_ID, 'fa-file-pdf', 'Exportar PDF');
    btnPdf.addEventListener('click', () => exportPDF(ifr));

    content.append(btnAll, btn10, btnCustom, divider, btnCsv, btnPdf);
    panel.append(header, content);

    const fab = document.createElement('button');
    fab.id = FAB_ID;
    fab.type = 'button';
    fab.innerHTML = '<i class="fa-solid fa-plus"></i>';
    fab.setAttribute('aria-label', 'Abrir menu de ações');
    Object.assign(fab.style, {
      width: `${UI.fabSize}px`,
      height: `${UI.fabSize}px`,
      borderRadius: '50%',
      border: `1px solid ${UI.brand}`,
      background: UI.brand,
      color: '#fff',
      cursor: 'pointer',
      fontSize: '14px',
      boxShadow: '0 4px 12px rgba(0,0,0,.2)',
      transition: 'transform .12s ease, background .12s ease'
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
        panel.style.opacity = '1';
        panel.style.transform = 'translateY(0) scale(1)';
        panel.style.pointerEvents = 'auto';
        fab.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      } else {
        panel.style.opacity = '0';
        panel.style.transform = 'translateY(8px) scale(.98)';
        panel.style.pointerEvents = 'none';
        fab.innerHTML = '<i class="fa-solid fa-plus"></i>';
      }
    };

    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!isOpen);
    });

    outsideClickHandler = (e) => {
      if (!root.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', outsideClickHandler, true);

    keydownHandler = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', keydownHandler, true);

    root.append(panel, fab);
    document.body.appendChild(root);
  }

  function createActionButton(id, iconClass, label) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.innerHTML = `<i class="fa-solid ${iconClass}" style="width:15px;text-align:center;"></i><span>${label}</span>`;

    Object.assign(btn.style, {
      width: '100%',
      height: '30px',
      padding: '0 10px',
      background: '#fff',
      color: UI.textStrong,
      border: '1px solid #cfdae8',
      borderRadius: '6px',
      fontWeight: '600',
      cursor: 'pointer',
      fontSize: '13px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: '7px',
      transition: 'transform .12s ease, border-color .12s ease, background .12s ease'
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#edf4fc';
      btn.style.borderColor = '#9ebce0';
      btn.style.transform = 'translateY(-1px)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#fff';
      btn.style.borderColor = '#cfdae8';
      btn.style.transform = 'translateY(0)';
    });

    return btn;
  }

  function showToast(msg) {
    const t = document.createElement('div');
    Object.assign(t.style, {
      position: 'fixed',
      right: '16px',
      bottom: '64px',
      background: UI.brand,
      color: '#fff',
      padding: '8px 11px',
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
    const d = safeRun('Falha ao acessar o documento do iframe.', () => mainFrame.contentDocument, null);
    if (!d) return;
    const originalLabel = btn.querySelector('span')?.textContent || btn.textContent;
    const icon = btn.querySelector('i')?.outerHTML || '';
    const setMsg = (m) => {
      btn.innerHTML = `${icon}<span>${m}</span>`;
    };
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
        const rows = Array.from(t2.querySelectorAll('tbody tr, tr')).filter((tr) => tr.querySelector('td'));
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
      logError('Erro ao unificar páginas de intimações.', err);
      setMsg('Erro');
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = `${icon}<span>${originalLabel}</span>`;
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

    const ths = Array.from((table.tHead || table).querySelectorAll('th')).map((th) => th.innerText.trim());
    if (ths.length) pushRow(ths);

    const trs = Array.from(table.querySelectorAll('tbody tr'));
    for (const tr of trs) {
      const tds = Array.from(tr.querySelectorAll('td')).map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim());
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
    const d = safeRun('Falha ao acessar a tabela para PDF.', () => ifr.contentDocument, null);
    const table = findMainTable(d);
    if (!table) {
      alert('Tabela não encontrada para exportação.');
      return;
    }

    exportPDFWithJSPDF(table).catch((err) => {
      logWarn('Falha no jsPDF; usando fallback de impressão.', err);
      exportPDFViaPrintWindow(table);
    });
  }

  async function exportPDFWithJSPDF(table) {
    showToast('Gerando PDF...');
    await ensurePdfLibs();

    const jsPDFNS = window.jspdf;
    if (!jsPDFNS || typeof jsPDFNS.jsPDF !== 'function') {
      throw new Error('jsPDF indisponível');
    }
    if (typeof window.jspdf.jsPDF.API.autoTable !== 'function') {
      throw new Error('AutoTable indisponível');
    }

    const { head, body } = tableToMatrix(table);
    if (!body.length) throw new Error('Sem dados para exportação');

    const now = new Date();
    const dateStr = now.toLocaleString('pt-BR');
    const doc = new window.jspdf.jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageW = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('Intimações', 10, 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Gerado em: ${dateStr}`, 10, 15);

    doc.autoTable({
      head,
      body,
      startY: 19,
      theme: 'grid',
      headStyles: {
        fillColor: [238, 242, 247],
        textColor: [20, 32, 54],
        fontSize: 8,
        fontStyle: 'bold'
      },
      bodyStyles: {
        fontSize: 7,
        textColor: [26, 31, 44],
        valign: 'top',
        cellPadding: 1.2,
        lineColor: [215, 221, 231],
        lineWidth: 0.1
      },
      margin: { top: 19, right: 7, bottom: 10, left: 7 },
      styles: {
        overflow: 'linebreak',
        cellWidth: 'wrap',
        minCellHeight: 4
      },
      willDrawCell: function (data) {
        if (data.section === 'body' && data.column.index === 0) {
          data.cell.styles.halign = 'center';
        }
      },
      didDrawPage: function () {
        const page = doc.internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(90, 104, 124);
        doc.text(`Página ${page}`, pageW - 22, doc.internal.pageSize.getHeight() - 4);
      }
    });

    const pad = (n) => String(n).padStart(2, '0');
    const fname = `intimacoes_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.pdf`;
    doc.save(fname);
    showToast('PDF gerado');
  }

  function exportPDFViaPrintWindow(table) {
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

  async function ensurePdfLibs() {
    if (window.jspdf?.jsPDF && typeof window.jspdf.jsPDF.API.autoTable === 'function') return;
    if (pdfLibPromise) return pdfLibPromise;

    pdfLibPromise = (async () => {
      await loadScript(JSPDF_CDN);
      await loadScript(AUTOTABLE_CDN);
      if (!window.jspdf?.jsPDF || typeof window.jspdf.jsPDF.API.autoTable !== 'function') {
        throw new Error('Falha ao carregar jsPDF/AutoTable');
      }
    })();

    try {
      await pdfLibPromise;
    } finally {
      pdfLibPromise = null;
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-pj-src="${src}"]`)) {
        const s = document.querySelector(`script[data-pj-src="${src}"]`);
        if (s.getAttribute('data-loaded') === '1') return resolve();
        s.addEventListener('load', () => resolve(), { once: true });
        s.addEventListener('error', () => reject(new Error(`Erro ao carregar ${src}`)), { once: true });
        return;
      }

      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.setAttribute('data-pj-src', src);
      s.onload = () => {
        s.setAttribute('data-loaded', '1');
        resolve();
      };
      s.onerror = () => reject(new Error(`Erro ao carregar ${src}`));
      document.head.appendChild(s);
    });
  }

  function tableToMatrix(table) {
    const headRow = table.querySelector('thead tr') || table.querySelector('tr');
    const head = [Array.from(headRow?.querySelectorAll('th,td') || []).map((el) => compactText(el.innerText || el.textContent || ''))];
    const bodyRows = Array.from(table.querySelectorAll('tbody tr')).filter((tr) => tr.querySelector('td'));
    const body = bodyRows.map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => compactText(td.innerText || td.textContent || ''))
    );
    return { head, body };
  }

  function compactText(v) {
    return String(v || '').replace(/\s+/g, ' ').trim();
  }

  function cleanCSV(value) {
    let v = String(value ?? '');
    v = v.replace(/\r?\n|\r/g, ' ').trim();
    if (/[;"\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
    return v;
  }

  function findMainTable(root) {
    const tables = Array.from(root.querySelectorAll('table'));
    let best = null;
    let scoreBest = -1;
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
    const blocks = Array.from(root.querySelectorAll('div,nav,td,p,form,span')).filter(
      (el) => /\bPágina\b/i.test(el.textContent || '') && el.querySelectorAll('a').length
    );
    if (blocks.length) return blocks.sort((a, b) => b.querySelectorAll('a').length - a.querySelectorAll('a').length)[0];
    return null;
  }

  function analyzePager(doc, pagerEl) {
    if (!pagerEl) return null;
    const input = pagerEl.querySelector('#CaixaTextoPosicionar, .CaixaTextoPosicionar, input[type="text"], input[type="number"]');
    let total = input ? parseInt((input.value || input.getAttribute('value') || '').trim(), 10) : NaN;

    if (!total || isNaN(total)) {
      const lastA = Array.from(pagerEl.querySelectorAll('a')).find((a) => /última|ultima/i.test(a.textContent || ''));
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
    const doc = safeRun('Falha ao acessar o iframe loader.', () => loader.contentDocument, null);
    if (!doc) throw new Error('Documento do loader indisponível.');

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

    const a = Array.from(doc.querySelectorAll('#Paginacao a, .Paginacao a, a')).find(
      (x) => parseInt((x.textContent || '').trim(), 10) === humanPage
    );

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
    return new Promise((res) => {
      const h = () => {
        target.removeEventListener(evt, h);
        res();
      };
      target.addEventListener(evt, h, { once: true });
    });
  }

  function observeTableChange(doc) {
    return new Promise((resolve) => {
      const table = findMainTable(doc);
      const root = table?.tBodies?.[0] || table || doc.body;
      if (!root) {
        resolve();
        return;
      }
      const getRowCount = () => {
        if (!table) return doc.querySelectorAll('table tbody tr').length || 0;
        return table.querySelectorAll('tbody tr, tr').length || 0;
      };
      const startCount = getRowCount();
      const observer = new MutationObserver(() => {
        const now = getRowCount();
        if (now !== startCount && now > 0) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(root, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
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
    } catch (error) {
      logWarn(`Falha ao verificar função ${name}.`, error);
      return false;
    }
  }
})();

(() => {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_ID = 'pj-intimacoes-marcadas';
  const SCRIPT_META = {
    schema: 'backup-v1',
    scriptId: 'projudi-intimacao-page',
    scriptName: 'Intimações',
    version: typeof GM_info !== 'undefined' && GM_info?.script?.version ? String(GM_info.script.version) : '3.1',
    fileName: 'projudi-intimacao-page.json'
  };
  const STORAGE_KEY = `${SCRIPT_ID}::store`;
  const BACKUP_STORAGE_KEY = `${SCRIPT_ID}::backup`;
  const STYLE_ID = `${SCRIPT_ID}-style`;
  const FRAME_STYLE_ID = `${SCRIPT_ID}-frame-style`;
  const PANEL_OVERLAY_ID = `${SCRIPT_ID}-overlay`;
  const PANEL_ID = `${SCRIPT_ID}-panel`;
  const LOG_PREFIX = '[Intimacoes Marcadas]';
  const MAIN_IFRAME_SELECTOR = 'iframe#Principal, iframe[name="userMainFrame"]';
  const TABLE_SELECTOR = 'table.Tabela, table#Tabela';

  const state = {
    refreshTimer: 0,
    observer: null,
    iframe: null,
    iframeLoadHandler: null,
    panel: null,
    currentTables: [],
    rowCache: new WeakMap(),
    targetDocument: document,
    menuRegistered: false,
    menuCommandId: null,
    backupTimer: 0,
    store: loadStore()
  };

  const DEFAULT_BACKUP_SETTINGS = {
    enabled: false,
    gistId: '',
    token: '',
    fileName: SCRIPT_META.fileName,
    autoBackupOnSave: false,
    lastBackupAt: '',
    lastBackupSignature: ''
  };

  init();

  function init() {
    safeRun('Falha ao iniciar o painel de marcacao.', () => {
      injectRootStyles();
      ensureFontAwesome(document);
      registerMenuCommand();
      state.store.ui.panelOpen = false;
      bindIframe();
      refreshContext();
      installObserver();
    });
  }

  function logWarn(message, meta) {
    if (meta === undefined) {
      console.warn(LOG_PREFIX, message);
      return;
    }
    console.warn(LOG_PREFIX, message, meta);
  }

  function logError(message, error) {
    console.error(LOG_PREFIX, message, error);
  }

  function safeRun(label, task, fallbackValue = null) {
    try {
      return task();
    } catch (error) {
      logError(label, error);
      return fallbackValue;
    }
  }

  function loadStore() {
    const fallback = {
      items: Object.create(null),
      ui: {
        panelOpen: false,
        hideDone: true,
        onlyMarkedOnPage: false,
        query: ''
      }
    };

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return fallback;
      const items = parsed.items && typeof parsed.items === 'object' ? parsed.items : Object.create(null);
      const ui = parsed.ui && typeof parsed.ui === 'object' ? parsed.ui : {};
      return {
        items,
        ui: {
          panelOpen: Boolean(ui.panelOpen),
          hideDone: ui.hideDone !== false,
          onlyMarkedOnPage: Boolean(ui.onlyMarkedOnPage),
          query: typeof ui.query === 'string' ? ui.query : ''
        }
      };
    } catch (error) {
      logWarn('Nao foi possivel carregar o armazenamento local. Reiniciando estado.', error);
      return fallback;
    }
  }

  function persistStore() {
    safeRun('Falha ao persistir o armazenamento local.', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.store));
    });
    scheduleAutoBackup();
  }

  function normalizeBackupSettings(value) {
    const next = { ...DEFAULT_BACKUP_SETTINGS, ...(value || {}) };
    next.enabled = !!next.enabled;
    next.gistId = String(next.gistId || '').trim();
    next.token = String(next.token || '').trim();
    next.fileName = String(next.fileName || SCRIPT_META.fileName).trim() || SCRIPT_META.fileName;
    next.autoBackupOnSave = !!next.autoBackupOnSave;
    next.lastBackupAt = String(next.lastBackupAt || '').trim();
    next.lastBackupSignature = String(next.lastBackupSignature || '').trim();
    return next;
  }

  function loadBackupSettings() {
    try {
      const raw = localStorage.getItem(BACKUP_STORAGE_KEY);
      if (!raw) return normalizeBackupSettings(DEFAULT_BACKUP_SETTINGS);
      return normalizeBackupSettings(JSON.parse(raw));
    } catch (_) {
      return normalizeBackupSettings(DEFAULT_BACKUP_SETTINGS);
    }
  }

  function saveBackupSettings(next) {
    const normalized = normalizeBackupSettings(next);
    safeRun('Falha ao salvar configuracoes de backup.', () => {
      localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(normalized));
    });
    return normalized;
  }

  function formatLastBackupLabel(value) {
    if (!value) return 'Ultimo backup: ainda nao enviado.';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Ultimo backup: ainda nao enviado.';
    return `Ultimo backup: ${date.toLocaleString('pt-BR')}.`;
  }

  function buildExportPayload() {
    return {
      schema: SCRIPT_META.schema,
      scriptId: SCRIPT_META.scriptId,
      scriptName: SCRIPT_META.scriptName,
      version: SCRIPT_META.version,
      exportedAt: new Date().toISOString(),
      items: state.store.items
    };
  }

  function buildBackupSignature() {
    return JSON.stringify(state.store.items);
  }

  function scheduleAutoBackup() {
    clearTimeout(state.backupTimer);
    state.backupTimer = 0;
    const backupSettings = loadBackupSettings();
    if (!backupSettings.enabled || !backupSettings.autoBackupOnSave) return;
    const signature = buildBackupSignature();
    if (signature === backupSettings.lastBackupSignature) return;
    state.backupTimer = window.setTimeout(async () => {
      state.backupTimer = 0;
      try {
        await pushBackupToGist(backupSettings, buildExportPayload());
        saveBackupSettings({
          ...backupSettings,
          lastBackupAt: new Date().toISOString(),
          lastBackupSignature: signature
        });
        if (state.panel) renderPanel();
      } catch (error) {
        logWarn('Falha no backup automatico das intimacoes.', error);
      }
    }, 700);
  }

  function githubRequest(options) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest indisponivel.'));
        return;
      }
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: options.url,
        headers: options.headers || {},
        data: options.data,
        onload: resolve,
        onerror: () => reject(new Error('Falha de rede ao acessar o GitHub.')),
        ontimeout: () => reject(new Error('Tempo esgotado ao acessar o GitHub.'))
      });
    });
  }

  function parseGithubError(response) {
    try {
      const parsed = JSON.parse(response.responseText || '{}');
      if (parsed && parsed.message) return parsed.message;
    } catch (_) {}
    return `GitHub respondeu com status ${response.status}.`;
  }

  async function pushBackupToGist(backupSettings, payload) {
    if (!backupSettings.gistId) throw new Error('Informe o Gist ID.');
    if (!backupSettings.token) throw new Error('Informe o token do GitHub.');
    const response = await githubRequest({
      method: 'PATCH',
      url: `https://api.github.com/gists/${encodeURIComponent(backupSettings.gistId)}`,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${backupSettings.token}`,
        'Content-Type': 'application/json'
      },
      data: JSON.stringify({
        files: {
          [backupSettings.fileName]: {
            content: JSON.stringify(payload, null, 2)
          }
        }
      })
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(parseGithubError(response));
    }
    return JSON.parse(response.responseText || '{}');
  }

  async function readBackupFromGist(backupSettings) {
    if (!backupSettings.gistId) throw new Error('Informe o Gist ID.');
    if (!backupSettings.token) throw new Error('Informe o token do GitHub.');
    const response = await githubRequest({
      method: 'GET',
      url: `https://api.github.com/gists/${encodeURIComponent(backupSettings.gistId)}`,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${backupSettings.token}`
      }
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(parseGithubError(response));
    }
    const gist = JSON.parse(response.responseText || '{}');
    const file = gist && gist.files ? gist.files[backupSettings.fileName] : null;
    if (!file || !file.content) throw new Error('Arquivo de backup nao encontrado no Gist.');
    return JSON.parse(file.content);
  }

  function injectRootStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_OVERLAY_ID} {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(8, 28, 52, .28);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        z-index: 2147483000;
        font-family: Arial, sans-serif;
      }
      #${PANEL_OVERLAY_ID}[data-open="true"] {
        display: flex;
      }
      #${PANEL_ID} {
        width: min(860px, calc(100vw - 48px));
        max-height: min(80vh, 860px);
        display: flex;
        flex-direction: column;
        background: #fff;
        border: 1px solid #cfdaea;
        border-radius: 16px;
        box-shadow: 0 22px 48px rgba(8, 32, 61, .22);
        overflow: hidden;
      }
      .pjim-panel__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 16px 12px;
        color: #fff;
        background: linear-gradient(180deg, #2f72b8 0%, #245f9d 100%);
      }
      .pjim-panel__head-text {
        min-width: 0;
      }
      .pjim-panel__title {
        margin: 0;
        font-size: 26px;
        font-weight: 700;
      }
      .pjim-panel__subtitle {
        margin-top: 4px;
        font-size: 13px;
        opacity: .92;
      }
      .pjim-panel__close {
        appearance: none;
        border: 0;
        width: 38px;
        min-width: 38px;
        height: 38px;
        border-radius: 999px;
        background: rgba(255, 255, 255, .18);
        color: #fff;
        font-size: 26px;
        line-height: 1;
        cursor: pointer;
      }
      .pjim-panel__close:hover {
        background: rgba(255, 255, 255, .26);
      }
      .pjim-panel__body {
        display: grid;
        gap: 12px;
        padding: 14px;
        background: #f7f9fc;
        overflow: auto;
      }
      .pjim-panel__toolbar {
        display: grid;
        gap: 10px;
      }
      .pjim-panel__search {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        border: 1px solid #c9d6e9;
        border-radius: 12px;
        padding: 10px 12px;
        font: inherit;
      }
      .pjim-panel__checks {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        color: #375272;
        font-size: 14px;
      }
      .pjim-panel__checks label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
      }
      .pjim-panel__meta {
        font-size: 12px;
        color: #61748d;
      }
      .pjim-backup {
        display: grid;
        gap: 8px;
        padding: 12px;
        border: 1px solid #d6e0ef;
        border-radius: 14px;
        background: #fff;
      }
      .pjim-backup__title {
        font-size: 18px;
        font-weight: 700;
        color: #164172;
      }
      .pjim-backup__hint {
        font-size: 12px;
        color: #61748d;
      }
      .pjim-backup__grid {
        display: grid;
        gap: 8px;
      }
      .pjim-backup__grid input {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        border: 1px solid #c9d6e9;
        border-radius: 10px;
        padding: 9px 10px;
        font: inherit;
      }
      .pjim-backup__checks {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        color: #375272;
        font-size: 14px;
      }
      .pjim-backup__checks label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
      }
      .pjim-backup__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .pjim-backup__status,
      .pjim-backup__last {
        font-size: 12px;
        color: #61748d;
      }
      .pjim-list {
        display: grid;
        gap: 10px;
      }
      .pjim-empty {
        padding: 18px;
        border: 1px dashed #cad7ea;
        border-radius: 14px;
        background: #fff;
        color: #5c718b;
        text-align: center;
      }
      .pjim-card {
        display: grid;
        gap: 8px;
        padding: 12px;
        background: #fff;
        border: 1px solid #d6e0ef;
        border-radius: 14px;
      }
      .pjim-card--done {
        opacity: .76;
      }
      .pjim-card__top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .pjim-card__id {
        font-size: 21px;
        font-weight: 700;
        color: #164172;
      }
      .pjim-pill {
        border-radius: 999px;
        padding: 4px 8px;
        font-size: 12px;
        font-weight: 700;
        color: #2d506f;
        background: #e8eff8;
      }
      .pjim-pill--done {
        color: #18663a;
        background: #dff3e5;
      }
      .pjim-pill--late {
        color: #8f2525;
        background: #ffe1e1;
      }
      .pjim-pill--soon {
        color: #805400;
        background: #fff0c7;
      }
      .pjim-card__grid {
        display: grid;
        gap: 6px;
        color: #20364f;
        font-size: 13px;
      }
      .pjim-card__line strong {
        color: #4f6783;
      }
      .pjim-card__movement {
        color: #36506f;
      }
      .pjim-card__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .pjim-card__action {
        appearance: none;
        border: 1px solid #c5d3e7;
        background: #fff;
        color: #1d4d87;
        border-radius: 10px;
        padding: 8px 10px;
        cursor: pointer;
        font: inherit;
      }
      .pjim-card__action:hover {
        background: #eef5ff;
      }
      .pjim-card__action--primary {
        background: #1f69d5;
        border-color: #1f69d5;
        color: #fff;
      }
    `;
    document.head.appendChild(style);
  }

  function injectFrameStyles(targetDoc) {
    if (!targetDoc || targetDoc.getElementById(FRAME_STYLE_ID)) return;
    const style = targetDoc.createElement('style');
    style.id = FRAME_STYLE_ID;
    style.textContent = `
      .pjim-row--marked {
        background: linear-gradient(90deg, rgba(70, 141, 255, 0.16), rgba(70, 141, 255, 0.04)) !important;
      }
      .pjim-row--marked td:first-child,
      .pjim-row--marked td:nth-child(2) {
        box-shadow: inset 4px 0 0 #2f7ae5;
      }
      .pjim-row--done {
        background: linear-gradient(90deg, rgba(72, 178, 115, 0.18), rgba(72, 178, 115, 0.05)) !important;
      }
      .pjim-row--hidden {
        display: none !important;
      }
      table.pjim-table {
        width: 100% !important;
        margin-right: 0 !important;
      }
      table.pjim-table tbody tr td {
        padding-top: 1px !important;
        padding-bottom: 1px !important;
        line-height: 1.15 !important;
      }
      .pjim-inline {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        margin-left: 3px;
        white-space: nowrap;
        vertical-align: middle;
        line-height: 1;
      }
      .pjim-btn {
        appearance: none;
        color: #1d4d87;
        cursor: pointer;
        padding: 0 !important;
        margin: 0 !important;
        min-width: 0 !important;
        width: 18px;
        height: 18px;
        line-height: 1 !important;
        transition: color .15s ease, opacity .15s ease;
        vertical-align: middle;
        text-decoration: none;
        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .pjim-btn i {
        pointer-events: none;
        font-size: 18px;
        line-height: 1;
        display: inline-block;
        vertical-align: middle;
      }
      .pjim-btn:hover {
        background: transparent;
        color: #114b96;
      }
      .pjim-btn[disabled] {
        opacity: .35;
        cursor: default;
      }
      .pjim-btn[disabled]:hover {
        background: transparent;
        color: #1d4d87;
      }
      .pjim-btn[aria-disabled="true"] {
        opacity: .35;
        cursor: default;
        pointer-events: none;
      }
      .pjim-btn--active {
        background: transparent;
        color: #2f7ae5;
      }
      .pjim-btn--active:hover {
        background: transparent;
        color: #2466c5;
      }
      .pjim-native-host {
        white-space: nowrap;
        vertical-align: middle !important;
      }
      .pjim-quantity-row td {
        background: #cfcfcf !important;
        font-weight: 700;
        text-align: right !important;
        padding-right: 10px !important;
        line-height: 1.1 !important;
      }
    `;
    (targetDoc.head || targetDoc.documentElement).appendChild(style);
  }

  function ensureFontAwesome(targetDoc) {
    if (!targetDoc || targetDoc.getElementById(`${SCRIPT_ID}-fa`)) return;
    const link = targetDoc.createElement('link');
    link.id = `${SCRIPT_ID}-fa`;
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.2.0/css/all.min.css';
    (targetDoc.head || targetDoc.documentElement).appendChild(link);
  }

  function registerMenuCommand() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    if (state.menuRegistered && state.menuCommandId !== null && typeof GM_unregisterMenuCommand === 'function') {
      safeRun('Falha ao remover o item anterior do menu do Tampermonkey.', () => {
        GM_unregisterMenuCommand(state.menuCommandId);
      });
    }
    state.menuCommandId = GM_registerMenuCommand('Gerenciar intimacoes', () => {
      state.store.ui.panelOpen = !state.store.ui.panelOpen;
      persistStore();
      ensureUi();
      updatePanelVisibility();
    });
    state.menuRegistered = true;
  }

  function bindIframe() {
    const iframe = document.querySelector(MAIN_IFRAME_SELECTOR);
    if (!iframe || iframe === state.iframe) return;
    if (state.iframe && state.iframeLoadHandler) {
      state.iframe.removeEventListener('load', state.iframeLoadHandler);
    }
    state.iframe = iframe;
    state.iframeLoadHandler = () => {
      state.rowCache = new WeakMap();
      refreshContext();
      installObserver();
    };
    iframe.addEventListener('load', state.iframeLoadHandler, { passive: true });
  }

  function refreshContext() {
    state.targetDocument = getActiveDocument();
    ensureFontAwesome(state.targetDocument);
    injectFrameStyles(state.targetDocument);
    state.currentTables = findRelevantTables(state.targetDocument);
    if (!state.currentTables.length) {
      teardownUiIfNoItems();
      return;
    }
    renderTables();
    if (state.panel) renderPanel();
  }

  function teardownUiIfNoItems() {
    if (Object.keys(state.store.items).length > 0) {
      if (state.panel) renderPanel();
      return;
    }
    document.getElementById(PANEL_OVERLAY_ID)?.remove();
    state.panel = null;
  }

  function installObserver() {
    if (state.observer) state.observer.disconnect();
    bindIframe();
    const targetDoc = getActiveDocument();
    const root = targetDoc.getElementById('divTabela') || targetDoc.getElementById('divCorpo') || targetDoc.body || targetDoc.documentElement;
    if (!root) return;

    state.observer = new MutationObserver((mutations) => {
      if (!hasRelevantMutation(mutations)) return;
      scheduleRefresh();
    });
    state.observer.observe(root, { childList: true, subtree: true });
  }

  function hasRelevantMutation(mutations) {
    return mutations.some((mutation) => {
      const changedNodes = [mutation.target, ...mutation.addedNodes, ...mutation.removedNodes];
      return changedNodes.some((node) => isRelevantNode(node));
    });
  }

  function isRelevantNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const element = node;
    if (element.matches?.(TABLE_SELECTOR)) return true;
    if (element.closest?.('table')) return true;
    if (element.querySelector?.(TABLE_SELECTOR)) return true;
    if (element.matches?.('fieldset, legend, tbody, tr')) return true;
    return false;
  }

  function scheduleRefresh() {
    if (state.refreshTimer) window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => {
      state.refreshTimer = 0;
      bindIframe();
      refreshContext();
    }, 140);
  }

  function getActiveDocument() {
    const iframe = document.querySelector(MAIN_IFRAME_SELECTOR);
    if (iframe) {
      const iframeDoc = safeRun('Falha ao acessar o documento do iframe principal.', () => iframe.contentDocument, null);
      if (iframeDoc && iframeDoc.body) return iframeDoc;
    }
    return document;
  }

  function findRelevantTables(targetDoc) {
    return Array.from(targetDoc.querySelectorAll(TABLE_SELECTOR)).filter((table) => {
      const headerMap = getHeaderMap(table);
      if (headerMap.intimacao < 0 || headerMap.processo < 0 || headerMap.movimentacao < 0) return false;
      const legend = table.closest('fieldset')?.querySelector('legend')?.textContent || '';
      const title = targetDoc.querySelector('h1,h2,.Titulo,.titulo')?.textContent || '';
      const bodyText = targetDoc.body?.textContent || '';
      const isIntimacoesPage =
        isIntimationContextText(title) ||
        isIntimationContextText(bodyText) ||
        /consultar intima/i.test(normalizeText(bodyText));
      return isIntimationContextText(legend) || isIntimacoesPage;
    });
  }

  function isIntimationContextText(value) {
    const text = normalizeText(value);
    return text.includes('intimac') || text.includes('citac');
  }

  function getHeaderMap(table) {
    const headers = Array.from(table.querySelectorAll('thead th')).map((th, index) => ({
      index,
      text: normalizeText(th.textContent)
    }));

    const findIndex = (...patterns) => {
      const match = headers.find(({ text }) => patterns.some((pattern) => text.includes(pattern)));
      return match ? match.index : -1;
    };
    const findLastIndex = (...patterns) => {
      const matches = headers.filter(({ text }) => patterns.some((pattern) => text.includes(pattern)));
      return matches.length ? matches[matches.length - 1].index : -1;
    };

    return {
      intimacao: findIndex('num.', 'num', 'número', 'numero'),
      processo: findIndex('processo'),
      movimentacao: findIndex('movimentação', 'movimentacao'),
      dataBase: findIndex('data leitura', 'data publicação', 'data publicacao'),
      prazo: findIndex('possível data limite', 'possivel data limite', 'data limite'),
      marcar: findIndex('marcar'),
      detalhes: findIndex('detalhes'),
      tipo: findIndex('tipo'),
      actionHost: findLastIndex('opcoes', 'opções', 'opcoes', 'marcar', 'descartar', 'detalhes')
    };
  }

  function extractRowData(row, headerMap) {
    const cells = Array.from(row.children);
    const id = getCellText(cells[headerMap.intimacao]);
    const processNumber = getCellText(cells[headerMap.processo]);
    const movement = getCellText(cells[headerMap.movimentacao]);

    if (!id || !/^\d+$/.test(id) || !processNumber) return null;

    const baseUrl = row.ownerDocument?.location?.href || window.location.href;
    const processLink = extractTargetFromElement(
      findNavigationElement(
        cells[headerMap.processo],
        'a[href*="BuscaProcesso"], button[onclick*="BuscaProcesso"], [onclick*="BuscaProcesso"]'
      ),
      baseUrl
    );
    const processActionSelector = 'a[href*="BuscaProcesso"], button[onclick*="BuscaProcesso"], [onclick*="BuscaProcesso"]';
    const nativeMarkButton = headerMap.marcar >= 0
      ? findNavigationElement(
        cells[headerMap.marcar],
        'button[onclick*="DescartarPendenciaProcesso"], a[href*="DescartarPendenciaProcesso"], button[title*="marcar" i], a[title*="marcar" i]'
      )
      : row.querySelector('button[title*="marcar" i], a[title*="marcar" i], button[onclick*="DescartarPendenciaProcesso" i], a[href*="DescartarPendenciaProcesso" i]');
    const type = headerMap.tipo >= 0 ? getCellText(cells[headerMap.tipo]) : 'Intimacao';
    const observedAt = headerMap.dataBase >= 0 ? getCellText(cells[headerMap.dataBase]) : '';
    const deadline = headerMap.prazo >= 0 ? getCellText(cells[headerMap.prazo]) : '';
    const sourceLegend = row.closest('fieldset')?.querySelector('legend')?.textContent?.trim() || '';
    const nativeMarkHref = extractTargetFromElement(nativeMarkButton, baseUrl);
    const isNativeDone = /finalizada=true/i.test(nativeMarkHref);

    return {
      id,
      processNumber,
      processLink,
      processActionSelector,
      movement,
      type,
      observedAt,
      deadline,
      sourceLegend,
      nativeMarkHref,
      isNativeDone
    };
  }

  function renderTables() {
    const markedIds = new Set(Object.keys(state.store.items));
    state.currentTables.forEach((table) => {
      table.classList.add('pjim-table');
      const headerMap = getHeaderMap(table);
      Array.from(table.tBodies).forEach((tbody) => {
        Array.from(tbody.rows).forEach((row) => renderRow(row, headerMap, markedIds));
      });
    });
  }

  function renderRow(row, headerMap, markedIds) {
    const cells = Array.from(row.children);
    const rowData = extractRowData(row, headerMap);
    if (!rowData) return;

    const storedItem = state.store.items[rowData.id];
    if (storedItem) mergeObservedData(rowData.id, rowData);

    const effectiveItem = state.store.items[rowData.id];
    const signature = JSON.stringify({
      id: rowData.id,
      process: rowData.processNumber,
      movement: rowData.movement,
      observedAt: rowData.observedAt,
      deadline: rowData.deadline,
      marked: Boolean(effectiveItem),
      done: Boolean(effectiveItem && effectiveItem.done),
      onlyMarkedOnPage: Boolean(state.store.ui.onlyMarkedOnPage)
    });

    if (state.rowCache.get(row) === signature) return;
    state.rowCache.set(row, signature);

    row.classList.remove('pjim-row--marked', 'pjim-row--done', 'pjim-row--hidden');

    if (effectiveItem) {
      row.classList.add('pjim-row--marked');
      if (effectiveItem.done) row.classList.add('pjim-row--done');
    }

    if (state.store.ui.onlyMarkedOnPage && !markedIds.has(rowData.id)) {
      row.classList.add('pjim-row--hidden');
    }

    const actionCellIndex = headerMap.actionHost >= 0 ? headerMap.actionHost : Math.max(headerMap.marcar, headerMap.detalhes);
    const actionCell = actionCellIndex >= 0 ? cells[actionCellIndex] : null;
    if (!actionCell) return;
    actionCell.classList.add('pjim-native-host');
    actionCell.querySelector('.pjim-inline')?.remove();

    const markButton = document.createElement('span');
    markButton.className = `pjim-btn${effectiveItem ? ' pjim-btn--active' : ''}`;
    markButton.setAttribute('role', 'button');
    markButton.tabIndex = 0;
    markButton.title = effectiveItem ? 'Remover das minhas intimacoes' : 'Marcar como minha';
    markButton.innerHTML = effectiveItem
      ? '<i class="fa-solid fa-star fa-lg" aria-hidden="true"></i>'
      : '<i class="fa-regular fa-star fa-lg" aria-hidden="true"></i>';
    bindInlineAction(markButton, () => toggleMarked(rowData));

    const doneButton = document.createElement('span');
    doneButton.className = `pjim-btn${effectiveItem && effectiveItem.done ? ' pjim-btn--active' : ''}`;
    doneButton.setAttribute('role', 'button');
    doneButton.tabIndex = effectiveItem ? 0 : -1;
    doneButton.title = effectiveItem ? (effectiveItem.done ? 'Reabrir intimacao' : 'Marcar como concluida') : 'Marque primeiro como sua';
    doneButton.innerHTML = '<i class="fa-solid fa-check fa-lg" aria-hidden="true"></i>';
    if (!effectiveItem) {
      doneButton.setAttribute('aria-disabled', 'true');
    } else {
      bindInlineAction(doneButton, () => toggleDone(rowData.id));
    }

    const actions = document.createElement('span');
    actions.className = 'pjim-inline';
    actions.append(markButton, doneButton);
    actionCell.appendChild(actions);
  }

  function toggleMarked(rowData) {
    const current = state.store.items[rowData.id];
    if (current) {
      delete state.store.items[rowData.id];
      persistStore();
      renderPanel();
      renderTables();
      return;
    }

    state.store.items[rowData.id] = {
      id: rowData.id,
      processNumber: rowData.processNumber,
      processLink: rowData.processLink || '',
      processActionSelector: rowData.processActionSelector || '',
      movement: rowData.movement,
      type: rowData.type,
      observedAt: rowData.observedAt,
      deadline: rowData.deadline,
      sourceLegend: rowData.sourceLegend,
      nativeMarkHref: rowData.nativeMarkHref || '',
      nativeDone: Boolean(rowData.isNativeDone),
      done: Boolean(rowData.isNativeDone),
      updatedAt: new Date().toISOString()
    };

    persistStore();
    renderPanel();
    renderTables();
  }

  function toggleDone(id) {
    const item = state.store.items[id];
    if (!item) return;
    item.done = !item.done;
    item.updatedAt = new Date().toISOString();
    persistStore();
    renderPanel();
    renderTables();
  }

  function mergeObservedData(id, observedData) {
    const item = state.store.items[id];
    if (!item) return;
    item.processNumber = observedData.processNumber || item.processNumber;
    item.processLink = observedData.processLink || item.processLink;
    item.processActionSelector = observedData.processActionSelector || item.processActionSelector;
    item.movement = observedData.movement || item.movement;
    item.type = observedData.type || item.type;
    item.observedAt = observedData.observedAt || item.observedAt;
    item.deadline = observedData.deadline || item.deadline;
    item.sourceLegend = observedData.sourceLegend || item.sourceLegend;
    item.nativeMarkHref = observedData.nativeMarkHref || item.nativeMarkHref;
    item.nativeDone = Boolean(observedData.isNativeDone);
  }

  function ensureUi() {
    if (!state.panel) {
      const overlay = document.createElement('div');
      overlay.id = PANEL_OVERLAY_ID;
      overlay.dataset.open = 'false';
      overlay.innerHTML = `
        <section id="${PANEL_ID}" role="dialog" aria-modal="true" aria-label="Gerenciar intimacoes">
          <div class="pjim-panel__header">
            <div class="pjim-panel__head-text">
              <div class="pjim-panel__title">Minhas Intimacoes</div>
              <div class="pjim-panel__subtitle">Triagem por numero da intimacao.</div>
            </div>
            <button type="button" class="pjim-panel__close" title="Fechar">x</button>
          </div>
          <div class="pjim-panel__body">
            <div class="pjim-panel__toolbar">
              <input class="pjim-panel__search" type="search" placeholder="Buscar intimacao, processo ou texto" />
              <div class="pjim-panel__checks">
                <label><input type="checkbox" data-role="hide-done" /> Ocultar concluidas</label>
                <label><input type="checkbox" data-role="only-marked-page" /> Ocultar nao marcadas na pagina</label>
              </div>
              <div class="pjim-panel__meta"></div>
            </div>
            <section class="pjim-backup">
              <div class="pjim-backup__title">Backup remoto</div>
              <div class="pjim-backup__hint">Use um unico Gist no GitHub e um arquivo separado para este script.</div>
              <div class="pjim-backup__grid">
                <input type="text" data-role="backup-gist-id" placeholder="Gist ID" />
                <input type="password" data-role="backup-token" placeholder="Token do GitHub" />
                <input type="text" data-role="backup-file-name" placeholder="Nome do arquivo" />
              </div>
              <div class="pjim-backup__checks">
                <label><input type="checkbox" data-role="backup-enabled" /> Ativar backup por Gist no GitHub.</label>
                <label><input type="checkbox" data-role="backup-auto" /> Backup automatico</label>
              </div>
              <div class="pjim-backup__actions">
                <button type="button" class="pjim-card__action" data-role="backup-send">Enviar backup</button>
                <button type="button" class="pjim-card__action" data-role="backup-restore">Restaurar backup</button>
                <button type="button" class="pjim-card__action" data-role="backup-clear">Limpar backup</button>
              </div>
              <div class="pjim-backup__status" data-role="backup-status"></div>
              <div class="pjim-backup__last" data-role="backup-last">Ultimo backup: ainda nao enviado.</div>
            </section>
            <div class="pjim-list"></div>
          </div>
        </section>
      `;
      document.body.appendChild(overlay);
      state.panel = overlay.querySelector(`#${PANEL_ID}`);

      overlay.addEventListener('click', (event) => {
        if (event.target !== overlay) return;
        state.store.ui.panelOpen = false;
        persistStore();
        updatePanelVisibility();
      });

      state.panel?.querySelector('.pjim-panel__close')?.addEventListener('click', () => {
        state.store.ui.panelOpen = false;
        persistStore();
        updatePanelVisibility();
      });

      state.panel?.querySelector('.pjim-panel__search')?.addEventListener('input', (event) => {
        const input = event.currentTarget;
        state.store.ui.query = input.value || '';
        persistStore();
        renderPanel();
      });

      state.panel?.querySelector('[data-role="hide-done"]')?.addEventListener('change', (event) => {
        const input = event.currentTarget;
        state.store.ui.hideDone = input.checked;
        persistStore();
        renderPanel();
      });

      state.panel?.querySelector('[data-role="only-marked-page"]')?.addEventListener('change', (event) => {
        const input = event.currentTarget;
        state.store.ui.onlyMarkedOnPage = input.checked;
        persistStore();
        renderTables();
      });

      const backupEnabled = state.panel?.querySelector('[data-role="backup-enabled"]');
      const backupGistId = state.panel?.querySelector('[data-role="backup-gist-id"]');
      const backupToken = state.panel?.querySelector('[data-role="backup-token"]');
      const backupFileName = state.panel?.querySelector('[data-role="backup-file-name"]');
      const backupAuto = state.panel?.querySelector('[data-role="backup-auto"]');
      const backupSend = state.panel?.querySelector('[data-role="backup-send"]');
      const backupRestore = state.panel?.querySelector('[data-role="backup-restore"]');
      const backupClear = state.panel?.querySelector('[data-role="backup-clear"]');
      const backupStatus = state.panel?.querySelector('[data-role="backup-status"]');
      const backupLast = state.panel?.querySelector('[data-role="backup-last"]');

      const hasBackupUi = [
        backupEnabled,
        backupGistId,
        backupToken,
        backupFileName,
        backupAuto,
        backupSend,
        backupRestore,
        backupClear,
        backupStatus,
        backupLast
      ].every(Boolean);

      const showBackupStatus = (message, type) => {
        if (!hasBackupUi || !backupStatus) return;
        backupStatus.textContent = String(message || '');
        backupStatus.style.color = type === 'err' ? '#b42318' : type === 'ok' ? '#067647' : '';
      };

      const updateBackupLast = () => {
        if (!hasBackupUi || !backupLast) return;
        backupLast.textContent = formatLastBackupLabel(loadBackupSettings().lastBackupAt);
      };

      const readBackupSettingsFromPanel = () => normalizeBackupSettings({
        enabled: backupEnabled?.checked,
        gistId: backupGistId?.value,
        token: backupToken?.value,
        fileName: backupFileName?.value,
        autoBackupOnSave: backupAuto?.checked
      });

      if (hasBackupUi) {
        const backupSettings = loadBackupSettings();
        backupEnabled.checked = backupSettings.enabled;
        backupGistId.value = backupSettings.gistId;
        backupToken.value = backupSettings.token;
        backupFileName.value = backupSettings.fileName;
        backupAuto.checked = backupSettings.autoBackupOnSave;
        updateBackupLast();

        backupSend.addEventListener('click', async () => {
          try {
            const settings = saveBackupSettings(readBackupSettingsFromPanel());
            showBackupStatus('Enviando backup...', '');
            const signature = buildBackupSignature();
            await pushBackupToGist(settings, buildExportPayload());
            saveBackupSettings({ ...settings, lastBackupAt: new Date().toISOString(), lastBackupSignature: signature });
            updateBackupLast();
            showBackupStatus('Backup enviado com sucesso.', 'ok');
          } catch (error) {
            showBackupStatus(error instanceof Error ? error.message : 'Falha ao enviar backup.', 'err');
          }
        });

        backupRestore.addEventListener('click', async () => {
          try {
            const settings = saveBackupSettings(readBackupSettingsFromPanel());
            showBackupStatus('Restaurando backup...', '');
            const payload = await readBackupFromGist(settings);
            state.store.items = payload && payload.items && typeof payload.items === 'object' ? payload.items : Object.create(null);
            persistStore();
            const signature = buildBackupSignature();
            saveBackupSettings({ ...settings, lastBackupSignature: signature });
            renderPanel();
            renderTables();
            showBackupStatus('Backup restaurado com sucesso.', 'ok');
          } catch (error) {
            showBackupStatus(error instanceof Error ? error.message : 'Falha ao restaurar backup.', 'err');
          }
        });

        backupClear.addEventListener('click', () => {
          saveBackupSettings(DEFAULT_BACKUP_SETTINGS);
          backupEnabled.checked = false;
          backupGistId.value = '';
          backupToken.value = '';
          backupFileName.value = SCRIPT_META.fileName;
          backupAuto.checked = false;
          updateBackupLast();
          showBackupStatus('Configuracao de backup limpa.', 'ok');
        });
      }

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && state.store.ui.panelOpen) {
          state.store.ui.panelOpen = false;
          persistStore();
          updatePanelVisibility();
        }
      }, { passive: true });
    }

    updatePanelVisibility();
  }

  function updatePanelVisibility() {
    const overlay = document.getElementById(PANEL_OVERLAY_ID);
    if (!overlay) return;
    overlay.dataset.open = state.store.ui.panelOpen ? 'true' : 'false';
    if (state.store.ui.panelOpen) {
      renderPanel();
    }
  }

  function renderPanel() {
    if (!state.panel) return;
    const searchInput = state.panel.querySelector('.pjim-panel__search');
    const hideDoneInput = state.panel.querySelector('[data-role="hide-done"]');
    const onlyMarkedInput = state.panel.querySelector('[data-role="only-marked-page"]');
    const backupEnabled = state.panel.querySelector('[data-role="backup-enabled"]');
    const backupGistId = state.panel.querySelector('[data-role="backup-gist-id"]');
    const backupToken = state.panel.querySelector('[data-role="backup-token"]');
    const backupFileName = state.panel.querySelector('[data-role="backup-file-name"]');
    const backupAuto = state.panel.querySelector('[data-role="backup-auto"]');
    const backupLast = state.panel.querySelector('[data-role="backup-last"]');
    const meta = state.panel.querySelector('.pjim-panel__meta');
    const list = state.panel.querySelector('.pjim-list');
    if (!list || !meta) return;

    const backupSettings = loadBackupSettings();
    if (searchInput) searchInput.value = state.store.ui.query;
    if (hideDoneInput) hideDoneInput.checked = state.store.ui.hideDone;
    if (onlyMarkedInput) onlyMarkedInput.checked = state.store.ui.onlyMarkedOnPage;
    if (backupEnabled) backupEnabled.checked = backupSettings.enabled;
    if (backupGistId) backupGistId.value = backupSettings.gistId;
    if (backupToken) backupToken.value = backupSettings.token;
    if (backupFileName) backupFileName.value = backupSettings.fileName;
    if (backupAuto) backupAuto.checked = backupSettings.autoBackupOnSave;
    if (backupLast) backupLast.textContent = formatLastBackupLabel(backupSettings.lastBackupAt);

    const items = getFilteredItems();
    meta.textContent = `${items.length} item(ns) visivel(is) • ${Object.keys(state.store.items).length} intimacao(oes) marcada(s).`;

    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'pjim-empty';
      empty.textContent = 'Nenhuma intimacao marcada para este filtro.';
      list.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const card = document.createElement('article');
      card.className = `pjim-card${item.done ? ' pjim-card--done' : ''}`;

      const top = document.createElement('div');
      top.className = 'pjim-card__top';

      const id = document.createElement('div');
      id.className = 'pjim-card__id';
      id.textContent = item.id;

      const pill = document.createElement('div');
      pill.className = `pjim-pill ${resolvePillClass(item)}`.trim();
      pill.textContent = resolvePillLabel(item);
      top.append(id, pill);

      const grid = document.createElement('div');
      grid.className = 'pjim-card__grid';
      grid.innerHTML = `
        <div class="pjim-card__line"><strong>Processo:</strong> ${escapeHtml(item.processNumber || '—')}</div>
        <div class="pjim-card__line"><strong>Prazo:</strong> ${escapeHtml(item.deadline || '—')}</div>
        <div class="pjim-card__line"><strong>Origem:</strong> ${escapeHtml(item.sourceLegend || item.type || 'Intimacao')}</div>
        <div class="pjim-card__movement">${escapeHtml(item.movement || '—')}</div>
      `;

      const actions = document.createElement('div');
      actions.className = 'pjim-card__actions';

      const doneButton = document.createElement('button');
      doneButton.type = 'button';
      doneButton.className = 'pjim-card__action pjim-card__action--primary';
      doneButton.textContent = item.done ? 'Reabrir' : 'Concluir';
      doneButton.addEventListener('click', () => toggleDone(item.id));

      const openProcess = document.createElement('button');
      openProcess.type = 'button';
      openProcess.className = 'pjim-card__action';
      openProcess.textContent = 'Abrir processo';
      openProcess.disabled = !item.processLink;
      openProcess.addEventListener('click', () => openProcessFromPanel(item));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'pjim-card__action';
      remove.textContent = 'Remover';
      remove.addEventListener('click', () => {
        delete state.store.items[item.id];
        persistStore();
        renderPanel();
        renderTables();
      });

      actions.append(doneButton, openProcess, remove);
      card.append(top, grid, actions);
      fragment.appendChild(card);
    });

    list.appendChild(fragment);
  }

  function getFilteredItems() {
    const query = normalizeText(state.store.ui.query);
    const items = Object.values(state.store.items).filter((item) => {
      if (state.store.ui.hideDone && item.done) return false;
      if (!query) return true;
      const haystack = normalizeText([
        item.id,
        item.processNumber,
        item.deadline,
        item.movement,
        item.sourceLegend
      ].join(' '));
      return haystack.includes(query);
    });

    return items.sort((left, right) => {
      const leftTime = parseDateTime(left.deadline) || Number.MAX_SAFE_INTEGER;
      const rightTime = parseDateTime(right.deadline) || Number.MAX_SAFE_INTEGER;
      if (left.done !== right.done) return left.done ? 1 : -1;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return String(left.id).localeCompare(String(right.id), 'pt-BR', { numeric: true });
    });
  }

  function resolvePillClass(item) {
    if (item.done) return 'pjim-pill--done';
    const deadlineTime = parseDateTime(item.deadline);
    if (!deadlineTime) return '';
    const now = Date.now();
    if (deadlineTime < now) return 'pjim-pill--late';
    if (deadlineTime - now <= 2 * 24 * 60 * 60 * 1000) return 'pjim-pill--soon';
    return '';
  }

  function resolvePillLabel(item) {
    if (item.done) return 'Concluida';
    const deadlineTime = parseDateTime(item.deadline);
    if (!deadlineTime) return 'Sem prazo';
    const now = Date.now();
    if (deadlineTime < now) return 'Vencida';
    if (deadlineTime - now <= 2 * 24 * 60 * 60 * 1000) return 'Vencendo';
    return 'Aberta';
  }

  function openProcessFromPanel(item) {
    state.store.ui.panelOpen = false;
    persistStore();
    updatePanelVisibility();
    const targetDoc = getActiveDocument();
    const processAction = findProcessActionElement(targetDoc, item.id);
    if (processAction && typeof processAction.click === 'function') {
      safeRun('Falha ao acionar o link nativo do processo.', () => {
        processAction.click();
      });
      return;
    }
    navigateTo(item.processLink);
  }

  function findProcessActionElement(targetDoc, intimationId) {
    if (!targetDoc || !intimationId) return null;
    for (const table of findRelevantTables(targetDoc)) {
      const headerMap = getHeaderMap(table);
      for (const tbody of Array.from(table.tBodies)) {
        for (const row of Array.from(tbody.rows)) {
          const rowData = extractRowData(row, headerMap);
          if (!rowData || rowData.id !== intimationId) continue;
          const cells = Array.from(row.children);
          return findNavigationElement(
            cells[headerMap.processo],
            'a[href*="BuscaProcesso"], button[onclick*="BuscaProcesso"], [onclick*="BuscaProcesso"]'
          );
        }
      }
    }
    return null;
  }

  function navigateTo(href) {
    if (!href) return;
    const target = resolveUrl(href);
    if (!target) return;
    const iframe = document.querySelector(MAIN_IFRAME_SELECTOR);
    if (iframe) {
      state.iframe = iframe;
      bindIframe();
      safeRun('Falha ao navegar no iframe principal para a URL da intimacao.', () => {
        const frameWindow = iframe.contentWindow || window.frames.userMainFrame || window.frames.Principal || null;
        if (frameWindow && frameWindow.location) {
          try {
            frameWindow.location.replace('about:blank');
            window.setTimeout(() => {
              frameWindow.location.href = target;
            }, 80);
            return;
          } catch (_) {}
        }
        iframe.setAttribute('src', 'about:blank');
        window.setTimeout(() => {
          iframe.setAttribute('src', target);
        }, 80);
      });
      return;
    }
    window.location.assign(target);
  }

  function resolveUrl(href, baseUrl = '') {
    try {
      let normalizedHref = String(href || '').trim().replace(/^['"]|['"]$/g, '');
      if (!normalizedHref) return '';
      if (!/^(https?:|\/)/i.test(normalizedHref)) {
        normalizedHref = `/${normalizedHref}`;
      }
      const effectiveBase = baseUrl || state.targetDocument?.location?.href || window.location.href;
      return new URL(normalizedHref, effectiveBase).toString();
    } catch (error) {
      logWarn('Nao foi possivel resolver a URL da intimacao.', { href, error });
      return '';
    }
  }

  function findNavigationElement(root, preferredSelector = '') {
    if (!root || !(root instanceof Element)) return null;
    if (preferredSelector) {
      const preferred = root.querySelector(preferredSelector);
      if (preferred) return preferred;
    }
    return root.querySelector('a[href], button[onclick], [onclick], [href]') || null;
  }

  function extractTargetFromElement(element, baseUrl = '') {
    if (!element || !(element instanceof Element)) return '';
    const href = element.getAttribute('href');
    const rawTarget = href ? href.replace(/&amp;/g, '&') : extractHref(element.getAttribute('onclick'));
    if (!rawTarget) return '';
    return resolveUrl(rawTarget, baseUrl);
  }

  function extractHref(onclickValue) {
    if (!onclickValue) return '';
    const locationMatch = onclickValue.match(/(?:window\.)?location\.href\s*=\s*['"]([^'"]+)['"]/i);
    if (locationMatch) return locationMatch[1].replace(/&amp;/g, '&');
    const genericMatch = onclickValue.match(/['"]([^'"]*(?:Pendencia|BuscaProcesso|DescartarPendenciaProcesso)[^'"]*)['"]/i);
    return genericMatch ? genericMatch[1].replace(/&amp;/g, '&') : '';
  }

  function getCellText(cell) {
    return normalizeSpaces(cell?.textContent || '');
  }

  function bindInlineAction(element, handler) {
    element.addEventListener('click', handler);
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      handler();
    });
  }

  function normalizeText(value) {
    return normalizeSpaces(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function normalizeSpaces(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseDateTime(value) {
    const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
    if (!match) return 0;
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = match;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    ).getTime();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
