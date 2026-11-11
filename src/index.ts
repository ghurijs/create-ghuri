#!/usr/bin/env node
// `npm create ghuri@latest` entry point. The programmatic API lives in ./create.
import { createGhuri } from './create'

createGhuri(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
