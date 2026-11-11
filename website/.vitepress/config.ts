import { defineConfig } from 'vitepress'
import type { DefaultTheme } from 'vitepress'
import {
  groupIconMdPlugin,
  groupIconVitePlugin,
} from 'vitepress-plugin-group-icons'
import llmstxt from 'vitepress-plugin-llms'

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = 'https://github.com/marcelsud/accord'

/**
 * Where the runnable examples live. Links written as `[text](examples:bank/domain.ts)`
 * are rewritten to `${EXAMPLES_BASE}/bank/domain.ts` at build time.
 * Change this one value (or set ACCORD_EXAMPLES_BASE) to point the docs at another checkout.
 * Paths are relative to the accord-examples repository root, such as `bank/domain.ts`.
 */
const EXAMPLES_BASE =
  process.env.ACCORD_EXAMPLES_BASE ??
  'https://github.com/marcelsud/accord-examples/tree/main'
const EXAMPLES_PREFIX = 'examples:'
const examplesUrl = (path: string) =>
  path ? `${EXAMPLES_BASE}/${path}` : EXAMPLES_BASE.replace(/\/tree\/[^/]+$/, '')

// markdown-it plugin: rewrite `examples:` link hrefs.
function examplesLinks(md: any) {
  const render =
    md.renderer.rules.link_open ??
    ((tokens: any, idx: number, options: any, _env: any, self: any) =>
      self.renderToken(tokens, idx, options))
  md.renderer.rules.link_open = (tokens: any, idx: number, options: any, env: any, self: any) => {
    const href = tokens[idx].attrGet('href')
    if (href?.startsWith(EXAMPLES_PREFIX)) {
      tokens[idx].attrSet('href', examplesUrl(href.slice(EXAMPLES_PREFIX.length)))
      tokens[idx].attrSet('target', '_blank')
      tokens[idx].attrSet('rel', 'noreferrer')
    }
    return render(tokens, idx, options, env, self)
  }
}

// Apply the same rewrite to the Markdown copies emitted for agents (llms*.txt, *.md).
function rewriteExampleLinksIn(dir: string) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name)
    if (statSync(file).isDirectory()) {
      rewriteExampleLinksIn(file)
    } else if (/\.(md|txt)$/.test(name)) {
      const text = readFileSync(file, 'utf8')
      const next = text.replace(/\]\(examples:([^)\s]*)\)/g, (_m, path) => `](${examplesUrl(path)})`)
      if (next !== text) writeFileSync(file, next)
    }
  }
}

