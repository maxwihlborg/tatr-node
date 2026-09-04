local cli = require "tatr.cli"
local fzf = require "fzf-lua"
local tatr = require "tatr"

local M = {}

--- `tatr ls` as a shell command for fzf to reload on every keystroke. fzf-lua
--- appends the query placeholder and escapes the typed query for us.
---@param cfg TatrConfig
---@return string
local function list_command(cfg)
  -- --color: nothing is a tty here, --log-level=none: the cli's skipped-file
  -- logs would end up in the list
  local args = { "ls", "--color", "--log-level=none" }
  vim.list_extend(args, cfg.args)

  local parts = {}
  for _, arg in ipairs(vim.list_extend(vim.deepcopy(cfg.cmd), args)) do
    parts[#parts + 1] = vim.fn.shellescape(arg)
  end

  return table.concat(parts, " ")
end

--- The id `tatr ls` prints in front of every task.
---@param entry string
---@return string?
local function id_of(entry)
  return (fzf.utils.strip_ansi_coloring(entry)):match "^(.-): %["
end

--- `tatr preview <id>` in a real buffer, so the markdown gets a filetype and
--- with it treesitter, rather than the flat text a shell previewer would give.
--- Handed over as a `_ctor` spec: fzf-lua merges a table previewer with its
--- builtin defaults, which would drop the class' metatable on the way.
---@param cfg TatrConfig
---@return { _ctor: fun(): table }
function M.previewer(cfg)
  local Task = require("fzf-lua.previewer.builtin").buffer_or_file:extend()

  ---@param entry_str string
  ---@param cb fun(entry: table)
  function Task:parse_entry(entry_str, cb)
    local id = id_of(entry_str)
    if not id then
      return {}
    end

    cli.preview({ cmd = cfg.cmd, id = id }, function(lines, err)
      cb { title = id, filetype = "markdown", content = lines or vim.split(err, "\n") }
    end)
  end

  return {
    _ctor = function()
      return Task
    end,
  }
end

--- Pick a task with fzf-lua and open it. fzf does no matching of its own, each
--- keystroke re-runs the query through the cli, the way `tatr ls --fzf` does.
---@param opts TatrConfig|{ query: string[] }|nil
function M.pick(opts)
  local cfg = tatr.resolve(opts)

  local function open(with)
    return function(selected)
      local id = id_of(selected[1])
      if id then
        tatr.open({ id = id }, vim.tbl_deep_extend("force", cfg, { open = with }))
      end
    end
  end

  local actions = { ["default"] = open(cfg.open) }
  for key, with in pairs(cfg.fzf.keys) do
    actions[key] = open(with)
  end

  fzf.fzf_live(
    list_command(cfg),
    vim.tbl_deep_extend("force", {
      prompt = cfg.prompt,
      actions = actions,
      previewer = M.previewer(cfg),
      query = table.concat((opts or {}).query or {}, " "),
      -- fzf sleeps this long before reloading, so a burst of keystrokes only
      -- costs one run of the cli
      query_delay = cfg.fzf.query_delay,
      exec_empty_query = true,
      fzf_opts = { ["--no-multi"] = true },
    }, cfg.fzf.opts)
  )
end

--- Make the picker available as `:FzfLua tatr`.
---@param override boolean? replace an existing `tatr` extension
function M.register(override)
  -- registering twice warns, and setup() may well run more than once
  if fzf.tatr and not override then
    return
  end

  fzf.register_extension("tatr", M.pick, {}, override)
end

return M
