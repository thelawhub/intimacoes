// ==UserScript==
// @name         Intimações
// @namespace    projudi-intimacao-page.user.js
// @version      3.9
// @icon         https://img.icons8.com/ios-filled/100/scales--v1.png
// @description  Reúne intimações em uma página, exporta CSV/PDF e permite triagem local com foco em baixo consumo de memória.
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

  if (window.top !== window.self) return;

  const SCRIPT_NAME = 'Intimações';
  const SCRIPT_VERSION =
    typeof GM_info !== 'undefined' && GM_info?.script?.version
      ? String(GM_info.script.version)
      : '3.8';
  const LOG_PREFIX = '[Intimações]';

  const SELECTORS = {
    mainFrame: 'iframe#Principal, iframe[name="userMainFrame"]',
    title: 'h1, h2, .Titulo, .titulo',
    table: 'table',
    relevantTable: 'table.Tabela, table#Tabela',
    pager: '#Paginacao, .Paginacao',
    pagerClickable: '#Paginacao a, #Paginacao button, .Paginacao a, .Paginacao button, .BotaoIr, a[href*="buscaDados"], [onclick*="buscaDados"]',
    processAction: 'a[href*="BuscaProcesso"], button[onclick*="BuscaProcesso"], [onclick*="BuscaProcesso"]',
    nativeDoneAction:
      'button[onclick*="DescartarPendenciaProcesso"], a[href*="DescartarPendenciaProcesso"], button[title*="marcar" i], a[title*="marcar" i]'
  };

  const IDS = {
    hostStyle: 'pjip-host-style',
    frameStyle: 'pjip-frame-style',
    hostRoot: 'pjip-root',
    actionsPanel: 'pjip-actions-panel',
    actionsFab: 'pjip-actions-fab',
    toast: 'pjip-toast',
    modalOverlay: 'pjip-modal-overlay',
    modalPanel: 'pjip-modal-panel'
  };

  const STORAGE_KEYS = {
    store: 'pj-intimacoes-marcadas::store',
    backup: 'pj-intimacoes-marcadas::backup'
  };

  const BACKUP_DEFAULTS = {
    enabled: false,
    gistId: '',
    token: '',
    fileName: 'projudi-intimacao-page.json',
    autoBackupOnSave: false,
    lastBackupAt: '',
    lastBackupSignature: ''
  };

  const PRIVATE = {
    tableContext: Symbol('tableContext'),
    frameHooks: Symbol('frameHooks'),
    patchFlag: Symbol('patchFlag'),
    refreshToken: Symbol('refreshToken'),
    rowSignature: Symbol('rowSignature')
  };

  const PDF_CDNS = {
    jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
    autoTable: 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'
  };

  /** @type {{
   * frame: HTMLIFrameElement | null,
   * frameDoc: Document | null,
   * frameWin: Window | null,
   * frameLoadHandler: ((event: Event) => void) | null,
   * pageContext: ReturnType<typeof analyzeFrameContext> | null,
   * pageSignature: string,
   * refreshTimers: number[],
   * refreshNonce: number,
   * menuCommandId: number | null,
   * hostHooksAttached: boolean,
   * menuOpen: boolean,
   * modalOpen: boolean,
   * modalRoot: HTMLElement | null,
   * toastTimer: number,
   * backupTimer: number,
   * pdfPromise: Promise<void> | null,
   * store: ReturnType<typeof loadStore>
   * }}
   */
  const state = {
    frame: null,
    frameDoc: null,
    frameWin: null,
    frameLoadHandler: null,
    pageContext: null,
    pageSignature: '',
    refreshTimers: [],
    refreshNonce: 0,
    menuCommandId: null,
    hostHooksAttached: false,
    menuOpen: false,
    modalOpen: false,
    modalRoot: null,
    toastTimer: 0,
    backupTimer: 0,
    pdfPromise: null,
    store: loadStore()
  };

  init();

  /**
   * Inicializa o script com o menor numero possivel de hooks permanentes.
   */
  function init() {
    injectHostStyles();
    attachHostHooks();
    registerMenuCommand();
    ensureActionMenu();
    updateActionPanelState();
    bindMainFrame();
  }

  /**
   * Anexa hooks globais uma unica vez.
   */
  function attachHostHooks() {
    if (state.hostHooksAttached) return;
    state.hostHooksAttached = true;

    document.addEventListener(
      'click',
      (event) => {
        const target = resolveEventElement(event.target);
        if (!target) return;
        const root = document.getElementById(IDS.hostRoot);
        if (root && !root.contains(target)) {
          state.menuOpen = false;
          updateActionPanelState();
        }
      },
      true
    );

    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        state.menuOpen = false;
        updateActionPanelState();
        if (state.modalOpen) closeModal();
      },
      true
    );
  }

  /**
   * Escreve log de informacao pontual.
   * @param {string} message
   * @param {unknown=} details
   */
  function logInfo(message, details) {
    if (details === undefined) {
      console.info(LOG_PREFIX, message);
      return;
    }
    console.info(LOG_PREFIX, message, details);
  }

  /**
   * Escreve log de alerta.
   * @param {string} message
   * @param {unknown=} details
   */
  function logWarn(message, details) {
    if (details === undefined) {
      console.warn(LOG_PREFIX, message);
      return;
    }
    console.warn(LOG_PREFIX, message, details);
  }

  /**
   * Escreve log de erro.
   * @param {string} message
   * @param {unknown} error
   */
  function logError(message, error) {
    console.error(LOG_PREFIX, message, error);
  }

  /**
   * Executa um bloco com tratamento de erro uniforme.
   * @template T
   * @param {string} label
   * @param {() => T} task
   * @param {T=} fallbackValue
   * @returns {T | undefined}
   */
  function safeRun(label, task, fallbackValue) {
    try {
      return task();
    } catch (error) {
      logError(label, error);
      return fallbackValue;
    }
  }

  /**
   * Obtém o iframe principal do Projudi.
   * @returns {HTMLIFrameElement | null}
   */
  function findMainFrame() {
    return /** @type {HTMLIFrameElement | null} */ (document.querySelector(SELECTORS.mainFrame));
  }

  /**
   * Vincula o script ao iframe principal e reutiliza o mesmo listener.
   */
  function bindMainFrame() {
    const frame = findMainFrame();
    if (!frame || frame === state.frame) return;

    if (state.frame && state.frameLoadHandler) {
      state.frame.removeEventListener('load', state.frameLoadHandler);
    }

    state.frame = frame;
    state.frameLoadHandler = () => {
      onFrameLoaded(frame);
    };

    frame.addEventListener('load', state.frameLoadHandler, { passive: true });
    onFrameLoaded(frame);
  }

  /**
   * Reage ao carregamento do iframe sem manter observers permanentes.
   * @param {HTMLIFrameElement} frame
   */
  function onFrameLoaded(frame) {
    clearRefreshTimers();
    state.frameDoc = safeRun('Falha ao acessar o documento do iframe principal.', () => frame.contentDocument, null) || null;
    state.frameWin = safeRun('Falha ao acessar a janela do iframe principal.', () => frame.contentWindow, null) || null;
    if (!state.frameDoc || !state.frameDoc.body) return;

    state.pageContext = null;
    state.pageSignature = '';
    attachFrameHooks(state.frameDoc);
    patchFrameFunctions(state.frameWin);
    refreshFrameContext('frame-load');
  }

  /**
   * Anexa hooks leves ao documento do iframe.
   * Em vez de observar a arvore inteira, o script reage apenas a eventos relevantes.
   * @param {Document} doc
   */
  function attachFrameHooks(doc) {
    if (doc[PRIVATE.frameHooks]) return;
    doc[PRIVATE.frameHooks] = true;

    doc.addEventListener(
      'click',
      (event) => {
        handleFrameClick(event);
      },
      true
    );
  }

  /**
   * Encapsula funcoes de paginacao conhecidas para reagir a atualizacoes AJAX
   * sem depender de MutationObserver continuo.
   * @param {Window | null} frameWin
   */
  function patchFrameFunctions(frameWin) {
    if (!frameWin) return;

    const candidates = ['buscaDados'];
    for (const functionName of candidates) {
      const current = safeRun(`Falha ao acessar ${functionName}.`, () => frameWin[functionName], null);
      if (typeof current !== 'function') continue;
      if (current[PRIVATE.patchFlag]) continue;

      const wrapped = function (...args) {
        const result = current.apply(this, args);
        scheduleRefreshBurst(`${functionName}-call`);
        return result;
      };

      wrapped[PRIVATE.patchFlag] = true;
      frameWin[functionName] = wrapped;
    }
  }

  /**
   * Decide o que precisa ser feito apos um clique dentro do iframe.
   * @param {MouseEvent} event
   */
  function handleFrameClick(event) {
    const target = resolveEventElement(event.target);
    if (!target) return;

    const pagerAction = target.closest(SELECTORS.pagerClickable);
    if (pagerAction) {
      scheduleRefreshBurst('pager-click');
    }
  }

  /**
   * Agenda um pequeno burst de refreshes para capturar atualizacoes AJAX
   * sem manter observers vivos durante toda a sessao.
   * @param {string} reason
   */
  function scheduleRefreshBurst(reason) {
    clearRefreshTimers();
    const nonce = ++state.refreshNonce;
    const delays = [120, 450, 1200];

    for (const delay of delays) {
      const timer = window.setTimeout(() => {
        if (state.refreshNonce !== nonce) return;
        refreshFrameContext(`${reason}:${delay}`);
      }, delay);
      state.refreshTimers.push(timer);
    }
  }

  /**
   * Limpa timers de refresh pendentes.
   */
  function clearRefreshTimers() {
    for (const timer of state.refreshTimers) window.clearTimeout(timer);
    state.refreshTimers = [];
  }

  /**
   * Reconstrói o contexto da pagina atual.
   * @param {string} reason
   */
  function refreshFrameContext(reason) {
    bindMainFrame();
    ensureActionMenu();
    if (!state.frame || !state.frameDoc) {
      updateActionMenuVisibility({ isIntimationPage: false });
      if (state.modalOpen) renderModal();
      return;
    }

    const nextContext = analyzeFrameContext(state.frame, state.frameDoc);
    state.pageContext = nextContext;
    updateActionMenuVisibility(nextContext);

    if (!nextContext.isIntimationPage) {
      state.pageSignature = '';
      if (state.modalOpen) renderModal();
      return;
    }

    injectFrameStyles(nextContext.doc);
    const nextSignature = buildPageSignature(nextContext);
    const shouldSyncRows =
      nextSignature !== state.pageSignature ||
      reason === 'inline-action' ||
      reason === 'frame-load';
    state.pageSignature = nextSignature;

    if (shouldSyncRows) {
      syncPageRows(nextContext);
    }

    if (state.modalOpen) {
      renderModal();
    }
  }

  /**
   * Analisa o iframe com uma unica passada sobre as tabelas.
   * @param {HTMLIFrameElement} frame
   * @param {Document} doc
   * @returns {{
   *   doc: Document,
   *   url: string,
   *   title: string,
   *   isIntimationPage: boolean,
   *   mainTable: HTMLTableElement | null,
   *   markTables: Array<{table: HTMLTableElement, headerMap: ReturnType<typeof createHeaderMap>, legend: string}>
   * }}
   */
  function analyzeFrameContext(frame, doc) {
    const title = normalizeSpaces(doc.querySelector(SELECTORS.title)?.textContent || '');
    const url = safeRun('Falha ao ler URL do iframe.', () => frame.contentWindow?.location?.href || doc.location.href, '') || '';
    const relevantTables = Array.from(doc.querySelectorAll(SELECTORS.relevantTable));
    const tables = relevantTables.length ? relevantTables : Array.from(doc.querySelectorAll(SELECTORS.table));

    let mainTable = null;
    let mainScore = -1;
    /** @type {Array<{table: HTMLTableElement, headerMap: ReturnType<typeof createHeaderMap>, legend: string}>} */
    const markTables = [];

    for (const candidate of tables) {
      const table = /** @type {HTMLTableElement} */ (candidate);
      const headerMap = createHeaderMap(table);
      const score = scoreMainTable(table, headerMap);
      if (score > mainScore) {
        mainScore = score;
        mainTable = table;
      }

      if (isStructuredIntimationTable(table, headerMap)) {
        const legend = normalizeSpaces(table.closest('fieldset')?.querySelector('legend')?.textContent || '');
        table[PRIVATE.tableContext] = headerMap;
        markTables.push({ table, headerMap, legend });
      }
    }

    const isIntimationPage = markTables.length > 0;

    return {
      doc,
      url,
      title,
      isIntimationPage,
      mainTable,
      markTables
    };
  }

  /**
   * Gera uma assinatura pequena da pagina para evitar trabalho repetido.
   * @param {ReturnType<typeof analyzeFrameContext>} context
   * @returns {string}
   */
  function buildPageSignature(context) {
    const parts = [context.url, context.title, String(context.markTables.length)];
    for (const entry of context.markTables) {
      parts.push(String(entry.table.tBodies[0]?.rows.length || 0));
      const firstDataRow = findFirstDataRow(entry.table);
      parts.push(firstDataRow ? normalizeSpaces(firstDataRow.textContent || '').slice(0, 80) : '');
    }
    return parts.join('|');
  }

  /**
   * Detecta primeiro tr com td.
   * @param {HTMLTableElement} table
   * @returns {HTMLTableRowElement | null}
   */
  function findFirstDataRow(table) {
    for (const body of Array.from(table.tBodies)) {
      for (const row of Array.from(body.rows)) {
        if (row.querySelector('td')) return row;
      }
    }
    return null;
  }

  /**
   * Pontua a tabela principal de intimações.
   * @param {HTMLTableElement} table
   * @param {ReturnType<typeof createHeaderMap>} headerMap
   * @returns {number}
   */
  function scoreMainTable(table, headerMap) {
    if (!isStructuredIntimationTable(table, headerMap)) return 0;
    let score = 0;
    if (headerMap.intimationId >= 0) score += 2;
    if (headerMap.process >= 0) score += 2;
    if (headerMap.movement >= 0) score += 3;
    if (headerMap.kind >= 0) score += 1;
    if (headerMap.deadline >= 0) score += 2;
    if (headerMap.baseDate >= 0) score += 2;
    if (headerMap.mark >= 0) score += 1;
    if (hasNativeIntimationAction(table)) score += 2;
    if (table.matches(SELECTORS.relevantTable)) score += 1;
    return score;
  }

  /**
   * Verifica se a tabela possui estrutura de pendências/intimações do Projudi.
   * @param {HTMLTableElement} table
   * @param {ReturnType<typeof createHeaderMap>} headerMap
   * @returns {boolean}
   */
  function isStructuredIntimationTable(table, headerMap) {
    const hasCoreColumns = headerMap.intimationId >= 0 && headerMap.process >= 0 && headerMap.movement >= 0;
    if (!hasCoreColumns) return false;
    return (
      headerMap.baseDate >= 0 ||
      headerMap.deadline >= 0 ||
      headerMap.mark >= 0 ||
      hasNativeIntimationAction(table)
    );
  }

  /**
   * Detecta ações nativas de pendência/intimação na tabela.
   * @param {ParentNode | null} root
   * @returns {boolean}
   */
  function hasNativeIntimationAction(root) {
    if (!root || typeof root.querySelector !== 'function') return false;
    return Boolean(root.querySelector(SELECTORS.nativeDoneAction));
  }

  /**
   * Cria o mapa semantico de colunas com uma unica leitura de cabecalho.
   * @param {HTMLTableElement} table
   * @returns {{
   *   intimationId: number,
   *   process: number,
   *   movement: number,
   *   baseDate: number,
   *   deadline: number,
   *   mark: number,
   *   details: number,
   *   kind: number,
   *   actionHost: number
   * }}
   */
  function createHeaderMap(table) {
    const headerCells = Array.from(
      table.querySelectorAll('thead th').length
        ? table.querySelectorAll('thead th')
        : table.querySelectorAll('tr:first-child th, tr:first-child td')
    );
    const normalized = headerCells.map((cell) => normalizeText(cell.textContent || ''));

    const findIndex = (...needles) => normalized.findIndex((value) => needles.some((needle) => value.includes(needle)));
    const findLastIndex = (...needles) => {
      for (let index = normalized.length - 1; index >= 0; index -= 1) {
        if (needles.some((needle) => normalized[index].includes(needle))) return index;
      }
      return -1;
    };

    return {
      intimationId: findIndex('num.', 'num', 'numero', 'número'),
      process: findIndex('processo'),
      movement: findIndex('movimentacao', 'movimentação'),
      baseDate: findIndex('data leitura', 'data publicacao', 'data publicação'),
      deadline: findIndex('possivel data limite', 'possível data limite', 'data limite'),
      mark: findIndex('marcar'),
      details: findIndex('detalhes'),
      kind: findIndex('tipo'),
      actionHost: findLastIndex('opcoes', 'opções', 'opcoes', 'marcar', 'descartar', 'detalhes')
    };
  }

  /**
   * Atualiza as linhas com classes e acoes inline.
   * @param {ReturnType<typeof analyzeFrameContext>} context
   */
  function syncPageRows(context) {
    const markedIds = new Set(Object.keys(state.store.items));

    for (const tableEntry of context.markTables) {
      const { table, headerMap, legend } = tableEntry;
      table.classList.add('pjip-table');

      for (const body of Array.from(table.tBodies)) {
        for (const row of Array.from(body.rows)) {
          syncSingleRow(row, headerMap, legend, markedIds);
        }
      }
    }
  }

  /**
   * Atualiza uma linha individual.
   * @param {HTMLTableRowElement} row
   * @param {ReturnType<typeof createHeaderMap>} headerMap
   * @param {string} legend
   * @param {Set<string>} markedIds
   */
  function syncSingleRow(row, headerMap, legend, markedIds) {
    const rowData = extractRowData(row, headerMap, legend);
    if (!rowData) return;

    if (state.store.items[rowData.id]) {
      mergeObservedItem(rowData.id, rowData);
    }

    const item = state.store.items[rowData.id] || null;
    const rowSignature = `${rowData.id}|${item ? 1 : 0}|${item?.done ? 1 : 0}|${state.store.ui.onlyMarkedOnPage ? 1 : 0}`;
    if (row[PRIVATE.rowSignature] === rowSignature) return;
    row[PRIVATE.rowSignature] = rowSignature;

    row.classList.toggle('pjip-row--marked', Boolean(item));
    row.classList.toggle('pjip-row--done', Boolean(item && item.done));
    row.classList.toggle('pjip-row--hidden', Boolean(state.store.ui.onlyMarkedOnPage && !markedIds.has(rowData.id)));

    const actionCellIndex = headerMap.actionHost >= 0 ? headerMap.actionHost : Math.max(headerMap.mark, headerMap.details, 0);
    const actionCell = /** @type {HTMLTableCellElement | undefined} */ (row.children[actionCellIndex]);
    if (!actionCell) return;
    actionCell.classList.add('pjip-native-host');

    let host = actionCell.querySelector('.pjip-inline');
    if (!host) {
      host = row.ownerDocument.createElement('span');
      host.className = 'pjip-inline';
      actionCell.appendChild(host);
    }

    host.replaceChildren(
      buildInlineButton(
        row.ownerDocument,
        item ? '★' : '☆',
        item ? 'Remover das minhas intimações' : 'Marcar como minha',
        () => toggleMarked(rowData)
      ),
      buildInlineButton(
        row.ownerDocument,
        '✓',
        item ? (item.done ? 'Reabrir intimação' : 'Marcar como concluída') : 'Marque primeiro como sua',
        () => toggleDone(rowData.id),
        !item
      )
    );
  }

  /**
   * Cria um botao inline com binding direto para garantir confiabilidade do clique.
   * @param {Document} doc
   * @param {string} label
   * @param {string} title
   * @param {() => void} onClick
   * @param {boolean=} disabled
   * @returns {HTMLButtonElement}
   */
  function buildInlineButton(doc, label, title, onClick, disabled = false) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'pjip-inline-btn';
    button.textContent = label;
    button.title = title;
    button.disabled = disabled;
    if (!disabled) {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      });
    }
    return button;
  }

  /**
   * Extrai os dados relevantes de uma linha da tabela.
   * @param {HTMLTableRowElement} row
   * @param {ReturnType<typeof createHeaderMap>} headerMap
   * @param {string} legend
   * @returns {{
   *   id: string,
   *   processNumber: string,
   *   processLink: string,
   *   movement: string,
   *   kind: string,
   *   observedAt: string,
   *   deadline: string,
   *   sourceLegend: string,
   *   nativeMarkHref: string,
   *   isNativeDone: boolean
   * } | null}
   */
  function extractRowData(row, headerMap, legend) {
    const cells = Array.from(row.children);
    const id = getCellText(cells[headerMap.intimationId]);
    const processNumber = getCellText(cells[headerMap.process]);
    const movement = getCellText(cells[headerMap.movement]);

    if (!id || !/^\d+$/.test(id) || !processNumber) return null;

    const baseUrl = row.ownerDocument.location?.href || window.location.href;
    const processElement = findNavigationElement(cells[headerMap.process], SELECTORS.processAction);
    const nativeDoneElement =
      headerMap.mark >= 0
        ? findNavigationElement(cells[headerMap.mark], SELECTORS.nativeDoneAction)
        : row.querySelector(SELECTORS.nativeDoneAction);
    const processLink = extractNavigableUrl(processElement, baseUrl);
    const nativeMarkHref = extractNavigableUrl(nativeDoneElement, baseUrl);

    return {
      id,
      processNumber,
      processLink,
      movement,
      kind: headerMap.kind >= 0 ? getCellText(cells[headerMap.kind]) : 'Intimação',
      observedAt: headerMap.baseDate >= 0 ? getCellText(cells[headerMap.baseDate]) : '',
      deadline: headerMap.deadline >= 0 ? getCellText(cells[headerMap.deadline]) : '',
      sourceLegend: legend,
      nativeMarkHref,
      isNativeDone: /finalizada=true/i.test(nativeMarkHref)
    };
  }

  /**
   * Marca ou desmarca uma intimacao.
   * @param {NonNullable<ReturnType<typeof extractRowData>>} rowData
   */
  function toggleMarked(rowData) {
    if (state.store.items[rowData.id]) {
      delete state.store.items[rowData.id];
    } else {
      state.store.items[rowData.id] = {
        id: rowData.id,
        processNumber: rowData.processNumber,
        processLink: rowData.processLink,
        movement: rowData.movement,
        kind: rowData.kind,
        observedAt: rowData.observedAt,
        deadline: rowData.deadline,
        sourceLegend: rowData.sourceLegend,
        nativeMarkHref: rowData.nativeMarkHref,
        nativeDone: Boolean(rowData.isNativeDone),
        done: Boolean(rowData.isNativeDone),
        updatedAt: new Date().toISOString()
      };
    }

    persistStore();
    refreshFrameContext('inline-action');
  }

  /**
   * Alterna o estado de concluida.
   * @param {string} itemId
   */
  function toggleDone(itemId) {
    const item = state.store.items[itemId];
    if (!item) return;
    item.done = !item.done;
    item.updatedAt = new Date().toISOString();
    persistStore();
    refreshFrameContext('inline-action');
  }

  /**
   * Mescla os dados observados em uma linha com o armazenamento local.
   * @param {string} itemId
   * @param {NonNullable<ReturnType<typeof extractRowData>>} rowData
   */
  function mergeObservedItem(itemId, rowData) {
    const item = state.store.items[itemId];
    if (!item) return;
    item.processNumber = rowData.processNumber || item.processNumber;
    item.processLink = rowData.processLink || item.processLink;
    item.movement = rowData.movement || item.movement;
    item.kind = rowData.kind || item.kind;
    item.observedAt = rowData.observedAt || item.observedAt;
    item.deadline = rowData.deadline || item.deadline;
    item.sourceLegend = rowData.sourceLegend || item.sourceLegend;
    item.nativeMarkHref = rowData.nativeMarkHref || item.nativeMarkHref;
    item.nativeDone = Boolean(rowData.isNativeDone);
  }

  /**
   * Le o armazenamento local.
   * @returns {{items: Record<string, any>, ui: {panelOpen: boolean, hideDone: boolean, onlyMarkedOnPage: boolean, query: string}}}
   */
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
      const raw = localStorage.getItem(STORAGE_KEYS.store);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return fallback;
      return {
        items: parsed.items && typeof parsed.items === 'object' ? parsed.items : Object.create(null),
        ui: {
          panelOpen: Boolean(parsed.ui?.panelOpen),
          hideDone: parsed.ui?.hideDone !== false,
          onlyMarkedOnPage: Boolean(parsed.ui?.onlyMarkedOnPage),
          query: typeof parsed.ui?.query === 'string' ? parsed.ui.query : ''
        }
      };
    } catch (error) {
      logWarn('Falha ao carregar dados locais. O armazenamento sera reiniciado.', error);
      return fallback;
    }
  }

  /**
   * Persiste o armazenamento local e agenda backup, se configurado.
   */
  function persistStore() {
    try {
      localStorage.setItem(STORAGE_KEYS.store, JSON.stringify(state.store));
    } catch (error) {
      logError('Falha ao salvar dados locais.', error);
    }
    scheduleAutoBackup();
  }

  /**
   * Normaliza configuracoes de backup.
   * @param {Partial<typeof BACKUP_DEFAULTS>=} value
   * @returns {typeof BACKUP_DEFAULTS}
   */
  function normalizeBackupSettings(value) {
    return {
      enabled: Boolean(value?.enabled),
      gistId: String(value?.gistId || '').trim(),
      token: String(value?.token || '').trim(),
      fileName: String(value?.fileName || BACKUP_DEFAULTS.fileName).trim() || BACKUP_DEFAULTS.fileName,
      autoBackupOnSave: Boolean(value?.autoBackupOnSave),
      lastBackupAt: String(value?.lastBackupAt || '').trim(),
      lastBackupSignature: String(value?.lastBackupSignature || '').trim()
    };
  }

  /**
   * Le configuracoes de backup.
   * @returns {typeof BACKUP_DEFAULTS}
   */
  function loadBackupSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.backup);
      return raw ? normalizeBackupSettings(JSON.parse(raw)) : normalizeBackupSettings(BACKUP_DEFAULTS);
    } catch (error) {
      logWarn('Falha ao carregar configuracoes de backup.', error);
      return normalizeBackupSettings(BACKUP_DEFAULTS);
    }
  }

  /**
   * Salva configuracoes de backup.
   * @param {Partial<typeof BACKUP_DEFAULTS>} settings
   * @returns {typeof BACKUP_DEFAULTS}
   */
  function saveBackupSettings(settings) {
    const normalized = normalizeBackupSettings(settings);
    try {
      localStorage.setItem(STORAGE_KEYS.backup, JSON.stringify(normalized));
    } catch (error) {
      logError('Falha ao salvar configuracoes de backup.', error);
    }
    return normalized;
  }

  /**
   * Agenda backup remoto apenas quando o conteudo mudou.
   */
  function scheduleAutoBackup() {
    window.clearTimeout(state.backupTimer);
    state.backupTimer = 0;

    const settings = loadBackupSettings();
    if (!settings.enabled || !settings.autoBackupOnSave) return;

    const signature = JSON.stringify(state.store.items);
    if (signature === settings.lastBackupSignature) return;

    state.backupTimer = window.setTimeout(async () => {
      try {
        await pushBackupToGist(settings, buildBackupPayload());
        saveBackupSettings({
          ...settings,
          lastBackupAt: new Date().toISOString(),
          lastBackupSignature: signature
        });
        if (state.modalOpen) renderModal();
      } catch (error) {
        logWarn('Falha no backup automatico.', error);
      }
    }, 700);
  }

  /**
   * Monta o payload de backup.
   * @returns {{schema: string, scriptId: string, scriptName: string, version: string, exportedAt: string, items: Record<string, any>}}
   */
  function buildBackupPayload() {
    return {
      schema: 'backup-v1',
      scriptId: 'projudi-intimacao-page',
      scriptName: SCRIPT_NAME,
      version: SCRIPT_VERSION,
      exportedAt: new Date().toISOString(),
      items: state.store.items
    };
  }

  /**
   * Faz requisicao ao GitHub via API do userscript.
   * @param {{method?: string, url: string, headers?: Record<string, string>, data?: string}} options
   * @returns {Promise<any>}
   */
  function githubRequest(options) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest não está disponível.'));
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

  /**
   * Extrai mensagem amigavel de erro do GitHub.
   * @param {{status: number, responseText?: string}} response
   * @returns {string}
   */
  function parseGithubError(response) {
    try {
      const parsed = JSON.parse(response.responseText || '{}');
      if (parsed && parsed.message) return String(parsed.message);
    } catch (_) {}
    return `GitHub respondeu com status ${response.status}.`;
  }

  /**
   * Envia backup para um Gist.
   * @param {typeof BACKUP_DEFAULTS} settings
   * @param {ReturnType<typeof buildBackupPayload>} payload
   * @returns {Promise<any>}
   */
  async function pushBackupToGist(settings, payload) {
    if (!settings.gistId) throw new Error('Informe o Gist ID.');
    if (!settings.token) throw new Error('Informe o token do GitHub.');

    const response = await githubRequest({
      method: 'PATCH',
      url: `https://api.github.com/gists/${encodeURIComponent(settings.gistId)}`,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${settings.token}`,
        'Content-Type': 'application/json'
      },
      data: JSON.stringify({
        files: {
          [settings.fileName]: {
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

  /**
   * Restaura backup a partir de um Gist.
   * @param {typeof BACKUP_DEFAULTS} settings
   * @returns {Promise<any>}
   */
  async function readBackupFromGist(settings) {
    if (!settings.gistId) throw new Error('Informe o Gist ID.');
    if (!settings.token) throw new Error('Informe o token do GitHub.');

    const response = await githubRequest({
      method: 'GET',
      url: `https://api.github.com/gists/${encodeURIComponent(settings.gistId)}`,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${settings.token}`
      }
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(parseGithubError(response));
    }

    const gist = JSON.parse(response.responseText || '{}');
    const file = gist?.files?.[settings.fileName];
    if (!file?.content) throw new Error('Arquivo de backup não encontrado no Gist.');
    return JSON.parse(file.content);
  }

  /**
   * Registra ou atualiza o menu do Tampermonkey.
   */
  function registerMenuCommand() {
    if (typeof GM_registerMenuCommand !== 'function') return;

    if (state.menuCommandId !== null && typeof GM_unregisterMenuCommand === 'function') {
      safeRun('Falha ao remover comando anterior do menu.', () => {
        GM_unregisterMenuCommand(state.menuCommandId);
      });
    }

    state.menuCommandId = GM_registerMenuCommand('Gerenciar intimações', () => {
      openModal();
    });
  }

  /**
   * Injeta estilos da pagina host uma unica vez.
   */
  function injectHostStyles() {
    if (document.getElementById(IDS.hostStyle)) return;

    const style = document.createElement('style');
    style.id = IDS.hostStyle;
    style.textContent = `
      #${IDS.hostRoot} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        width: 40px;
        height: 40px;
        pointer-events: none;
        font-family: Arial, sans-serif;
      }
      #${IDS.hostRoot} > * {
        pointer-events: auto;
      }
      .pjip-hidden {
        display: none !important;
      }
      .pjip-actions-panel {
        position: absolute;
        right: 0;
        bottom: 48px;
        width: 260px;
        border: 1px solid #d4dceb;
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 14px 28px rgba(15, 36, 62, 0.18);
        overflow: hidden;
        visibility: hidden;
        opacity: 0;
        transform-origin: bottom right;
        transform: translateY(8px) scale(.98);
        pointer-events: none;
        transition: opacity .15s ease, transform .15s ease;
      }
      .pjip-actions-panel[data-open="true"] {
        visibility: visible;
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }
      .pjip-actions-head {
        padding: 10px 12px;
        background: linear-gradient(180deg, #2f72b8 0%, #2b69aa 100%);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
      }
      .pjip-actions-body {
        display: grid;
        gap: 4px;
        padding: 6px;
        background: #f7f9fc;
      }
      .pjip-actions-divider {
        height: 1px;
        margin: 2px 0;
        background: #dde4ef;
      }
      .pjip-action-btn,
      .pjip-modal-btn,
      .pjip-inline-btn {
        appearance: none;
        border: 1px solid #cbd8e8;
        border-radius: 8px;
        background: #fff;
        color: #173a61;
        cursor: pointer;
        font: inherit;
      }
      .pjip-action-btn {
        min-height: 32px;
        padding: 0 10px;
        text-align: left;
        font-size: 13px;
        font-weight: 600;
      }
      .pjip-action-btn:hover,
      .pjip-modal-btn:hover,
      .pjip-inline-btn:hover {
        background: #edf4fc;
        border-color: #9fbbe0;
      }
      .pjip-fab {
        width: 40px;
        height: 40px;
        border-radius: 999px;
        border: 1px solid #2b69aa;
        background: #2b69aa;
        color: #fff;
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        box-shadow: 0 4px 12px rgba(0, 0, 0, .2);
      }
      .pjip-fab:hover {
        background: #245a92;
      }
      #${IDS.toast} {
        position: fixed;
        right: 16px;
        bottom: 66px;
        z-index: 2147483647;
        padding: 8px 11px;
        border-radius: 6px;
        border: 1px solid #2b69aa;
        background: #2b69aa;
        color: #fff;
        font: 600 12px Arial, sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,.18);
        opacity: 0;
        transition: opacity .2s ease;
      }
      #${IDS.modalOverlay} {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(8, 28, 52, .28);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        font-family: Arial, sans-serif;
      }
      #${IDS.modalOverlay}[data-open="true"] {
        display: flex;
      }
      #${IDS.modalPanel} {
        width: min(860px, calc(100vw - 48px));
        max-height: min(82vh, 860px);
        display: flex;
        flex-direction: column;
        background: #fff;
        border: 1px solid #cfdaea;
        border-radius: 16px;
        box-shadow: 0 22px 48px rgba(8, 32, 61, .22);
        overflow: hidden;
      }
      .pjip-modal-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 16px 12px;
        color: #fff;
        background: linear-gradient(180deg, #2f72b8 0%, #245f9d 100%);
      }
      .pjip-modal-title {
        margin: 0;
        font-size: 24px;
        font-weight: 700;
      }
      .pjip-modal-subtitle {
        margin-top: 4px;
        font-size: 13px;
        opacity: .92;
      }
      .pjip-modal-close {
        width: 38px;
        min-width: 38px;
        height: 38px;
        border: 0;
        border-radius: 999px;
        background: rgba(255,255,255,.18);
        color: #fff;
        cursor: pointer;
        font-size: 22px;
      }
      .pjip-modal-close:hover {
        background: rgba(255,255,255,.26);
      }
      .pjip-modal-body {
        display: grid;
        gap: 12px;
        padding: 14px;
        overflow: auto;
        background: #f7f9fc;
      }
      .pjip-toolbar,
      .pjip-backup,
      .pjip-item {
        display: grid;
        gap: 10px;
        padding: 12px;
        border: 1px solid #d6e0ef;
        border-radius: 14px;
        background: #fff;
      }
      .pjip-toolbar input[type="search"],
      .pjip-backup input[type="text"],
      .pjip-backup input[type="password"] {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        border: 1px solid #c9d6e9;
        border-radius: 10px;
        padding: 9px 10px;
        font: inherit;
      }
      .pjip-checks {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        font-size: 14px;
        color: #375272;
      }
      .pjip-checks label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
      }
      .pjip-toolbar-meta,
      .pjip-backup-meta {
        font-size: 12px;
        color: #61748d;
      }
      .pjip-backup-actions,
      .pjip-item-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .pjip-modal-btn {
        padding: 8px 10px;
        font-size: 13px;
      }
      .pjip-modal-btn--primary {
        border-color: #1f69d5;
        background: #1f69d5;
        color: #fff;
      }
      .pjip-item--done {
        opacity: .78;
      }
      .pjip-item-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .pjip-item-id {
        font-size: 21px;
        font-weight: 700;
        color: #164172;
      }
      .pjip-item-status {
        border-radius: 999px;
        padding: 4px 8px;
        font-size: 12px;
        font-weight: 700;
        color: #2d506f;
        background: #e8eff8;
      }
      .pjip-item-status--done {
        color: #18663a;
        background: #dff3e5;
      }
      .pjip-item-status--late {
        color: #8f2525;
        background: #ffe1e1;
      }
      .pjip-item-status--soon {
        color: #805400;
        background: #fff0c7;
      }
      .pjip-item-grid {
        display: grid;
        gap: 6px;
        color: #20364f;
        font-size: 13px;
      }
      .pjip-item-grid strong {
        color: #4f6783;
      }
      .pjip-empty {
        padding: 18px;
        border: 1px dashed #cad7ea;
        border-radius: 14px;
        background: #fff;
        color: #5c718b;
        text-align: center;
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Injeta estilos no iframe apenas quando ele esta em contexto relevante.
   * @param {Document} doc
   */
  function injectFrameStyles(doc) {
    if (doc.getElementById(IDS.frameStyle)) return;

    const style = doc.createElement('style');
    style.id = IDS.frameStyle;
    style.textContent = `
      .pjip-table {
        width: 100% !important;
        margin-right: 0 !important;
      }
      .pjip-table tbody tr td {
        padding-top: 1px !important;
        padding-bottom: 1px !important;
        line-height: 1.15 !important;
      }
      .pjip-row--marked {
        background: linear-gradient(90deg, rgba(70, 141, 255, 0.16), rgba(70, 141, 255, 0.04)) !important;
      }
      .pjip-row--marked td:first-child,
      .pjip-row--marked td:nth-child(2) {
        box-shadow: inset 4px 0 0 #2f7ae5;
      }
      .pjip-row--done {
        background: linear-gradient(90deg, rgba(72, 178, 115, 0.18), rgba(72, 178, 115, 0.05)) !important;
      }
      .pjip-row--hidden {
        display: none !important;
      }
      .pjip-inline {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        margin-left: 3px;
        white-space: nowrap;
        vertical-align: middle;
      }
      .pjip-native-host {
        white-space: nowrap;
        vertical-align: middle !important;
      }
      .pjip-inline-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        width: 18px;
        height: 18px;
        padding: 0 !important;
        margin: 0 !important;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: #1d4d87;
        font-size: 18px;
        font-weight: 700;
        line-height: 1;
        vertical-align: middle;
        box-shadow: none;
      }
      .pjip-inline-btn:hover {
        background: transparent;
        color: #114b96;
      }
      .pjip-inline-btn[disabled] {
        opacity: .4;
        cursor: default;
      }
      .pjip-inline-btn[disabled]:hover {
        background: transparent;
        color: #1d4d87;
      }
    `;

    (doc.head || doc.documentElement).appendChild(style);
  }

  /**
   * Garante a existencia do menu de acoes flutuante.
   */
  function ensureActionMenu() {
    if (document.getElementById(IDS.hostRoot)) return;

    const root = document.createElement('div');
    root.id = IDS.hostRoot;
    root.classList.add('pjip-hidden');

    const panel = document.createElement('div');
    panel.id = IDS.actionsPanel;
    panel.className = 'pjip-actions-panel';
    panel.dataset.open = 'false';

    const head = document.createElement('div');
    head.className = 'pjip-actions-head';
    head.textContent = 'Ações de Intimações';

    const body = document.createElement('div');
    body.className = 'pjip-actions-body';

    body.appendChild(buildMenuButton('Carregar todas as páginas', () => unifyPages(null)));
    body.appendChild(buildMenuButton('Carregar 10 páginas', () => unifyPages(10)));
    body.appendChild(
      buildMenuButton('Carregar X páginas', () => {
        const raw = window.prompt('Quantas páginas deseja carregar?', '20');
        if (raw === null) return;
        const amount = Number.parseInt(String(raw).trim(), 10);
        if (!Number.isFinite(amount) || amount < 1) {
          window.alert('Informe um número inteiro maior que 0.');
          return;
        }
        unifyPages(amount);
      })
    );

    const divider = document.createElement('div');
    divider.className = 'pjip-actions-divider';
    body.appendChild(divider);
    body.appendChild(buildMenuButton('Exportar CSV', () => exportCSV()));
    body.appendChild(buildMenuButton('Exportar PDF', () => exportPDF()));
    body.appendChild(buildMenuButton('Minhas intimações', () => openModal()));

    panel.append(head, body);

    const fab = document.createElement('button');
    fab.id = IDS.actionsFab;
    fab.className = 'pjip-fab';
    fab.type = 'button';
    fab.textContent = '+';
    fab.setAttribute('aria-label', 'Abrir ações de intimações');
    fab.addEventListener('click', () => {
      state.menuOpen = !state.menuOpen;
      updateActionPanelState();
    });

    root.append(panel, fab);
    document.body.appendChild(root);
  }

  /**
   * Remove o menu flutuante quando a pagina deixa de ser relevante.
   */
  function teardownActionMenu() {
    state.menuOpen = false;
    document.getElementById(IDS.hostRoot)?.remove();
  }

  /**
   * Atualiza visibilidade do menu flutuante.
   * @param {ReturnType<typeof analyzeFrameContext>} context
   */
  function updateActionMenuVisibility(context) {
    const root = document.getElementById(IDS.hostRoot);
    if (!root) return;
    if (!context.isIntimationPage) state.menuOpen = false;
    root.classList.toggle('pjip-hidden', !context.isIntimationPage);
    updateActionPanelState();
  }

  /**
   * Atualiza o estado visual do painel flutuante.
   */
  function updateActionPanelState() {
    const panel = document.getElementById(IDS.actionsPanel);
    const fab = document.getElementById(IDS.actionsFab);
    if (!panel || !fab) return;
    panel.dataset.open = state.menuOpen ? 'true' : 'false';
    fab.textContent = state.menuOpen ? '×' : '+';
  }

  /**
   * Cria botao do menu principal.
   * @param {string} label
   * @param {() => void} onClick
   * @returns {HTMLButtonElement}
   */
  function buildMenuButton(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pjip-action-btn';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  /**
   * Mostra notificacao pequena e temporaria.
   * @param {string} message
   */
  function showToast(message) {
    let toast = document.getElementById(IDS.toast);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = IDS.toast;
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = '1';
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      if (toast) toast.style.opacity = '0';
    }, 1800);
  }

  /**
   * Unifica multiplas paginas em uma so usando um iframe temporario e polling local.
   * @param {number | null} maxPages
   */
  async function unifyPages(maxPages) {
    const context = state.pageContext;
    if (!context?.mainTable || !state.frame) {
      window.alert('Tabela principal não encontrada.');
      return;
    }

    const button = /** @type {HTMLButtonElement | null} */ (document.activeElement instanceof HTMLButtonElement ? document.activeElement : null);
    const originalText = button?.textContent || '';
    setBusyButtonLabel(button, 'Carregando...');

    try {
      const mainDoc = context.doc;
      const mainTable = context.mainTable;
      const targetBody = mainTable.tBodies[0] || mainTable;
      const pager = mainDoc.querySelector(SELECTORS.pager);
      const pagerInfo = analyzePager(mainDoc, pager);

      if (!pagerInfo || pagerInfo.totalPages < 2) {
        window.alert('Sem paginação disponível.');
        return;
      }

      const loader = document.createElement('iframe');
      loader.style.display = 'none';
      state.frame.parentElement?.appendChild(loader);

      try {
        loader.src = state.frame.contentWindow?.location?.href || context.url;
        await waitForFrameLoad(loader);

        const targetPage = maxPages ? Math.min(maxPages, pagerInfo.totalPages) : pagerInfo.totalPages;
        if (targetPage <= 1) return;

        for (let currentPage = 2; currentPage <= targetPage; currentPage += 1) {
          setBusyButtonLabel(button, `Página ${currentPage}/${targetPage}...`);
          await navigateLoaderToPage(loader, currentPage, pagerInfo);

          const loaderDoc = loader.contentDocument;
          if (!loaderDoc) continue;
          const nextTable = findBestMainTable(loaderDoc);
          if (!nextTable) continue;

          const rows = Array.from(nextTable.querySelectorAll('tbody tr')).filter((row) => row.querySelector('td'));
          for (const row of rows) {
            targetBody.appendChild(mainDoc.importNode(row, true));
          }
        }

        if (!maxPages || targetPage === pagerInfo.totalPages) {
          pager?.remove();
        }

        showToast('Páginas reunidas com sucesso');
        refreshFrameContext('unify-pages');
      } finally {
        loader.remove();
      }
    } catch (error) {
      logError('Falha ao unificar as paginas de intimacoes.', error);
      window.alert('Não foi possível unificar as páginas.');
    } finally {
      restoreBusyButton(button, originalText);
    }
  }

  /**
   * Ajusta estado visual de um botao durante operacao.
   * @param {HTMLButtonElement | null} button
   * @param {string} text
   */
  function setBusyButtonLabel(button, text) {
    if (!button) return;
    button.disabled = true;
    button.textContent = text;
  }

  /**
   * Restaura o botao ao estado normal.
   * @param {HTMLButtonElement | null} button
   * @param {string} originalText
   */
  function restoreBusyButton(button, originalText) {
    if (!button) return;
    button.disabled = false;
    if (originalText) button.textContent = originalText;
  }

  /**
   * Analisa o paginador.
   * @param {Document} doc
   * @param {Element | null} pagerElement
   * @returns {{totalPages: number, canCallBuscaDados: boolean, inputSelector: string | null, buttonSelector: string | null, pageSize: number | null} | null}
   */
  function analyzePager(doc, pagerElement) {
    if (!pagerElement) return null;

    const input = pagerElement.querySelector('#CaixaTextoPosicionar, .CaixaTextoPosicionar, input[type="text"], input[type="number"]');
    let totalPages = input ? Number.parseInt(String(input.value || input.getAttribute('value') || '').trim(), 10) : Number.NaN;

    if (!Number.isFinite(totalPages) || totalPages < 2) {
      const links = Array.from(pagerElement.querySelectorAll('a'));
      const lastLink = links.find((link) => /ultima|última/i.test(link.textContent || ''));
      const extracted = lastLink ? extractLastNumber(lastLink.getAttribute('href')) : null;
      if (typeof extracted === 'number') totalPages = extracted + 1;
    }

    if (!Number.isFinite(totalPages) || totalPages < 2) return null;

    const goButton = pagerElement.querySelector('.BotaoIr, input[value="Ir"], button');

    return {
      totalPages,
      canCallBuscaDados: typeof doc.defaultView?.buscaDados === 'function',
      inputSelector: input ? buildCssPath(input) : null,
      buttonSelector: goButton ? buildCssPath(goButton) : null,
      pageSize: extractSecondNumberFromPager(pagerElement)
    };
  }

  /**
   * Navega o iframe temporario ate uma pagina alvo.
   * @param {HTMLIFrameElement} loader
   * @param {number} pageNumber
   * @param {NonNullable<ReturnType<typeof analyzePager>>} pagerInfo
   */
  async function navigateLoaderToPage(loader, pageNumber, pagerInfo) {
    const loaderDoc = loader.contentDocument;
    const loaderWin = loader.contentWindow;
    if (!loaderDoc || !loaderWin) throw new Error('Iframe temporario indisponivel.');

    const currentTable = findBestMainTable(loaderDoc);
    const previousSignature = captureTableSnapshot(currentTable);

    if (pagerInfo.canCallBuscaDados && typeof loaderWin.buscaDados === 'function') {
      loaderWin.buscaDados(pageNumber - 1, pagerInfo.pageSize || 15);
      await waitForTableChange(loaderDoc, previousSignature);
      return;
    }

    if (pagerInfo.inputSelector && pagerInfo.buttonSelector) {
      const input = loaderDoc.querySelector(pagerInfo.inputSelector);
      const button = loaderDoc.querySelector(pagerInfo.buttonSelector);
      if (input && button) {
        input.value = String(pageNumber);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof button.click === 'function') button.click();
        await waitForTableChange(loaderDoc, previousSignature);
        return;
      }
    }

    const link = Array.from(loaderDoc.querySelectorAll(`${SELECTORS.pager} a, a`)).find(
      (anchor) => Number.parseInt(String(anchor.textContent || '').trim(), 10) === pageNumber
    );
    if (link) {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await waitForTableChange(loaderDoc, previousSignature);
      return;
    }

    loader.src = loaderWin.location.href;
    await waitForFrameLoad(loader);
  }

  /**
   * Aguarda carga do iframe.
   * @param {HTMLIFrameElement} frame
   * @returns {Promise<void>}
   */
  function waitForFrameLoad(frame) {
    return new Promise((resolve) => {
      const handler = () => {
        frame.removeEventListener('load', handler);
        resolve();
      };
      frame.addEventListener('load', handler, { once: true });
    });
  }

  /**
   * Captura uma assinatura simples da tabela.
   * @param {HTMLTableElement | null} table
   * @returns {string}
   */
  function captureTableSnapshot(table) {
    if (!table) return 'missing';
    const rows = Array.from(table.querySelectorAll('tbody tr')).filter((row) => row.querySelector('td'));
    const firstText = rows[0] ? normalizeSpaces(rows[0].textContent || '').slice(0, 80) : '';
    return `${rows.length}|${firstText}`;
  }

  /**
   * Espera uma mudanca na tabela usando polling curto e local.
   * Isso substitui MutationObserver longo e reduz uso de memoria.
   * @param {Document} doc
   * @param {string} previousSnapshot
   * @returns {Promise<void>}
   */
  function waitForTableChange(doc, previousSnapshot) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        const nextTable = findBestMainTable(doc);
        const nextSnapshot = captureTableSnapshot(nextTable);
        if (nextSnapshot !== previousSnapshot || Date.now() - startedAt > 8000) {
          window.clearInterval(interval);
          resolve();
        }
      }, 120);
    });
  }

  /**
   * Exporta tabela para CSV.
   */
  function exportCSV() {
    const table = state.pageContext?.mainTable;
    if (!table) {
      window.alert('Tabela não encontrada para exportação.');
      return;
    }

    const rows = [];
    const pushRow = (values) => {
      rows.push(values.map(escapeCsv).join(';'));
    };

    const headers = Array.from((table.tHead || table).querySelectorAll('th')).map((cell) => normalizeSpaces(cell.innerText || cell.textContent || ''));
    if (headers.length) pushRow(headers);

    for (const row of Array.from(table.querySelectorAll('tbody tr'))) {
      const values = Array.from(row.querySelectorAll('td')).map((cell) => normalizeSpaces(cell.innerText || cell.textContent || ''));
      if (values.length) pushRow(values);
    }

    const blob = new Blob(['\ufeff', rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, buildTimestampedFileName('intimacoes', 'csv'));
    showToast('CSV gerado');
  }

  /**
   * Exporta tabela para PDF.
   */
  function exportPDF() {
    const table = state.pageContext?.mainTable;
    if (!table) {
      window.alert('Tabela não encontrada para exportação.');
      return;
    }

    exportPdfWithJsPdf(table).catch((error) => {
      logWarn('Falha ao gerar PDF via jsPDF. Sera usado o fallback de impressao.', error);
      exportPdfViaPrint(table);
    });
  }

  /**
   * Exporta PDF com jsPDF carregado sob demanda.
   * @param {HTMLTableElement} table
   */
  async function exportPdfWithJsPdf(table) {
    await ensurePdfLibraries();

    const jsPdfNamespace = window.jspdf;
    if (!jsPdfNamespace?.jsPDF || typeof jsPdfNamespace.jsPDF.API.autoTable !== 'function') {
      throw new Error('Bibliotecas jsPDF indisponíveis.');
    }

    const matrix = tableToMatrix(table);
    if (!matrix.body.length) throw new Error('Tabela vazia.');

    const doc = new window.jspdf.jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const now = new Date();
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('Intimações', 10, 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Gerado em: ${now.toLocaleString('pt-BR')}`, 10, 15);

    doc.autoTable({
      head: matrix.head,
      body: matrix.body,
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
      didDrawPage: () => {
        const page = doc.internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(90, 104, 124);
        doc.text(`Página ${page}`, pageWidth - 24, doc.internal.pageSize.getHeight() - 4);
      }
    });

    doc.save(buildTimestampedFileName('intimacoes', 'pdf'));
    showToast('PDF gerado');
  }

  /**
   * Fallback de exportacao via janela de impressao.
   * @param {HTMLTableElement} table
   */
  function exportPdfViaPrint(table) {
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=800');
    if (!printWindow) {
      window.alert('Bloqueador de pop-up ativo. Permita pop-up para gerar PDF.');
      return;
    }

    const generatedAt = new Date().toLocaleString('pt-BR');
    printWindow.document.open();
    printWindow.document.write(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Intimações</title><style>body{font-family:Arial,sans-serif;margin:20px;color:#111}h1{font-size:18px;margin:0 0 8px}.meta{font-size:12px;margin-bottom:12px;color:#444}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #bbb;padding:6px;vertical-align:top}th{background:#f3f3f3}@media print{body{margin:10mm}}</style></head><body><h1>Intimações</h1><div class="meta">Gerado em: ${generatedAt}</div>${table.outerHTML}</body></html>`
    );
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => {
      printWindow.print();
    }, 250);
    showToast('Impressão PDF aberta');
  }

  /**
   * Carrega jsPDF e AutoTable sob demanda.
   * @returns {Promise<void>}
   */
  async function ensurePdfLibraries() {
    if (window.jspdf?.jsPDF && typeof window.jspdf.jsPDF.API.autoTable === 'function') return;
    if (state.pdfPromise) return state.pdfPromise;

    state.pdfPromise = (async () => {
      await loadScriptOnce(PDF_CDNS.jspdf);
      await loadScriptOnce(PDF_CDNS.autoTable);
      if (!window.jspdf?.jsPDF || typeof window.jspdf.jsPDF.API.autoTable !== 'function') {
        throw new Error('Não foi possível carregar jsPDF/AutoTable.');
      }
    })();

    try {
      await state.pdfPromise;
    } finally {
      state.pdfPromise = null;
    }
  }

  /**
   * Carrega um script externo apenas uma vez.
   * @param {string} src
   * @returns {Promise<void>}
   */
  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-pjip-src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Falha ao carregar ${src}`)), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.async = true;
      script.src = src;
      script.dataset.pjipSrc = src;
      script.addEventListener(
        'load',
        () => {
          script.dataset.loaded = '1';
          resolve();
        },
        { once: true }
      );
      script.addEventListener('error', () => reject(new Error(`Falha ao carregar ${src}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  /**
   * Converte tabela em matriz para exportacao.
   * @param {HTMLTableElement} table
   * @returns {{head: string[][], body: string[][]}}
   */
  function tableToMatrix(table) {
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    const head = [
      Array.from(headerRow?.querySelectorAll('th,td') || []).map((cell) =>
        normalizeSpaces(cell.innerText || cell.textContent || '')
      )
    ];

    const body = Array.from(table.querySelectorAll('tbody tr'))
      .filter((row) => row.querySelector('td'))
      .map((row) =>
        Array.from(row.querySelectorAll('td')).map((cell) =>
          normalizeSpaces(cell.innerText || cell.textContent || '')
        )
      );

    return { head, body };
  }

  /**
   * Abre o painel de gerenciamento.
   */
  function openModal() {
    state.modalOpen = true;
    state.store.ui.panelOpen = true;
    persistStore();
    ensureModal();
    renderModal();
  }

  /**
   * Fecha o painel de gerenciamento.
   */
  function closeModal() {
    state.modalOpen = false;
    state.store.ui.panelOpen = false;
    persistStore();
    const overlay = document.getElementById(IDS.modalOverlay);
    if (overlay) overlay.dataset.open = 'false';
  }

  /**
   * Garante a existencia do modal apenas quando necessario.
   */
  function ensureModal() {
    if (state.modalRoot) return;

    const overlay = document.createElement('div');
    overlay.id = IDS.modalOverlay;
    overlay.dataset.open = 'false';

    const panel = document.createElement('section');
    panel.id = IDS.modalPanel;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Gerenciar intimações');

    const head = document.createElement('div');
    head.className = 'pjip-modal-head';

    const headText = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'pjip-modal-title';
    title.textContent = 'Minhas Intimações';
    const subtitle = document.createElement('div');
    subtitle.className = 'pjip-modal-subtitle';
    subtitle.textContent = 'Triagem local com atualização sob demanda.';
    headText.append(title, subtitle);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'pjip-modal-close';
    closeButton.textContent = '×';
    closeButton.title = 'Fechar';
    closeButton.addEventListener('click', () => closeModal());

    head.append(headText, closeButton);

    const body = document.createElement('div');
    body.className = 'pjip-modal-body';
    body.innerHTML = `
      <section class="pjip-toolbar">
        <input type="search" data-role="search" placeholder="Buscar intimação, processo ou texto">
        <div class="pjip-checks">
          <label><input type="checkbox" data-role="hide-done"> Ocultar concluídas</label>
          <label><input type="checkbox" data-role="only-marked-page"> Ocultar não marcadas na página</label>
        </div>
        <div class="pjip-toolbar-meta" data-role="meta"></div>
      </section>
      <section class="pjip-backup">
        <div><strong>Backup remoto</strong></div>
        <div class="pjip-backup-meta">Use um único Gist no GitHub com um arquivo exclusivo para este script.</div>
        <input type="text" data-role="backup-gist-id" placeholder="Gist ID">
        <input type="password" data-role="backup-token" placeholder="Token do GitHub">
        <input type="text" data-role="backup-file-name" placeholder="Nome do arquivo">
        <div class="pjip-checks">
          <label><input type="checkbox" data-role="backup-enabled"> Ativar backup por Gist</label>
          <label><input type="checkbox" data-role="backup-auto"> Backup automático</label>
        </div>
        <div class="pjip-backup-actions">
          <button type="button" class="pjip-modal-btn" data-role="backup-send">Enviar backup</button>
          <button type="button" class="pjip-modal-btn" data-role="backup-restore">Restaurar backup</button>
          <button type="button" class="pjip-modal-btn" data-role="backup-clear">Limpar backup</button>
        </div>
        <div class="pjip-backup-meta" data-role="backup-status"></div>
        <div class="pjip-backup-meta" data-role="backup-last"></div>
      </section>
      <section data-role="list"></section>
    `;

    overlay.appendChild(panel);
    panel.append(head, body);
    document.body.appendChild(overlay);
    state.modalRoot = overlay;

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeModal();
    });

    body.querySelector('[data-role="search"]')?.addEventListener('input', (event) => {
      const input = /** @type {HTMLInputElement} */ (event.currentTarget);
      state.store.ui.query = input.value || '';
      persistStore();
      renderModal();
    });

    body.querySelector('[data-role="hide-done"]')?.addEventListener('change', (event) => {
      const input = /** @type {HTMLInputElement} */ (event.currentTarget);
      state.store.ui.hideDone = input.checked;
      persistStore();
      renderModal();
    });

    body.querySelector('[data-role="only-marked-page"]')?.addEventListener('change', (event) => {
      const input = /** @type {HTMLInputElement} */ (event.currentTarget);
      state.store.ui.onlyMarkedOnPage = input.checked;
      persistStore();
      refreshFrameContext('modal-filter');
      renderModal();
    });

    body.querySelector('[data-role="backup-send"]')?.addEventListener('click', async () => {
      const statusNode = body.querySelector('[data-role="backup-status"]');
      try {
        const settings = saveBackupSettings(readBackupSettingsFromModal(body));
        setNodeText(statusNode, 'Enviando backup...');
        const signature = JSON.stringify(state.store.items);
        await pushBackupToGist(settings, buildBackupPayload());
        saveBackupSettings({
          ...settings,
          lastBackupAt: new Date().toISOString(),
          lastBackupSignature: signature
        });
        setNodeText(statusNode, 'Backup enviado com sucesso.');
        renderModal();
      } catch (error) {
        setNodeText(statusNode, error instanceof Error ? error.message : 'Falha ao enviar backup.');
      }
    });

    body.querySelector('[data-role="backup-restore"]')?.addEventListener('click', async () => {
      const statusNode = body.querySelector('[data-role="backup-status"]');
      try {
        const settings = saveBackupSettings(readBackupSettingsFromModal(body));
        setNodeText(statusNode, 'Restaurando backup...');
        const payload = await readBackupFromGist(settings);
        state.store.items = payload?.items && typeof payload.items === 'object' ? payload.items : Object.create(null);
        persistStore();
        saveBackupSettings({
          ...settings,
          lastBackupSignature: JSON.stringify(state.store.items)
        });
        refreshFrameContext('backup-restore');
        setNodeText(statusNode, 'Backup restaurado com sucesso.');
        renderModal();
      } catch (error) {
        setNodeText(statusNode, error instanceof Error ? error.message : 'Falha ao restaurar backup.');
      }
    });

    body.querySelector('[data-role="backup-clear"]')?.addEventListener('click', () => {
      saveBackupSettings(BACKUP_DEFAULTS);
      renderModal();
    });
  }

  /**
   * Lê configuracoes de backup a partir do modal.
   * @param {Element} root
   * @returns {typeof BACKUP_DEFAULTS}
   */
  function readBackupSettingsFromModal(root) {
    return normalizeBackupSettings({
      enabled: /** @type {HTMLInputElement | null} */ (root.querySelector('[data-role="backup-enabled"]'))?.checked,
      gistId: /** @type {HTMLInputElement | null} */ (root.querySelector('[data-role="backup-gist-id"]'))?.value,
      token: /** @type {HTMLInputElement | null} */ (root.querySelector('[data-role="backup-token"]'))?.value,
      fileName: /** @type {HTMLInputElement | null} */ (root.querySelector('[data-role="backup-file-name"]'))?.value,
      autoBackupOnSave: /** @type {HTMLInputElement | null} */ (root.querySelector('[data-role="backup-auto"]'))?.checked
    });
  }

  /**
   * Renderiza o modal apenas quando aberto.
   */
  function renderModal() {
    ensureModal();
    if (!state.modalRoot) return;

    state.modalRoot.dataset.open = state.modalOpen ? 'true' : 'false';
    if (!state.modalOpen) return;

    const root = state.modalRoot;
    const backupSettings = loadBackupSettings();
    setInputValue(root.querySelector('[data-role="search"]'), state.store.ui.query);
    setChecked(root.querySelector('[data-role="hide-done"]'), state.store.ui.hideDone);
    setChecked(root.querySelector('[data-role="only-marked-page"]'), state.store.ui.onlyMarkedOnPage);
    setChecked(root.querySelector('[data-role="backup-enabled"]'), backupSettings.enabled);
    setChecked(root.querySelector('[data-role="backup-auto"]'), backupSettings.autoBackupOnSave);
    setInputValue(root.querySelector('[data-role="backup-gist-id"]'), backupSettings.gistId);
    setInputValue(root.querySelector('[data-role="backup-token"]'), backupSettings.token);
    setInputValue(root.querySelector('[data-role="backup-file-name"]'), backupSettings.fileName);
    setNodeText(root.querySelector('[data-role="backup-last"]'), formatLastBackupLabel(backupSettings.lastBackupAt));

    const items = getFilteredItems();
    setNodeText(
      root.querySelector('[data-role="meta"]'),
      `${items.length} item(ns) visível(is) • ${Object.keys(state.store.items).length} intimação(ões) marcada(s).`
    );

    const listNode = root.querySelector('[data-role="list"]');
    if (!listNode) return;
    listNode.replaceChildren();

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'pjip-empty';
      empty.textContent = 'Nenhuma intimação marcada para este filtro.';
      listNode.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of items) {
      fragment.appendChild(buildModalItem(item));
    }
    listNode.appendChild(fragment);
  }

  /**
   * Constroi um item do painel.
   * @param {any} item
   * @returns {HTMLElement}
   */
  function buildModalItem(item) {
    const card = document.createElement('article');
    card.className = `pjip-item${item.done ? ' pjip-item--done' : ''}`;

    const top = document.createElement('div');
    top.className = 'pjip-item-top';

    const idNode = document.createElement('div');
    idNode.className = 'pjip-item-id';
    idNode.textContent = String(item.id || '');

    const statusNode = document.createElement('div');
    statusNode.className = `pjip-item-status ${resolveItemStatusClass(item)}`.trim();
    statusNode.textContent = resolveItemStatusLabel(item);
    top.append(idNode, statusNode);

    const grid = document.createElement('div');
    grid.className = 'pjip-item-grid';
    appendLabeledValue(grid, 'Processo', item.processNumber || '—');
    appendLabeledValue(grid, 'Prazo', item.deadline || '—');
    appendLabeledValue(grid, 'Origem', item.sourceLegend || item.kind || 'Intimação');
    const movement = document.createElement('div');
    movement.textContent = item.movement || '—';
    grid.appendChild(movement);

    const actions = document.createElement('div');
    actions.className = 'pjip-item-actions';

    const doneButton = document.createElement('button');
    doneButton.type = 'button';
    doneButton.className = 'pjip-modal-btn pjip-modal-btn--primary';
    doneButton.textContent = item.done ? 'Reabrir' : 'Concluir';
    doneButton.addEventListener('click', () => {
      toggleDone(String(item.id));
      renderModal();
    });

    const openProcessButton = document.createElement('button');
    openProcessButton.type = 'button';
    openProcessButton.className = 'pjip-modal-btn';
    openProcessButton.textContent = 'Abrir processo';
    openProcessButton.disabled = !item.processLink;
    openProcessButton.addEventListener('click', () => {
      openProcess(item);
    });

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'pjip-modal-btn';
    removeButton.textContent = 'Remover';
    removeButton.addEventListener('click', () => {
      delete state.store.items[item.id];
      persistStore();
      refreshFrameContext('modal-remove');
      renderModal();
    });

    actions.append(doneButton, openProcessButton, removeButton);
    card.append(top, grid, actions);
    return card;
  }

  /**
   * Adiciona uma linha com rotulo e valor.
   * @param {HTMLElement} container
   * @param {string} label
   * @param {string} value
   */
  function appendLabeledValue(container, label, value) {
    const line = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    line.appendChild(strong);
    line.appendChild(document.createTextNode(value));
    container.appendChild(line);
  }

  /**
   * Filtra os itens marcados para exibicao.
   * @returns {any[]}
   */
  function getFilteredItems() {
    const query = normalizeText(state.store.ui.query);
    const items = Object.values(state.store.items).filter((item) => {
      if (state.store.ui.hideDone && item.done) return false;
      if (!query) return true;
      const haystack = normalizeText([item.id, item.processNumber, item.deadline, item.movement, item.sourceLegend].join(' '));
      return haystack.includes(query);
    });

    items.sort((left, right) => {
      const leftTime = parseBrazilianDateTime(left.deadline) || Number.MAX_SAFE_INTEGER;
      const rightTime = parseBrazilianDateTime(right.deadline) || Number.MAX_SAFE_INTEGER;
      if (left.done !== right.done) return left.done ? 1 : -1;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return String(left.id).localeCompare(String(right.id), 'pt-BR', { numeric: true });
    });

    return items;
  }

  /**
   * Resolve classe do status.
   * @param {any} item
   * @returns {string}
   */
  function resolveItemStatusClass(item) {
    if (item.done) return 'pjip-item-status--done';
    const time = parseBrazilianDateTime(item.deadline);
    if (!time) return '';
    const now = Date.now();
    if (time < now) return 'pjip-item-status--late';
    if (time - now <= 2 * 24 * 60 * 60 * 1000) return 'pjip-item-status--soon';
    return '';
  }

  /**
   * Resolve rotulo do status.
   * @param {any} item
   * @returns {string}
   */
  function resolveItemStatusLabel(item) {
    if (item.done) return 'Concluída';
    const time = parseBrazilianDateTime(item.deadline);
    if (!time) return 'Sem prazo';
    const now = Date.now();
    if (time < now) return 'Vencida';
    if (time - now <= 2 * 24 * 60 * 60 * 1000) return 'Vencendo';
    return 'Aberta';
  }

  /**
   * Tenta abrir o processo a partir da linha atual. Se nao encontrar, navega pela URL.
   * @param {any} item
   */
  function openProcess(item) {
    closeModal();
    const doc = state.frameDoc;
    if (doc && item.id) {
      for (const tableEntry of state.pageContext?.markTables || []) {
        const { table, headerMap, legend } = tableEntry;
        for (const body of Array.from(table.tBodies)) {
          for (const row of Array.from(body.rows)) {
            const rowData = extractRowData(row, headerMap, legend);
            if (!rowData || rowData.id !== item.id) continue;
            const processAction = findNavigationElement(row.children[headerMap.process], SELECTORS.processAction);
            if (processAction && typeof processAction.click === 'function') {
              processAction.click();
              return;
            }
          }
        }
      }
    }

    navigateFrameTo(item.processLink);
  }

  /**
   * Navega o iframe principal com seguranca.
   * @param {string} href
   */
  function navigateFrameTo(href) {
    const resolved = resolveAllowedUrl(href, state.frameDoc?.location?.href || window.location.href);
    if (!resolved) return;

    if (state.frame && state.frame.contentWindow) {
      try {
        state.frame.contentWindow.location.href = resolved;
        return;
      } catch (error) {
        logWarn('Falha ao navegar diretamente no iframe. Sera usado src.', error);
      }
      state.frame.setAttribute('src', resolved);
      return;
    }

    window.location.assign(resolved);
  }

  /**
   * Resolve URLs navegaveis e bloqueia esquemas inseguros.
   * @param {string} href
   * @param {string} baseUrl
   * @returns {string}
   */
  function resolveAllowedUrl(href, baseUrl) {
    if (!href) return '';
    try {
      const cleaned = String(href).trim().replace(/^['"]|['"]$/g, '');
      const url = new URL(/^(https?:|\/)/i.test(cleaned) ? cleaned : `/${cleaned}`, baseUrl);
      if (!/^https?:$/i.test(url.protocol)) return '';
      return url.toString();
    } catch (error) {
      logWarn('Nao foi possivel resolver URL segura.', { href, error });
      return '';
    }
  }

  /**
   * Busca um elemento de navegacao dentro de um container.
   * @param {ParentNode | null | undefined} root
   * @param {string} preferredSelector
   * @returns {Element | null}
   */
  function findNavigationElement(root, preferredSelector) {
    if (!root || typeof root.querySelector !== 'function') return null;
    return root.querySelector(preferredSelector) || root.querySelector('a[href], button[onclick], [onclick], [href]');
  }

  /**
   * Extrai URL a partir de href ou onclick.
   * @param {Element | null} element
   * @param {string} baseUrl
   * @returns {string}
   */
  function extractNavigableUrl(element, baseUrl) {
    if (!element) return '';
    const href = element.getAttribute('href');
    const onclick = element.getAttribute('onclick');
    const raw = href ? href.replace(/&amp;/g, '&') : extractHrefFromOnclick(onclick);
    return resolveAllowedUrl(raw, baseUrl);
  }

  /**
   * Extrai href a partir de handlers inline conhecidos.
   * @param {string | null} onclickValue
   * @returns {string}
   */
  function extractHrefFromOnclick(onclickValue) {
    if (!onclickValue) return '';
    const locationMatch = onclickValue.match(/(?:window\.)?location\.href\s*=\s*['"]([^'"]+)['"]/i);
    if (locationMatch) return locationMatch[1].replace(/&amp;/g, '&');
    const genericMatch = onclickValue.match(/['"]([^'"]*(?:Pendencia|BuscaProcesso|DescartarPendenciaProcesso)[^'"]*)['"]/i);
    return genericMatch ? genericMatch[1].replace(/&amp;/g, '&') : '';
  }

  /**
   * Retorna texto de uma celula.
   * @param {Element | undefined} cell
   * @returns {string}
   */
  function getCellText(cell) {
    return normalizeSpaces(cell?.textContent || '');
  }

  /**
   * Localiza a melhor tabela principal.
   * @param {ParentNode} root
   * @returns {HTMLTableElement | null}
   */
  function findBestMainTable(root) {
    const tables = Array.from(root.querySelectorAll(SELECTORS.table));
    let best = null;
    let bestScore = -1;

    for (const candidate of tables) {
      const table = /** @type {HTMLTableElement} */ (candidate);
      const score = scoreMainTable(table, createHeaderMap(table));
      if (score > bestScore) {
        bestScore = score;
        best = table;
      }
    }

    return best;
  }

  /**
   * Gera nome de arquivo com timestamp.
   * @param {string} baseName
   * @param {string} extension
   * @returns {string}
   */
  function buildTimestampedFileName(baseName, extension) {
    const now = new Date();
    const parts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ];
    const time = [String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0')].join('-');
    return `${baseName}_${parts.join('-')}_${time}.${extension}`;
  }

  /**
   * Dispara download de blob.
   * @param {Blob} blob
   * @param {string} fileName
   */
  function triggerDownload(blob, fileName) {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(anchor.href);
      anchor.remove();
    }, 800);
  }

  /**
   * Normaliza texto com remoção de acentos e lowercase.
   * @param {string} value
   * @returns {string}
   */
  function normalizeText(value) {
    return normalizeSpaces(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  /**
   * Compacta espacos em branco.
   * @param {string} value
   * @returns {string}
   */
  function normalizeSpaces(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Resolve um target de evento em Element, inclusive quando o browser entrega Text.
   * @param {EventTarget | null} target
   * @returns {Element | null}
   */
  function resolveEventElement(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    if (target instanceof Node && target.parentElement) return target.parentElement;
    return null;
  }

  /**
   * Faz escape CSV.
   * @param {string} value
   * @returns {string}
   */
  function escapeCsv(value) {
    let normalized = String(value || '').replace(/\r?\n|\r/g, ' ').trim();
    if (/[;"\n]/.test(normalized)) normalized = `"${normalized.replace(/"/g, '""')}"`;
    return normalized;
  }

  /**
   * Formata o rotulo de ultimo backup.
   * @param {string} isoDate
   * @returns {string}
   */
  function formatLastBackupLabel(isoDate) {
    if (!isoDate) return 'Último backup: ainda não enviado.';
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return 'Último backup: ainda não enviado.';
    return `Último backup: ${date.toLocaleString('pt-BR')}.`;
  }

  /**
   * Faz parse de data/hora no formato brasileiro.
   * @param {string} value
   * @returns {number}
   */
  function parseBrazilianDateTime(value) {
    const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
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

  /**
   * Atualiza o valor de um input.
   * @param {Element | null} element
   * @param {string} value
   */
  function setInputValue(element, value) {
    if (element instanceof HTMLInputElement) element.value = value;
  }

  /**
   * Atualiza o estado checked de um input.
   * @param {Element | null} element
   * @param {boolean} value
   */
  function setChecked(element, value) {
    if (element instanceof HTMLInputElement) element.checked = value;
  }

  /**
   * Atualiza texto de um no.
   * @param {Element | null} element
   * @param {string} value
   */
  function setNodeText(element, value) {
    if (element) element.textContent = value;
  }

  /**
   * Extrai ultimo numero de uma string.
   * @param {string | null} value
   * @returns {number | null}
   */
  function extractLastNumber(value) {
    if (!value) return null;
    const match = value.match(/(\d+)\D*\)?\s*$/);
    return match ? Number.parseInt(match[1], 10) : null;
  }

  /**
   * Extrai pageSize do href do paginador.
   * @param {Element} pagerElement
   * @returns {number | null}
   */
  function extractSecondNumberFromPager(pagerElement) {
    const link = pagerElement.querySelector('a[href^="javascript:buscaDados("]');
    if (!link) return null;
    const match = link.getAttribute('href')?.match(/buscaDados\(\s*\d+\s*,\s*(\d+)\s*\)/i);
    return match ? Number.parseInt(match[1], 10) : null;
  }

  /**
   * Cria seletor CSS relativamente estavel.
   * @param {Element} element
   * @returns {string}
   */
  function buildCssPath(element) {
    const segments = [];
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      let segment = current.nodeName.toLowerCase();
      if (current.id) {
        segment += `#${CSS.escape(current.id)}`;
        segments.unshift(segment);
        break;
      }
      let index = 1;
      let sibling = current;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.nodeName === current.nodeName) index += 1;
      }
      segment += `:nth-of-type(${index})`;
      segments.unshift(segment);
    }
    return segments.join(' > ');
  }
})();