const sidebars = (): DefaultTheme.SidebarItem[] => [
  {
    text: 'Concepts',
    collapsed: true,
    items: [
      { text: 'Motivation', link: '/docs/concepts/motivation' },
      { text: 'Tuples, not throws', link: '/docs/concepts/results' },
      { text: 'Events and delivery', link: '/docs/concepts/delivery' },
      {
        text: 'DDD Concepts',
        collapsed: true,
        items: [
          { text: 'Overview', link: '/docs/concepts/ddd/' },
          { text: 'Ubiquitous language', link: '/docs/concepts/ddd/ubiquitous-language' },
          { text: 'Entities and value objects', link: '/docs/concepts/ddd/entities-and-value-objects' },
          { text: 'Aggregates and invariants', link: '/docs/concepts/ddd/aggregates' },
          { text: 'Commands', link: '/docs/concepts/ddd/commands' },
          { text: 'Domain events', link: '/docs/concepts/ddd/domain-events' },
          { text: 'Rejections', link: '/docs/concepts/ddd/rejections' },
          { text: 'Repositories', link: '/docs/concepts/ddd/repositories' },
          { text: 'Domain services', link: '/docs/concepts/ddd/domain-services' },
          { text: 'Policies', link: '/docs/concepts/ddd/policies' },
          { text: 'Read models', link: '/docs/concepts/ddd/read-models' },
          { text: 'Workflows', link: '/docs/concepts/ddd/workflows' },
          { text: 'Anti-corruption layer', link: '/docs/concepts/ddd/anti-corruption' },
          { text: 'Tutorial', link: '/docs/concepts/ddd/tutorial' },
        ],
      },
    ],
  },
  {
    text: 'Getting Started',
    collapsed: false,
    items: [
      { text: 'Basic', link: '/docs/getting-started/basic' },
      { text: 'SQLite', link: '/docs/getting-started/sqlite' },
      { text: 'Effect', link: '/docs/getting-started/effect' },
    ],
  },
  {
    text: 'API',
    collapsed: true,
    items: [
      { text: 'Schemas', link: '/docs/api/schema' },
      { text: 'Results', link: '/docs/api/result' },
      { text: 'Events and Rejections', link: '/docs/api/events' },
      { text: 'Value Objects', link: '/docs/api/value-object' },
      { text: 'Aggregate', link: '/docs/api/aggregate' },
      { text: 'Model and wire', link: '/docs/api/model' },
      { text: 'View', link: '/docs/api/view' },
      { text: 'Policy', link: '/docs/api/policy' },
      { text: 'Projection', link: '/docs/api/projection' },
      { text: 'Service', link: '/docs/api/service' },
      { text: 'External', link: '/docs/api/external' },
      { text: 'Workflow', link: '/docs/api/workflow' },
      { text: 'Stream', link: '/docs/api/stream' },
      { text: 'HTTP API', link: '/docs/api/http' },
      { text: 'Story', link: '/docs/api/story' },
      { text: 'SQLite store', link: '/docs/api/sqlite' },
      { text: 'Effect', link: '/docs/api/effect' },
    ],
  },
  {
    text: 'Guides',
    collapsed: true,
    items: [
      { text: 'Testing', link: '/docs/guides/testing' },
      { text: 'Versioning and migrations', link: '/docs/guides/migrations' },
      { text: 'Best Practices', link: '/docs/guides/best-practices' },
      { text: 'Limits of v0.1', link: '/docs/guides/limits' },
      { text: 'FAQs', link: '/docs/guides/faq' },
      { text: 'Contributing', link: '/docs/guides/contributing' },
    ],
  },
  {
    text: 'Coding Agents',
    collapsed: true,
    items: [
      { text: 'Docs List', link: '/llms.txt' },
      { text: 'Full Docs', link: '/llms-full.txt' },
    ],
  },
]

const sidebarsExamples = (): DefaultTheme.SidebarItem[] => [
  {
    text: 'Examples',
    items: [
      { text: 'Overview', link: '/examples/' },
      { text: 'Bank', link: '/examples/bank' },
      { text: 'Notifications + SQLite ledger', link: '/examples/notifications' },
      { text: 'Durable bank', link: '/examples/durable-bank' },
      { text: 'CRM and migrations', link: '/examples/crm' },
      { text: 'Source on GitHub', link: examplesUrl('') },
    ],
  },
]

export default defineConfig({
  lang: 'en-US',
  title: 'Accord',
  description:
    'Composable domain modeling for TypeScript. Simplifying DDD for the rest of us.',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: false,
  head: [
    ['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Accord - Composable domain modeling' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Define business rules, record what happened, and describe what should happen next through a small, explicit TypeScript API.',
      },
    ],
  ],
  themeConfig: {
    logo: '/favicon.svg',
    siteTitle: 'Accord',
    search: { provider: 'local' },
    nav: [
      { text: 'Docs', link: '/docs/' },
      { text: 'Examples', link: '/examples/' },
      { text: 'Runtime reference', link: `${repo}/blob/main/docs/runtime.md` },
    ],
    sidebar: {
      '/docs/': sidebars(),
      '/examples/': sidebarsExamples(),
    },
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: {
      pattern: `${repo}/edit/main/website/:path`,
      text: 'Edit this page on GitHub',
    },
    outline: { level: [2, 3] },
    footer: {
      message: 'Accord is currently UNLICENSED. No open-source license has been selected yet.',
      copyright: 'Copyright © Marcelo Santos',
    },
  },
  markdown: {
    config(md) {
      md.use(groupIconMdPlugin)
      md.use(examplesLinks)
    },
  },
  buildEnd(siteConfig) {
    rewriteExampleLinksIn(siteConfig.outDir)
  },
  vite: {
    plugins: [
      groupIconVitePlugin(),
      llmstxt({
        domain: 'https://accord-docs-aqu.pages.dev',
        ignoreFiles: ['index.md'],
      }),
    ],
  },
})
