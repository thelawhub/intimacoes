// ==UserScript==
// @name         Intimações
// @namespace    projudi-intimacao-page.user.js
// @version      5.4
// @icon         https://img.icons8.com/ios-filled/100/scales--v1.png
// @description  Reúne intimações, exporta CSV/PDF, permite triagem local e destaca/filtra prazos do Projudi.
// @author       louencosv (GPT)
// @license      CC BY-NC 4.0
// @updateURL    https://raw.githubusercontent.com/thelawhub/intimacoes/refs/heads/main/projudi-intimacao-page.user.js
// @downloadURL  https://raw.githubusercontent.com/thelawhub/intimacoes/refs/heads/main/projudi-intimacao-page.user.js
// @match        *://projudi.tjgo.jus.br/*
// @match        *://projudi-teste.tjgo.jus.br/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self) {
    try {
      if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Gerenciar Intimações', () => {
          window.top.postMessage({ type: 'pjip:open-manager' }, '*');
        });
      }
    } catch (_) {}
    return;
  }

  const SCRIPT_NAME = 'Intimações';
  const SCRIPT_VERSION =
    typeof GM_info !== 'undefined' && GM_info?.script?.version
      ? String(GM_info.script.version)
      : '4.5';
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

  const DEADLINE = {
    windowDays: 7,
    targetHeaders: ['data limite', 'possivel data limite', 'possível data limite'],
    filterDateKey: 'projudi_highlight_filter_date_v1',
    filterEnabledKey: 'projudi_highlight_filter_enabled_v1',
    filterModeKey: 'projudi_highlight_filter_mode_v1',
    filterRangeStartKey: 'projudi_highlight_filter_range_start_v1',
    filterRangeEndKey: 'projudi_highlight_filter_range_end_v1',
    settingsSyncEvent: 'projudi:deadline-settings-changed',
    classPrefix: 'tm-hl7d',
    filterHiddenAttr: 'data-tm-filter-hidden',
    cellAttr: 'data-tm-deadline-class'
  };

  const DEADLINE_WEEKDAY_PALETTE = [
    { bg: 'rgba(255,205,210,1)', fg: 'rgba(183,28,28,1)' },
    { bg: 'rgba(255,224,178,1)', fg: 'rgba(191,54,12,1)' },
    { bg: 'rgba(255,249,196,1)', fg: 'rgba(245,127,23,1)' },
    { bg: 'rgba(220,237,200,1)', fg: 'rgba(51,105,30,1)' },
    { bg: 'rgba(200,230,201,1)', fg: 'rgba(27,94,32,1)' }
  ];
  const DEADLINE_WEEKEND_COLOR = { bg: 'rgba(227,242,253,1)', fg: 'rgba(13,71,161,1)' };

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
   * menuCommandIds: number[],
   * hostHooksAttached: boolean,
   * menuOpen: boolean,
   * modalOpen: boolean,
   * modalRoot: HTMLElement | null,
   * toastTimer: number,
   * backupTimer: number,
   * pdfPromise: Promise<void> | null,
   * deadlineState: ReturnType<typeof buildDeadlineState>,
   * deadlineCellAnalysisCache: WeakMap<HTMLTableCellElement, any>,
   * deadlineTargetColsCache: WeakMap<HTMLTableElement, Set<number>>,
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
    menuCommandIds: [],
    hostHooksAttached: false,
    menuOpen: false,
    modalOpen: false,
    modalRoot: null,
    toastTimer: 0,
    backupTimer: 0,
    pdfPromise: null,
    deadlineState: buildDeadlineState(),
    deadlineCellAnalysisCache: new WeakMap(),
    deadlineTargetColsCache: new WeakMap(),
    store: loadStore()
  };

  init();

  /**
   * Inicializa o script com o menor numero possivel de hooks permanentes.
   */
  function init() {
    injectHostStyles();
    attachHostHooks();
    attachDeadlineHooks();
    registerMenuCommand();
    window.addEventListener('message', (event) => {
      if (!event || !event.data || event.data.type !== 'pjip:open-manager') return;
      openModal();
    });
    window.addEventListener('pageshow', registerMenuCommand, true);
    window.addEventListener('focus', registerMenuCommand, true);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) registerMenuCommand();
    });
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
      updateActionMenuVisibility({ isIntimationPage: false, showActionMenu: false });
      if (state.modalOpen) renderModal();
      return;
    }

    const nextContext = analyzeFrameContext(state.frame, state.frameDoc);
    state.pageContext = nextContext;
    updateActionMenuVisibility(nextContext);
    syncDeadlineState();
    injectDeadlineStyles(nextContext.doc);
    processDeadlineRoot(nextContext.doc);

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
      processDeadlineRoot(nextContext.doc);
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
   *   showActionMenu: boolean,
   *   mainTable: HTMLTableElement | null,
   *   markTables: Array<{table: HTMLTableElement, headerMap: ReturnType<typeof createHeaderMap>, legend: string}>
   * }}
   */
  function analyzeFrameContext(frame, doc) {
    const title = normalizeSpaces(doc.querySelector(SELECTORS.title)?.textContent || '');
    const url = safeRun('Falha ao ler URL do iframe.', () => frame.contentWindow?.location?.href || doc.location.href, '') || '';
    const isIntimationScreen = isIntimationFrameScreen(doc, url, title);
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
    const showActionMenu = isIntimationScreen && isIntimationPage;

    return {
      doc,
      url,
      title,
      isIntimationPage,
      showActionMenu,
      mainTable,
      markTables
    };
  }

  /**
   * Confirma se o iframe atual pertence ao fluxo real de pendências/intimações.
   * Evita falso positivo na página inicial, que também possui tabelas com colunas parecidas.
   * @param {Document} doc
   * @param {string} url
   * @param {string} title
   * @returns {boolean}
   */
  function isIntimationFrameScreen(doc, url, title) {
    const normalizedUrl = normalizeText(url);
    const normalizedTitle = normalizeText(title);
    const headingText = normalizeText(
      Array.from(doc.querySelectorAll('.area h2, fieldset > legend, .formLocalizarLegenda'))
        .map((node) => node.textContent || '')
        .join(' ')
    );

    const isPendenciaModule =
      normalizedUrl.includes('pendencia') ||
      normalizedTitle.includes('pendencia');

    const mentionsIntimationFlow =
      headingText.includes('intimac') ||
      headingText.includes('citac') ||
      headingText.includes('pendencia');

    return isPendenciaModule && mentionsIntimationFlow;
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
   * @returns {{items: Record<string, any>, ui: {panelOpen: boolean, hideDone: boolean, onlyMarkedOnPage: boolean, query: string, statusFilter: string, sortBy: string, backupExpanded: boolean}}}
   */
  function loadStore() {
    const fallback = {
      items: Object.create(null),
      ui: {
        panelOpen: false,
        hideDone: true,
        onlyMarkedOnPage: false,
        query: '',
        statusFilter: 'active',
        sortBy: 'deadline-asc',
        backupExpanded: false
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
          query: typeof parsed.ui?.query === 'string' ? parsed.ui.query : '',
          statusFilter: typeof parsed.ui?.statusFilter === 'string' ? parsed.ui.statusFilter : 'active',
          sortBy: typeof parsed.ui?.sortBy === 'string' ? parsed.ui.sortBy : 'deadline-asc',
          backupExpanded: Boolean(parsed.ui?.backupExpanded)
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

    const previousIds = state.menuCommandIds.splice(0);
    const nextId = GM_registerMenuCommand('Gerenciar Intimações', () => openModal());
    if (nextId !== null && nextId !== undefined) {
      state.menuCommandIds.push(nextId);
    } else {
      state.menuCommandIds.push(...previousIds);
      return;
    }

    if (previousIds.length && typeof GM_unregisterMenuCommand === 'function') {
      for (const commandId of previousIds) {
        if (commandId === nextId) continue;
        safeRun('Falha ao remover comando anterior do menu.', () => {
          GM_unregisterMenuCommand(commandId);
        });
      }
    }
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
        position: relative;
        width: min(1180px, calc(100vw - 32px));
        height: min(88vh, 920px);
        display: flex;
        flex-direction: column;
        background: #fff;
        border: 1px solid #cfdaea;
        border-radius: 14px;
        box-shadow: 0 24px 54px rgba(8, 32, 61, .22);
        overflow: hidden;
      }
      .pjip-modal-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 16px;
        color: #fff;
        background: linear-gradient(180deg, #2f72b8 0%, #245f9d 100%);
      }
      .pjip-modal-title {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
      }
      .pjip-modal-subtitle {
        margin-top: 2px;
        font-size: 12px;
        opacity: .92;
      }
      .pjip-modal-close {
        width: 32px;
        min-width: 32px;
        height: 32px;
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
        flex: 1 1 auto;
        min-height: 0;
        display: grid;
        grid-template-columns: 292px minmax(0, 1fr);
        grid-template-rows: auto auto;
        grid-template-areas:
          "rail deadline"
          "rail list";
        align-items: start;
        gap: 12px;
        padding: 12px;
        overflow: auto;
        background: #f4f7fb;
      }
      .pjip-overview {
        grid-area: rail;
        display: grid;
        align-content: start;
        gap: 12px;
      }
      .pjip-summary {
        display: grid;
        gap: 12px;
        padding: 14px;
        border: 1px solid #d6e0ef;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
      }
      .pjip-summary-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .pjip-summary-kicker {
        color: #33537a;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .04em;
        text-transform: uppercase;
      }
      .pjip-summary-title {
        margin-top: 5px;
        color: #15385f;
        font-size: 22px;
        font-weight: 800;
        line-height: 1.1;
      }
      .pjip-summary-subtitle {
        margin-top: 4px;
        color: #58718e;
        font-size: 13px;
      }
      .pjip-summary-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
      }
      .pjip-summary-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .pjip-stat {
        appearance: none;
        display: grid;
        gap: 3px;
        padding: 10px 11px;
        border: 1px solid #d7e2f0;
        border-radius: 8px;
        background: #fff;
        cursor: pointer;
        font: inherit;
        text-align: left;
      }
      .pjip-stat:hover {
        border-color: #9fbbe0;
        box-shadow: 0 3px 10px rgba(15, 54, 102, .08);
      }
      .pjip-stat[data-active="true"] {
        border-color: #1f69d5;
        box-shadow: inset 0 0 0 1px #1f69d5;
      }
      .pjip-stat-value {
        color: #143f70;
        font-size: 22px;
        font-weight: 800;
        line-height: 1;
      }
      .pjip-stat-label {
        color: #5b7089;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: .02em;
      }
      .pjip-stat--late {
        background: linear-gradient(180deg, #fff6f6 0%, #ffeaea 100%);
      }
      .pjip-stat--late .pjip-stat-value {
        color: #a02828;
      }
      .pjip-stat--soon {
        background: linear-gradient(180deg, #fffaf0 0%, #fff2d8 100%);
      }
      .pjip-stat--soon .pjip-stat-value {
        color: #9a5b00;
      }
      .pjip-stat--open {
        background: linear-gradient(180deg, #f4faff 0%, #eaf3ff 100%);
      }
      .pjip-stat--done {
        background: linear-gradient(180deg, #f3fbf5 0%, #e5f5e9 100%);
      }
      .pjip-stat--done .pjip-stat-value {
        color: #1d6f3b;
      }
      .pjip-section {
        display: grid;
        gap: 10px;
      }
      .pjip-section-title {
        margin: 0 0 0 2px;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .04em;
        text-transform: uppercase;
      }
      .pjip-toolbar,
      .pjip-deadline,
      .pjip-backup,
      .pjip-list-shell,
      .pjip-item {
        display: grid;
        gap: 10px;
        padding: 12px;
        border: 1px solid #d6e0ef;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
      }
      .pjip-toolbar input[type="search"],
      .pjip-toolbar select,
      .pjip-deadline input[type="date"],
      .pjip-backup input[type="text"],
      .pjip-backup input[type="password"] {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        border: 1px solid #c9d6e9;
        border-radius: 6px;
        padding: 8px 9px;
        font: inherit;
        min-height: 40px;
      }
      .pjip-toolbar-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 10px;
        align-items: start;
      }
      .pjip-toolbar-row {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }
      .pjip-deadline {
        grid-area: deadline;
        gap: 10px;
      }
      .pjip-deadline-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .pjip-deadline-status {
        color: #48627e;
        font-size: 12px;
        font-weight: 700;
      }
      .pjip-deadline-grid {
        display: grid;
        grid-template-columns: minmax(210px, .8fr) minmax(310px, 1.1fr) minmax(230px, .8fr);
        gap: 10px;
      }
      .pjip-deadline-card {
        display: grid;
        gap: 8px;
        padding: 10px;
        border: 1px solid #dbe3ef;
        border-radius: 8px;
        background: #f8fafc;
      }
      .pjip-deadline-card-title {
        color: #173a61;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .03em;
        text-transform: uppercase;
      }
      .pjip-deadline-card-desc {
        color: #61748d;
        font-size: 11px;
        line-height: 1.4;
      }
      .pjip-deadline-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        align-items: stretch;
      }
      .pjip-deadline-row > input,
      .pjip-deadline-row > button {
        width: 100%;
        min-height: 52px;
        box-sizing: border-box;
      }
      .pjip-deadline-row--range {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .pjip-field {
        display: grid;
        gap: 6px;
        min-width: 0;
      }
      .pjip-field label {
        display: block;
        color: #47627f;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .02em;
        line-height: 1.2;
      }
      .pjip-checks {
        display: grid;
        gap: 8px;
        font-size: 12px;
        color: #375272;
      }
      .pjip-checks label {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 9px;
        border: 1px solid #dbe3ef;
        border-radius: 6px;
        background: #f8fbff;
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
      .pjip-list-shell {
        grid-area: list;
        gap: 14px;
        min-height: 0;
      }
      .pjip-list-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .pjip-list-meta {
        color: #61748d;
        font-size: 12px;
      }
      .pjip-list {
        display: grid;
        gap: 8px;
      }
      .pjip-modal-btn {
        padding: 7px 10px;
        font-size: 12px;
        min-height: 40px;
      }
      .pjip-modal-btn--primary {
        border-color: #1f69d5;
        background: #1f69d5;
        color: #fff;
      }
      .pjip-modal-btn--ghost {
        background: #f8fbff;
      }
      .pjip-backup {
        gap: 14px;
      }
      .pjip-backup[hidden] {
        display: none;
      }
      .pjip-backup-popover {
        position: absolute;
        inset: 0;
        z-index: 2;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: rgba(15, 35, 60, .28);
      }
      .pjip-backup-popover[data-open="true"] {
        display: flex;
      }
      .pjip-backup-dialog {
        width: min(480px, 100%);
        max-height: min(74vh, 620px);
        overflow: auto;
        border: 1px solid #c9d6e9;
        border-radius: 10px;
        background: #fff;
        box-shadow: 0 24px 54px rgba(8, 32, 61, .24);
      }
      .pjip-backup-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .pjip-backup-status-pill {
        padding: 6px 10px;
        border-radius: 999px;
        background: #eef4fb;
        color: #48627e;
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
      }
      .pjip-item--done {
        opacity: .78;
      }
      .pjip-item {
        position: relative;
        grid-template-columns: minmax(140px, .62fr) minmax(0, 1.38fr) auto;
        align-items: center;
        gap: 14px;
        padding: 12px 14px;
      }
      .pjip-item-top {
        display: grid;
        gap: 6px;
        min-width: 0;
      }
      .pjip-item-id {
        font-size: 19px;
        font-weight: 700;
        color: #164172;
        line-height: 1.05;
      }
      .pjip-item-status {
        border-radius: 999px;
        padding: 4px 8px;
        font-size: 11px;
        font-weight: 700;
        color: #2d506f;
        background: #e8eff8;
        width: fit-content;
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
      .pjip-item-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .pjip-item-pill {
        padding: 4px 7px;
        border-radius: 999px;
        background: #eef4fb;
        color: #365879;
        font-size: 11px;
        font-weight: 700;
      }
      .pjip-item-grid {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        color: #20364f;
        font-size: 12px;
        min-width: 0;
      }
      .pjip-item-line {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .pjip-item-line strong {
        color: #4f6783;
        font-size: 11px;
        letter-spacing: .02em;
      }
      .pjip-item-line span {
        overflow-wrap: anywhere;
      }
      .pjip-item-actions {
        justify-content: flex-end;
        min-width: 178px;
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
      @media (max-width: 860px) {
        #${IDS.modalOverlay} {
          padding: 12px;
        }
        #${IDS.modalPanel} {
          width: min(100vw - 8px, 1180px);
          height: 92vh;
          max-height: 92vh;
        }
        .pjip-modal-body,
        .pjip-overview,
        .pjip-toolbar-grid,
        .pjip-toolbar-row,
        .pjip-deadline-grid,
        .pjip-deadline-row,
        .pjip-deadline-row--range,
        .pjip-summary-grid,
        .pjip-item,
        .pjip-item-grid {
          grid-template-columns: 1fr;
        }
        .pjip-modal-body {
          grid-template-areas:
            "rail"
            "deadline"
            "list";
        }
        .pjip-summary-head,
        .pjip-list-head,
        .pjip-deadline-head,
        .pjip-backup-head,
        .pjip-item-top {
          flex-direction: column;
          align-items: stretch;
        }
        .pjip-summary-actions {
          justify-content: flex-start;
        }
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
    body.appendChild(buildMenuButton('Minhas intimações e prazos', () => openModal()));

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
    const shouldShowMenu = Boolean(context.showActionMenu);
    if (!shouldShowMenu) state.menuOpen = false;
    root.classList.toggle('pjip-hidden', !shouldShowMenu);
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
    state.store.ui.backupExpanded = false;
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
    panel.setAttribute('aria-label', 'Gerenciar Intimações');

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
      <section class="pjip-overview">
        <section class="pjip-summary">
          <div class="pjip-summary-head">
            <div>
              <div class="pjip-summary-kicker">Painel principal</div>
              <div class="pjip-summary-title" data-role="summary-title"></div>
              <div class="pjip-summary-subtitle" data-role="summary-subtitle"></div>
            </div>
          </div>
          <div class="pjip-summary-grid">
            <button type="button" class="pjip-stat pjip-stat--late" data-role="quick-status" data-status="late">
              <div class="pjip-stat-value" data-role="stat-late">0</div>
              <div class="pjip-stat-label">Vencidas</div>
            </button>
            <button type="button" class="pjip-stat pjip-stat--soon" data-role="quick-status" data-status="soon">
              <div class="pjip-stat-value" data-role="stat-soon">0</div>
              <div class="pjip-stat-label">Vencendo</div>
            </button>
            <button type="button" class="pjip-stat pjip-stat--open" data-role="quick-status" data-status="open">
              <div class="pjip-stat-value" data-role="stat-open">0</div>
              <div class="pjip-stat-label">Abertas</div>
            </button>
            <button type="button" class="pjip-stat pjip-stat--done" data-role="quick-status" data-status="done">
              <div class="pjip-stat-value" data-role="stat-done">0</div>
              <div class="pjip-stat-label">Concluídas</div>
            </button>
          </div>
          <div class="pjip-summary-actions">
            <button type="button" class="pjip-modal-btn pjip-modal-btn--ghost" data-role="backup-toggle"></button>
          </div>
        </section>
        <section class="pjip-toolbar">
          <div class="pjip-section">
            <div class="pjip-section-title">Filtros</div>
            <div class="pjip-toolbar-grid">
              <div class="pjip-field">
                <label for="pjip-modal-search">Busca</label>
                <input id="pjip-modal-search" type="search" data-role="search" placeholder="Buscar intimação, processo ou texto">
              </div>
              <div class="pjip-toolbar-row">
                <div class="pjip-field">
                  <label for="pjip-modal-status">Status</label>
                  <select id="pjip-modal-status" data-role="status-filter">
                    <option value="all">Todas</option>
                    <option value="late">Vencidas</option>
                    <option value="soon">Vencendo</option>
                    <option value="open">Abertas</option>
                    <option value="done">Concluídas</option>
                    <option value="active">Abertas e em andamento</option>
                  </select>
                </div>
                <div class="pjip-field">
                  <label for="pjip-modal-sort">Ordenação</label>
                  <select id="pjip-modal-sort" data-role="sort-by">
                    <option value="deadline-asc">Prazo mais próximo</option>
                    <option value="deadline-desc">Prazo mais distante</option>
                    <option value="updated-desc">Atualizadas recentemente</option>
                    <option value="id-asc">Número da intimação</option>
                  </select>
                </div>
              </div>
            </div>
            <div class="pjip-checks">
              <label><input type="checkbox" data-role="hide-done"> Ocultar concluídas</label>
              <label><input type="checkbox" data-role="only-marked-page"> Mostrar só as marcadas nesta página</label>
            </div>
            <div class="pjip-toolbar-meta" data-role="meta"></div>
          </div>
        </section>
      </section>
      <section class="pjip-deadline" data-role="deadline-panel">
        <div class="pjip-deadline-head">
          <div class="pjip-section">
            <div class="pjip-section-title">Prazos</div>
            <div class="pjip-backup-meta">Filtros aplicados diretamente à tabela atual do Projudi.</div>
          </div>
          <div class="pjip-deadline-status" data-role="deadline-status"></div>
        </div>
        <div class="pjip-deadline-grid">
          <div class="pjip-deadline-card">
            <div class="pjip-deadline-card-title">Filtro por data exata</div>
            <div class="pjip-deadline-card-desc">Exibe somente linhas cuja coluna de prazo corresponda à data escolhida.</div>
            <div class="pjip-deadline-row">
              <input data-role="deadline-date" type="date">
              <button type="button" class="pjip-modal-btn pjip-modal-btn--primary" data-role="deadline-apply-date">Aplicar</button>
            </div>
          </div>
          <div class="pjip-deadline-card">
            <div class="pjip-deadline-card-title">Filtro por período</div>
            <div class="pjip-deadline-card-desc">Exibe somente linhas com prazo dentro do intervalo informado.</div>
            <div class="pjip-deadline-row pjip-deadline-row--range">
              <input data-role="deadline-range-start" type="date">
              <input data-role="deadline-range-end" type="date">
              <button type="button" class="pjip-modal-btn pjip-modal-btn--primary" data-role="deadline-apply-range">Aplicar período</button>
            </div>
          </div>
          <div class="pjip-deadline-card">
            <div class="pjip-deadline-card-title">Sem data limite</div>
            <div class="pjip-deadline-card-desc">Localiza linhas com prazo vazio ou preenchido apenas com traço.</div>
            <div class="pjip-deadline-row">
              <button type="button" class="pjip-modal-btn pjip-modal-btn--primary" data-role="deadline-apply-missing">Localizar sem prazo</button>
              <button type="button" class="pjip-modal-btn" data-role="deadline-clear">Limpar filtro</button>
            </div>
          </div>
        </div>
      </section>
      <section class="pjip-list-shell">
        <div class="pjip-list-head">
          <div>
            <div class="pjip-section-title">Itens monitorados</div>
            <div class="pjip-list-meta" data-role="list-meta"></div>
          </div>
        </div>
        <section class="pjip-list" data-role="list"></section>
      </section>
      <div class="pjip-backup-popover" data-role="backup-popover">
        <section class="pjip-backup pjip-backup-dialog" data-role="backup-panel">
          <div class="pjip-backup-head">
            <div class="pjip-section">
              <div class="pjip-section-title">Backup remoto</div>
              <div class="pjip-backup-meta">Gist usado apenas para sincronizar as marcações locais deste script.</div>
            </div>
            <div class="pjip-backup-status-pill" data-role="backup-pill"></div>
          </div>
          <input type="text" data-role="backup-gist-id" placeholder="Gist ID">
          <input type="password" data-role="backup-token" placeholder="Token do GitHub">
          <input type="text" data-role="backup-file-name" placeholder="Nome do arquivo">
          <div class="pjip-checks">
            <label><input type="checkbox" data-role="backup-enabled"> Ativar backup por Gist</label>
            <label><input type="checkbox" data-role="backup-auto"> Backup automático</label>
          </div>
          <div class="pjip-backup-actions">
            <button type="button" class="pjip-modal-btn" data-role="backup-send">Enviar</button>
            <button type="button" class="pjip-modal-btn" data-role="backup-restore">Restaurar</button>
            <button type="button" class="pjip-modal-btn" data-role="backup-clear">Limpar</button>
            <button type="button" class="pjip-modal-btn" data-role="backup-close">Fechar</button>
          </div>
          <div class="pjip-backup-meta" data-role="backup-status"></div>
          <div class="pjip-backup-meta" data-role="backup-last"></div>
        </section>
      </div>
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

    body.querySelector('[data-role="status-filter"]')?.addEventListener('change', (event) => {
      const input = /** @type {HTMLSelectElement} */ (event.currentTarget);
      state.store.ui.statusFilter = input.value || 'active';
      persistStore();
      renderModal();
    });

    body.querySelectorAll('[data-role="quick-status"]').forEach((button) => {
      button.addEventListener('click', (event) => {
        const target = /** @type {HTMLElement} */ (event.currentTarget);
        state.store.ui.statusFilter = target.dataset.status || 'active';
        persistStore();
        renderModal();
      });
    });

    body.querySelector('[data-role="sort-by"]')?.addEventListener('change', (event) => {
      const input = /** @type {HTMLSelectElement} */ (event.currentTarget);
      state.store.ui.sortBy = input.value || 'deadline-asc';
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

    body.querySelector('[data-role="backup-toggle"]')?.addEventListener('click', () => {
      state.store.ui.backupExpanded = true;
      persistStore();
      renderModal();
    });

    body.querySelector('[data-role="backup-close"]')?.addEventListener('click', () => {
      state.store.ui.backupExpanded = false;
      persistStore();
      renderModal();
    });

    body.querySelector('[data-role="backup-popover"]')?.addEventListener('click', (event) => {
      if (event.target !== event.currentTarget) return;
      state.store.ui.backupExpanded = false;
      persistStore();
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

    body.querySelector('[data-role="deadline-apply-date"]')?.addEventListener('click', () => {
      const ymd = /** @type {HTMLInputElement | null} */ (body.querySelector('[data-role="deadline-date"]'))?.value || '';
      if (!ymdToDate(ymd)) {
        setNodeText(body.querySelector('[data-role="deadline-status"]'), 'Selecione uma data válida.');
        return;
      }
      setDeadlineStored(DEADLINE.filterDateKey, ymd);
      setDeadlineFilterMode('exact');
      setDeadlineFilterEnabled(true);
      applyDeadlineSettingsChange();
      renderModal();
    });

    body.querySelector('[data-role="deadline-apply-range"]')?.addEventListener('click', () => {
      const start = /** @type {HTMLInputElement | null} */ (body.querySelector('[data-role="deadline-range-start"]'))?.value || '';
      const end = /** @type {HTMLInputElement | null} */ (body.querySelector('[data-role="deadline-range-end"]'))?.value || '';
      if (!ymdToDate(start) || !ymdToDate(end)) {
        setNodeText(body.querySelector('[data-role="deadline-status"]'), 'Selecione data inicial e final válidas.');
        return;
      }
      setDeadlineStored(DEADLINE.filterRangeStartKey, start);
      setDeadlineStored(DEADLINE.filterRangeEndKey, end);
      setDeadlineFilterMode('range');
      setDeadlineFilterEnabled(true);
      applyDeadlineSettingsChange();
      renderModal();
    });

    body.querySelector('[data-role="deadline-apply-missing"]')?.addEventListener('click', () => {
      setDeadlineFilterMode('missing');
      setDeadlineFilterEnabled(true);
      applyDeadlineSettingsChange();
      renderModal();
    });

    body.querySelector('[data-role="deadline-clear"]')?.addEventListener('click', () => {
      clearDeadlineStored(DEADLINE.filterDateKey);
      clearDeadlineStored(DEADLINE.filterRangeStartKey);
      clearDeadlineStored(DEADLINE.filterRangeEndKey);
      setDeadlineFilterMode('exact');
      setDeadlineFilterEnabled(false);
      applyDeadlineSettingsChange();
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
    const todayYmd = toYmd(cloneDay(new Date()));
    const filterDate = getDeadlineFilterDate() || todayYmd;
    const summary = buildItemsSummary();
    const visibleItems = getFilteredItems();
    setInputValue(root.querySelector('[data-role="search"]'), state.store.ui.query);
    setChecked(root.querySelector('[data-role="hide-done"]'), state.store.ui.hideDone);
    setChecked(root.querySelector('[data-role="only-marked-page"]'), state.store.ui.onlyMarkedOnPage);
    setSelectValue(root.querySelector('[data-role="status-filter"]'), state.store.ui.statusFilter);
    setSelectValue(root.querySelector('[data-role="sort-by"]'), state.store.ui.sortBy);
    setChecked(root.querySelector('[data-role="backup-enabled"]'), backupSettings.enabled);
    setChecked(root.querySelector('[data-role="backup-auto"]'), backupSettings.autoBackupOnSave);
    setInputValue(root.querySelector('[data-role="backup-gist-id"]'), backupSettings.gistId);
    setInputValue(root.querySelector('[data-role="backup-token"]'), backupSettings.token);
    setInputValue(root.querySelector('[data-role="backup-file-name"]'), backupSettings.fileName);
    setNodeText(root.querySelector('[data-role="backup-last"]'), formatLastBackupLabel(backupSettings.lastBackupAt));
    setInputValue(root.querySelector('[data-role="deadline-date"]'), filterDate);
    setInputValue(root.querySelector('[data-role="deadline-range-start"]'), getDeadlineRangeStart() || filterDate);
    setInputValue(root.querySelector('[data-role="deadline-range-end"]'), getDeadlineRangeEnd() || filterDate);
    setNodeText(root.querySelector('[data-role="deadline-status"]'), describeActiveDeadlineFilter());
    setNodeText(root.querySelector('[data-role="summary-title"]'), `${formatCount(summary.visible, 'item', 'itens')} em foco`);
    setNodeText(
      root.querySelector('[data-role="summary-subtitle"]'),
      summary.late
        ? `${summary.late} vencida(s) precisam de atenção imediata.`
        : 'Painel reorganizado para priorizar o que exige ação.'
    );
    setNodeText(root.querySelector('[data-role="stat-late"]'), String(summary.late));
    setNodeText(root.querySelector('[data-role="stat-soon"]'), String(summary.soon));
    setNodeText(root.querySelector('[data-role="stat-open"]'), String(summary.open));
    setNodeText(root.querySelector('[data-role="stat-done"]'), String(summary.done));
    root.querySelectorAll('[data-role="quick-status"]').forEach((button) => {
      if (button instanceof HTMLElement) {
        button.dataset.active = button.dataset.status === state.store.ui.statusFilter ? 'true' : 'false';
      }
    });
    setNodeText(root.querySelector('[data-role="list-meta"]'), describeVisibleItems(summary.visible, summary.total, state.store.ui.statusFilter));
    setNodeText(
      root.querySelector('[data-role="meta"]'),
      `${formatCount(visibleItems.length, 'item visível', 'itens visíveis')} • ${formatCount(summary.total, 'intimação marcada', 'intimações marcadas')} • ordenação: ${resolveSortLabel(state.store.ui.sortBy)}.`
    );
    setNodeText(
      root.querySelector('[data-role="backup-toggle"]'),
      'Abrir backup remoto'
    );
    setNodeText(root.querySelector('[data-role="backup-pill"]'), backupSettings.enabled ? 'Backup ativo' : 'Backup desativado');
    const backupPopover = root.querySelector('[data-role="backup-popover"]');
    if (backupPopover instanceof HTMLElement) {
      backupPopover.dataset.open = state.store.ui.backupExpanded ? 'true' : 'false';
    }

    const listNode = root.querySelector('[data-role="list"]');
    if (!listNode) return;
    listNode.replaceChildren();

    if (!visibleItems.length) {
      const empty = document.createElement('div');
      empty.className = 'pjip-empty';
      empty.textContent = 'Nenhuma intimação marcada para este filtro.';
      listNode.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of visibleItems) {
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

    const meta = document.createElement('div');
    meta.className = 'pjip-item-meta';
    meta.appendChild(buildItemPill(item.processNumber || 'Sem processo'));
    meta.appendChild(buildItemPill(formatDeadlinePill(item.deadline)));
    top.append(idNode, statusNode, meta);

    const grid = document.createElement('div');
    grid.className = 'pjip-item-grid';
    appendLabeledValue(grid, 'Movimentação', item.movement || '—');
    appendLabeledValue(grid, 'Última atualização', formatObservedAt(item.updatedAt || item.observedAt));
    appendLabeledValue(grid, 'Origem', item.sourceLegend || item.kind || 'Intimação');

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
    line.className = 'pjip-item-line';
    const strong = document.createElement('strong');
    strong.textContent = label;
    const text = document.createElement('span');
    text.textContent = value;
    line.append(strong, text);
    container.appendChild(line);
  }

  /**
   * Cria um selo visual para metadados principais do item.
   * @param {string} text
   * @returns {HTMLElement}
   */
  function buildItemPill(text) {
    const pill = document.createElement('div');
    pill.className = 'pjip-item-pill';
    pill.textContent = text;
    return pill;
  }

  /**
   * Formata o selo de prazo sem exibir horario.
   * @param {string=} deadline
   * @returns {string}
   */
  function formatDeadlinePill(deadline) {
    const value = normalizeSpaces(deadline || '');
    if (!value) return 'Sem prazo';
    const match = value.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
    return match ? `Prazo ${match[1]}` : `Prazo ${value}`;
  }

  /**
   * Filtra os itens marcados para exibicao.
   * @returns {any[]}
   */
  function getFilteredItems() {
    const query = normalizeText(state.store.ui.query);
    const items = Object.values(state.store.items).filter((item) => {
      const status = resolveItemStatusKey(item);
      if (state.store.ui.hideDone && item.done && state.store.ui.statusFilter !== 'done') return false;
      if (!matchesStatusFilter(status, state.store.ui.statusFilter)) return false;
      if (!query) return true;
      const haystack = normalizeText([item.id, item.processNumber, item.deadline, item.movement, item.sourceLegend].join(' '));
      return haystack.includes(query);
    });

    items.sort((left, right) => {
      const leftTime = parseBrazilianDateTime(left.deadline) || Number.MAX_SAFE_INTEGER;
      const rightTime = parseBrazilianDateTime(right.deadline) || Number.MAX_SAFE_INTEGER;
      if (state.store.ui.sortBy === 'deadline-desc') {
        if (left.done !== right.done) return left.done ? 1 : -1;
        if (leftTime !== rightTime) return rightTime - leftTime;
      } else if (state.store.ui.sortBy === 'updated-desc') {
        const leftUpdated = resolveUpdatedAtTime(left);
        const rightUpdated = resolveUpdatedAtTime(right);
        if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
      } else if (state.store.ui.sortBy === 'id-asc') {
        return String(left.id).localeCompare(String(right.id), 'pt-BR', { numeric: true });
      } else {
        if (left.done !== right.done) return left.done ? 1 : -1;
        if (leftTime !== rightTime) return leftTime - rightTime;
      }
      return String(left.id).localeCompare(String(right.id), 'pt-BR', { numeric: true });
    });

    return items;
  }

  /**
   * Gera resumo geral para o topo do painel.
   * @returns {{total: number, visible: number, late: number, soon: number, open: number, done: number}}
   */
  function buildItemsSummary() {
    const allItems = Object.values(state.store.items);
    let late = 0;
    let soon = 0;
    let open = 0;
    let done = 0;

    for (const item of allItems) {
      const status = resolveItemStatusKey(item);
      if (status === 'done') done += 1;
      else if (status === 'late') late += 1;
      else if (status === 'soon') soon += 1;
      else open += 1;
    }

    return {
      total: allItems.length,
      visible: getFilteredItems().length,
      late,
      soon,
      open,
      done
    };
  }

  /**
   * Define se um status pertence ao filtro selecionado.
   * @param {string} status
   * @param {string} filter
   * @returns {boolean}
   */
  function matchesStatusFilter(status, filter) {
    if (filter === 'all') return true;
    if (filter === 'active') return status === 'late' || status === 'soon' || status === 'open';
    return status === filter;
  }

  /**
   * Resolve a chave de status usada nos filtros.
   * @param {any} item
   * @returns {'done' | 'late' | 'soon' | 'open'}
   */
  function resolveItemStatusKey(item) {
    if (item.done) return 'done';
    const time = parseBrazilianDateTime(item.deadline);
    if (!time) return 'open';
    const now = Date.now();
    if (time < now) return 'late';
    if (time - now <= 2 * 24 * 60 * 60 * 1000) return 'soon';
    return 'open';
  }

  /**
   * Resolve um timestamp comparavel para ordenacao por atualizacao.
   * @param {any} item
   * @returns {number}
   */
  function resolveUpdatedAtTime(item) {
    const value = item.updatedAt || item.observedAt || '';
    return parseBrazilianDateTime(value) || Date.parse(value) || 0;
  }

  /**
   * Descreve a lista visivel conforme o filtro aplicado.
   * @param {number} visible
   * @param {number} total
   * @param {string} statusFilter
   * @returns {string}
   */
  function describeVisibleItems(visible, total, statusFilter) {
    const scope =
      statusFilter === 'late'
        ? 'somente vencidas'
        : statusFilter === 'soon'
          ? 'somente vencendo'
          : statusFilter === 'open'
            ? 'somente abertas'
            : statusFilter === 'done'
              ? 'somente concluídas'
              : statusFilter === 'active'
                ? 'abertas em andamento'
                : 'todos os status';
    return `${formatCount(visible, 'item exibido', 'itens exibidos')} de ${formatCount(total, 'monitorado', 'monitorados')} • filtro: ${scope}.`;
  }

  /**
   * Formata contagens simples com singular e plural.
   * @param {number} count
   * @param {string} singular
   * @param {string} plural
   * @returns {string}
   */
  function formatCount(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  /**
   * Resolve o rotulo legivel da ordenacao.
   * @param {string} sortBy
   * @returns {string}
   */
  function resolveSortLabel(sortBy) {
    if (sortBy === 'deadline-desc') return 'prazo mais distante';
    if (sortBy === 'updated-desc') return 'atualizadas recentemente';
    if (sortBy === 'id-asc') return 'número da intimação';
    return 'prazo mais próximo';
  }

  /**
   * Resolve classe do status.
   * @param {any} item
   * @returns {string}
   */
  function resolveItemStatusClass(item) {
    const status = resolveItemStatusKey(item);
    if (status === 'done') return 'pjip-item-status--done';
    if (status === 'late') return 'pjip-item-status--late';
    if (status === 'soon') return 'pjip-item-status--soon';
    return '';
  }

  /**
   * Resolve rotulo do status.
   * @param {any} item
   * @returns {string}
   */
  function resolveItemStatusLabel(item) {
    const status = resolveItemStatusKey(item);
    if (status === 'done') return 'Concluída';
    if (status === 'late') return 'Vencida';
    if (status === 'soon') return 'Vencendo';
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
   * Anexa os hooks globais usados pelo modulo de prazos.
   */
  function attachDeadlineHooks() {
    window.addEventListener(DEADLINE.settingsSyncEvent, () => {
      syncDeadlineState(true);
      if (state.frameDoc) {
        clearDeadlineProcessedState(state.frameDoc);
        injectDeadlineStyles(state.frameDoc);
        processDeadlineRoot(state.frameDoc);
      }
    });

    window.addEventListener('focus', maybeRefreshDeadlinesForClockOrSettings);
    window.addEventListener('pageshow', maybeRefreshDeadlinesForClockOrSettings);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) maybeRefreshDeadlinesForClockOrSettings();
    });
  }

  /**
   * Atualiza prazos quando a data do dia ou configuracoes salvas mudam.
   */
  function maybeRefreshDeadlinesForClockOrSettings() {
    const previous = state.deadlineState;
    const next = buildDeadlineState();
    if (next.todayYmd === previous.todayYmd && next.settingsSnapshot === previous.settingsSnapshot) return;
    state.deadlineState = next;
    state.deadlineCellAnalysisCache = new WeakMap();
    if (!state.frameDoc) return;
    clearDeadlineProcessedState(state.frameDoc);
    injectDeadlineStyles(state.frameDoc);
    processDeadlineRoot(state.frameDoc);
  }

  /**
   * Sincroniza o estado derivado dos prazos.
   * @param {boolean=} force
   */
  function syncDeadlineState(force = false) {
    const next = buildDeadlineState();
    if (!force && next.todayYmd === state.deadlineState.todayYmd && next.settingsSnapshot === state.deadlineState.settingsSnapshot) {
      return;
    }
    state.deadlineState = next;
    state.deadlineCellAnalysisCache = new WeakMap();
  }

  /**
   * Le armazenamento do modulo de prazos.
   * @param {string} key
   * @param {any=} fallback
   * @returns {any}
   */
  function getDeadlineStored(key, fallback = '') {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (error) {
      logWarn(`Falha ao ler configuracao de prazo "${key}".`, error);
      return fallback;
    }
  }

  /**
   * Salva armazenamento do modulo de prazos.
   * @param {string} key
   * @param {any} value
   */
  function setDeadlineStored(key, value) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, value);
      else localStorage.setItem(key, String(value));
    } catch (error) {
      logWarn(`Falha ao salvar configuracao de prazo "${key}".`, error);
    }
  }

  /**
   * Remove uma chave de armazenamento do modulo de prazos.
   * @param {string} key
   */
  function clearDeadlineStored(key) {
    try {
      if (typeof GM_deleteValue === 'function') GM_deleteValue(key);
      else localStorage.removeItem(key);
    } catch (error) {
      logWarn(`Falha ao limpar configuracao de prazo "${key}".`, error);
    }
  }

  function getDeadlineFilterDate() {
    return String(getDeadlineStored(DEADLINE.filterDateKey, '') || '');
  }

  function getDeadlineFilterEnabled() {
    const raw = getDeadlineStored(DEADLINE.filterEnabledKey, false);
    return raw === true || raw === 'true' || raw === 1 || raw === '1';
  }

  function setDeadlineFilterEnabled(enabled) {
    setDeadlineStored(DEADLINE.filterEnabledKey, Boolean(enabled));
  }

  function getDeadlineFilterMode() {
    const mode = String(getDeadlineStored(DEADLINE.filterModeKey, 'exact') || 'exact').toLowerCase();
    if (mode === 'range' || mode === 'missing') return mode;
    return 'exact';
  }

  function setDeadlineFilterMode(mode) {
    setDeadlineStored(DEADLINE.filterModeKey, mode === 'range' || mode === 'missing' ? mode : 'exact');
  }

  function getDeadlineRangeStart() {
    return String(getDeadlineStored(DEADLINE.filterRangeStartKey, '') || '');
  }

  function getDeadlineRangeEnd() {
    return String(getDeadlineStored(DEADLINE.filterRangeEndKey, '') || '');
  }

  /**
   * Monta o estado derivado do destaque de prazos.
   * @returns {{todayYmd: string, byYmd: Map<string, any>, entries: any[], highlightSnapshot: string, settingsSnapshot: string}}
   */
  function buildDeadlineState() {
    const today = cloneDay(new Date());
    const windowDates = [];
    for (let index = 0; index < DEADLINE.windowDays; index += 1) windowDates.push(addDays(today, index));
    const weekdays = windowDates.map((date, index) => ({ date, index })).filter((entry) => !isWeekend(entry.date));
    const entries = windowDates.map((date, offset) => {
      if (isWeekend(date)) {
        return {
          ymd: toYmd(date),
          className: `${DEADLINE.classPrefix}-weekend`,
          tooltip: `Fim de semana (${weekdayShortPT(date)}) • ${formatDay(date)}`,
          color: DEADLINE_WEEKEND_COLOR
        };
      }
      const weekdayPos = weekdays.findIndex((entry) => entry.index === offset);
      const color = interpolateDeadlinePalette(
        DEADLINE_WEEKDAY_PALETTE,
        Math.max(0, weekdayPos),
        Math.max(1, weekdays.length)
      );
      return {
        ymd: toYmd(date),
        className: `${DEADLINE.classPrefix}-wd-${weekdayPos}`,
        tooltip: `Possível vencimento em ${offset === 0 ? 'HOJE' : `${offset} dia(s)`} • ${weekdayShortPT(date)} • ${formatDay(date)}`,
        color
      };
    });

    return {
      todayYmd: toYmd(today),
      byYmd: new Map(entries.map((entry) => [entry.ymd, entry])),
      entries,
      highlightSnapshot: entries.map((entry) => entry.ymd).join('|'),
      settingsSnapshot: JSON.stringify({
        filterDate: getDeadlineFilterDate(),
        filterEnabled: getDeadlineFilterEnabled(),
        filterMode: getDeadlineFilterMode(),
        filterRangeStart: getDeadlineRangeStart(),
        filterRangeEnd: getDeadlineRangeEnd()
      })
    };
  }

  /**
   * Injeta CSS de destaque de prazo no documento alvo.
   * @param {Document} doc
   */
  function injectDeadlineStyles(doc) {
    const baseId = `${DEADLINE.classPrefix}-style`;
    if (!doc.getElementById(baseId)) {
      const style = doc.createElement('style');
      style.id = baseId;
      style.textContent = `
        td.${DEADLINE.classPrefix}-cell {
          position: relative;
          font-weight: 600 !important;
          border-radius: 4px;
          box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
        }
        td.${DEADLINE.classPrefix}-cell[data-tooltip] { cursor: help; }
        td.${DEADLINE.classPrefix}-cell[data-tooltip]::after {
          content: attr(data-tooltip);
          position: absolute;
          left: 50%;
          top: -6px;
          transform: translateX(-50%) translateY(-100%);
          background: #333;
          color: #fff;
          padding: 4px 8px;
          font-size: 11px;
          border-radius: 4px;
          white-space: nowrap;
          opacity: 0;
          pointer-events: none;
          transition: opacity .2s;
          z-index: 99999;
        }
        td.${DEADLINE.classPrefix}-cell[data-tooltip]::before {
          content: "";
          position: absolute;
          left: 50%;
          top: -6px;
          transform: translateX(-50%);
          border-width: 5px;
          border-style: solid;
          border-color: transparent transparent #333 transparent;
          opacity: 0;
          transition: opacity .2s;
          z-index: 99998;
        }
        td.${DEADLINE.classPrefix}-cell:hover::after,
        td.${DEADLINE.classPrefix}-cell:hover::before { opacity: 1; }
      `;
      (doc.head || doc.documentElement).appendChild(style);
    }

    const dynId = `${DEADLINE.classPrefix}-dyn`;
    doc.getElementById(dynId)?.remove();
    const dyn = doc.createElement('style');
    dyn.id = dynId;
    dyn.textContent = state.deadlineState.entries
      .map((entry) => `td.${DEADLINE.classPrefix}-cell.${entry.className}{background-color:${entry.color.bg} !important;color:${entry.color.fg} !important;}`)
      .join('\n');
    (doc.head || doc.documentElement).appendChild(dyn);
  }

  /**
   * Processa tabelas de prazo dentro de um documento ou elemento.
   * @param {Document | Element} root
   */
  function processDeadlineRoot(root) {
    getDeadlineTablesFromRoot(root).forEach(processDeadlineTable);
  }

  /**
   * Reverte o estado visual aplicado pelo filtro/destaque de prazo.
   * @param {Document | Element} root
   */
  function clearDeadlineProcessedState(root) {
    root.querySelectorAll?.(`td.${DEADLINE.classPrefix}-cell`).forEach(clearDeadlineCellHighlight);
    root.querySelectorAll?.(`tr[${DEADLINE.filterHiddenAttr}="1"]`).forEach(showDeadlineRow);
  }

  /**
   * Processa uma tabela que contenha coluna de prazo.
   * @param {HTMLTableElement} table
   */
  function processDeadlineTable(table) {
    const targetCols = getDeadlineColumnIndexes(table);
    if (!targetCols.size) return;
    const filterSpec = getActiveDeadlineFilterSpec();
    const rows = table.querySelectorAll('tbody tr');

    for (const row of rows) {
      const cells = getDeadlineRowCells(row);
      for (let col = 0; col < cells.length; col += 1) {
        if (targetCols.has(col)) applyDeadlineHighlightToCell(cells[col]);
      }

      if (!filterSpec) showDeadlineRow(row);
      else if (rowMatchesDeadlineFilter(row, targetCols, filterSpec)) showDeadlineRow(row);
      else hideDeadlineRow(row);
    }
  }

  /**
   * Calcula os indices de colunas de prazo.
   * @param {HTMLTableElement} table
   * @returns {Set<number>}
   */
  function getDeadlineColumnIndexes(table) {
    const cached = state.deadlineTargetColsCache.get(table);
    if (cached) return cached;

    const rows = table.tHead?.rows?.length
      ? Array.from(table.tHead.rows)
      : Array.from(table.querySelectorAll('tr')).slice(0, 2);
    const headerRow = rows[rows.length - 1];
    const indexes = new Set();
    let index = 0;

    for (const cell of Array.from(headerRow?.children || [])) {
      const span = Number.parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
      const text = normalizeText(cell.textContent || '');
      if (DEADLINE.targetHeaders.some((header) => text.includes(normalizeText(header)))) {
        for (let offset = 0; offset < span; offset += 1) indexes.add(index + offset);
      }
      index += span;
    }

    state.deadlineTargetColsCache.set(table, indexes);
    return indexes;
  }

  /**
   * Retorna todas as tabelas afetadas por uma raiz.
   * @param {Document | Element | Node} root
   * @returns {HTMLTableElement[]}
   */
  function getDeadlineTablesFromRoot(root) {
    if (!root) return [];
    const tables = new Set();
    if (root.nodeName === 'TABLE') tables.add(root);
    if (root.nodeType === 1) {
      const parentTable = typeof root.closest === 'function' ? root.closest('table') : null;
      if (parentTable) tables.add(parentTable);
      root.querySelectorAll?.('table').forEach((table) => tables.add(table));
    } else if (root.nodeType === 9) {
      root.querySelectorAll('table').forEach((table) => tables.add(table));
    }
    return Array.from(tables);
  }

  /**
   * @param {Element} row
   * @returns {HTMLTableCellElement[]}
   */
  function getDeadlineRowCells(row) {
    return Array.from(row.children || []).filter((node) => node.nodeName === 'TD');
  }

  /**
   * @param {HTMLTableCellElement} cell
   */
  function clearDeadlineCellHighlight(cell) {
    const previousClass = cell.getAttribute(DEADLINE.cellAttr);
    if (previousClass) cell.classList.remove(previousClass);
    cell.classList.remove(`${DEADLINE.classPrefix}-cell`);
    cell.removeAttribute(DEADLINE.cellAttr);
    cell.removeAttribute('data-tooltip');
  }

  /**
   * @param {HTMLTableCellElement} cell
   */
  function applyDeadlineHighlightToCell(cell) {
    clearDeadlineCellHighlight(cell);
    const entry = analyzeDeadlineCell(cell).highlightEntry;
    if (!entry) return;
    cell.classList.add(`${DEADLINE.classPrefix}-cell`, entry.className);
    cell.setAttribute(DEADLINE.cellAttr, entry.className);
    cell.setAttribute('data-tooltip', entry.tooltip);
  }

  /**
   * @param {HTMLTableCellElement} cell
   * @returns {{text: string, missing: boolean, dates: Date[], highlightEntry: any, highlightSnapshot: string}}
   */
  function analyzeDeadlineCell(cell) {
    const text = String(cell?.textContent || '').trim();
    const cached = state.deadlineCellAnalysisCache.get(cell);
    if (cached && cached.text === text && cached.highlightSnapshot === state.deadlineState.highlightSnapshot) return cached;

    const dates = extractDeadlineDatesFromText(text);
    let highlightEntry = null;
    for (const date of dates) {
      const entry = state.deadlineState.byYmd.get(toYmd(date));
      if (entry) {
        highlightEntry = entry;
        break;
      }
    }

    const analysis = {
      text,
      missing: isMissingDeadlineText(text),
      dates,
      highlightEntry,
      highlightSnapshot: state.deadlineState.highlightSnapshot
    };
    state.deadlineCellAnalysisCache.set(cell, analysis);
    return analysis;
  }

  /**
   * @returns {{mode: 'missing'} | {mode: 'range', from: Date, to: Date} | {mode: 'exact', date: Date, ymd: string} | null}
   */
  function getActiveDeadlineFilterSpec() {
    if (!getDeadlineFilterEnabled()) return null;
    const mode = getDeadlineFilterMode();
    if (mode === 'missing') return { mode: 'missing' };
    if (mode === 'range') {
      const start = ymdToDate(getDeadlineRangeStart());
      const end = ymdToDate(getDeadlineRangeEnd());
      if (!start || !end) return null;
      return { mode: 'range', from: start <= end ? start : end, to: start <= end ? end : start };
    }
    const exact = ymdToDate(getDeadlineFilterDate()) || cloneDay(new Date());
    return { mode: 'exact', date: exact, ymd: toYmd(exact) };
  }

  /**
   * @param {Element} row
   * @param {Set<number>} targetCols
   * @param {NonNullable<ReturnType<typeof getActiveDeadlineFilterSpec>>} filterSpec
   */
  function rowMatchesDeadlineFilter(row, targetCols, filterSpec) {
    const cells = getDeadlineRowCells(row);
    for (let col = 0; col < cells.length; col += 1) {
      if (!targetCols.has(col)) continue;
      const analysis = analyzeDeadlineCell(cells[col]);
      if (filterSpec.mode === 'missing') {
        if (analysis.missing) return true;
        continue;
      }
      for (const date of analysis.dates) {
        if (filterSpec.mode === 'exact' && toYmd(date) === filterSpec.ymd) return true;
        if (filterSpec.mode === 'range' && date >= filterSpec.from && date <= filterSpec.to) return true;
      }
    }
    return false;
  }

  function hideDeadlineRow(row) {
    row.style.setProperty('display', 'none', 'important');
    row.setAttribute(DEADLINE.filterHiddenAttr, '1');
  }

  function showDeadlineRow(row) {
    if (!row.hasAttribute(DEADLINE.filterHiddenAttr)) return;
    row.style.removeProperty('display');
    row.removeAttribute(DEADLINE.filterHiddenAttr);
  }

  /**
   * Compatibilidade: atalhos antigos de prazos agora abrem o painel integrado.
   */
  function openDeadlinePanel() {
    openModal();
  }

  /**
   * Aplica uma mudanca de configuracao de prazos ao iframe atual.
   */
  function applyDeadlineSettingsChange() {
    syncDeadlineState(true);
    if (state.frameDoc) {
      clearDeadlineProcessedState(state.frameDoc);
      injectDeadlineStyles(state.frameDoc);
      processDeadlineRoot(state.frameDoc);
    }
    broadcastDeadlineSettingsSync();
  }

  /**
   * Notifica janelas do mesmo host sobre mudancas de prazo.
   */
  function broadcastDeadlineSettingsSync() {
    try {
      window.dispatchEvent(new CustomEvent(DEADLINE.settingsSyncEvent));
      state.frameWin?.dispatchEvent(new CustomEvent(DEADLINE.settingsSyncEvent));
    } catch (_) {}
  }

  /**
   * @returns {string}
   */
  function describeActiveDeadlineFilter() {
    if (!getDeadlineFilterEnabled()) return `Filtro desativado. Destaque automático: hoje + próximos ${DEADLINE.windowDays - 1} dias.`;
    const mode = getDeadlineFilterMode();
    if (mode === 'missing') return 'Filtro ativo: sem data limite.';
    if (mode === 'range') {
      const start = ymdToDate(getDeadlineRangeStart());
      const end = ymdToDate(getDeadlineRangeEnd());
      if (!start || !end) return 'Filtro por período incompleto.';
      const from = start <= end ? start : end;
      const to = start <= end ? end : start;
      return `Filtro ativo: ${formatDay(from)} até ${formatDay(to)}.`;
    }
    const exact = ymdToDate(getDeadlineFilterDate());
    return exact ? `Filtro ativo: ${formatDay(exact)}.` : 'Filtro por data incompleto.';
  }

  function cloneDay(date) {
    const copy = new Date(date.getTime());
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function addDays(date, amount) {
    const copy = new Date(date.getTime());
    copy.setDate(copy.getDate() + amount);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function ymdToDate(ymd) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function parseDeadlineDateToken(dayValue, monthValue, yearValue) {
    const day = Number(dayValue);
    const month = Number(monthValue);
    let year = Number(yearValue);
    if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
    if (String(yearValue).length === 2) year += 2000;
    const date = new Date(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function extractDeadlineDatesFromText(text) {
    const dates = [];
    const regexp = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})\b/g;
    let match;
    while ((match = regexp.exec(String(text || ''))) !== null) {
      const date = parseDeadlineDateToken(match[1], match[2], match[3]);
      if (date) dates.push(date);
    }
    return dates;
  }

  function isMissingDeadlineText(text) {
    const normalized = String(text || '').trim();
    return normalized === '' || /^[-–—]+$/.test(normalized);
  }

  function toYmd(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function formatDay(date) {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  }

  function weekdayShortPT(date) {
    return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][date.getDay()];
  }

  function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  function interpolateDeadlinePalette(palette, index, total) {
    if (total <= 1) return palette[0];
    const position = index / (total - 1);
    const segmentCount = palette.length - 1;
    const scaled = position * segmentCount;
    const floor = Math.floor(scaled);
    const fraction = scaled - floor;
    const current = palette[Math.min(floor, palette.length - 1)];
    const next = palette[Math.min(floor + 1, palette.length - 1)];
    const bg0 = parseRgba(current.bg);
    const bg1 = parseRgba(next.bg);
    const fg0 = parseRgba(current.fg);
    const fg1 = parseRgba(next.fg);
    if (!bg0 || !bg1 || !fg0 || !fg1) return palette[Math.min(index, palette.length - 1)];
    return {
      bg: rgbaToString(interpolateRgba(bg0, bg1, fraction)),
      fg: rgbaToString(interpolateRgba(fg0, fg1, fraction))
    };
  }

  function parseRgba(value) {
    const match = /rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/i.exec(value);
    if (!match) return null;
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4]) };
  }

  function interpolateRgba(left, right, fraction) {
    return {
      r: left.r + (right.r - left.r) * fraction,
      g: left.g + (right.g - left.g) * fraction,
      b: left.b + (right.b - left.b) * fraction,
      a: left.a + (right.a - left.a) * fraction
    };
  }

  function rgbaToString(color) {
    return `rgba(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)},${color.a})`;
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
   * Formata a data observada/atualizada para exibicao amigavel.
   * @param {string} value
   * @returns {string}
   */
  function formatObservedAt(value) {
    if (!value) return '—';
    const brazilianTime = parseBrazilianDateTime(value);
    if (brazilianTime) return new Date(brazilianTime).toLocaleString('pt-BR');
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString('pt-BR');
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
   * Atualiza o valor de um select.
   * @param {Element | null} element
   * @param {string} value
   */
  function setSelectValue(element, value) {
    if (element instanceof HTMLSelectElement) element.value = value;
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
