(() => {
  const DB_NAME = 'netplace-timeline';
  const DB_VERSION = 1;
  const STORE = 'workspace';
  const KEY = 'dashboard';
  document.documentElement.classList.add('visitor-mode');
  const CLOUD_TABLE = 'netplace_dashboard';
  const MEDIA_BUCKET = 'netplace-media';
  const cloudClient = window.NETPLACE_CLOUD && window.supabase?.createClient
    ? window.supabase.createClient(window.NETPLACE_CLOUD.url, window.NETPLACE_CLOUD.publishableKey)
    : null;
  const starter = {
    entries: [],
    metrics: [
      { label: 'Conquistas registradas', value: '0', note: 'e cada vez mais pela frente' },
      { label: 'Capítulos da jornada', value: '0', note: 'marcos que contam nossa história' },
      { label: 'Próximo passo', value: '∞', note: 'novas possibilidades' },
    ],
    profile: {
      kicker: 'NOSSA JORNADA · 3 ANOS', artLabel: 'FEITO DE CONEXÕES', titleOne: 'Crescemos juntos.', titleTwo: 'E ainda há muito por vir.',
      description: 'Uma história feita de ideias, pessoas e conquistas. Explore cada capítulo da evolução da Netplace.', heroNote: 'Uma linha do tempo viva — cada nova conquista aparece no topo.',
      metricsTitle: 'Marcas da nossa jornada', metricsKicker: 'O QUE CONSTRUÍMOS', timelineTitle: 'Daqui até onde podemos chegar.', timelineKicker: 'CADA PASSO CONTA',
      addLabel: 'Adicionar conquista', exportLabel: 'Exportar dados', newEntryLabel: 'Nova conquista', search: 'Buscar conquista...',
      emptyTitle: 'O primeiro capítulo começa aqui.', emptyCopy: 'Registre uma conquista e comece a contar a evolução da Netplace.',
      endTitle: 'O próximo capítulo começa agora.', endCopy: 'Adicione uma conquista para continuar escrevendo essa história.',
      footerCopy: 'Uma história construída por muitas conexões.', footerLabel: 'NETPLACE · EM EVOLUÇÃO', logo: '', cover: '',
      pageTitle: 'Netplace · Nossa evolução', brandCaption: 'NOSSA HISTÓRIA', spineFuture: 'FUTURO', spineStart: 'COMEÇO',
      heroSince: 'DESDE O PRIMEIRO PASSO',
      blue: '#2150bd', pink: '#ee6ca8', background: '#ffffff', card: '#ffffff', text: '#202a41', muted: '#77819a', hero: '#f7f9ff',
      displayFont: 'Manrope', bodyFont: 'DM Sans', scale: 100, radius: 9, width: 1500,
    },
  };
  let state = structuredClone(starter);
  let db;
  let cloudReady = false;
  let pendingImport = null;
  let localSnapshot = null;
  let cloudMedia = new Map();
  let pendingImages = [];
  let deleteId = null;
  let saveTimer;

  const $ = (selector) => document.querySelector(selector);
  const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const cleanRichText = (html) => {
    const allowed = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI']);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const clean = (node) => [...node.childNodes].map((child) => {
      if (child.nodeType === Node.TEXT_NODE) return document.createTextNode(child.textContent);
      if (child.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
      const fragment = document.createDocumentFragment();
      [...child.childNodes].forEach((grandchild) => fragment.append(clean(grandchild)));
      if (!allowed.has(child.tagName)) return fragment;
      const element = document.createElement(child.tagName.toLowerCase());
      element.append(fragment);
      return element;
    });
    const output = document.createDocumentFragment();
    clean(parsed.body).forEach((node) => output.append(node));
    const container = document.createElement('div'); container.append(output);
    return container.innerHTML;
  };
  const dateText = (value) => {
    const match = String(value || '').match(/^(\d{4})/);
    return match ? match[1] : '';
  };
  const openDB = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const readState = () => new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  const writeState = () => new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(state, KEY);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  const mediaSrc = (value, fallback = '') => {
    if (!value) return fallback;
    if (value.startsWith('storage:')) return cloudMedia.get(value.slice(8)) || '';
    return value;
  };
  const uploadInlineImages = async () => {
    const upload = async (dataUrl) => {
      const blob = await (await fetch(dataUrl)).blob();
      const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[blob.type] || 'jpg';
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await cloudClient.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
      if (error) throw error;
      return `storage:${path}`;
    };
    for (const entry of state.entries) {
      const images = Array.isArray(entry.images) ? entry.images : (entry.image ? [entry.image] : []);
      entry.images = await Promise.all(images.map((image) => image?.startsWith('data:') ? upload(image) : image));
      delete entry.image;
    }
    if (state.profile.logo?.startsWith('data:')) state.profile.logo = await upload(state.profile.logo);
    if (state.profile.cover?.startsWith('data:')) state.profile.cover = await upload(state.profile.cover);
  };
  const refreshCloudMedia = async () => {
    const paths = new Set();
    for (const entry of state.entries) {
      const images = Array.isArray(entry.images) ? entry.images : (entry.image ? [entry.image] : []);
      for (const image of images) if (image?.startsWith('storage:')) paths.add(image.slice(8));
    }
    for (const value of [state.profile.logo, state.profile.cover]) if (value?.startsWith('storage:')) paths.add(value.slice(8));
    const urls = await Promise.all([...paths].map(async (path) => {
      const { data, error } = await cloudClient.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600);
      if (error) throw error;
      return [path, data.signedUrl];
    }));
    cloudMedia = new Map(urls);
  };
  const saveCloudState = async () => {
    await uploadInlineImages();
    const { error } = await cloudClient.from(CLOUD_TABLE).upsert({ id: 'principal', content: state, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw error;
    await refreshCloudMedia();
  };
  const legacyEntryOrder = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
  const normalizeEntryOrder = (entries) => {
    if (!Array.isArray(entries) || !entries.length) return { entries: Array.isArray(entries) ? entries : [], migrated: false };
    const hasOrder = entries.some((entry) => Number.isFinite(entry.order_index));
    if (entries.every((entry) => Number.isFinite(entry.order_index))) {
      const sorted = entries.map((entry, index) => ({ entry, index }))
        .sort((a, b) => a.entry.order_index - b.entry.order_index || a.index - b.index)
        .map(({ entry }) => entry);
      return { entries: sorted, migrated: false };
    }
    const ordered = hasOrder
      ? [
          ...entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => Number.isFinite(entry.order_index))
            .sort((a, b) => a.entry.order_index - b.entry.order_index || a.index - b.index).map(({ entry }) => entry),
          ...entries.filter((entry) => !Number.isFinite(entry.order_index)).sort(legacyEntryOrder),
        ]
      : [...entries].sort(legacyEntryOrder);
    return { entries: ordered.map((entry, order_index) => ({ ...entry, order_index })), migrated: true };
  };
  const asDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
  });
  const exportSnapshot = async () => {
    const snapshot = structuredClone(state);
    const inline = async (value) => value?.startsWith('storage:') ? asDataUrl(await (await fetch(mediaSrc(value))).blob()) : value;
    for (const entry of snapshot.entries) {
      const images = Array.isArray(entry.images) ? entry.images : (entry.image ? [entry.image] : []);
      entry.images = await Promise.all(images.map(inline));
      delete entry.image;
    }
    snapshot.profile.logo = await inline(snapshot.profile.logo);
    snapshot.profile.cover = await inline(snapshot.profile.cover);
    return snapshot;
  };
  const activateCloudSession = async () => {
    $('#auth-message').textContent = 'Carregando o painel compartilhado…';
    const { data, error } = await cloudClient.from(CLOUD_TABLE).select('content').eq('id', 'principal').maybeSingle();
    if (error) { $('#auth-message').textContent = 'O acesso foi aceito, mas o banco ainda não está configurado. Execute o arquivo SQL de configuração e tente novamente.'; return false; }
    const hasSavedContent = data?.content && (Array.isArray(data.content.entries) || Array.isArray(data.content.metrics) || Boolean(data.content.profile));
    if (hasSavedContent) {
      state = { ...structuredClone(starter), ...data.content, profile: { ...structuredClone(starter.profile), ...(data.content.profile || {}) } };
    } else if (pendingImport || localSnapshot) {
      const source = pendingImport || localSnapshot;
      state = { ...structuredClone(starter), ...source, profile: { ...structuredClone(starter.profile), ...(source.profile || {}) } };
      await saveCloudState();
    } else {
      state = { ...structuredClone(starter), ...state, profile: { ...structuredClone(starter.profile), ...(state.profile || {}) } };
      await saveCloudState();
    }
    const order = normalizeEntryOrder(state.entries);
    state.entries = order.entries;
    if (order.migrated) { await saveCloudState(); if (db) await writeState(); }
    await refreshCloudMedia();
    cloudReady = true;
    document.documentElement.classList.remove('visitor-mode');
    $('#team-access').hidden = true; $('#set-password').hidden = false; $('#sign-out').hidden = false;
    applyProfile(); renderMetrics(); renderTimeline();
    $('#auth-dialog').close(); $('#auth-message').textContent = '';
    setSaveStatus('saved');
    return true;
  };
  const loadVisitorPresentation = async () => {
    cloudReady = false;
    document.documentElement.classList.add('visitor-mode');
    $('#team-access').hidden = false; $('#set-password').hidden = true; $('#sign-out').hidden = true;
    $('#save-label').textContent = 'Carregando apresentação…';
    state = structuredClone(starter);
    applyProfile(); renderMetrics(); renderTimeline();
    if (!cloudClient) { $('#save-label').textContent = 'Apresentação indisponível'; toast('Não foi possível carregar os dados do painel.'); return false; }
    try {
      const { data, error } = await cloudClient.from(CLOUD_TABLE).select('content').eq('id', 'principal').maybeSingle();
      if (error || !data?.content) throw error || new Error('Dados ainda não disponíveis.');
      state = { ...structuredClone(starter), ...data.content, profile: { ...structuredClone(starter.profile), ...(data.content.profile || {}) } };
      state.entries = normalizeEntryOrder(state.entries).entries;
      await refreshCloudMedia();
      applyProfile(); renderMetrics(); renderTimeline();
      $('#save-label').textContent = 'Modo apresentação';
      return true;
    } catch {
      $('#save-label').textContent = 'Apresentação indisponível';
      toast('Confira se a visualização para visitantes foi habilitada no Supabase.');
      return false;
    }
  };  const setSaveStatus = (status) => {
    const root = $('.save-status');
    root.classList.toggle('saving', status === 'saving');
    root.classList.toggle('error', status === 'error');
    $('#save-label').textContent = status === 'saving' ? 'Sincronizando…' : status === 'error' ? 'Erro ao sincronizar' : status === 'waiting' ? 'Aguardando login' : cloudReady ? 'Sincronizado com a equipe' : 'Salvo neste dispositivo';
  };
  const persist = () => {
    if (!cloudReady) return;
    setSaveStatus('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        if (db) await writeState();
        if (cloudReady) { await saveCloudState(); await writeState(); applyProfile(); renderTimeline(); setSaveStatus('saved'); }
        else setSaveStatus('saved');
      } catch (error) { setSaveStatus('error'); toast(`Não foi possível sincronizar: ${error.message || 'verifique sua conexão.'}`); }
    }, 120);
  };
  const toast = (message) => {
    const node = $('#toast'); node.textContent = message; node.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2500);
  };
  const renderMetrics = () => {
    $('#metrics-grid').innerHTML = state.metrics.map((metric, index) => {
      const theme = index % 2 ? { color: state.profile.pink, wash: '#fff0f6', icon: '♡' } : { color: state.profile.blue, wash: '#eff3ff', icon: '✦' };
      return `<article class="metric-card" style="--metric-color:${theme.color};--metric-wash:color-mix(in srgb,${theme.color} 8%,white)"><div class="metric-top"><span class="metric-label">${escapeHTML(metric.label)}</span><span class="metric-icon">${theme.icon}</span></div><div class="metric-value">${escapeHTML(metric.value)}</div><div class="metric-note">${escapeHTML(metric.note)}</div></article>`;
    }).join('');
  };
  const renderChart = (entry) => {
    const values = (entry.chart?.values || []).filter((point) => point.label && Number.isFinite(point.value));
    if (!values.length) return '';
    const max = Math.max(1, ...values.map((point) => point.value));
    const labels = values.map((point) => `<span title="${escapeHTML(point.label)}">${escapeHTML(point.label)}</span>`).join('');
    const bars = values.map((point) => `<div class="bar-col"><span class="bar-value">${escapeHTML(point.value)}</span><div class="bar" style="height:${Math.max(4, point.value / max * 70)}px"></div><span class="bar-label">${escapeHTML(point.label)}</span></div>`).join('');
    if (entry.chart.type !== 'line') return `<div class="chart-box"><div class="chart-title">DADOS DESTA CONQUISTA</div><div class="bar-chart">${bars}</div></div>`;
    const width = 480, height = 90, pad = 12;
    const points = values.map((point, i) => ({ x: values.length === 1 ? width / 2 : pad + i * (width - pad * 2) / (values.length - 1), y: height - pad - (point.value / max) * (height - pad * 2) }));
    const coords = points.map((point) => `${point.x},${point.y}`).join(' ');
    const dots = points.map((point) => `<circle class="point" cx="${point.x}" cy="${point.y}" r="4"><title>${escapeHTML(values[points.indexOf(point)].label)}: ${escapeHTML(values[points.indexOf(point)].value)}</title></circle>`).join('');
    return `<div class="chart-box"><div class="chart-title">DADOS DESTA CONQUISTA</div><svg class="line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Gráfico de linha: ${labels}"><defs><linearGradient id="lineFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${state.profile.pink}" stop-opacity=".22"/><stop offset="1" stop-color="${state.profile.pink}" stop-opacity="0"/></linearGradient></defs><path class="grid" d="M0 24H480M0 53H480M0 82H480"/><polygon class="fill" points="${pad},${height} ${coords} ${width - pad},${height}"/><polyline class="stroke" points="${coords}"/>${dots}</svg><div class="line-labels">${labels}</div></div>`;
  };
  const renderEntry = (entry, index) => {
    const theme = index % 2 ? { color: state.profile.pink } : { color: state.profile.blue };
    const tagTone = index % 2 ? 'pink' : '';
    const images = (Array.isArray(entry.images) ? entry.images : (entry.image ? [entry.image] : [])).map(mediaSrc).filter(Boolean);
    const gallery = images.length ? `<div class="card-gallery" aria-label="Fotos de ${escapeHTML(entry.title)}">${images.map((image, photoIndex) => `<img class="card-media" src="${image}" alt="Foto ${photoIndex + 1} de ${escapeHTML(entry.title)}" loading="lazy">`).join('')}</div>` : '';
    return `<article class="timeline-item" style="--node:${theme.color}"><time class="timeline-date" datetime="${escapeHTML(entry.date)}">${escapeHTML(dateText(entry.date))}</time><div class="timeline-card"><div class="card-head"><span class="category-tag ${tagTone}">${escapeHTML(entry.category || 'Conquista')}</span><div class="card-actions"><button class="icon-button edit-entry" data-id="${escapeHTML(entry.id)}" aria-label="Editar ${escapeHTML(entry.title)}" title="Editar">✎</button><button class="icon-button delete-entry" data-id="${escapeHTML(entry.id)}" aria-label="Remover ${escapeHTML(entry.title)}" title="Remover">⌫</button></div></div><h3>${escapeHTML(entry.title)}</h3>${entry.body ? `<div class="card-body">${entry.body}</div>` : ''}${gallery}${renderChart(entry)}</div></article>`;
  };
  const renderTimeline = () => {
    const query = $('#search').value.trim().toLocaleLowerCase('pt-BR');
    const entries = [...state.entries].sort((a, b) => a.order_index - b.order_index);
    $('#period-label').textContent = entries.length ? `${dateText(entries[entries.length - 1].date).toUpperCase()} — PRESENTE` : 'UMA HISTÓRIA EM MOVIMENTO';
    const filtered = entries.filter((entry) => `${entry.title} ${entry.category} ${entry.body.replace(/<[^>]+>/g, ' ')}`.toLocaleLowerCase('pt-BR').includes(query));
    const list = $('#timeline-list');
    if (!entries.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-illustration">◷</div><h3>${escapeHTML(state.profile.emptyTitle)}</h3><p>${escapeHTML(state.profile.emptyCopy)}</p><button class="button button-primary" id="empty-add">＋ ${escapeHTML(state.profile.addLabel)}</button></div>`;
      $('#empty-add').addEventListener('click', () => openEntry());
    } else if (!filtered.length) {
      list.innerHTML = '<div class="no-results">Nenhuma conquista corresponde à sua busca.</div>';
    } else {
      list.innerHTML = filtered.map(renderEntry).join('');
      if (cloudReady) {
        list.querySelectorAll('.edit-entry').forEach((button) => button.addEventListener('click', () => openEntry(button.dataset.id)));
        list.querySelectorAll('.delete-entry').forEach((button) => button.addEventListener('click', () => askDelete(button.dataset.id)));
      }
    }
  };
  const applyProfile = () => {
    const p = state.profile;
    const textMap = {
      'hero-kicker': p.kicker, 'hero-title-one': p.titleOne, 'hero-title-two': p.titleTwo, 'hero-description': p.description,
      'metrics-title': p.metricsTitle, 'metrics-kicker': p.metricsKicker, 'timeline-title': p.timelineTitle, 'timeline-kicker': p.timelineKicker,
      'add-first-label': p.addLabel, 'export-label': p.exportLabel, 'new-entry-label': p.newEntryLabel, 'footer-copy': p.footerCopy, 'footer-label': p.footerLabel,
      'timeline-end-title': p.endTitle, 'timeline-end-copy': p.endCopy,
    };
    Object.entries(textMap).forEach(([id, value]) => { const node = document.getElementById(id); if (node) node.textContent = value; });
    const noteParts = p.heroNote.split(' — ');
    $('#hero-note-title').textContent = noteParts[0] || p.heroNote;
    $('#hero-note-copy').textContent = noteParts[1] ? ` — ${noteParts.slice(1).join(' — ')}` : '';
    $('#hero-art-label').firstChild.textContent = `${p.artLabel} `;
    document.title = p.pageTitle || 'Netplace · Nossa evolução';
    document.querySelector('.brand-caption').textContent = p.brandCaption || 'NOSSA HISTÓRIA';
    $('#search').placeholder = p.search; $('#search').setAttribute('aria-label', p.search);
    $('#spine-future').textContent = p.spineFuture || 'FUTURO'; $('#spine-start').textContent = p.spineStart || 'COMEÇO';
    $('#hero-since').textContent = p.heroSince;
    document.querySelectorAll('.logo-image').forEach((image) => { image.src = mediaSrc(p.logo, 'logo-netplace.jpg'); });
    const cover = $('#cover-image'); cover.src = mediaSrc(p.cover); cover.hidden = !mediaSrc(p.cover);
    const root = document.documentElement.style;
    root.setProperty('--blue', p.blue); root.setProperty('--pink', p.pink); root.setProperty('--page-bg', p.background); root.setProperty('--card-bg', p.card);
    root.setProperty('--text-color', p.text); root.setProperty('--muted-color', p.muted); root.setProperty('--hero-bg', p.hero);
    root.setProperty('--display', `'${p.displayFont}', sans-serif`); root.setProperty('--font', `'${p.bodyFont}', sans-serif`);
    root.setProperty('--ui-scale', String(Number(p.scale) / 100)); root.setProperty('--card-radius', `${p.radius}px`); root.setProperty('--page-width', `${p.width}px`);
  };
  const fillDesignForm = () => {
    const p = state.profile;
    const ids = { 'design-kicker':'kicker','design-since':'heroSince','design-art-label':'artLabel','design-title-one':'titleOne','design-title-two':'titleTwo','design-description':'description','design-hero-note':'heroNote','design-metrics-title':'metricsTitle','design-metrics-kicker':'metricsKicker','design-timeline-title':'timelineTitle','design-timeline-kicker':'timelineKicker','design-add-label':'addLabel','design-export-label':'exportLabel','design-search':'search','design-new-entry':'newEntryLabel','design-empty-title':'emptyTitle','design-empty-copy':'emptyCopy','design-end-title':'endTitle','design-end-copy':'endCopy','design-footer-copy':'footerCopy','design-footer-label':'footerLabel','design-page-title':'pageTitle','design-brand-caption':'brandCaption','design-future':'spineFuture','design-start':'spineStart','color-blue':'blue','color-pink':'pink','color-background':'background','color-card':'card','color-text':'text','color-muted':'muted','color-hero':'hero','font-display':'displayFont','font-body':'bodyFont','ui-scale':'scale','card-radius':'radius','page-width':'width' };
    Object.entries(ids).forEach(([id, key]) => { const input = document.getElementById(id); if (input) input.value = p[key]; });
    $('#scale-value').textContent = `${p.scale}%`; $('#radius-value').textContent = `${p.radius} px`; $('#width-value').textContent = `${p.width} px`;
  };
  const readDesignForm = () => {
    const p = state.profile;
    const ids = { 'design-kicker':'kicker','design-since':'heroSince','design-art-label':'artLabel','design-title-one':'titleOne','design-title-two':'titleTwo','design-description':'description','design-hero-note':'heroNote','design-metrics-title':'metricsTitle','design-metrics-kicker':'metricsKicker','design-timeline-title':'timelineTitle','design-timeline-kicker':'timelineKicker','design-add-label':'addLabel','design-export-label':'exportLabel','design-search':'search','design-new-entry':'newEntryLabel','design-empty-title':'emptyTitle','design-empty-copy':'emptyCopy','design-end-title':'endTitle','design-end-copy':'endCopy','design-footer-copy':'footerCopy','design-footer-label':'footerLabel','design-page-title':'pageTitle','design-brand-caption':'brandCaption','design-future':'spineFuture','design-start':'spineStart','color-blue':'blue','color-pink':'pink','color-background':'background','color-card':'card','color-text':'text','color-muted':'muted','color-hero':'hero','font-display':'displayFont','font-body':'bodyFont','ui-scale':'scale','card-radius':'radius','page-width':'width' };
    Object.entries(ids).forEach(([id, key]) => { const input = document.getElementById(id); if (input) p[key] = input.value; });
  };
  const parseChart = () => {
    if (!$('#chart-enabled').checked) return null;
    const values = $('#chart-data').value.split('\n').map((line) => {
      const parts = line.split(',');
      return { label: (parts[0] || '').trim(), value: Number((parts.slice(1).join(',') || '').trim().replace(',', '.')) };
    }).filter((point) => point.label && Number.isFinite(point.value));
    return values.length ? { type: $('#chart-type').value, values } : null;
  };
  const renderImagePreviews = () => {
    const gallery = $('#image-preview-list');
    gallery.innerHTML = pendingImages.map((image, index) => `<div class=\"upload-preview\"><img src=\"${mediaSrc(image)}\" alt=\"Foto ${index + 1}\"><button type=\"button\" class=\"remove-preview\" data-index=\"${index}\" aria-label=\"Remover foto ${index + 1}\">×</button></div>`).join('');
    gallery.querySelectorAll('.remove-preview').forEach((button) => button.addEventListener('click', () => { pendingImages.splice(Number(button.dataset.index), 1); renderImagePreviews(); }));
    $('#image-count').textContent = `${pendingImages.length} foto${pendingImages.length === 1 ? '' : 's'} selecionada${pendingImages.length === 1 ? '' : 's'}`;
  };
  const openEntry = (id = null) => {
    const entry = id ? state.entries.find((item) => item.id === id) : null;
    $('#entry-form').reset();
    $('#entry-id').value = entry?.id || '';
    $('#entry-dialog-title').textContent = entry ? 'Editar conquista' : 'Nova conquista';
    $('#entry-title').value = entry?.title || '';
    $('#entry-year').value = (entry?.date || '').slice(0, 4) || String(new Date().getFullYear());
    $('#entry-category').value = entry?.category || 'Conquista';
    $('#entry-body').innerHTML = entry?.body || '';
    $('#chart-enabled').checked = Boolean(entry?.chart);
    $('#chart-fields').hidden = !entry?.chart;
    $('#chart-type').value = entry?.chart?.type || 'bar';
    $('#chart-data').value = entry?.chart?.values?.map((point) => `${point.label}, ${point.value}`).join('\n') || '';
    pendingImages = (Array.isArray(entry?.images) ? entry.images : (entry?.image ? [entry.image] : [])).slice();
    $('#entry-image').value = '';
    renderImagePreviews();
    $('#entry-dialog').showModal();
  };
  const openMetrics = () => {
    $('#metric-fields').innerHTML = state.metrics.map((metric, index) => `<div class="metric-edit-row"><label class="field-label">Indicador ${index + 1}<input data-field="label" maxlength="36" value="${escapeHTML(metric.label)}" required></label><label class="field-label">Valor em destaque<input data-field="value" maxlength="15" value="${escapeHTML(metric.value)}" required></label><label class="field-label">Texto de apoio<input data-field="note" maxlength="55" value="${escapeHTML(metric.note)}"></label></div>`).join('');
    $('#metrics-dialog').showModal();
  };
  const askDelete = (id) => { deleteId = id; $('#confirm-dialog').showModal(); };
  const openDesign = () => { fillDesignForm(); $('#design-form').reset(); fillDesignForm(); $('#design-dialog').showModal(); };
  const loadDesignImage = (event, property) => {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 6 * 1024 * 1024) { toast('Escolha uma imagem de até 6 MB.'); event.target.value = ''; return; }
    const reader = new FileReader(); reader.onload = () => { state.profile[property] = reader.result; applyProfile(); persist(); toast(property === 'logo' ? 'Logo atualizada.' : 'Arte da capa atualizada.'); }; reader.readAsDataURL(file);
  };
  const wire = () => {
    ['#add-first', '#add-entry', '#add-end'].forEach((selector) => $(selector).addEventListener('click', () => openEntry()));
    $('#edit-metrics').addEventListener('click', openMetrics);
    $('#edit-design').addEventListener('click', openDesign);
    $('#team-access').addEventListener('click', () => { $('#auth-message').textContent = ''; $('#auth-dialog').showModal(); });
    $('#auth-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!cloudClient) { $('#auth-message').textContent = 'O serviço de conexão não carregou. Confira a internet e recarregue a página.'; return; }
      $('#auth-submit').disabled = true; $('#auth-message').textContent = 'Verificando seu acesso…';
      const { error } = await cloudClient.auth.signInWithPassword({ email: $('#auth-email').value.trim(), password: $('#auth-password').value });
      if (error) { $('#auth-message').textContent = 'Não foi possível entrar. Confira seu e-mail e senha ou peça ao administrador para criar seu acesso.'; $('#auth-submit').disabled = false; return; }
      try {
        const ok = await activateCloudSession();
        if (!ok) await cloudClient.auth.signOut();
      } catch (error) { $('#auth-message').textContent = `Não foi possível carregar o painel: ${error.message || 'verifique a configuração do banco e das imagens.'}`; await cloudClient.auth.signOut(); }
      $('#auth-submit').disabled = false;
    });
    $('#password-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = $('#new-password').value;
      if (password !== $('#confirm-password').value) { $('#password-message').textContent = 'As senhas não coincidem. Confira os dois campos.'; return; }
      $('#password-submit').disabled = true; $('#password-message').textContent = 'Salvando sua senha…';
      const { error } = await cloudClient.auth.updateUser({ password });
      if (error) { $('#password-message').textContent = `Não foi possível salvar a senha: ${error.message}`; $('#password-submit').disabled = false; return; }
      history.replaceState(null, '', location.pathname + location.search);
      $('#password-dialog').close();
      $('#new-password').value = ''; $('#confirm-password').value = '';
      try {
        const ok = await activateCloudSession();
        if (!ok) await cloudClient.auth.signOut();
      } catch (error) { $('#auth-dialog').showModal(); $('#auth-message').textContent = `Senha criada, mas não foi possível carregar o painel: ${error.message || 'verifique o banco e as imagens.'}`; }
      $('#password-submit').disabled = false;
    });
    $('#sign-out').addEventListener('click', async () => {
      cloudReady = false; await cloudClient?.auth.signOut(); $('#auth-password').value = '';
      await loadVisitorPresentation();
    });
    $('#set-password').addEventListener('click', async () => {
      const { data } = await cloudClient.auth.getSession();
      if (!data.session) { toast('Entre no painel para definir sua senha.'); return; }
      $('#password-message').textContent = '';
      $('#password-form').reset();
      $('#password-dialog').showModal();
    });
    $('#backup-file').addEventListener('change', async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        pendingImport = JSON.parse(await file.text());
        if (!Array.isArray(pendingImport.entries) || !Array.isArray(pendingImport.metrics)) throw new Error('Arquivo sem os dados esperados.');
        $('#backup-name').textContent = `${file.name} pronto para importar`;
      } catch { pendingImport = null; $('#backup-name').textContent = 'Esse arquivo não parece ser uma cópia do painel.'; event.target.value = ''; }
    });
    $('#design-form').addEventListener('submit', (event) => {
      event.preventDefault(); readDesignForm(); applyProfile(); renderTimeline(); persist(); $('#design-dialog').close(); toast('Personalização salva.');
    });
    $('#design-logo').addEventListener('change', (event) => loadDesignImage(event, 'logo'));
    $('#design-cover').addEventListener('change', (event) => loadDesignImage(event, 'cover'));
    $('#clear-logo').addEventListener('click', () => { state.profile.logo = ''; $('#design-logo').value = ''; applyProfile(); persist(); toast('Logo original restaurada.'); });
    $('#clear-cover').addEventListener('click', () => { state.profile.cover = ''; $('#design-cover').value = ''; applyProfile(); persist(); toast('Arte da capa removida.'); });
    $('#ui-scale').addEventListener('input', () => { $('#scale-value').textContent = `${$('#ui-scale').value}%`; });
    $('#card-radius').addEventListener('input', () => { $('#radius-value').textContent = `${$('#card-radius').value} px`; });
    $('#page-width').addEventListener('input', () => { $('#width-value').textContent = `${$('#page-width').value} px`; });
    $('#reset-design').addEventListener('click', () => {
      state.profile = structuredClone(starter.profile); applyProfile(); fillDesignForm(); renderTimeline(); persist(); toast('A aparência inicial foi restaurada.');
    });
    $('#search').addEventListener('input', renderTimeline);
    $('#chart-enabled').addEventListener('change', () => { $('#chart-fields').hidden = !$('#chart-enabled').checked; });
    document.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
    document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));
    document.querySelectorAll('.rich-toolbar button').forEach((button) => button.addEventListener('click', () => { $('#entry-body').focus(); document.execCommand(button.dataset.cmd, false); }));
    $('#entry-image').addEventListener('change', async (event) => {
      const files = [...(event.target.files || [])];
      const accepted = files.filter((file) => file.size <= 6 * 1024 * 1024);
      if (accepted.length !== files.length) toast('Cada foto deve ter até 6 MB.');
      const loaded = await Promise.all(accepted.map((file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); })));
      pendingImages.push(...loaded); renderImagePreviews(); event.target.value = '';
    });
    $('#entry-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const id = $('#entry-id').value || crypto.randomUUID();
      const existing = state.entries.find((entry) => entry.id === id);
      const chart = parseChart();
      if ($('#chart-enabled').checked && !chart) { toast('Adicione pelo menos um par de rótulo e valor para o gráfico.'); return; }
      const nextOrder = existing?.order_index ?? (state.entries.reduce((max, item) => Math.max(max, Number.isFinite(item.order_index) ? item.order_index : -1), -1) + 1);
      const entry = { id, order_index: nextOrder, title: $('#entry-title').value.trim(), date: $('#entry-year').value, category: $('#entry-category').value, body: cleanRichText($('#entry-body').innerHTML).trim(), images: pendingImages, chart, updatedAt: Date.now() };
      if (existing) state.entries = state.entries.map((item) => item.id === id ? entry : item); else state.entries.push(entry);
      $('#entry-dialog').close(); renderTimeline(); persist(); toast(existing ? 'Conquista atualizada.' : 'Conquista adicionada à linha do tempo.');
    });
    $('#metrics-form').addEventListener('submit', (event) => {
      event.preventDefault();
      state.metrics = [...document.querySelectorAll('.metric-edit-row')].map((row) => ({ label: row.querySelector('[data-field="label"]').value.trim(), value: row.querySelector('[data-field="value"]').value.trim(), note: row.querySelector('[data-field="note"]').value.trim() }));
      renderMetrics(); $('#metrics-dialog').close(); persist(); toast('Indicadores atualizados.');
    });
    $('#confirm-delete').addEventListener('click', () => {
      state.entries = state.entries.filter((entry) => entry.id !== deleteId); deleteId = null;
      $('#confirm-dialog').close(); renderTimeline(); persist(); toast('Conquista removida.');
    });
    $('#export-data').addEventListener('click', async () => {
      try {
        const blob = new Blob([JSON.stringify(await exportSnapshot(), null, 2)], { type: 'application/json' });
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `netplace-linha-do-tempo-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); toast('Cópia dos dados exportada.');
      } catch { toast('Não foi possível baixar as imagens para a cópia.'); }
    });
  };
  const init = async () => {
    wire();
    try {
      db = await openDB(); localSnapshot = await readState();
      if (localSnapshot) {
        const order = normalizeEntryOrder(localSnapshot.entries);
        localSnapshot = { ...localSnapshot, entries: order.entries };
      }
    } catch { setSaveStatus('error'); }
    state = structuredClone(starter);
    state.profile = { ...structuredClone(starter.profile), ...(state.profile || {}) };
    applyProfile(); renderMetrics(); renderTimeline();
    if (!cloudClient) { await loadVisitorPresentation(); return; }
    const { data, error } = await cloudClient.auth.getSession();
    if (!error && data.session) {
      const authAction = new URLSearchParams(location.hash.slice(1)).get('type');
      if (authAction === 'invite') { $('#password-dialog').showModal(); return; }
      try { if (!(await activateCloudSession())) await loadVisitorPresentation(); }
      catch { await loadVisitorPresentation(); }
    } else await loadVisitorPresentation();
  };
  init();
})();
