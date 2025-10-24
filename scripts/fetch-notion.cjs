/**
 * fetch-notion-md.js
 * 将 Notion Database 中已发布的页面转换为 Markdown，写入 pages/posts/
 * 并把页面里引用的图片下载到 public/uploads，并替换 Markdown 中的图片 URL。
 *
 * 需要环境变量：
 *   NOTION_TOKEN
 *   NOTION_DATABASE_ID
 *
 * 用法（本地测试）：node fetch-notion.cjs
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { Client } = require('@notionhq/client');
const { NotionToMarkdown } = require('notion-to-md');
const slugify = require('slugify');

// 如果你的 Node 版本 < 18，请在运行前安装 node-fetch 并取消下面注释：
// globalThis.fetch = globalThis.fetch || require('node-fetch');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('ERROR: NOTION_TOKEN and NOTION_DATABASE_ID must be set in env.');
  process.exit(1);
}

const OUT_DIR = path.join(process.cwd(), 'pages', 'posts'); // 写到 Valaxy 的 posts 源目录
const UPLOADS_DIR_ON_DISK = path.join(process.cwd(), 'public', 'uploads'); // 保存图片的本地目录
const UPLOADS_URL_BASE = '/uploads'; // Markdown 中使用的 URL 前缀

// 并发控制：全局同时下载的图片数
const IMAGE_DOWNLOAD_CONCURRENCY = 6;

const notion = new Client({ auth: NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

function safeSlug(text) {
  if (!text) return Date.now().toString(36);
  return slugify(text, { lower: true, strict: true });
}

function frontMatter(meta) {
  // meta: { title, date, tags, slug, categories, excerpt, hide, updated }
  const lines = ['---'];
  if (meta.title) lines.push(`title: "${meta.title.replace(/"/g, '\\"')}"`);
  if (meta.date) lines.push(`date: "${meta.date}"`);
  if (meta.updated) lines.push(`updated: "${meta.updated}"`);
  if (meta.slug) lines.push(`slug: "${meta.slug}"`);
  // categories -> 写为数组或单字符串
  if (meta.categories && meta.categories.length) {
    const cats = meta.categories.map(c => `"${String(c).replace(/"/g,'\\"')}"`).join(', ');
    lines.push(`categories: [${cats}]`);
  }
  if (meta.tags && meta.tags.length) lines.push(`tags: [${meta.tags.map(t => `"${t.replace(/"/g,'\\"')}"`).join(', ')}]`);
  if (meta.excerpt) lines.push(`excerpt: "${meta.excerpt.replace(/"/g, '\\"')}"`);
  if (meta.hide) lines.push(`hide: ${JSON.stringify(meta.hide)}`); // 写入 "all" 或 "index"
  lines.push('---\n');

  return lines.join('\n');
}

function richTextToPlain(rich = []) {
  return (rich || []).map(rt => {
    if (rt.type === 'text') return rt.text?.content || '';
    if (rt.type === 'mention') return rt.mention?.user?.name || rt.mention?.name || '';
    if (rt.type === 'equation') return rt.equation?.expression || '';
    return '';
  }).join('');
}

// --------- 查询数据库（分页） ----------
async function queryPublishedDatabase() {
  const pageSize = 100;
  let results = [];
  let start_cursor = undefined;
  do {
    const res = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      start_cursor,
      page_size: pageSize,
      filter: {
        property: 'Published',
        checkbox: { equals: true }
      },
      sorts: [{ property: 'Date', direction: 'descending' }]
    });
    results = results.concat(res.results);
    start_cursor = res.has_more ? res.next_cursor : undefined;
  } while (start_cursor);
  return results;
}

// --------- Markdown 图片提取与替换工具 ----------
function extractImageUrlsFromMarkdown(md) {
  const urls = new Set();
  if (!md) return [];
  // 匹配 Markdown 图片语法 ![alt](url)
  const mdRe = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
  let m;
  while ((m = mdRe.exec(md)) !== null) urls.add(m[1]);

  // 匹配 HTML img 标签 <img src="url" ...>
  const imgRe = /<img[^>]+src=["'](https?:\/\/[^"'>\s]+)["'][^>]*>/g;
  while ((m = imgRe.exec(md)) !== null) urls.add(m[1]);

  // 匹配裸露的 https://...png jpg 等（不常见）
  const rawRe = /\bhttps?:\/\/[^\s)'"<>]+(?:png|jpe?g|gif|webp|svg)\b/ig;
  while ((m = rawRe.exec(md)) !== null) urls.add(m[0]);

  return Array.from(urls);
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceUrlInMarkdown(md, remoteUrl, localPath) {
  if (!md) return md;
  const esc = escapeRegExp(remoteUrl);
  // 替换 markdown 图片语法和 img 标签中出现的 URL
  const patterns = [
    new RegExp(`(!\\[[^\\]]*\\]\\()${esc}(\\))`, 'g'),
    new RegExp(`(<img[^>]+src=["'])${esc}(["'][^>]*>)`, 'g'),
    new RegExp(esc, 'g') // 最后兜底替换任何裸露 URL（谨慎）
  ];
  let out = md;
  for (const re of patterns) {
    out = out.replace(re, (m1, g1, g2) => {
      if (typeof g1 === 'undefined' && typeof g2 === 'undefined') return localPath;
      // 当使用前两种模式时保留前后部分
      return `${g1 || ''}${localPath}${g2 || ''}`;
    });
  }
  return out;
}

// --------- 下载工具（流式写入），并发限制 ----------
async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

// 简单的并发执行器（队列）
function limitConcurrency(concurrency) {
  let active = 0;
  const queue = [];
  async function run(fn) {
    if (active >= concurrency) {
      await new Promise(resolve => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      if (queue.length) {
        const next = queue.shift();
        next();
      }
    }
  }
  return run;
}

const runWithLimit = limitConcurrency(IMAGE_DOWNLOAD_CONCURRENCY);

// 根据 URL 获取扩展名的辅助（从 path 或 content-type 推断）
function extFromUrlPath(urlStr) {
  try {
    const urlObj = new URL(urlStr);
    const base = path.basename(urlObj.pathname || '');
    const ext = path.extname(base).split('?')[0];
    if (ext && ext.length <= 6) return ext;
  } catch(e) {}
  return '';
}

function extFromContentType(contentType) {
  if (!contentType) return '';
  if (contentType.includes('jpeg')) return '.jpg';
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('gif')) return '.gif';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('svg')) return '.svg';
  return '';
}

async function downloadToFile(url, filepath) {
  // 如果文件已存在，直接跳过
  try {
    if (fs.existsSync(filepath)) {
      return { skipped: true, path: filepath };
    }
  } catch (e) {
    // ignore
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);

  // 确认目录
  await ensureDir(path.dirname(filepath));

  // 如果扩展名不明确，从 content-type 推断（保留原逻辑）
  const curExt = path.extname(filepath);
  if ((!curExt || curExt === '') && res.headers) {
    const ct = res.headers.get('content-type') || '';
    const guessed = extFromContentType(ct) || '.jpg';
    filepath = filepath + guessed;
  }

  // ===== 使用 arrayBuffer() 写文件（兼容 Node 18+ fetch） =====
  const ab = await res.arrayBuffer();
  await fs.promises.writeFile(filepath, Buffer.from(ab));
  // ========================================================

  return { skipped: false, path: filepath };
}


// --------- 主流程 ----------
(async () => {
  try {
    console.log('Querying Notion DB:', NOTION_DATABASE_ID);
    const pages = await queryPublishedDatabase();
    console.log(`Found ${pages.length} published pages.`);

    await ensureDir(OUT_DIR);
    await ensureDir(UPLOADS_DIR_ON_DISK);

    //frontmatter
    for (const p of pages) {
      const props = p.properties || {};

      function plainFromRichOrTitle(prop) {
        if (!prop) return '';
        if (prop.type === 'title' && Array.isArray(prop.title)) return richTextToPlain(prop.title);
        if ((prop.type === 'rich_text' || prop.type === 'text') && Array.isArray(prop.rich_text)) return richTextToPlain(prop.rich_text);
        // 有时 notion-to-md 会把 title 转为 rich_text-like
        if (Array.isArray(prop)) return richTextToPlain(prop);
        return '';
      }

      // 标题（常见字段名为 Name / Title）
      let title = '';
      const titleProp = props['Name'] || props['Title'] || Object.values(props).find(x => x.type === 'title');
      if (titleProp) {
        const titleRich = titleProp.title || titleProp.rich_text || [];
        title = richTextToPlain(titleRich);
      }
      if (!title) title = 'Untitled';

      // slug（优先 Slug 字段，否则根据标题生成）
      let slug = '';
      if (props['Slug'] && props['Slug'].type === 'rich_text') {
        slug = richTextToPlain(props['Slug'].rich_text) || '';
      }
      if (!slug) slug = safeSlug(title);

      // date
      let date = '';
      if (props['Date'] && props['Date'].type === 'date' && props['Date'].date) date = props['Date'].date.start;
      if (!date && p.created_time) date = p.created_time;

      // tags
      let tags = [];
      if (props['Tags'] && props['Tags'].type === 'multi_select') tags = props['Tags'].multi_select.map(t => t.name);

      // categories（支持 select 或 multi_select；兼容拼写）
      let categories = [];
      const catProp = props['categories'] || props['Categories'] || props['catogories'] || props['Catogories'];
      if (catProp) {
        if (catProp.type === 'select' && catProp.select) {
          categories = [catProp.select.name];
        } else if (catProp.type === 'multi_select' && catProp.multi_select) {
          categories = catProp.multi_select.map(c => c.name);
        } else if (catProp.type === 'rich_text' && Array.isArray(catProp.rich_text)) {
          // 如果你把分类写成富文本，尝试按逗号分割
          const txt = richTextToPlain(catProp.rich_text).trim();
          if (txt) categories = txt.split(/[,，;]/).map(s => s.trim()).filter(Boolean);
        }
      }

      // excerpt（支持 rich_text 或 text）
      let excerpt = '';
      const excerptProp = props['Excerpt'] || props['excerpt'];
      if (excerptProp) {
        if ((excerptProp.type === 'rich_text' || excerptProp.type === 'text') && Array.isArray(excerptProp.rich_text)) {
          excerpt = richTextToPlain(excerptProp.rich_text);
        } else if (excerptProp.type === 'rich_text' && Array.isArray(excerptProp.rich_text)) {
          excerpt = richTextToPlain(excerptProp.rich_text);
        } else if (excerptProp.type === 'text' && Array.isArray(excerptProp.text)) {
          excerpt = richTextToPlain(excerptProp.text);
        } else {
          excerpt = plainFromRichOrTitle(excerptProp) || '';
        }
      }


      // hide 字段：优先支持 select，允许值：all / index / (空)
      let hide = '';
      const hideProp = props['hide'] || props['Hide'] || props['HIDE'];
      if (hideProp) {
        if (hideProp.type === 'select' && hideProp.select) {
          hide = String(hideProp.select.name || '').trim().toLowerCase();
        } else if (hideProp.type === 'checkbox') {
          // 兼容：checkbox true 等同 all
          hide = hideProp.checkbox ? 'all' : '';
        } else if (hideProp.type === 'multi_select' && hideProp.multi_select) {
          // 取第一个多选值并小写
          hide = (hideProp.multi_select[0]?.name || '').trim().toLowerCase();
        } else if (hideProp.type === 'rich_text' && Array.isArray(hideProp.rich_text)) {
          hide = richTextToPlain(hideProp.rich_text).trim().toLowerCase();
        } else {
          hide = String(plainFromRichOrTitle(hideProp) || '').trim().toLowerCase();
        }
      }
      // 仅接受 'all' 或 'index'，否则置为空
      if (hide !== 'all' && hide !== 'index') hide = '';


      // 使用 notion-to-md 转换页面内容为 markdown blocks
      // 将 mdObj 转成字符串
      const mdblocks = await n2m.pageToMarkdown(p.id);
      const mdObj = n2m.toMarkdownString(mdblocks);
      //let md = (mdObj && typeof mdObj === 'object') ? (mdObj.parent || mdObj) : ('' + mdObj || '');

      let md = '';
      if (mdObj) {
        if (typeof mdObj === 'string') {
          md = mdObj;
        } else if (mdObj.parent && typeof mdObj.parent === 'string') {
          md = mdObj.parent;
        } else if (Array.isArray(mdObj.content)) {
          md = mdObj.content.join('\n');
        } else {
          md = JSON.stringify(mdObj); // 万一以上都不是
        }
      }

      // ---------- 标题下调 ----------
      function shiftMarkdownHeaders(mdString) {
        if (typeof mdString !== 'string') return mdString;
        return mdString.replace(/^(#{1,3})\s+/gm, (match, hashes) => {
          const level = hashes.length;
          const newLevel = Math.min(level + 1, 6);
          return '#'.repeat(newLevel) + ' ';
        });
      }

      md = shiftMarkdownHeaders(md);


      // 提取图片 URL，并逐个下载替换
      const imageUrls = extractImageUrlsFromMarkdown(md);
      if (imageUrls.length) console.log(`Found ${imageUrls.length} images in "${title}" (${slug}).`);

      for (let i = 0; i < imageUrls.length; i++) {
        const imgUrl = imageUrls[i];
        try {
          // 构造文件名：slug-index.ext
          let ext = extFromUrlPath(imgUrl) || '';
          if (!ext) {
            // 临时用 .jpg，downloadToFile 会根据 content-type 修正
            ext = '.jpg';
          }
          // clean ext (remove query)
          ext = ext.split('?')[0];

          let localFilename = `${slug}-${i + 1}${ext}`;
          let localFilepath = path.join(UPLOADS_DIR_ON_DISK, localFilename);

          // 使用并发控制下载
          const result = await runWithLimit(async () => {
            // 如果 ext came from url contains query params making filename awkward, we will attempt to adjust after fetching
            let res = await downloadToFile(imgUrl, localFilepath);
            // 如果下载函数在根据 content-type 修改了文件名（追加扩展名），返回的 path 可能不同
            if (res && res.path && res.path !== localFilepath) {
              localFilepath = res.path;
              localFilename = path.basename(localFilepath);
            }
            return res;
          });

          if (result && result.skipped) {
            console.log(`Image exists, skipped: ${localFilename}`);
          } else {
            console.log(`Downloaded image: ${imgUrl} -> ${localFilename}`);
          }

          // 替换 md 中的远程 url 为本地相对路径
          const localUrlPath = `${UPLOADS_URL_BASE}/${localFilename}`;
          md = replaceUrlInMarkdown(md, imgUrl, localUrlPath);
        } catch (e) {
          console.error('Failed download image', imgUrl, e.message || e);
          // 遇到错误选择跳过（保留原链接，可能过期）
        }
      }

      // 构建文件内容：front-matter + md
      const titleHeading = `# ${title}\n\n`; // 将 title 写成正文 H1
      const fm = frontMatter({ title, date, categories, hide, tags, slug, excerpt, });
      const content = fm + md;

      // 写文件到 pages/posts/<slug>.md
      const filename = path.join(OUT_DIR, `${slug}.md`);
      fs.writeFileSync(filename, content, 'utf8');
      console.log('Wrote', filename);
    }

    console.log('All done.');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
