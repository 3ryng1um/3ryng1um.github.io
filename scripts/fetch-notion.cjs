/**
 * fetch-notion-md.js
 * 将 Notion Database 中已发布的页面转换为 Markdown，写入 pages/posts/
 *
 * 需要环境变量：
 *   NOTION_TOKEN
 *   NOTION_DATABASE_ID
 *
 * 用法（本地测试）：
 *   NOTION_TOKEN=xxx NOTION_DATABASE_ID=yyy node scripts/fetch-notion-md.js
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');
const { NotionToMarkdown } = require('notion-to-md');
const slugify = require('slugify');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const OUT_DIR = path.join(process.cwd(), 'pages', 'posts'); // 写到 Valaxy 的 posts 源目录

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('ERROR: NOTION_TOKEN and NOTION_DATABASE_ID must be set in env.');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

function safeSlug(text) {
  if (!text) return Date.now().toString(36);
  return slugify(text, { lower: true, strict: true });
}

function frontMatter(meta) {
  // meta: { title, date, tags, excerpt, slug }
  const lines = ['---'];
  if (meta.title) lines.push(`title: "${meta.title.replace(/"/g, '\\"')}"`);
  if (meta.date) lines.push(`date: "${meta.date}"`);
  if (meta.slug) lines.push(`slug: "${meta.slug}"`);
  if (meta.tags && meta.tags.length) lines.push(`tags: [${meta.tags.map(t => `"${t.replace(/"/g,'\\"')}"`).join(', ')}]`);
  if (meta.excerpt) lines.push(`excerpt: "${meta.excerpt.replace(/"/g, '\\"')}"`);
  lines.push('---\n');
  return lines.join('\n');
}

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

function richTextToPlain(rich = []) {
  return (rich || []).map(rt => {
    if (rt.type === 'text') return rt.text?.content || '';
    if (rt.type === 'mention') return rt.mention?.user?.name || rt.mention?.name || '';
    if (rt.type === 'equation') return rt.equation?.expression || '';
    return '';
  }).join('');
}

(async () => {
  try {
    console.log('Querying Notion DB:', NOTION_DATABASE_ID);
    const pages = await queryPublishedDatabase();
    console.log(`Found ${pages.length} published pages.`);

    fs.mkdirSync(OUT_DIR, { recursive: true });

    for (const p of pages) {
      const props = p.properties || {};

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

      // excerpt（可选）
      let excerpt = '';
      if (props['Excerpt'] && (props['Excerpt'].type === 'rich_text' || props['Excerpt'].type === 'title')) {
        const rt = props['Excerpt'].rich_text || props['Excerpt'].title || [];
        excerpt = richTextToPlain(rt);
      }

      // 使用 notion-to-md 转换页面内容为 markdown blocks
      const mdblocks = await n2m.pageToMarkdown(p.id);
      const mdString = n2m.toMarkdownString(mdblocks);

      // 构建文件内容：front-matter + mdString
      const fm = frontMatter({ title, date, tags, excerpt, slug });
      const content = fm + mdString.parent || mdString;

      // 写文件到 src/posts/<slug>.md
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
