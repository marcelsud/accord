---
title: Accord - Composable domain modeling
titleTemplate: ':title'
layout: home
hero:
  name: Accord
  text: Composable domain modeling
  tagline: Simplifying DDD for the rest of us. Business rules, events, and reactions through a small, explicit TypeScript API.
  actions:
    - theme: brand
      text: Get Started
      link: /docs/
    - theme: alt
      text: View on GitHub
      link: https://github.com/marcelsud/accord
features:
  - icon: 🧩
    title: Small, explicit API
    details: Aggregates, events, rejections, views, and policies. Plain functions and classes you can read in one sitting.
  - icon: 🏷️
    title: Tuples, not throws
    details: Every operation returns [value, null] or [null, error]. Business failures are plain tagged values you can match exhaustively.
  - icon: 💾
    title: Memory or SQLite
    details: An in-process runtime with a memory store by default, and optional SQLite persistence that recovers after restart.
  - icon: ⚡
    title: Effect optional
    details: Zero runtime dependencies for the core. Add Effect only if you want layers and lazy Effects.
  - icon: 🧭
    title: DDD, without the ceremony
    details: Ubiquitous language, aggregates, commands, events, policies, and read models, each mapped to a few functions.
    link: /docs/concepts/ddd/
    linkText: DDD concepts
---
