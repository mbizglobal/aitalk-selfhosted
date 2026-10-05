import { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';

const BASE = 'https://www.aitalk.ch';
const LANGS = ['en', 'de', 'de-ch', 'fr', 'es', 'ko'] as const;

type LangAlts = Record<string, string>;

function langAlternates(path: string): LangAlts {
  return Object.fromEntries(LANGS.map(l => {
    if (path === '/mbizglobal' && l === 'de') return [l, `${BASE}/${l}/aboutus`];
    return [l, `${BASE}/${l}${path}`];
  }));
}

function blogLangAlternates(): LangAlts {
  return Object.fromEntries(LANGS.map(l => [l, `${BASE}/blog/${l}`]));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // Static public pages per language
  const staticPages: MetadataRoute.Sitemap = LANGS.flatMap(lang => [
    {
      url: `${BASE}/${lang}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
      alternates: { languages: langAlternates('') },
    },
    {
      url: `${BASE}/${lang}/pricing`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
      alternates: { languages: langAlternates('/pricing') },
    },
    {
      url: lang === 'de' ? `${BASE}/de/aboutus` : `${BASE}/${lang}/mbizglobal`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
      alternates: { languages: langAlternates('/mbizglobal') },
    },
    {
      url: `${BASE}/${lang}/law/privacy-policy`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
      alternates: { languages: langAlternates('/law/privacy-policy') },
    },
    {
      url: `${BASE}/${lang}/law/terms-of-use`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
      alternates: { languages: langAlternates('/law/terms-of-use') },
    },
    {
      url: `${BASE}/${lang}/law/cookie-policy`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
      alternates: { languages: langAlternates('/law/cookie-policy') },
    },
    {
      url: `${BASE}/${lang}/law/data-processor-agreement`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
      alternates: { languages: langAlternates('/law/data-processor-agreement') },
    },
  ]);

  // Blog posts (dynamic from DB) + Blog list pages
  let postPages: MetadataRoute.Sitemap = [];
  let blogListPages: MetadataRoute.Sitemap = [];
  try {
    const posts = await prisma.blogPost.findMany({
      where: { published: true, language: { not: 'ja' } },
      select: { slug: true, language: true, updatedAt: true, groupId: true },
    });

    const groupMap = new Map<string, Map<string, string>>();
    for (const post of posts) {
      if (!post.groupId) continue;
      let langSlugs = groupMap.get(post.groupId);
      if (!langSlugs) {
        langSlugs = new Map();
        groupMap.set(post.groupId, langSlugs);
      }
      langSlugs.set(post.language, post.slug);
    }

    postPages = posts.map(post => {
      const groupSlugs = post.groupId ? groupMap.get(post.groupId) : null;
      const altLangs: Record<string, string> = groupSlugs
        ? Object.fromEntries(
            Array.from(groupSlugs.entries()).map(([l, s]) => [l, `${BASE}/blog/${l}/${s}`])
          )
        : { [post.language]: `${BASE}/blog/${post.language}/${post.slug}` };

      const enSlug = groupSlugs?.get('en') ?? post.slug;
      const enLang = groupSlugs?.has('en') ? 'en' : post.language;
      altLangs['x-default'] = `${BASE}/blog/${enLang}/${enSlug}`;

      return {
        url: `${BASE}/blog/${post.language}/${post.slug}`,
        lastModified: post.updatedAt,
        changeFrequency: 'monthly' as const,
        priority: 0.6,
        alternates: { languages: altLangs },
      };
    });

    const langsWithPosts = new Set(posts.map(p => p.language));
    blogListPages = LANGS.filter(lang => langsWithPosts.has(lang)).map(lang => ({
      url: `${BASE}/blog/${lang}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
      alternates: {
        languages: Object.fromEntries(
          LANGS.filter(l => langsWithPosts.has(l)).map(l => [l, `${BASE}/blog/${l}`])
        ),
      },
    }));
  } catch {
    // DB unavailable during build — skip posts; fallback to all blog list pages
    blogListPages = LANGS.map(lang => ({
      url: `${BASE}/blog/${lang}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
      alternates: { languages: blogLangAlternates() },
    }));
  }

  return [...staticPages, ...blogListPages, ...postPages];
}
