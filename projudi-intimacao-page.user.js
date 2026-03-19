// ==UserScript==
// @name         Intimações
// @namespace    projudi-intimacao-page.user.js
// @version      3.0
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
