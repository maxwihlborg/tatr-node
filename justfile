alias i := install
alias b := build
alias t := test
alias f := format
alias pr := pull-request

@default:
    just --list

install:
    pnpm install

build:
    pnpm exec turbo run build

pull-request:
    pnpm exec turbo run format lint build
    pnpm exec vitest --run

format-tasks:
    pnpm exec oxfmt ./tasks/**/*.{md}

format: format-tasks
    pnpm exec turbo run format

test:
    pnpm exec vitest --run
