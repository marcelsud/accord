# Contributing

Accord lives at [github.com/marcelsud/accord](https://github.com/marcelsud/accord). Issues and pull requests are welcome.

## Develop

```sh
git clone https://github.com/marcelsud/accord.git
cd accord
npm ci --ignore-scripts
npm run check
```

| Script | What it does |
| --- | --- |
| `npm run typecheck` | Positive assertions and `@ts-expect-error` inference tests |
| `npm test` | Build, compile tests, and run Node's built-in test runner |
| `npm run build` | ESM and declaration files in `dist/` |
| `npm run check` | Typecheck and tests |

## Docs

This site lives in `website/` and uses [VitePress](https://vitepress.dev).

```sh
cd website
npm install
npm run docs:dev
```
