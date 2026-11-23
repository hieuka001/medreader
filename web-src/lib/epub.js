// EPUB reader tối giản trên JSZip: bóc OPF/spine/nav, cho ra danh sách
// chương {title, html, text} + bìa + metadata. HTML được làm sạch (bỏ
// script/style/iframe) và ảnh nội bộ được thay bằng blob URL khi render.
const JSZip = window.JSZip;

function parseXml(str) {
  return new DOMParser().parseFromString(str, 'application/xml');
}
const $all = (doc, sel) => [...doc.querySelectorAll(sel)];
function resolvePath(base, href) {
  const parts = (base ? base.split('/') : []).concat(decodeURIComponent(href).split('/'));
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}
const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

export async function parseEpub(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new Error('EPUB hỏng: thiếu META-INF/container.xml');
  const opfPath = parseXml(container).querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB hỏng: không thấy file OPF');
  const opfDir = dirOf(opfPath);
  const opf = parseXml(await zip.file(opfPath).async('string'));

  const meta = {
    title: opf.querySelector('metadata > title, metadata title')?.textContent?.trim() || 'Sách EPUB',
    author: opf.querySelector('metadata > creator, metadata creator')?.textContent?.trim() || '',
  };

  const manifest = new Map();
  $all(opf, 'manifest > item').forEach(it => manifest.set(it.getAttribute('id'), {
    href: resolvePath(opfDir, it.getAttribute('href') || ''),
    type: it.getAttribute('media-type') || '',
    props: it.getAttribute('properties') || '',
  }));

  // Bìa: meta cover -> manifest id, hoặc item properties~cover-image
  let coverBlob = null;
  const coverId = opf.querySelector('metadata > meta[name="cover"]')?.getAttribute('content')
    || [...manifest.entries()].find(([, v]) => v.props.includes('cover-image'))?.[0];
  if (coverId && manifest.get(coverId)) {
    const f = zip.file(manifest.get(coverId).href);
    if (f) coverBlob = await f.async('blob');
  }

  // TOC từ NCX (EPUB2) — map href -> nhãn
  const tocLabels = new Map();
  const spineEl = opf.querySelector('spine');
  const ncxId = spineEl?.getAttribute('toc');
  if (ncxId && manifest.get(ncxId)) {
    try {
      const ncx = parseXml(await zip.file(manifest.get(ncxId).href).async('string'));
      $all(ncx, 'navPoint').forEach(np => {
        const label = np.querySelector('navLabel > text, navLabel text')?.textContent?.trim();
        const src = np.querySelector('content')?.getAttribute('src')?.split('#')[0];
        if (label && src) tocLabels.set(resolvePath(dirOf(manifest.get(ncxId).href), src), label);
      });
    } catch {}
  }

  const chapters = [];
  const items = $all(opf, 'spine > itemref');
  for (const ref of items) {
    if (ref.getAttribute('linear') === 'no') continue;
    const item = manifest.get(ref.getAttribute('idref'));
    if (!item || !/x?html/.test(item.type)) continue;
    const f = zip.file(item.href);
    if (!f) continue;
    const raw = await f.async('string');
    const doc = parseXml(raw.replace(/<\?xml[^>]*>/, ''));
    doc.querySelectorAll('script, style, iframe, object, embed, form').forEach(n => n.remove());
    const body = doc.body || doc.documentElement;
    const text = (body.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    // Thay src ảnh bằng blob URL
    const base = dirOf(item.href);
    for (const img of body.querySelectorAll('img, image')) {
      const src = img.getAttribute('src') || img.getAttribute('xlink:href') || img.getAttribute('href');
      if (src && !/^(https?:|data:)/.test(src)) {
        const imgFile = zip.file(resolvePath(base, src.split('#')[0]));
        if (imgFile) {
          const blob = await imgFile.async('blob');
          img.setAttribute('src', URL.createObjectURL(blob));
          img.removeAttribute('xlink:href'); img.removeAttribute('href');
        }
      }
    }
    body.querySelectorAll('a').forEach(a => { a.removeAttribute('href'); });
    const title = tocLabels.get(item.href)
      || body.querySelector('h1, h2, h3')?.textContent?.replace(/\s+/g, ' ').trim()
      || `Chương ${chapters.length + 1}`;
    chapters.push({ title, html: body.innerHTML, text });
  }
  if (!chapters.length) throw new Error('EPUB không có chương đọc được');
  return { meta, coverBlob, chapters };
}
