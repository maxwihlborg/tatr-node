# tatr.nvim

A neovim front end for the `tatr` cli: pick a task, then `lcd` into the task
dir and open it.

## Install

Requires the `tatr` binary on `$PATH` and
[plenary.nvim](https://github.com/nvim-lua/plenary.nvim).
[fzf-lua](https://github.com/ibhagwan/fzf-lua) is optional and only used by the
`:FzfLua tatr` picker.

```lua
{
  dir = "~/Desktop/tatr-node/apps/nvim",
  dependencies = { "nvim-lua/plenary.nvim" },
  cmd = "Tatr",
  opts = {},
}
```

## Usage

```vim
:Tatr
:Tatr .rust and prio lt 40
:TatrNew Write the docs
```

Everything after `:Tatr` is handed to `tatr ls` as a query, so the whole query
DSL works. The picker lists the tasks the way `tatr ls` prints them, and
selecting one opens the file, then runs `lcd` (see `cd` below) in that window
into the dir `tatr root` reports.

`:TatrNew [title]` runs `tatr new`, then opens the task it created with `create`
(`tabe` by default). Called without a title it asks for one through
`vim.ui.input`.

`:TatrMint` inserts a freshly minted `[<id>]: ` at the cursor, to be left in the
code as a marker:

```ts
// [DADD9K30YVSBT]: Mint and upsert tasks
function foo() {}
```

`:TatrTodo` goes the other way round: on a line carrying `TODO:` or `FIXME:` it
creates a task titled with the text after the marker and writes the id into the
marker, opening nothing.

```ts
// FIXME: crashes on empty input
// FIXME(DADDKSG5DX0WW): crashes on empty input
```

`FIXME` tags the task `bug`, per the `markers` map below.

`:TatrUpsert` with the cursor on either kind of line, `[<id>]:` or
`MARKER(<id>):`, opens the task that id names, creating it under that id first
if it does not exist yet. Whatever follows the colon becomes the title; with
nothing there it asks. Opening obeys `upsert`.

`:Tatr` uses the fzf-lua picker below when fzf-lua is installed, and
`vim.ui.select` otherwise; `picker = "select"` forces the latter. From lua,
`require("tatr").pick(opts)` does the
same, `require("tatr").new { title = { "..." } }` creates one, and
`require("tatr").open(task, opts)` opens a single task table from
`tatr ls -f json`.

### fzf-lua

`require("tatr.fzf").register()` registers the picker with fzf-lua, so
`:FzfLua tatr` and `require("fzf-lua").tatr()` work. `setup()` calls it for you
when fzf-lua is already loaded; register it from fzf-lua's own `config` if you
lazy load it:

```lua
{
  "ibhagwan/fzf-lua",
  config = function(_, opts)
    require("fzf-lua").setup(opts)
    require("tatr.fzf").register()
  end,
}
```

Like `tatr ls --fzf`, fzf does no matching of its own: what you type is the
query DSL, re-run through the cli on every keystroke, debounced by
`fzf.query_delay`. A query that does not compile shows the cli's complaint in
place of the list.

Entries are `tatr ls` output verbatim, colours and all, the preview is
`tatr show <id>` in a `markdown` buffer so treesitter highlights it,
`ctrl-g` cycles which tasks are listed, `open` → `closed` → `all`, with the
current one bracketed in the hint line fzf-lua draws under the count
(`:: <ctrl-g> to [open] - closed - all`). `ctrl-y` yanks the id of the task
under the cursor without leaving the picker,
and `enter`/`ctrl-s`/`ctrl-v`/`ctrl-t` open the task with
`edit`/`split`/`vsplit`/`tabedit`. `require("tatr.fzf").pick(opts)` is the
picker itself, and `opts.query` seeds the prompt.

### Language server

The cli ships one: `tatr lsp` speaks LSP over stdio, so markers work through
the usual keymaps in any buffer, no plugin commands involved. It needs no
`nvim-lspconfig`:

```lua
vim.lsp.config("tatr", {
  cmd = { "tatr", "lsp" },
  -- markers live in code, so attach wherever you leave them
  filetypes = { "typescript", "javascript", "lua", "rust", "markdown" },
  root_markers = { "tatr.config.yaml" },
})

vim.lsp.enable("tatr")
```

With that attached, on a line holding `[<id>]:` or `MARKER(<id>):`:

| keymap | what it does                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------ |
| `grd`  | jumps to the task file, like `:TatrUpsert` without the creating                                  |
| `K`    | shows the task, front matter and body                                                            |
| `grr`  | lists every marker pointing at the task                                                          |
| `gra`  | on a bare `TODO:`/`FIXME:`, creates the task and writes the id into the marker, like `:TatrTodo` |

`grr` also works anywhere inside a task file, where the task the file is stands
in for an id under the cursor. It searches with `ripgrep`, so it sees what is on
disk and skips whatever the repo ignores — a marker in an unsaved buffer is not
in the list yet. The task file itself is included as the declaration, which
clients ask for with `includeDeclaration`; `vim.lsp.buf.references()` does,
`fzf-lua`'s `lsp_references` does not unless told to.

`root_markers` is only how neovim decides where to attach a client — the server
resolves `tatr.config.yaml` per request, walking up from the file the request is
about, so several projects in one session are fine.

`init_options` turns a feature off, for when another plugin would rather tatr
kept out of a request it also answers:

```lua
vim.lsp.config("tatr", {
  init_options = { references = false },
})
```

If `tatr` is not on `PATH`, point `cmd` at it:
`cmd = { "node", "/path/to/apps/cli/bin/tatr.js", "lsp" }`.

## Configuration

Defaults, passed to `require("tatr").setup()`:

```lua
{
  cmd = { "tatr" },   -- how to invoke the cli
  args = {},          -- extra args for every `tatr ls`, e.g. { "--fzf" }
  order = {},         -- order keys, e.g. { "-prio", "title" } or { "-id" } for newest first
  cd = "lcd",         -- "lcd" | "tcd" | "cd" | false, run before opening
  open = "edit",      -- "edit" | "split" | "vsplit" | "tabedit"
  create = "tabe",    -- how :TatrNew opens the task it just created
  upsert = "tabe",    -- how :TatrUpsert opens the task under the cursor
  markers = {         -- what :TatrTodo picks up, and the tags it gives the task
    TODO = {},
    FIXME = { "bug" },
  },
  picker = "auto",    -- "auto" prefers fzf-lua when installed, "select" forces vim.ui.select
  prompt = "Tasks> ",
  fzf = {
    -- key -> how to open the task under the cursor, enter uses `open` above
    keys = {
      ["ctrl-t"] = "tabedit",
      ["ctrl-v"] = "vsplit",
      ["ctrl-s"] = "split",
    },
    copy = "ctrl-y",   -- key that yanks the task id, false to disable
    cycle = "ctrl-g",  -- key that cycles open -> closed -> all, false to disable
    status = "open",   -- which tasks the picker starts on
    query_delay = 150, -- ms fzf waits before re-running the query
    -- passed through to fzf_live
    opts = {},
  },
}
```

`order` becomes one `--order` flag with the keys comma joined, so it takes
whatever `tatr ls --order` takes: `title`, `tags`, `id`, `size`, `priority`
(`prio`), `mtime`, `btime`, each optionally `-` prefixed to reverse. Left empty
the cli's own default stands, and an `--order` in `args` wins over it.

Any of these can be overridden per call:
`require("tatr").pick { open = "vsplit" }`.

The cli runs with neovim's cwd, so it picks up the same `tatr.config.yaml` you
are editing under.
