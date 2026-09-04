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
```

Everything after `:Tatr` is handed to `tatr ls` as a query, so the whole query
DSL works. The picker lists the tasks the way `tatr ls` prints them, and
selecting one opens the file, then runs `lcd` (see `cd` below) in that window
into the dir `tatr root` reports.

`:Tatr` uses `vim.ui.select`. From lua, `require("tatr").pick(opts)` does the
same and `require("tatr").open(task, opts)` opens a single task table from
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
`tatr preview <id>` in a `markdown` buffer so treesitter highlights it, and
`enter`/`ctrl-s`/`ctrl-v`/`ctrl-t` open the task with
`edit`/`split`/`vsplit`/`tabedit`. `require("tatr.fzf").pick(opts)` is the
picker itself, and `opts.query` seeds the prompt.

## Configuration

Defaults, passed to `require("tatr").setup()`:

```lua
{
  cmd = { "tatr" },   -- how to invoke the cli
  args = {},          -- extra args for every `tatr ls`, e.g. { "--order=title" }
  cd = "lcd",         -- "lcd" | "tcd" | "cd" | false, run before opening
  open = "edit",      -- "edit" | "split" | "vsplit" | "tabedit"
  prompt = "Tasks> ",
  fzf = {
    -- key -> how to open the task under the cursor, enter uses `open` above
    keys = {
      ["ctrl-t"] = "tabedit",
      ["ctrl-v"] = "vsplit",
      ["ctrl-s"] = "split",
    },
    query_delay = 150, -- ms fzf waits before re-running the query
    -- passed through to fzf_live
    opts = {},
  },
}
```

Any of these can be overridden per call:
`require("tatr").pick { open = "vsplit" }`.

The cli runs with neovim's cwd, so it picks up the same `tatr.config.yaml` you
are editing under.
